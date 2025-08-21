const { Events } = require('discord.js');
const { setupBumpReminder } = require('../tasks/bumpReminder');
const setupWeeklyReset = require('../tasks/weeklyReset');
const setupDailyReset = require('../tasks/dailyReset');
const { resumeActiveGiveaways } = require('../utils/handleMotwGiveaway');
const { resumeDailyReminders } = require('../tasks/dailyReminder');
const { resumeTempRoleRemovals } = require('../tasks/tempRoleManager');
const { setupIdleChatter } = require('../tasks/idleChatter');
const { seedDatabase } = require('../utils/seedDatabase');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		seedDatabase();
		console.log('[Ready.js] Database charsys seeding process finished.');
		setupWeeklyReset(client);
		console.log('[Ready.js] setupWeeklyReset is complete');
		setupBumpReminder(client);
		console.log('[Ready.js] setupBumpReminder is complete');
		setupDailyReset(client);
		console.log('[Ready.js] setupDailyReset is complete');
		resumeActiveGiveaways(client);
		console.log('[Ready.js] resumeActiveGiveaways is complete');
		resumeDailyReminders(client);
		console.log('[Ready.js] resumeDailyReminders is complete');
		resumeTempRoleRemovals(client);
		console.log('[Ready.js] resumeTempRoleRemovals is complete');
 		try {
 			setupIdleChatter(client);
 			console.log('[Ready.js] setupIdleChatter is complete');
 		}
		catch (error) {
 			console.error('[Ready.js] Failed to setup idle chatter:', error);
 		}

	},
};