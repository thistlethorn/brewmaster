const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('@root/config.json');
const db = require('@database/database.js');
const { reschedule } = require('@core_brewmaster/tasks/bumpReminder.js');

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('forcereminder')
		.setDescription('[DEVELOPER COMMAND] Manually resets the bump timer to the current time.'),

	async execute(interaction) {
		// Ensure only the developer can use this command
		if (interaction.user.id !== config.developerId) {
			return interaction.reply({
				content: 'You do not have permission to use this command.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			// === THE FIX: WRITE A NEW TIMESTAMP TO THE DATABASE ===
			// This creates a "synthetic" bump entry using the bot's own ID.
			// This entry becomes the new "last bump time", forcing the timer to reset.
			const now = new Date();
			const botId = interaction.client.user.id;

			db.prepare(`
                INSERT INTO bump_leaderboard (user_id, bumps, last_bump_time, last_bump_week)
                VALUES (?, 0, ?, NULL)
                ON CONFLICT(user_id) DO UPDATE SET
                    last_bump_time = excluded.last_bump_time
            `).run(botId, now.toISOString());

			console.log(`[ForceReminder] Manually inserted a synthetic bump time: ${now.toISOString()}`);

			// Now that the database is correct, we can call reschedule.
			reschedule();

			// --- Provide accurate feedback ---
			const embed = new EmbedBuilder()
				.setColor(0x2ECC71)
				.setTitle('✅ Bump Timer Manually Reset!')
				.setDescription('I have inserted a synthetic bump entry for the current time. The reminder timer has been reset based on this new timestamp.');

			const nextBumpTime = new Date(now.getTime() + config.bump.cooldownMs);
			const nextBumpTimestamp = Math.floor(nextBumpTime.getTime() / 1000);

			embed.addFields(
				{ name: 'Manual Reset Time (New "Last Bump")', value: `<t:${Math.floor(now.getTime() / 1000)}:F>`, inline: false },
				{ name: 'New Reminder Scheduled For', value: `<t:${nextBumpTimestamp}:R> (at <t:${nextBumpTimestamp}:T>)`, inline: false },
			);

			await interaction.editReply({ embeds: [embed] });

		}
		catch (error) {
			console.error('[ForceReminder] An error occurred:', error);
			await interaction.editReply({
				content: 'An error occurred while trying to reset the reminder timer. Please check the console.',
			});
		}
	},
};