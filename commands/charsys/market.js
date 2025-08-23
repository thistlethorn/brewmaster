// commands/charsys/market.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../database');

// In-memory set to track users currently in a trade session to prevent concurrent trades.
const activeTrades = new Set();
const TRADE_TIMEOUT = 30 * 60 * 1000;
const tradeTimestamps = new Map();

function addToActiveTrades(userId) {
	activeTrades.add(userId);
	tradeTimestamps.set(userId, Date.now());
}

setInterval(() => {
	const now = Date.now();
	for (const [userId, timestamp] of tradeTimestamps.entries()) {
		if (now - timestamp > TRADE_TIMEOUT) {
			activeTrades.delete(userId);
			tradeTimestamps.delete(userId);
		}
	}
}, 5 * 60 * 1000);

/**
 * Creates the base User Interface embed for a trade session.
 * @param {import('discord.js').User} initiator
 * @param {import('discord.js').User} receiver
 * @returns {EmbedBuilder}
 */
function buildTradeEmbed(initiator, receiver) {
	return new EmbedBuilder()
		.setTitle(`Trading Session: ${initiator.username} ↔️ ${receiver.username}`);
}

/**
 * Creates the action buttons for the trading UI based on the session's state.
 * @param {string} sessionId The ID of the trade session.
 * @param {object} session The current session data from the database.
 * @param {string} userId The ID of the user viewing the buttons.
 * @returns {ActionRowBuilder[]}
 */
function buildTradeButtons(sessionId, session, userId) {
	const userIsInitiator = userId === session.initiator_user_id;
	const isLocked = userIsInitiator ? session.initiator_locked : session.receiver_locked;

	const row1 = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`trade_add_item_${sessionId}`).setLabel('Add Item').setStyle(ButtonStyle.Success).setEmoji('🎒').setDisabled(!!isLocked),
		new ButtonBuilder().setCustomId(`trade_add_crowns_${sessionId}`).setLabel('Add Crowns').setStyle(ButtonStyle.Success).setEmoji('👑').setDisabled(!!isLocked),
		new ButtonBuilder().setCustomId(`trade_remove_item_${sessionId}`).setLabel('Remove Item').setStyle(ButtonStyle.Secondary).setEmoji('✏️').setDisabled(!!isLocked),
	);
	const row2 = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`trade_lock_offer_${sessionId}`)
			.setLabel(isLocked ? 'Unlock Offer' : 'Lock Offer')
			.setStyle(isLocked ? ButtonStyle.Secondary : ButtonStyle.Primary)
			.setEmoji(isLocked ? '🔓' : '🔒'),
		new ButtonBuilder().setCustomId(`trade_cancel_trade_${sessionId}`).setLabel('Cancel Trade').setStyle(ButtonStyle.Danger).setEmoji('❌'),
	);
	return [row1, row2];
}

/**
 * Fetches the current state of a trade and updates the main UI embed and buttons.
 * @param {import('discord.js').Interaction} interaction The interaction object.
 * @param {number} sessionId The ID of the trade session.
 */
