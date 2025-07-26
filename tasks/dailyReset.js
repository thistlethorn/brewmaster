const db = require('../database');
const { scheduleJob } = require('node-schedule');
const { updateMultiplier } = require('../utils/handleCrownRewards');

async function setupDailyReset(client) {
	// Runs at 00:00 UTC every day
	scheduleJob('0 0 * * *', async () => {
		try {
			// Clear user activity counts
			db.prepare(`
                UPDATE user_activity 
                SET normal_messages = 0
                WHERE normal_messages > 0
            `).run();

			console.log(`[dailyReset] User activity counts cleared at ${new Date().toISOString()}`);

			// Remove active chatter role from everyone and update multipliers
			const ACTIVE_CHATTER_ROLE = '1382521995656302632';

			// Process guilds one at a time
			for (const guild of client.guilds.cache.values()) {
				try {
					// Added a try-catch for each guild to prevent one guild from stopping the whole process
					const role = guild.roles.cache.get(ACTIVE_CHATTER_ROLE);
					if (!role) {
						console.log(`[dailyReset] Active Chatter role not found in guild: ${guild.name}`);
						continue;
					}

					// Fetch all members to ensure the cache is populated
					await guild.members.fetch();
					const membersWithRole = role.members;

					if (membersWithRole.size === 0) {
						console.log(`[dailyReset] No members with Active Chatter role in guild: ${guild.name}`);
						continue;
					}

					console.log(`[dailyReset] Found ${membersWithRole.size} members with the Active Chatter role in ${guild.name}. Starting removal.`);

					// Process members one at a time with a small delay
					for (const member of membersWithRole.values()) {
						try {
							await member.roles.remove(role);
							console.log(`[dailyReset] Removed Active Chatter role from ${member.user.tag}`);
							await updateMultiplier(member.id, guild);

							// Small delay to avoid rate limits
							await new Promise(resolve => setTimeout(resolve, 500));
						}
						catch (error) {
							console.error(`[dailyReset] [Error] Couldn't process ${member.user.tag}`, error);
						}
					}
				}
				catch (guildError) {
					console.error(`[dailyReset] [Error] An error occurred while processing guild ${guild.name}`, guildError);
				}
			}

			console.log('[dailyReset] Daily reset completed successfully');
		}
		catch (error) {
			console.error('[dailyReset] [Global Error]', error);
		}
	});
}

module.exports = setupDailyReset;