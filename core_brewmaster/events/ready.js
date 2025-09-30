const log = require('@utils/logger.js');
const { Events } = require('discord.js');
const { setupBumpReminder } = require('@core_brewmaster/tasks/bumpReminder.js');
const setupWeeklyReset = require('@core_tavernborne/tasks/weeklyReset.js');
const setupDailyReset = require('@core_tavernborne/tasks/dailyReset.js');
const { resumeActiveGiveaways } = require('@core_tavernborne/handlers/handleMonarchGiveaway.js');
const { resumeDailyReminders } = require('@core_tavernborne/tasks/dailyReminder.js');
const { resumeTempRoleRemovals } = require('@core_tavernborne/tasks/tempRoleManager.js');
const { setupIdleChatter } = require('@core_tavernborne/tasks/idleChatter.js');
const { seedDatabase } = require('@database/seedDatabase.js');
const { resumePendingVerifications } = require('@core_brewmaster/tasks/captchaRequest.js');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		log.success(`[Ready.js] Logged in as ${client.user.tag}`);
		try {
			seedDatabase();
			log.info('[Ready.js] Database charsys seeding process finished.');
		}
		catch (error) {
			log.error('[Ready.js] Failed to seed database:', error);
			client.destroy();
			process.exit(1);
		}
		log.info('[Ready.js] setupWeeklyReset is complete');
		setupWeeklyReset(client);
		log.info('[Ready.js] setupWeeklyReset is complete');
		setupBumpReminder(client);
		log.info('[Ready.js] setupBumpReminder is complete');
		setupDailyReset(client);
		log.info('[Ready.js] setupDailyReset is complete');
		resumeActiveGiveaways(client);
		log.info('[Ready.js] resumeActiveGiveaways is complete');
		resumeDailyReminders(client);
		log.info('[Ready.js] resumeDailyReminders is complete');
		resumeTempRoleRemovals(client);
		log.info('[Ready.js] resumeTempRoleRemovals is complete');
 		try {
 			setupIdleChatter(client);
 			log.info('[Ready.js] setupIdleChatter is complete');
 		}
		catch (error) {
 			log.error('[Ready.js] Failed to setup idle chatter:', error);
 		}
		resumePendingVerifications(client);
		log.info('[Ready.js] resumePendingVerifications is complete');

		log.success('[Ready.js] Finished!');

	},
};