async function updateTradeUI(interaction, sessionId) {
	const session = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);
	if (!session || session.status !== 'PENDING') return;
	if (!activeTrades.has(session.initiator_user_id) || !activeTrades.has(session.receiver_user_id)) {
	// Trade has been cleaned up by timeout, update DB to reflect this
		db.prepare('UPDATE trade_sessions SET status = \'CANCELLED\' WHERE session_id = ?').run(sessionId);
		return;
	}

	const offers = db.prepare(`
        SELECT tsi.user_id, tsi.crown_amount, i.name as item_name
        FROM trade_session_items tsi
        LEFT JOIN user_inventory ui ON tsi.inventory_id = ui.inventory_id
        LEFT JOIN items i ON ui.item_id = i.item_id
        WHERE tsi.session_id = ?
    `).all(sessionId);

	const initiator = await interaction.client.users.fetch(session.initiator_user_id);
	const receiver = await interaction.client.users.fetch(session.receiver_user_id);

	const formatOffer = (offer) => {
		if (offer.length === 0) return '*Nothing offered yet.*';
		return offer.map(o => o.crown_amount ? `• 👑 ${o.crown_amount.toLocaleString()} Crowns` : `• ${o.item_name}`).join('\n');
	};

	const initiatorOfferText = formatOffer(offers.filter(o => o.user_id === session.initiator_user_id));
	const receiverOfferText = formatOffer(offers.filter(o => o.user_id === session.receiver_user_id));

	const embed = buildTradeEmbed(initiator, receiver)
		.setColor(session.initiator_locked && session.receiver_locked ? 0xFEE75C : 0x3498DB)
		.addFields(
			{ name: `${session.initiator_locked ? '✅' : '🔒'} ${initiator.username}'s Offer`, value: initiatorOfferText, inline: true },
			{ name: `${session.receiver_locked ? '✅' : '🔒'} ${receiver.username}'s Offer`, value: receiverOfferText, inline: true },
		);

	let components = [];
	if (session.initiator_locked && session.receiver_locked) {
		embed.setFooter({ text: 'Both parties have locked in. Review the final trade and press Confirm.' });
		const confirmRow = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`trade_final_confirm_${sessionId}`).setLabel('Confirm Final Trade').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`trade_cancel_trade_${sessionId}`).setLabel('Cancel Trade').setStyle(ButtonStyle.Danger),
		);
		components.push(confirmRow);
	}
	else {
		embed.setFooter({ text: 'Use the buttons to manage your offer. Both parties must lock in before confirming.' });
		// We need to generate buttons for both users to see their correct "Lock/Unlock" state.
		// Since we can only edit the message once, we send a generic set. The button handler will use the interaction user's ID to determine their state.
		// A more advanced solution would be sending ephemeral "control panel" messages to each user, but this is simpler and effective.
		components = buildTradeButtons(sessionId, session, interaction.user.id);
	}

	  // Resolve the trade UI message to edit.
	let message = interaction.message || null;
	if (!message) {
		const row = db.prepare('SELECT ui_message_id FROM trade_sessions WHERE session_id = ?').get(sessionId);
		if (row?.ui_message_id) {
			try {
				message = await interaction.channel.messages.fetch(row.ui_message_id);
			}
			catch (e) {
				// message not found (deleted) -> bail out gracefully
				console.error('Trade UI Message not found: ', e);
				return;
			}
		}
		else {
			// No persisted message id; cannot safely edit.
			return;
		}
	}
	await message.edit({ embeds: [embed], components });
}


/**
 * Performs the final, atomic exchange of all items and crowns.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {number} sessionId
 */
