const db = require('../database');

// Constants
const BUMP_CHANNEL_ID = '1354187940246327316';
const BUMP_ROLE_ID = '1380398838333968436';
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000;

let reminderTimeout = null;
let clientInstance = null;
let isSendingReminder = false;

function setupBumpReminder(client) {
	clientInstance = client;
	console.log('[Bump Reminder] Initializing...');
	scheduleNextReminder();
}

function scheduleNextReminder() {
	// Clear any existing timeout
	if (reminderTimeout) clearTimeout(reminderTimeout);

	// Get last bump time from DB
	const lastBump = db.prepare(`
        SELECT last_bump_time 
        FROM bump_leaderboard 
        WHERE last_bump_time IS NOT NULL
        ORDER BY last_bump_time DESC 
        LIMIT 1
    `).get();

	if (!lastBump) {
		console.log('[Bump Reminder] No bumps recorded yet');
		return;
	}

	const lastBumpTime = new Date(lastBump.last_bump_time);
	if (isNaN(lastBumpTime.getTime())) {
		console.error('[Bump Reminder] Invalid last bump time:', lastBump.last_bump_time);
		return;
	}

	const nextBumpTime = new Date(lastBumpTime.getTime() + BUMP_COOLDOWN_MS);
	const now = new Date();
	const delayMs = nextBumpTime - now;

	// console.log(`[Bump Reminder] Last bump: ${lastBumpTime.toISOString()}`);
	// console.log(`[Bump Reminder] Next bump possible: ${nextBumpTime.toISOString()}`);
	// console.log(`[Bump Reminder] Current time: ${now.toISOString()}`);
	console.log(`[Bump Reminder] Time until next bump: ${Math.round(delayMs / 1000 / 60)} minutes`);

	if (now >= nextBumpTime) {
		console.log('[Bump Reminder] Bump is available now');
		if (!isSendingReminder) {
			sendReminder();
		}
	}
	else {
		console.log(`[Bump Reminder] Scheduling reminder in ${Math.round(delayMs / 1000 / 60)} minutes`);
		reminderTimeout = setTimeout(() => {
			sendReminder();
		}, delayMs);
	}
}

async function sendReminder() {
	if (isSendingReminder) return;
	isSendingReminder = true;
	const devDisableReminders = false;

	if (!clientInstance) {
		console.error('[Bump Reminder] Client not initialized');
		isSendingReminder = false;
		return;
	}
	if (!devDisableReminders) {
		try {
			const channel = await clientInstance.channels.fetch(BUMP_CHANNEL_ID).catch(console.error);
			if (!channel) {
				console.error('[Bump Reminder] Channel not found');
				isSendingReminder = false;
				return;
			}

			await channel.send({
				content: `⏰ <@&${BUMP_ROLE_ID}> **Bump is available NOW!** Use \`/bump\` to keep the server active!`,
				allowedMentions: { roles: [BUMP_ROLE_ID] },
			});
			console.log('[Bump Reminder] Ping sent successfully');
		}
		catch (error) {
			console.error('[Bump Reminder] Error:', error);
		}
		finally {
			isSendingReminder = false;
		// Don't immediately reschedule - wait for next bump to update the timestamp
		}
	}
	else {
		console.log('[Bump Reminder] Reminders are disabled in development mode');
		isSendingReminder = false;
	}
}

module.exports = {
	setupBumpReminder,
	reschedule: scheduleNextReminder,
};