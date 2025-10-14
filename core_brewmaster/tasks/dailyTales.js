// core_brewmaster/tasks/dailyTales.js
const cron = require('node-cron');
const schedule = require('node-schedule');
const db = require('@database/database.js');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { scheduleRoleRemoval } = require('@core_tavernborne/tasks/tempRoleManager.js');
const config = require('@root/config.json');

const {
	postChannelId, archiveChannelId, pingRoleId, starCrewRoleId,
	cronSchedule, activeDurationHours, questionStarReward, answerWinReward,
} = config.dailyTales;

const activeJobs = new Map();

/**
 * Post a randomly selected approved Daily Tale to the configured channel and schedule its conclusion.
 *
 * Selects one approved submission; if none is available the function exits without posting. When a submission is found,
 * the function sends a message in the configured post channel (mentioning the ping role) containing an embed and interactive
 * buttons, persists a record in `daily_tales_messages` and marks the submission as used, then schedules the tale's conclusion.
 */
async function postDailyTale(client) {
	try {
		const question = db.prepare(`
            SELECT * FROM daily_tales_submissions
            WHERE status = 'approved'
            ORDER BY RANDOM() LIMIT 1
        `).get();

		if (!question) {
			console.log('[DailyTales] No approved questions found. Skipping post for today.');
			return;
		}

		const channel = await client.channels.fetch(postChannelId);
		if (!channel?.isTextBased()) {
			throw new Error('Daily Tales post channel not found or not a text channel.');
		}

		const endTime = new Date(Date.now() + activeDurationHours * 60 * 60 * 1000);
		const endTimestamp = Math.floor(endTime.getTime() / 1000);

		const embed = new EmbedBuilder()
			.setColor(0x5865F2)
			.setTitle('📜 Daily Tavern Topic 📜')
			.setDescription(`**${question.question_text}**`)
			.setFooter({ text: `⭐ 0 Stars | This question is active for the next ${activeDurationHours} hours.` });

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId('dailytales_submit').setLabel('Submit a Question').setStyle(ButtonStyle.Success).setEmoji('✍️'),
			new ButtonBuilder().setCustomId(`dailytales_star_question_${question.submission_id}`).setLabel('Star this Question').setStyle(ButtonStyle.Primary).setEmoji('⭐'),
			new ButtonBuilder().setCustomId('dailytales_toggle_ping').setLabel('Toggle Daily Ping').setStyle(ButtonStyle.Secondary).setEmoji('🔔'),
		);

		const message = await channel.send({ content: `<@&${pingRoleId}>`, embeds: [embed], components: [row] });

		db.transaction(() => {
			db.prepare('INSERT INTO daily_tales_messages (message_id, channel_id, submission_id, end_timestamp) VALUES (?, ?, ?, ?)')
				.run(message.id, channel.id, question.submission_id, endTimestamp);
			db.prepare('UPDATE daily_tales_submissions SET status = \'used\' WHERE submission_id = ?').run(question.submission_id);
		})();

		scheduleTaleConclusion(client, message.id, endTime);
		console.log(`[DailyTales] Posted new tale (Submission ID: ${question.submission_id}). Conclusion scheduled for ${endTime.toISOString()}.`);
	}
	catch (error) {
		console.error('[DailyTales] Failed to post daily tale:', error);
	}
}

/**
 * Schedule the automatic conclusion for a posted Daily Tale and ensure only one job exists for that message.
 * @param {import('discord.js').Client} client - Discord client instance used when concluding the tale.
 * @param {string} messageId - ID of the tale message to conclude.
 * @param {Date} endTime - Time at which the tale should be concluded.
 */
function scheduleTaleConclusion(client, messageId, endTime) {
	if (activeJobs.has(messageId)) {
		activeJobs.get(messageId).cancel();
	}
	const job = schedule.scheduleJob(endTime, () => concludeDailyTale(client, messageId));
	activeJobs.set(messageId, job);
}

/**
 * Concludes a Daily Tale: determines the winning reply (if any), archives the record to the archive channel, grants rewards and a temporary role to the winner, rewards the question submitter when applicable, disables interactions on the original post, and removes the tale record.
 * @param {import('discord.js').Client} client - Discord client instance.
 * @param {string} messageId - ID of the tale message to conclude.
 */
