// core_brewmaster/commands/admin/clearcaptcha.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('@database/database.js');
const config = require('@root/config.json');

// This ID should match the one in captchaRequest.js
const VERIFY_CHANNEL_ID = '1375485421990969487';

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('clearcaptcha')
		.setDescription('[ADMIN] Clears all pending CAPTCHA verifications and associated messages.')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

	async execute(interaction) {
		// Redundant permission check for the bot owner
		if (interaction.user.id !== config.developerId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({
				content: 'This command is restricted to Administrators.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			// 1. Fetch all pending verification sessions from the database.
			const sessions = db.prepare('SELECT * FROM captcha_sessions').all();

			if (sessions.length === 0) {
				return interaction.editReply({ content: 'There are no pending CAPTCHA verifications to clear.' });
			}

			let clearedCount = 0;
			const channel = await interaction.client.channels.fetch(VERIFY_CHANNEL_ID).catch(() => null);

			if (!channel) {
				// If the channel is gone, we can still clear the DB, but we can't edit the messages.
				console.warn('[clearCaptcha] Verification channel not found. Proceeding to clear database only.');
			}
			else {
				// 2. Loop through each session to edit the original Discord message.
				for (const session of sessions) {
					try {
						const message = await channel.messages.fetch(session.message_id).catch(() => null);
						if (message) {
							const clearedEmbed = new EmbedBuilder()
								.setColor(0x95A5A6)
								.setTitle('Verification Manually Cleared')
								.setDescription(`This verification prompt was cleared by an administrator (${interaction.user.username}).`);

							await message.edit({ embeds: [clearedEmbed], components: [], files: [] });
						}
					}
					catch (error) {
						// Log the error but don't stop the process. The message might have been deleted already.
						console.error(`[clearCaptcha] Could not edit message ${session.message_id}:`, error.message);
					}
				}
			}

			// 3. Clear all entries from the database in a single transaction.
			const result = db.prepare('DELETE FROM captcha_sessions').run();
			clearedCount = result.changes;

			// NOTE: This does NOT clear the in-memory `node-schedule` jobs.
			// However, when those jobs fire, they will query the database, find no session,
			// and gracefully exit. A full bot restart is required to completely clear the scheduled jobs from memory.
			// For this command's purpose, this is an acceptable and safe outcome.

			// 4. Send a final confirmation message.
			const successEmbed = new EmbedBuilder()
				.setColor(0x2ECC71)
				.setTitle('✅ CAPTCHA Sessions Cleared')
				.setDescription(`Successfully cleared **${clearedCount}** pending verification sessions.`)
				.setFooter({ text: 'In-memory timers will be fully cleared on the next bot restart.' });

			await interaction.editReply({ embeds: [successEmbed] });

		}
		catch (error) {
			console.error('[clearCaptcha] An error occurred:', error);
			const errorEmbed = new EmbedBuilder()
				.setColor(0xE74C3C)
				.setTitle('❌ Operation Failed')
				.setDescription('A critical error occurred while trying to clear the verification sessions. Please check the console logs.');

			await interaction.editReply({ embeds: [errorEmbed] });
		}
	},
};