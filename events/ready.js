const { Events } = require('discord.js');
const { setupBumpReminder } = require('../tasks/bumpReminder');
const setupWeeklyReset = require('../tasks/weeklyReset');
const setupDailyReset = require('../tasks/dailyReset');
const { resumeActiveGiveaways } = require('../utils/handleMotwGiveaway');
const { resumeDailyReminders } = require('../tasks/dailyReminder');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
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

	},
};