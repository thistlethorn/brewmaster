const { SlashCommandBuilder, MessageFlags, Collection } = require('discord.js');
const db = require('../../database');
const updateLeaderboard = require('../../utils/updateLeaderboard');
const getWeekIdentifier = require('../../utils/getWeekIdentifier');

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('backlog')
		.setDescription('[DEVELOPER COMMAND] Push raw data to the bump_db.'),
	async execute(interaction) {
		 if (interaction.member.roles.cache.has('1354145856345083914') || interaction.member.id === '1126419078140153946') {
			const disboardId = '302050872383242240';
			const bumpLog = [];

			// Fetch last 100 messages from the current channel
			const messages = await interaction.channel.messages.fetch({ limit: 100 });

			// Map<userId, count>
			const summary = new Collection();

			for (const message of messages.values()) {
				if (
					message.author.id === disboardId &&
		message.embeds.length > 0 &&
		message.embeds[0].description?.includes('Bump done!')
				) {
					// Get the user who triggered the bump command
					const userId = message.interactionMetadata?.user?.id;
					if (!userId) continue;

					// Insert into 2D array structure
					let placed = false;
					for (let i = 0; i < bumpLog.length; i++) {
						if (bumpLog[i][0] === userId) {
							bumpLog[i].push(userId);
							placed = true;
							break;
						}
					}
					if (!placed) {
						bumpLog.push([userId]);
					}

					// Update summary
					summary.set(userId, (summary.get(userId) || 0) + 1);

					// Optionally delete the Disboard message
					await message.delete().catch(() => null);
				}
			}

			// Optional debug: console.log bumpLog
			console.log('Bump Log:', bumpLog);
			const currentWeek = getWeekIdentifier();
			const stmt = db.prepare(`
				INSERT INTO bump_leaderboard (user_id, bumps, last_bump_week)
				VALUES (?, ?, ?)
				ON CONFLICT(user_id) DO UPDATE SET
					bumps = CASE 
						WHEN last_bump_week = ? THEN bumps + excluded.bumps
						ELSE excluded.bumps
					END,
					last_bump_week = ?
			`);

			for (const userGroup of bumpLog) {
				const userId = userGroup[0];
				const bumpCount = userGroup.length;

				stmt.run(userId, bumpCount, currentWeek, currentWeek, currentWeek);
			}
			// Create final response string
			const response = Array.from(summary.entries())
				.map(([userId, count]) => `Added <@${userId}> ${count} bump${count > 1 ? 's' : ''}`)
				.join(', ');

			await updateLeaderboard(interaction.client);
			console.log('----------------------');
			console.log('END backlog.js');
			await interaction.reply({ content: response || 'No bumps found!', flags: MessageFlags.Ephemeral });
			setTimeout(async () => {
				try {
					await interaction.deleteReply();
				}
				catch (err) {
					console.error('Failed to delete reply:', err);
				}
			}, 8000);
		}
		else {
			console.log('Failed to run admin command /leaderboard.');
			console.log('----------------------');
			console.log('END leaderboard.js');
			await interaction.reply({ content: 'Insufficient permissions to run Administration commands!', flags: MessageFlags.Ephemeral });
			setTimeout(async () => {
				try {
					await interaction.deleteReply();
				}
				catch (err) {
					console.error('Failed to delete reply:', err);
				}
			}, 8000);
		}
	},
};