async function executeTrade(interaction, sessionId) {
	const session = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);
	if (!session.initiator_locked || !session.receiver_locked || session.status !== 'PENDING') {
		return interaction.followUp({ content: 'Trade cannot be confirmed. One or both parties have not locked their offer.', flags: MessageFlags.Ephemeral });
	}

	try {
		const tradeExecutionTx = db.transaction(() => {
			const currentSession = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ? FOR UPDATE').get(sessionId);
			if (!currentSession || currentSession.status !== 'PENDING') {
				throw new Error('Trade is no longer pending');
			}

			const offers = db.prepare('SELECT * FROM trade_session_items WHERE session_id = ?').all(sessionId);
			const initiatorOffers = offers.filter(o => o.user_id === session.initiator_user_id);
			const receiverOffers = offers.filter(o => o.user_id === session.receiver_user_id);

			const processOffers = (senderId, receiverId, sentOffers) => {
				const totalCrowns = sentOffers.reduce((sum, offer) => sum + (offer.crown_amount || 0), 0);
				if (totalCrowns > 0) {
					const result = db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ? AND crowns >= ?').run(totalCrowns, senderId, totalCrowns);
					if (result.changes === 0) {
						throw new Error(`Insufficient funds for user ${senderId} at time of trade.`);
					}
					db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(totalCrowns, receiverId);
				}
				for (const offer of sentOffers) {
					if (offer.inventory_id) {
						db.prepare('UPDATE user_inventory SET user_id = ? WHERE inventory_id = ?').run(receiverId, offer.inventory_id);
					}
				}
			};

			processOffers(session.initiator_user_id, session.receiver_user_id, initiatorOffers);
			processOffers(session.receiver_user_id, session.initiator_user_id, receiverOffers);

			db.prepare('UPDATE trade_sessions SET status = \'COMPLETED\' WHERE session_id = ?').run(sessionId);
		});

		tradeExecutionTx();

		activeTrades.delete(session.initiator_user_id);
		activeTrades.delete(session.receiver_user_id);
		tradeTimestamps.delete(session.initiator_user_id);
		tradeTimestamps.delete(session.receiver_user_id);

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle('✅ Trade Successful!')
			.setDescription('The items and crowns have been exchanged. This thread will be archived shortly.');

		await interaction.message.edit({ embeds: [successEmbed], components: [] });
		setTimeout(() => interaction.channel.delete().catch(console.error), 15000);

	}
	catch (error) {
		console.error('Trade execution error:', error);

		let failingUser = null;
		if (error.message.includes(session.initiator_user_id)) {
			failingUser = await interaction.client.users.fetch(session.initiator_user_id);
		}
		else if (error.message.includes(session.receiver_user_id)) {
			failingUser = await interaction.client.users.fetch(session.receiver_user_id);
		}

		const errorMessage = failingUser
			? `${failingUser.username} no longer has enough crowns to complete the trade.`
			: 'A critical database error occurred.';

		await interaction.followUp({
			content: `**Trade Failed:** ${errorMessage} The trade has been cancelled, and no items or crowns were exchanged.`,
			flags: MessageFlags.Ephemeral,
		});

		db.prepare('UPDATE trade_sessions SET status = \'CANCELLED\' WHERE session_id = ?').run(sessionId);
		activeTrades.delete(session.initiator_user_id);
		activeTrades.delete(session.receiver_user_id);
		tradeTimestamps.delete(session.initiator_user_id);
		tradeTimestamps.delete(session.receiver_user_id);

		const cancelEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle('Trade Failed & Cancelled')
			.setDescription('The trade could not be completed due to insufficient funds or an error.');
		await interaction.message.edit({ embeds: [cancelEmbed], components: [] });
	}
}
module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('market')
		.setDescription('Interact with the player-driven economy.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('trade')
				.setDescription('Initiate a secure trade with another player.')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('The player you want to trade with.')
						.setRequired(true))),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'trade') {
			const initiator = interaction.user;
			const receiver = interaction.options.getUser('user');

			if (initiator.id === receiver.id) {
				return interaction.reply({ content: 'You cannot trade with yourself.', flags: MessageFlags.Ephemeral });
			}
			if (receiver.bot) {
				return interaction.reply({ content: 'You cannot trade with bots.', flags: MessageFlags.Ephemeral });
			}
			if (activeTrades.has(initiator.id) || activeTrades.has(receiver.id)) {
				return interaction.reply({ content: 'One of the participants is already in an active trade session.', flags: MessageFlags.Ephemeral });
			}

			try {
				addToActiveTrades(initiator.id);
				addToActiveTrades(receiver.id);

				await interaction.reply({ content: `Sending a trade request to ${receiver.username}...`, flags: MessageFlags.Ephemeral });

				const requestEmbed = new EmbedBuilder()
					.setColor(0xFEE75C)
					.setTitle('Incoming Trade Request!')
					.setDescription(`${initiator.username} wants to trade with you. Do you accept?`)
					.setFooter({ text: 'This request will expire in 60 seconds.' });

				const requestRow = new ActionRowBuilder().addComponents(
					new ButtonBuilder().setCustomId(`trade_accept_${initiator.id}_${receiver.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
					new ButtonBuilder().setCustomId(`trade_decline_${initiator.id}_${receiver.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
				);

				const requestMessage = await interaction.channel.send({ content: `<@${receiver.id}>`, embeds: [requestEmbed], components: [requestRow] });

				let tradeAccepted = false;
				const filter = i => i.user.id === receiver.id;
				const collector = requestMessage.createMessageComponentCollector({ filter, max: 1, time: 60000 });

				collector.on('collect', async i => {
					if (i.customId.startsWith('trade_accept')) {
						await i.deferUpdate();
						tradeAccepted = true;
						const result = db.prepare('INSERT INTO trade_sessions (initiator_user_id, receiver_user_id, status, initiator_locked, receiver_locked) VALUES (?, ?, \'PENDING\', 0, 0)').run(initiator.id, receiver.id);
						const sessionId = result.lastInsertRowid;
						const session = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);

						const thread = await interaction.channel.threads.create({
							name: `Trade-${initiator.username}-${receiver.username}`,
							type: ChannelType.PrivateThread,
							reason: `Secure trade session ${sessionId}`,
						});

						await thread.members.add(initiator.id);
						await thread.members.add(receiver.id);

						const tradeEmbed = buildTradeEmbed(initiator, receiver);
						const tradeButtons = buildTradeButtons(sessionId, session, initiator.id);
						const tradeMessage = await thread.send({ embeds: [tradeEmbed], components: tradeButtons });

						// Persist the UI message id for future edits (e.g., from modals)
						db.prepare('UPDATE trade_sessions SET ui_message_id = ? WHERE session_id = ?').run(tradeMessage.id, sessionId);

						await requestMessage.edit({ content: `Trade accepted! Please proceed to the private thread: ${thread}`, embeds: [], components: [] });

					}
					else if (i.customId.startsWith('trade_decline')) {
						activeTrades.delete(initiator.id);
						activeTrades.delete(receiver.id);
						await i.update({ content: `${receiver.username} has declined the trade request.`, embeds: [], components: [] });
					}
				});

				collector.on('end', async (collected, reason) => {
					if (reason === 'time' && !tradeAccepted) {
						activeTrades.delete(initiator.id);
						activeTrades.delete(receiver.id);
						if (requestMessage) {
							await requestMessage.edit({ content: 'The trade request has expired.', embeds: [], components: [] }).catch((e) => {console.error(e);});
						}
					}
				});

			}
			catch (error) {
				console.error('Trade initiation error:', error);
				activeTrades.delete(initiator.id);
				activeTrades.delete(receiver.id);
				tradeTimestamps.delete(initiator.id);
			    tradeTimestamps.delete(receiver.id);

				await interaction.followUp({ content: 'An error occurred while trying to start the trade.', flags: MessageFlags.Ephemeral });
			}
		}
		else {
			await interaction.reply({ content: 'This market command is not yet implemented.', flags: MessageFlags.Ephemeral });
		}
	},

	async buttons(interaction) {
		const [, action, subAction, sessionId] = interaction.customId.split('_');
		const userId = interaction.user.id;

		const session = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);
		if (!session || (userId !== session.initiator_user_id && userId !== session.receiver_user_id)) {
			return interaction.reply({ content: 'This is not your trade session.', flags: MessageFlags.Ephemeral });
		}
		if (session.status !== 'PENDING') {
			return interaction.reply({ content: 'This trade is no longer active.', flags: MessageFlags.Ephemeral });
		}

		switch (`${action}_${subAction}`) {
		case 'add_item': {
			const items = db.prepare(`
                    SELECT ui.inventory_id, i.name FROM user_inventory ui
                    JOIN items i ON ui.item_id = i.item_id
                    WHERE ui.user_id = ? AND i.is_tradeable = 1
                `).all(userId);
			if (items.length === 0) return interaction.reply({ content: 'You have no tradeable items in your inventory.', flags: MessageFlags.Ephemeral });

			const menu = new StringSelectMenuBuilder()
				.setCustomId(`trade_menu_additem_${sessionId}`)
				.setPlaceholder('Select an item to add to your offer...')
				.addOptions(items.slice(0, 25).map(item => ({ label: item.name, value: item.inventory_id.toString() })));
			await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
			break;
		}
		case 'add_crowns': {
			const balance = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId)?.crowns || 0;
			const modal = new ModalBuilder().setCustomId(`trade_modal_crowns_${sessionId}`).setTitle('Add Crowns to Offer');
			const amountInput = new TextInputBuilder().setCustomId('crown_amount').setLabel(`Amount to offer (You have: ${balance})`).setStyle(TextInputStyle.Short).setRequired(true);
			modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
			await interaction.showModal(modal);
			break;
		}
		case 'remove_item': {
			const offeredItems = db.prepare(`
                    SELECT tsi.inventory_id, i.name
                    FROM trade_session_items tsi
                    JOIN user_inventory ui ON tsi.inventory_id = ui.inventory_id
                    JOIN items i ON ui.item_id = i.item_id
                    WHERE tsi.session_id = ? AND tsi.user_id = ? AND tsi.crown_amount IS NULL
                `).all(sessionId, userId);

			if (offeredItems.length === 0) return interaction.reply({ content: 'You have not offered any items to remove.', flags: MessageFlags.Ephemeral });

			const menu = new StringSelectMenuBuilder()
				.setCustomId(`trade_menu_removeitem_${sessionId}`)
				.setPlaceholder('Select an item to remove from your offer...')
				.addOptions(offeredItems.map(item => ({ label: item.name, value: item.inventory_id.toString() })));
			await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
			break;
		}
		case 'lock_offer': {
			const isInitiator = userId === session.initiator_user_id;
			const currentLockStatus = isInitiator ? session.initiator_locked : session.receiver_locked;
			const newLockStatus = currentLockStatus ? 0 : 1;

			const updateStatements = {
				initiator: db.prepare('UPDATE trade_sessions SET initiator_locked = ? WHERE session_id = ?'),
				receiver: db.prepare('UPDATE trade_sessions SET receiver_locked = ? WHERE session_id = ?'),
			};
			const statement = isInitiator ? updateStatements.initiator : updateStatements.receiver;
			statement.run(newLockStatus, sessionId);

			await interaction.deferUpdate();
			await updateTradeUI(interaction, sessionId);
			break;
		}
		case 'final_confirm': {
			await interaction.deferUpdate();
			await executeTrade(interaction, sessionId);
			break;
		}
		case 'cancel_trade': {
			db.prepare('UPDATE trade_sessions SET status = \'CANCELLED\' WHERE session_id = ?').run(sessionId);
			activeTrades.delete(session.initiator_user_id);
			activeTrades.delete(session.receiver_user_id);
			tradeTimestamps.delete(session.initiator_user_id);
			tradeTimestamps.delete(session.receiver_user_id);

			const cancelEmbed = new EmbedBuilder()
				.setColor(0xE74C3C)
				.setTitle('Trade Cancelled')
				.setDescription(`This trade has been cancelled by ${interaction.user.username}.`);

			await interaction.update({ embeds: [cancelEmbed], components: [] });
			setTimeout(() => interaction.channel.delete().catch(console.error), 10000);
			break;
		}
		}
	},

	async modals(interaction) {
		const [,, sessionId] = interaction.customId.split('_');
		const userId = interaction.user.id;

		const amount = parseInt(interaction.fields.getTextInputValue('crown_amount'));
		const balance = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId)?.crowns || 0;

		if (isNaN(amount) || amount <= 0) {
			return interaction.reply({ content: 'Please enter a valid, positive number.', flags: MessageFlags.Ephemeral });
		}
		if (amount > balance) {
			return interaction.reply({ content: `You cannot offer more crowns than you have! (Balance: ${balance})`, flags: MessageFlags.Ephemeral });
		}
		const existingOffer = db.prepare('SELECT crown_amount FROM trade_session_items WHERE session_id = ? AND user_id = ? AND crown_amount IS NOT NULL').get(sessionId, userId);

		const session = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);
		const isInitiator = userId === session.initiator_user_id;
		const isLocked = isInitiator ? session.initiator_locked : session.receiver_locked;

		if (isLocked) {
			return interaction.reply({ content: 'You cannot modify your offer while it is locked.', flags: MessageFlags.Ephemeral });
		}

		db.prepare(`
                INSERT INTO trade_session_items (session_id, user_id, crown_amount) VALUES (?, ?, ?)
                ON CONFLICT(session_id, user_id) DO UPDATE SET crown_amount = excluded.crown_amount
            `).run(sessionId, userId, amount);

		const message = existingOffer
			? `You have updated your crown offer from 👑 ${existingOffer.crown_amount.toLocaleString()} to 👑 ${amount.toLocaleString()} Crowns.`
			: `You have offered 👑 ${amount.toLocaleString()} Crowns.`;
		await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
		await updateTradeUI(interaction, sessionId);
	},

	async menus(interaction) {
		const [,, subAction, sessionId] = interaction.customId.split('_');
		const userId = interaction.user.id;

		if (subAction === 'additem') {
			const inventoryId = parseInt(interaction.values[0]);
			const alreadyOffered = db.prepare('SELECT 1 FROM trade_session_items WHERE session_id = ? AND inventory_id = ?').get(sessionId, inventoryId);
			if (alreadyOffered) {
				return interaction.update({ content: 'You have already offered this item.', components: [] });
			}

			// Verify user owns the item
			const itemOwnership = db.prepare('SELECT user_id FROM user_inventory WHERE inventory_id = ?').get(inventoryId);
			if (!itemOwnership || itemOwnership.user_id !== userId) {
				return interaction.update({ content: 'You do not own this item.', components: [] });
			}

			// Check if user's offer is locked
			const session = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);
			const isInitiator = userId === session.initiator_user_id;
			const isLocked = isInitiator ? session.initiator_locked : session.receiver_locked;
			if (isLocked) {
				return interaction.update({ content: 'You cannot modify your offer while it is locked.', components: [] });
			}

			db.prepare('INSERT INTO trade_session_items (session_id, user_id, inventory_id) VALUES (?, ?, ?)').run(sessionId, userId, inventoryId);
			await interaction.update({ content: 'Item added to your offer.', components: [] });
			await updateTradeUI(interaction, sessionId);
		}
		else if (subAction === 'removeitem') {
			const inventoryId = parseInt(interaction.values[0]);

			// Check if user's offer is locked
			const session = db
				.prepare('SELECT * FROM trade_sessions WHERE session_id = ?')
				.get(sessionId);
			const isInitiator = userId === session.initiator_user_id;
			const isLocked = isInitiator
				? session.initiator_locked
				: session.receiver_locked;
			if (isLocked) {
				return interaction.update({
					content: 'You cannot modify your offer while it is locked.',
					components: [],
				});
			}

			db.prepare(
				'DELETE FROM trade_session_items WHERE session_id = ? AND user_id = ? AND inventory_id = ?',
			).run(sessionId, userId, inventoryId);
			await interaction.update({ content: 'Item removed from your offer.', components: [] });
			await updateTradeUI(interaction, sessionId);
		}

	},
};