const db = require('../database');
const sendMessageToChannel = require('../utils/sendMessageToChannel');

const config = require('../config.json');
const IDLE_CHATTER_CHANNEL_ID = config.discord?.idleChatterChannelId;
// 1 hour
const MIN_COOLDOWN_MS = 60 * 60 * 1000;
// 1 hour
const MAX_ADDITIONAL_MS = 60 * 60 * 1000;

const IDLE_REWARD = 5;
const IDLE_MAX_TRIGGERS = Math.max(1, parseInt(config.tonyQuote?.maxIdleUses ?? 40, 10));
let chatterTimeout = null;
let clientInstance = null;
let isSendingMessage = false;

/**
 * Calculates and saves the next random time for an idle message.
 */
function calculateAndSetNextTime() {
	const randomDelay = Math.random() * MAX_ADDITIONAL_MS;
	const nextTime = new Date(Date.now() + MIN_COOLDOWN_MS + randomDelay);
	db.prepare(`
        INSERT INTO tony_idle_chatter_state (id, next_chatter_time)
        VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET next_chatter_time = excluded.next_chatter_time
    `).run(nextTime.toISOString());
	console.log(`[Idle Chatter] New next chatter time set to: ${nextTime.toISOString()}`);
}

function setupIdleChatter(client) {
	clientInstance = client;
	console.log('[Idle Chatter] Initializing...');
	if (!IDLE_CHATTER_CHANNEL_ID) {
		console.warn(
			'[Idle Chatter] idleChatterChannelId is not configured. Skipping idle chatter scheduling.',
		);
		return;
	}
	scheduleNextChatter();
}

function scheduleNextChatter() {
	if (chatterTimeout) clearTimeout(chatterTimeout);

	// Ensure the state row exists
	db.prepare('INSERT OR IGNORE INTO tony_idle_chatter_state (id, next_chatter_time) VALUES (1, NULL)').run();
	const state = db.prepare('SELECT next_chatter_time FROM tony_idle_chatter_state WHERE id = 1').get();

	if (!state || !state.next_chatter_time) {
		console.log('[Idle Chatter] No chatter time set. Scheduling first message.');
		calculateAndSetNextTime();
		// Re-call once to schedule with the new time (row now exists)
		scheduleNextChatter();
		return;
	}

	const nextChatterTime = new Date(state.next_chatter_time);
	if (isNaN(nextChatterTime.getTime())) {
		console.error('[Idle Chatter] Invalid next chatter time in database:', state.next_chatter_time);
		calculateAndSetNextTime();
		scheduleNextChatter();
		return;
	}

	const now = new Date();
	const delayMs = nextChatterTime - now;

	console.log(`[Idle Chatter] Next message scheduled for: ${nextChatterTime.toISOString()}`);

	if (delayMs <= 0) {
		console.log('[Idle Chatter] Chatter time is overdue. Attempting to claim and send.');
		const holdUntil = new Date(Date.now() + 60_000).toISOString();
		const nowIso = new Date().toISOString();
		const claim = db.prepare(`
            UPDATE tony_idle_chatter_state
            SET next_chatter_time = ?
            WHERE id = 1 AND next_chatter_time IS NOT NULL AND next_chatter_time <= ?
        `).run(holdUntil, nowIso);

		if (claim.changes === 1 && !isSendingMessage) {
			sendIdleMessage();
		}
		else {
			// Another instance claimed; reschedule based on current db value
			scheduleNextChatter();
		}
	}
	else {
		console.log(`[Idle Chatter] Scheduling message in ${Math.round(delayMs / 1000 / 60)} minutes.`);
		chatterTimeout = setTimeout(() => {
			sendIdleMessage();
		}, delayMs);
	}
}

async function sendIdleMessage() {
	if (isSendingMessage) return;
	isSendingMessage = true;

	try {
		const uniqueUserIds = db.prepare(`
            SELECT DISTINCT user_id FROM tony_quotes_active WHERE quote_type = 'idle'
        `).all().map(row => row.user_id);

		if (uniqueUserIds.length === 0) {
			console.log('[Idle Chatter] No active idle quotes found to send.');
			// No need to call scheduleNextChatter here, as the finally block handles it.
			return;
		}

		// Step 1: Pick a random user
		const randomUserId = uniqueUserIds[Math.floor(Math.random() * uniqueUserIds.length)];

		// Step 2: Get all idle quotes for that user
		const userQuotes = db.prepare(`
            SELECT id, quote_text FROM tony_quotes_active WHERE quote_type = 'idle' AND user_id = ?
        `).all(randomUserId);

		if (userQuotes.length === 0) {
			console.warn('[Idle Chatter] Selected user has no idle quotes - rescheduling.');
			return;
			// finally{} will schedule the next attempt
		}

		// Step 3: Pick a random quote from that user's list
		const chosenQuote = userQuotes[Math.floor(Math.random() * userQuotes.length)];

		// --- Send the message and process DB updates ---
		await sendMessageToChannel(
			clientInstance,
			IDLE_CHATTER_CHANNEL_ID,
			{ content: `*${chosenQuote.quote_text}*`, allowedMentions: { parse: [] } },
		);

		const nowISO = new Date().toISOString();
		const triggerTx = db.transaction(() => {
			db.prepare(`
                UPDATE tony_quotes_active
                SET times_triggered = times_triggered + 1,
                    last_triggered_at = ?
                WHERE id = ?
            `).run(nowISO, chosenQuote.id);

			db.prepare(`
                INSERT INTO user_economy (user_id, crowns)
                VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
            `).run(randomUserId, IDLE_REWARD, IDLE_REWARD);

			const currentTriggers = db.prepare('SELECT times_triggered FROM tony_quotes_active WHERE id = ?').get(chosenQuote.id);
			if (currentTriggers && currentTriggers.times_triggered >= IDLE_MAX_TRIGGERS) {
				db.prepare('DELETE FROM tony_quotes_active WHERE id = ?').run(chosenQuote.id);
				console.log(`[Idle Chatter] Idle quote ${chosenQuote.id} reached ${IDLE_MAX_TRIGGERS} uses and was retired.`);
			}
		});

		triggerTx();
		console.log(`[Idle Chatter] Sent idle quote ${chosenQuote.id} from user ${randomUserId}.`);

	}
	catch (error) {
		console.error('[Idle Chatter] Failed to send idle message:', error);
	}
	finally {
		isSendingMessage = false;
		// Schedule the next one regardless of success/failure to prevent getting stuck
		calculateAndSetNextTime();
		scheduleNextChatter();
	}
}

module.exports = {
	setupIdleChatter,
};