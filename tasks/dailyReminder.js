const { EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const db = require('../database');

const scheduledReminders = new Map();
const BOT_COMMANDS_CHANNEL_ID = '1354187940246327316';
const STREAK_EXPIRY_HOURS = 48;

/*
 * Sends the reminder message to the user and updates the database to prevent re-sending.
 * @param {import('discord.js').Client} client The Discord client.
 * @param {string} userId The ID of the user to remind.
 * @param {string} lastClaimISO The ISO string of the last claim time.
 */
async function sendReminder(client, userId, lastClaimISO) {
	try {
		const channel = await client.channels.fetch(BOT_COMMANDS_CHANNEL_ID);
		if (!channel || !channel.isTextBased()) {
			console.error(`[dailyReminder] Error: Channel ${BOT_COMMANDS_CHANNEL_ID} not found or is not a text channel.`);
			return;
		}

		const user = await client.users.fetch(userId);
		const lastClaimTime = new Date(lastClaimISO);
		const streakExpiryTime = new Date(lastClaimTime.getTime() + STREAK_EXPIRY_HOURS * 60 * 60 * 1000);
		const streakExpiryTimestamp = Math.floor(streakExpiryTime.getTime() / 1000);

		const embed = new EmbedBuilder()
			.setColor(0x5865F2)
			.setTitle('🔔 Daily Claim Reminder!')
			.setDescription(`Hey ${user.displayName}! Just a heads-up, you can now claim your \`/econ daily\` reward.`)
			.addFields({
				name: 'Keep Your Streak Alive!',
				value: `Your current streak will expire <t:${streakExpiryTimestamp}:R>. Don't miss out!`,
			});

		await channel.send({ content: `<@${userId}>` });
		await channel.send({ embeds: [embed] });

		// CRITICAL: Mark this claim cycle as notified to prevent spam.
		db.prepare('UPDATE daily_ping_preferences SET last_notified_claim_time = ? WHERE user_id = ?')
			.run(lastClaimISO, userId);

	}
	catch (error) {
		console.error(`[dailyReminder] Failed to send reminder to user ${userId}:`, error);
	}
	finally {
		scheduledReminders.delete(userId);
	}
}
/*
 * Schedules a daily reminder for a user.
 * @param {import('discord.js').Client} client The Discord client.
 * @param {string} userId The user's ID.
 * @param {Date} claimTime The time the user claimed.
 */
function scheduleDailyReminder(client, userId, claimTime) {
	if (scheduledReminders.has(userId)) {
		scheduledReminders.get(userId).cancel();
	}

	const reminderTime = new Date(claimTime.getTime() + 24 * 60 * 60 * 1000);

	if (reminderTime > new Date()) {
		const job = schedule.scheduleJob(reminderTime, () => {
			sendReminder(client, userId, claimTime.toISOString());
		});
		scheduledReminders.set(userId, job);
	}
}

/*
 * Resumes reminders on bot startup, sending immediate notifications for overdue claims.
 * @param {import('discord.js').Client} client The Discord client.
 */
function resumeDailyReminders(client) {
	console.log('[dailyReminder] Resuming pending daily reminders...');
	const usersToProcess = db.prepare(`
        SELECT
            ue.user_id,
            ue.last_daily,
            dpp.last_notified_claim_time
        FROM user_economy ue
        JOIN daily_ping_preferences dpp ON ue.user_id = dpp.user_id
        WHERE dpp.opt_in_status = 1 AND ue.last_daily IS NOT NULL
    `).all();

	let resumedCount = 0;
	let immediateCount = 0;
	const now = new Date();

	for (const user of usersToProcess) {
		// Prevent notification if one for this exact claim has already been sent
		if (user.last_daily === user.last_notified_claim_time) {
			continue;
		}

		const lastClaimTime = new Date(user.last_daily);
		const reminderTime = new Date(lastClaimTime.getTime() + 24 * 60 * 60 * 1000);
		const streakExpiryTime = new Date(lastClaimTime.getTime() + STREAK_EXPIRY_HOURS * 60 * 60 * 1000);

		// Only process if the streak hasn't already expired
		if (streakExpiryTime > now) {
			if (reminderTime <= now) {
				// Reminder time is in the past, send it now.
				sendReminder(client, user.user_id, user.last_daily);
				immediateCount++;
			}
			else {
				// Reminder time is in the future, schedule it.
				scheduleDailyReminder(client, user.user_id, lastClaimTime);
				resumedCount++;
			}
		}
	}
	console.log(`[dailyReminder] Resumed ${resumedCount} future reminders and sent ${immediateCount} immediate reminders.`);
}


module.exports = {
	scheduleDailyReminder,
	resumeDailyReminders,
	sendReminder,
};