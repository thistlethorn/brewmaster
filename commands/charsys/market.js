// commands/charsys/market.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../database');

// In-memory set to track users currently in a trade session to prevent concurrent trades.
const activeTrades = new Set();
const TRADE_TIMEOUT = 30 * 60 * 1000;
const tradeTimestamps = new Map();


/**
* Mark a user as being in an active trade and record a heartbeat timestamp.
* @param {string} userId
*/
function addToActiveTrades(userId) {
	activeTrades.add(userId);
	tradeTimestamps.set(userId, Date.now());
	// Prevent unbounded growth by limiting map size
	if (tradeTimestamps.size > 1000) {
		// Remove oldest entries
		const entries = Array.from(tradeTimestamps.entries());
		entries.sort((a, b) => a[1] - b[1]);
		for (let i = 0; i < 100; i++) {
			const [oldUserId] = entries[i];
			if (!activeTrades.has(oldUserId)) {
				tradeTimestamps.delete(oldUserId);
			}
		}
	}

}

const cleanupInterval = setInterval(() => {
	try {
		const now = Date.now();
		for (const [userId, timestamp] of tradeTimestamps.entries()) {
			if (now - timestamp > TRADE_TIMEOUT) {
				activeTrades.delete(userId);
				tradeTimestamps.delete(userId);
			}
		}
	}
	catch (error) {
		console.error('Trade cleanup interval error:', error);
	}
}, TRADE_TIMEOUT);

/**
 * Creates the base User Interface embed for a trade session.
 * @param {import('discord.js').User} initiator
 * @param {import('discord.js').User} receiver
 * @returns {EmbedBuilder}
 */
function buildTradeEmbed(initiator, receiver) {
	return new EmbedBuilder()
		.setTitle(`Trading Session: ${initiator.displayName} ↔️ ${receiver.displayName}`);
}

/**
 * Creates the action buttons for the trading UI based on the session's state.
 * @param {string} sessionId The ID of the trade session.
 * @returns {ActionRowBuilder[]}
 */
