/* eslint-disable no-empty-function */
// commands/charsys/market.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType } = require('discord.js');
const db = require('../../database');

// In-memory set to track users currently in a trade session.
const activeTrades = new Set();

/**
 * Creates the initial User Interface embed for a new trade session.
 * @param {import('discord.js').User} initiator
 * @param {import('discord.js').User} receiver
 * @returns {EmbedBuilder}
 */
function buildTradeEmbed(initiator, receiver) {
	return new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle(`Trading Session: ${initiator.username} ↔️ ${receiver.username}`)
		.addFields(
			{ name: `🔒 ${initiator.username}'s Offer`, value: '*Nothing offered yet.*', inline: true },
			{ name: `🔒 ${receiver.username}'s Offer`, value: '*Nothing offered yet.*', inline: true },
		)
		.setFooter({ text: 'Use the buttons below to manage your offer. Both parties must lock in before confirming.' });
}

/**
 * Creates the action buttons for the trading UI.
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
		new ButtonBuilder().setCustomId(`trade_lock_offer_${sessionId}`).setLabel('Lock Offer').setStyle(ButtonStyle.Primary).setEmoji('🔒'),
		new ButtonBuilder().setCustomId(`trade_cancel_${sessionId}`).setLabel('Cancel Trade').setStyle(ButtonStyle.Danger).setEmoji('❌'),
	);
	return [row1, row2];
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

			// --- Initial Validation ---
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
				// Add both users to the active trade set to prevent multiple trades.
				activeTrades.add(initiator.id);
				activeTrades.add(receiver.id);

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

				const filter = i => i.user.id === receiver.id;
				const collector = requestMessage.createMessageComponentCollector({ filter, max: 1, time: 60000 });

				collector.on('collect', async i => {
					if (i.customId.startsWith('trade_accept')) {
						await i.deferUpdate();
						// Create the trade session in the database
						const result = db.prepare('INSERT INTO trade_sessions (initiator_user_id, receiver_user_id, status) VALUES (?, ?, \'PENDING\')').run(initiator.id, receiver.id);
						const sessionId = result.lastInsertRowid;

						// Create a private thread for the trade
						const thread = await interaction.channel.threads.create({
							name: `Trade-${initiator.username}-${receiver.username}`,
							type: ChannelType.PrivateThread,
							reason: `Secure trade session ${sessionId}`,
						});

						await thread.members.add(initiator.id);
						await thread.members.add(receiver.id);

						const tradeEmbed = buildTradeEmbed(initiator, receiver);
						const tradeButtons = buildTradeButtons(sessionId);

						await thread.send({ embeds: [tradeEmbed], components: tradeButtons });
						await requestMessage.edit({ content: `Trade accepted! Please proceed to the private thread: ${thread}`, embeds: [], components: [] });

					}
					else if (i.customId.startsWith('trade_decline')) {
						activeTrades.delete(initiator.id);
						activeTrades.delete(receiver.id);
						await i.update({ content: `${receiver.username} has declined the trade request.`, embeds: [], components: [] });
					}
				});

				collector.on('end', (collected, reason) => {
					if (reason === 'time') {
						activeTrades.delete(initiator.id);
						activeTrades.delete(receiver.id);
						requestMessage.edit({ content: 'The trade request has expired.', embeds: [], components: [] });
					}
				});

			}
			catch (error) {
				console.error('Trade initiation error:', error);
				activeTrades.delete(initiator.id);
				activeTrades.delete(receiver.id);
				await interaction.followUp({ content: 'An error occurred while trying to start the trade.', flags: MessageFlags.Ephemeral });
			}
		}
		else {
			await interaction.reply({ content: 'This market command is not yet implemented.', flags: MessageFlags.Ephemeral });
		}
	},
	// Placeholder for button/modal handlers
	buttons: async () => {},
	modals: async () => {},
	menus: async () => {},
};