async function concludeDailyTale(client, messageId) {
	console.log(`[DailyTales] Concluding tale for message ID: ${messageId}`);
	try {
		const taleData = db.prepare('SELECT * FROM daily_tales_messages WHERE message_id = ?').get(messageId);
		if (!taleData) return;

		const originalChannel = await client.channels.fetch(taleData.channel_id).catch(() => null);
		const originalMessage = await originalChannel?.messages.fetch(messageId).catch(() => null);

		let winner = null;
		if (originalMessage) {
			// Fetch recent messages and filter for replies to the tale message
			const replies = (await originalChannel.messages.fetch({ limit: 100 })).filter(m =>
				m.reference && m.reference.messageId === messageId && !m.author.bot,
			);

			if (replies.size > 0) {
				let topScore = -1;
				for (const reply of replies.values()) {
					const starReaction = reply.reactions.cache.get('⭐');
					// Bot's reaction doesn't count, so we subtract 1
					const score = starReaction ? Math.max(0, starReaction.count - 1) : 0;
					if (score > topScore) {
						topScore = score;
						winner = reply;
					}
				}
			}
		}

		const questionData = db.prepare('SELECT * FROM daily_tales_submissions WHERE submission_id = ?').get(taleData.submission_id);
		const archiveChannel = await client.channels.fetch(archiveChannelId);

		const recordEmbed = new EmbedBuilder()
			.setColor(0x95A5A6)
			.setTitle(`Tavern Daily Tales - Record for ${new Date(Date.now() - activeDurationHours * 3600000).toLocaleDateString()}`)
			.addFields({ name: 'Question of the Day', value: questionData.question_text });

		if (winner) {
			const winnerMember = await originalChannel.guild.members.fetch(winner.author.id).catch(() => null);
			recordEmbed.addFields({ name: 'Winning Answer', value: `>>> ${winner.content}\n- ${winner.author}` });

			if (winnerMember) {
				db.prepare('INSERT OR IGNORE INTO user_economy (user_id, crowns) VALUES (?, 0)').run(winner.author.id);
				db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(answerWinReward, winner.author.id);
				await winnerMember.roles.add(starCrewRoleId);
				// Role lasts for 1 week
				await scheduleRoleRemoval(client, winner.author.id, winner.guild.id, starCrewRoleId, 7 * 24 * 60 * 60 * 1000);
			}
		}
		else {
			recordEmbed.addFields({ name: 'Winning Answer', value: 'No answers were submitted for today\'s tale!' });
		}
		recordEmbed.addFields({ name: 'About Daily Tales', value: 'This is a daily community prompt! You can join the fun by submitting your own questions and voting on answers in our main chat. Use the `/help` command for more info.' });

		await archiveChannel.send({ embeds: [recordEmbed] });

		// Reward question submitter if their question was popular
		if (questionData.star_count > 3) {
			db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(questionStarReward, questionData.submitter_id);
		}

		if (originalMessage) {
			const disabledRow = new ActionRowBuilder().addComponents(
				originalMessage.components[0].components.map(c => ButtonBuilder.from(c).setDisabled(true)),
			);
			await originalMessage.edit({ components: [disabledRow] });
		}

		db.prepare('DELETE FROM daily_tales_messages WHERE message_id = ?').run(messageId);
	}
	catch (error) {
		console.error(`[DailyTales] Failed to conclude tale for message ${messageId}:`, error);
	}
	finally {
		activeJobs.delete(messageId);
	}
}

module.exports = {
	setupDailyTales: (client) => {
		console.log('[DailyTales] Setting up daily cron job...');
		cron.schedule(cronSchedule, () => postDailyTale(client), {
			timezone: 'UTC',
		});
	},
	resumeDailyTales: (client) => {
		console.log('[DailyTales] Resuming pending tale conclusions...');
		const activeTales = db.prepare('SELECT * FROM daily_tales_messages').all();
		const now = Date.now();
		for (const tale of activeTales) {
			const endTime = new Date(tale.end_timestamp * 1000);
			if (endTime <= now) {
				concludeDailyTale(client, tale.message_id);
			}
			else {
				scheduleTaleConclusion(client, tale.message_id, endTime);
			}
		}
	},
};