function buildTradeButtons(sessionId) {
	const row1 = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`trade_add_item_${sessionId}`).setLabel('Add Item').setStyle(ButtonStyle.Success).setEmoji('🎒'),
		new ButtonBuilder().setCustomId(`trade_add_crowns_${sessionId}`).setLabel('Add Crowns').setStyle(ButtonStyle.Success).setEmoji('👑'),
		new ButtonBuilder().setCustomId(`trade_remove_item_${sessionId}`).setLabel('Remove Item').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
	);
	const row2 = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`trade_lock_offer_${sessionId}`)
			.setLabel('Toggle Lock/Unlock')
			.setStyle(ButtonStyle.Primary)
			.setEmoji('🔒'),
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
	// Check if trade has been cleaned up by timeout
	const now = Date.now();
	const initiatorTimeout = tradeTimestamps.get(session.initiator_user_id);
	const receiverTimeout = tradeTimestamps.get(session.receiver_user_id);

	if (!initiatorTimeout || !receiverTimeout ||
	    now - initiatorTimeout > TRADE_TIMEOUT ||
	    now - receiverTimeout > TRADE_TIMEOUT) {
		db.prepare('UPDATE trade_sessions SET status = \'CANCELLED\' WHERE session_id = ?').run(sessionId);
		return;
	}

	// Get ONLY the items from this table
	const offeredItems = db.prepare(`
        SELECT tsi.user_id, i.name as item_name
        FROM trade_session_items tsi
        JOIN user_inventory ui ON tsi.inventory_id = ui.inventory_id
        JOIN items i ON ui.item_id = i.item_id
        WHERE tsi.session_id = ?
    `).all(sessionId);

	const initiator = await interaction.client.users.fetch(session.initiator_user_id);
	const receiver = await interaction.client.users.fetch(session.receiver_user_id);

	// New helper to format offers correctly
	const formatOffer = (userId, crownOffer, items) => {
		const offerLines = [];
		if (crownOffer > 0) {
			offerLines.push(`• 👑 ${crownOffer.toLocaleString()} Crowns`);
		}
		const userItems = items.filter(item => item.user_id === userId);
		for (const item of userItems) {
			offerLines.push(`• ${item.item_name}`);
		}
		return offerLines.length > 0 ? offerLines.join('\n') : '*Nothing offered yet.*';
	};

	const initiatorOfferText = formatOffer(session.initiator_user_id, session.initiator_crown_offer, offeredItems);
	const receiverOfferText = formatOffer(session.receiver_user_id, session.receiver_crown_offer, offeredItems);

	const embed = buildTradeEmbed(initiator, receiver)
		.setColor(session.initiator_locked && session.receiver_locked ? 0xFEE75C : 0x3498DB)
		.addFields(
			{ name: `${session.initiator_locked ? '🔒' : '📦'} ${initiator.displayName}'s Offer`, value: initiatorOfferText, inline: true },
			{ name: `${session.receiver_locked ? '🔒' : '📦'} ${receiver.displayName}'s Offer`, value: receiverOfferText, inline: true },
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
		components = buildTradeButtons(sessionId);
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
	let currentSession;
	try {
		const tradeExecutionTx = db.transaction(() => {
			currentSession = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);
			if (!currentSession || currentSession.status !== 'PENDING' || !currentSession.initiator_locked || !currentSession.receiver_locked) {
				throw new Error('Trade is no longer pending');
			}

			const initiatorId = currentSession.initiator_user_id;
			const receiverId = currentSession.receiver_user_id;

			// --- Step 1: Exchange Crowns ---
			const exchangeCrowns = (sendingId, receivingId, amount) => {
				if (amount <= 0) return;

				// Debit the sender
				const debitResult = db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ? AND crowns >= ?').run(amount, sendingId, amount);
				if (debitResult.changes === 0) {
					throw new Error(`Insufficient crowns for user ${sendingId}. Required: ${amount}`);
				}

				// Credit the receiver
				const creditResult = db.prepare(`
					INSERT INTO user_economy (user_id, crowns) VALUES (?, ?)
					ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + excluded.crowns
					WHERE crowns + excluded.crowns <= 9223372036854775807
				`).run(receivingId, amount);
				if (creditResult.changes === 0) {
					throw new Error(`Crown transfer would exceed maximum balance for user ${receivingId}`);
				}
			};

			// Perform the two-way crown exchange
			exchangeCrowns(initiatorId, receiverId, currentSession.initiator_crown_offer);
			exchangeCrowns(receiverId, initiatorId, currentSession.receiver_crown_offer);

			// --- Step 2: Exchange Items ---
			const offeredItems = db.prepare('SELECT inventory_id, user_id FROM trade_session_items WHERE session_id = ?').all(sessionId);
			for (const item of offeredItems) {
				const receiverIdForItem = item.user_id === initiatorId ? receiverId : initiatorId;
				const moved = db.prepare('UPDATE user_inventory SET user_id = ? WHERE inventory_id = ? AND user_id = ?').run(receiverIdForItem, item.inventory_id, item.user_id);
				if (moved.changes !== 1) {
					throw new Error(`Item no longer owned by user ${item.user_id} at time of trade.`);
				}
			}

			// --- Step 3: Mark trade as complete ---
			db.prepare('UPDATE trade_sessions SET status = \'COMPLETED\' WHERE session_id = ?').run(sessionId);
		});

		tradeExecutionTx();

		activeTrades.delete(currentSession.initiator_user_id);
		activeTrades.delete(currentSession.receiver_user_id);
		tradeTimestamps.delete(currentSession.initiator_user_id);
		tradeTimestamps.delete(currentSession.receiver_user_id);

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle('✅ Trade Successful!')
			.setDescription('The items and crowns have been exchanged. This thread will be archived shortly.');

		await interaction.message.edit({ embeds: [successEmbed], components: [] });
		setTimeout(() => interaction.channel.delete().catch(console.error), 15000);

	}
	catch (error) {
		console.error('Trade execution error:', error);
		if (!currentSession) {
			currentSession = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);
		}

		if (error.message === 'Trade is no longer pending') {
			return interaction.followUp({
				content: 'Trade cannot be confirmed. One or both parties have not locked their offer.',
				flags: MessageFlags.Ephemeral,
			});
		}

		let failingUser = null;
		if (currentSession && error.message.includes(currentSession.initiator_user_id)) {
			failingUser = await interaction.client.users.fetch(currentSession.initiator_user_id);
		}
		else if (currentSession && error.message.includes(currentSession.receiver_user_id)) {
			failingUser = await interaction.client.users.fetch(currentSession.receiver_user_id);
		}

		const errorMessage = failingUser
			? `${failingUser.displayName} no longer has enough crowns to complete the trade.`
			: 'A critical database error occurred.';

		await interaction.followUp({
			content: `**Trade Failed:** ${errorMessage} The trade has been cancelled, and no items or crowns were exchanged.`,
			flags: MessageFlags.Ephemeral,
		});

		db.prepare('UPDATE trade_sessions SET status = \'CANCELLED\' WHERE session_id = ?').run(sessionId);
		if (currentSession) {
			activeTrades.delete(currentSession.initiator_user_id);
			activeTrades.delete(currentSession.receiver_user_id);
			tradeTimestamps.delete(currentSession.initiator_user_id);
			tradeTimestamps.delete(currentSession.receiver_user_id);
		}

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
			const getTradeableItemCount = (userId) => {
				const row = db.prepare(`
                    SELECT COUNT(ui.inventory_id) as itemCount
                    FROM user_inventory ui
                    JOIN items i ON ui.item_id = i.item_id
                    WHERE ui.user_id = ? AND i.is_tradeable = 1 AND ui.equipped_slot IS NULL
                `).get(userId);
				return row?.itemCount || 0;
			};

			const initiatorItemCount = getTradeableItemCount(initiator.id);
			const receiverItemCount = getTradeableItemCount(receiver.id);

			if (initiatorItemCount === 0 && receiverItemCount === 0) {
				return interaction.reply({ content: 'A trade cannot be started if neither participant has any tradeable items in their inventory. Use `/econ pay` for crown-only transfers.', flags: MessageFlags.Ephemeral });
			}

			try {
				addToActiveTrades(initiator.id);
				addToActiveTrades(receiver.id);

				await interaction.reply({ content: `Sending a trade request to ${receiver.displayName}...`, flags: MessageFlags.Ephemeral });

				const requestEmbed = new EmbedBuilder()
					.setColor(0xFEE75C)
					.setTitle('Incoming Trade Request!')
					.setDescription(`${initiator.displayName} wants to trade with you. Do you accept?`)
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
						if (!activeTrades.has(initiator.id) || !activeTrades.has(receiver.id)) {
							await requestMessage.edit({ content: 'This trade request has expired.', embeds: [], components: [] });
							return;
						}
						tradeAccepted = true;
						let sessionId;
						let session;
						let thread;
						try {
							const result = db.prepare('INSERT INTO trade_sessions (initiator_user_id, receiver_user_id, status, initiator_locked, receiver_locked) VALUES (?, ?, \'PENDING\', 0, 0)').run(initiator.id, receiver.id);
							sessionId = result.lastInsertRowid;
							session = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);

							const threadName = `Trade-${initiator.displayName}-${receiver.displayName}`.substring(0, 100);
							thread = await interaction.channel.threads.create({
								name: threadName,
								type: ChannelType.PrivateThread,
								reason: `Secure trade session ${sessionId}`,
							});
						}
						catch (error) {
							// Clean up the session if thread creation failed
							if (sessionId) {
								db.prepare('DELETE FROM trade_sessions WHERE session_id = ?').run(sessionId);
							}
							activeTrades.delete(initiator.id);
							activeTrades.delete(receiver.id);
							tradeTimestamps.delete(initiator.id);
							tradeTimestamps.delete(receiver.id);
							throw error;
						}


						try {
							await thread.members.add(initiator.id);
							await thread.members.add(receiver.id);
						}
						catch (error) {
							console.error('Failed to add members to trade thread:', error);
							// Clean up the session
							db.prepare('UPDATE trade_sessions SET status = \'CANCELLED\' WHERE session_id = ?').run(sessionId);
							activeTrades.delete(initiator.id);
							activeTrades.delete(receiver.id);
							tradeTimestamps.delete(initiator.id);
							tradeTimestamps.delete(receiver.id);
							await thread.delete().catch(console.error);
							await requestMessage.edit({ content: 'Failed to create trade thread. The trade has been cancelled.', embeds: [], components: [] });
							return;
						}

						const tradeEmbed = buildTradeEmbed(initiator, receiver);
						const tradeButtons = buildTradeButtons(sessionId, session, initiator.id);
						const tradeMessage = await thread.send({ embeds: [tradeEmbed], components: tradeButtons });

						// Persist the UI message id for future edits (e.g., from modals)
						db.prepare('UPDATE trade_sessions SET ui_message_id = ? WHERE session_id = ?').run(tradeMessage.id, sessionId);

						await requestMessage.edit({ content: `Trade accepted! Please proceed to the private thread: ${thread}`, embeds: [], components: [] });

					}
					else if (i.customId.startsWith('trade_decline')) {
						if (!activeTrades.has(initiator.id) || !activeTrades.has(receiver.id)) {
							await i.update({ content: 'This trade request has expired.', embeds: [], components: [] });
							return;
						}
						activeTrades.delete(initiator.id);
						activeTrades.delete(receiver.id);
						await i.update({ content: `${receiver.displayName} has declined the trade request.`, embeds: [], components: [] });
					}
				});

				collector.on('end', async (collected, reason) => {
					try {
						if (reason === 'time' && !tradeAccepted) {
							activeTrades.delete(initiator.id);
							activeTrades.delete(receiver.id);
							if (requestMessage) {
								await requestMessage.edit({ content: 'The trade request has expired.', embeds: [], components: [] }).catch((e) => {console.error(e);});
							}
						}
					}
					catch (e) {
						console.error('Failed to cleanup on collector ending:', e);
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
		const parts = interaction.customId.split('_');
		if (parts.length !== 4 || !parts[1] || !parts[2] || !parts[3]) {
			return interaction.reply({ content: 'Invalid trade action.', flags: MessageFlags.Ephemeral });
		}
		const [, action, subAction, sessionId] = parts;
		const userId = interaction.user.id;
		tradeTimestamps.set(userId, Date.now());

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
				.setPlaceholder(items.length > 25 ? `Select an item (showing first 25 of ${items.length})...` : 'Select an item to add to your offer...')
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
					WHERE tsi.session_id = ? AND tsi.user_id = ?
				`).all(sessionId, userId);

    		if (offeredItems.length === 0) return interaction.reply({ content: 'You have not offered any items to remove.', flags: MessageFlags.Ephemeral });

			const menu = new StringSelectMenuBuilder()
				.setCustomId(`trade_menu_removeitem_${sessionId}`)
				.setPlaceholder(offeredItems.length > 25 ? 'Select an item to remove (showing first 25)...' : 'Select an item to remove from your offer...')
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
				.setDescription(`This trade has been cancelled by ${interaction.user.displayName}.`);

			await interaction.update({ embeds: [cancelEmbed], components: [] });
			setTimeout(() => interaction.channel.delete().catch(console.error), 10000);
			break;
		}
		}
	},

	async modals(interaction) {
		const parts = interaction.customId.split('_');
		const sessionId = parts[parts.length - 1];
		const userId = interaction.user.id;
		tradeTimestamps.set(userId, Date.now());
		const amount = parseInt(interaction.fields.getTextInputValue('crown_amount'), 10);
		const balance = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId)?.crowns || 0;

		if (isNaN(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) {
			return interaction.reply({ content: 'Please enter a valid, non-negative number.', flags: MessageFlags.Ephemeral });
		}
		if (amount > balance) {
			return interaction.reply({ content: `You cannot offer more crowns than you have! (Balance: ${balance})`, flags: MessageFlags.Ephemeral });
		}

		const session = db.prepare('SELECT initiator_user_id, receiver_user_id, initiator_locked, receiver_locked, initiator_crown_offer, receiver_crown_offer, status FROM trade_sessions WHERE session_id = ?').get(sessionId);
		if (!session || session.status !== 'PENDING' || (userId !== session.initiator_user_id && userId !== session.receiver_user_id)) {
			return interaction.reply({ content: 'This trade session is invalid or no longer active.', flags: MessageFlags.Ephemeral });
		}
		const isInitiator = userId === session.initiator_user_id;
		const isLocked = isInitiator ? session.initiator_locked : session.receiver_locked;

		if (isLocked) {
			return interaction.reply({ content: 'You cannot modify your offer while it is locked.', flags: MessageFlags.Ephemeral });
		}

		// Correctly update the trade_sessions table
		const columnToUpdate = isInitiator ? 'initiator_crown_offer' : 'receiver_crown_offer';
		db.prepare(`UPDATE trade_sessions SET ${columnToUpdate} = ? WHERE session_id = ?`).run(amount, sessionId);

		const existingOffer = isInitiator ? session.initiator_crown_offer : session.receiver_crown_offer;
		const message = existingOffer > 0 ?
			`You have updated your crown offer from 👑 ${existingOffer.toLocaleString()} to 👑 ${amount.toLocaleString()} Crowns.` :
			`You have offered 👑 ${amount.toLocaleString()} Crowns.`;

		await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
		await updateTradeUI(interaction, sessionId);
	},

	async menus(interaction) {
		const [,, subAction, sessionId] = interaction.customId.split('_');
		const userId = interaction.user.id;
		tradeTimestamps.set(userId, Date.now());

		if (subAction === 'additem') {
			const inventoryId = parseInt(interaction.values[0], 10);
			if (Number.isNaN(inventoryId)) {
				return interaction.update({ content: 'Invalid item selection.', components: [] });
			}

			// Check if user's offer is locked
			const session = db.prepare('SELECT * FROM trade_sessions WHERE session_id = ?').get(sessionId);
			const isInitiator = userId === session.initiator_user_id;
			const isLocked = isInitiator ? session.initiator_locked : session.receiver_locked;
			if (isLocked) {
				return interaction.update({ content: 'You cannot modify your offer while it is locked.', components: [] });
			}

			try {
				const addItemTx = db.transaction(() => {
					// Check if already offered inside transaction
					const alreadyOffered = db.prepare('SELECT 1 FROM trade_session_items WHERE session_id = ? AND inventory_id = ?').get(sessionId, inventoryId);
					if (alreadyOffered) {
						throw new Error('Already offered');
					}
					// Verify ownership inside transaction
					const itemOwnership = db.prepare('SELECT user_id FROM user_inventory WHERE inventory_id = ?').get(inventoryId);
					if (!itemOwnership || itemOwnership.user_id !== userId) {
						throw new Error('Item not owned');
					}
					db.prepare('INSERT INTO trade_session_items (session_id, user_id, inventory_id) VALUES (?, ?, ?)').run(sessionId, userId, inventoryId);
				});
				addItemTx();
			}
			catch (error) {
				if (error.message === 'Item not owned') {
					return interaction.update({ content: 'You do not own this item.', components: [] });
				}
				if (error.message === 'Already offered') {
					return interaction.update({ content: 'You have already offered this item.', components: [] });
				}
				throw error;
			}
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

// Export for cleanup on shutdown
module.exports.cleanup = () => {
	clearInterval(cleanupInterval);
};