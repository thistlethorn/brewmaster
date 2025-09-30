// commands/admin/resendmotw.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('@database/database.js');
const config = require('@root/config.json');

// Constants from the original giveaway handler for consistency
const HALL_OF_FAME_CHANNEL = '1365345890591703080';
const REMEMBERED_SOUL_ROLE = '1365350340496588840';

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('resendmotw')
		.setDescription('[ADMIN] Resends the winner announcement for a Member of the Week giveaway.')
		.addStringOption(option =>
			option.setName('giveaway_message_id')
				.setDescription('The message ID of the giveaway. Leave blank or use "-1" for the most recent one.')
				.setRequired(false)),

	async execute(interaction) {
		// --- Permission Check ---
		if (interaction.user.id !== config.developerId) {
			return interaction.reply({ content: 'This is a developer-only command.', flags: MessageFlags.Ephemeral });
		}

		await interaction.deferReply({ ephemeral: true });

		const giveawayIdInput = interaction.options.getString('giveaway_message_id');
		let giveaway;

		try {
			// --- 1. Find the Target Giveaway ---
			if (giveawayIdInput && giveawayIdInput !== '-1') {
				// User provided a specific ID
				giveaway = db.prepare('SELECT * FROM motw_giveaways WHERE message_id = ? AND completed = 1').get(giveawayIdInput);
			}
			else {
				// Find the most recently completed giveaway
				giveaway = db.prepare('SELECT * FROM motw_giveaways WHERE completed = 1 ORDER BY end_time DESC LIMIT 1').get();
			}

			if (!giveaway) {
				return interaction.editReply({ content: 'Could not find a completed giveaway matching that ID, or there are no completed giveaways to resend.' });
			}

			const { winner_id, week_identifier, message_id } = giveaway;

			if (!winner_id) {
				return interaction.editReply({ content: `The selected giveaway (Week ${week_identifier}) has no recorded winner. Cannot resend.` });
			}

			// --- 2. Fetch Necessary Data for the Embed ---
			const winnerMember = await interaction.guild.members.fetch(winner_id).catch(() => null);
			if (!winnerMember) {
				return interaction.editReply({ content: `The winner (<@${winner_id}>) for Week ${week_identifier} could not be found in the server.` });
			}

			const hallOfFameChannel = await interaction.client.channels.fetch(HALL_OF_FAME_CHANNEL);
			if (!hallOfFameChannel?.isTextBased()) {
				throw new Error('Hall of Fame channel not found or is not a text channel.');
			}

			// Determine if the "Remembered Soul" role was given during this win.
			// This logic assumes the role is given on the *first* win.
			const winCount = db.prepare('SELECT COUNT(*) as count FROM motw_winners_history WHERE user_id = ?').get(winner_id).count;
			const rememberedSoulGiven = (winCount === 1);

			// Check if there were other participants for the "consolation prize" message.
			const entries = db.prepare('SELECT 1 FROM motw_entries WHERE giveaway_id = ? AND user_id != ?').all(message_id, winner_id);
			const hasConsolationWinners = entries.length > 0;

			// --- 3. Reconstruct the Winner Embed (based on endMotwGiveaway logic) ---
			const winnerEmbed = new EmbedBuilder()
				.setColor(0xF1C40F)
				.setTitle(`🏆 Congratulations to Week ${week_identifier}'s Member of the Week! 🏆`)
				.setDescription(`Please congratulate ${winnerMember} for being selected! They will be featured on our social media and receive:`)
				.setThumbnail(winnerMember.user.displayAvatarURL())
				.addFields(
					{ name: '👑 Crowns Reward', value: '**300 Crowns** have been added to your balance!', inline: false },
					{ name: '✨ Multiplier Bonus', value: 'You now have a **3X Crown earnings multiplier** for the week!', inline: false },
				);

			if (rememberedSoulGiven) {
				winnerEmbed.addFields({ name: '🌟 New Permanent Role!', value: `You have earned the <@&${REMEMBERED_SOUL_ROLE}> role!`, inline: false });
			}
			if (hasConsolationWinners) {
				winnerEmbed.addFields({ name: '💸 Consolation Prizes', value: 'All other participants have received **100 Crowns**! Thank you for entering!', inline: false });
			}
			winnerEmbed.setFooter({ text: 'A new giveaway starts next week!' }).setTimestamp();

			// --- 4. Send the Reconstructed Message ---
			await hallOfFameChannel.send({ content: `🎉 Congratulations, <@${winner_id}>! 🎉`, embeds: [winnerEmbed] });

			await interaction.editReply({ content: `✅ Successfully resent the MOTW winner announcement for Week ${week_identifier} to ${hallOfFameChannel}.` });

		}
		catch (error) {
			console.error('[resendmotw] An error occurred:', error);
			await interaction.editReply({ content: 'An error occurred while trying to resend the announcement. Please check the logs.' });
		}
	},
};