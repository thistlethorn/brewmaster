// /tasks/captchaRequest.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const db = require('../database');

const VERIFY_CHANNEL_ID = '1375485421990969487';
const SAMPLES_PATH = path.join(__dirname, '..', 'samples');
const VERIFICATION_TIMEOUT_MS = 10 * 60 * 1000;

const activeJobs = new Map();

/**
 * Generates a random 5-character alphanumeric string.
 * @returns {string}
 */
function generateRandomString() {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 5; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

/**
 * Handles the kicking of a user after a timeout.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {string} messageId The ID of the CAPTCHA message.
 */
async function handleTimeout(client, messageId) {
	const session = db.prepare('SELECT * FROM captcha_sessions WHERE message_id = ?').get(messageId);
	if (!session) {
		activeJobs.delete(messageId);
		return;
	}

	try {
		const guild = await client.guilds.fetch(session.guild_id);
		const member = await guild.members.fetch(session.user_id).catch(() => null);

		if (member) {
			const dmEmbed = new EmbedBuilder()
				.setColor(0xFEE75C)
				.setTitle('Verification Timed Out')
				.setDescription('You did not complete the verification in time and have been removed from the Westwind Tavern. You are welcome to try again!')
				.addFields({ name: 'Re-join Link', value: 'https://dsc.gg/westwindtavern' });

			await member.send({ embeds: [dmEmbed] }).catch(err => console.error(`[CAPTCHA] Could not DM user ${member.id}:`, err.message));
			await member.kick('Failed to complete CAPTCHA verification in time.');
		}

		const channel = await guild.channels.fetch(VERIFY_CHANNEL_ID);
		const message = await channel.messages.fetch(messageId).catch(() => null);

		if (message) {
			const timedOutEmbed = new EmbedBuilder()
				.setColor(0x95A5A6)
				.setTitle('Verification Timed Out')
				.setDescription(`${member ? member.user.username : 'User'} failed to verify within the time limit and has been removed.`);
			await message.edit({ embeds: [timedOutEmbed], components: [], files: [] });
		}
	}
	catch (error) {
		console.error(`[CAPTCHA] Error during timeout for message ${messageId}:`, error);
	}
	finally {
		db.prepare('DELETE FROM captcha_sessions WHERE message_id = ?').run(messageId);
		activeJobs.delete(messageId);
	}
}

module.exports = {
	/**
     * Starts the verification process for a new member.
     * @param {import('discord.js').GuildMember} member The member who just joined.
     */
	async startVerification(member) {
		try {
			const captchaFiles = fs.readdirSync(SAMPLES_PATH).filter(file => file.endsWith('.png'));
			if (captchaFiles.length === 0) {
				console.error('[CAPTCHA] No CAPTCHA images found in the /samples directory.');
				return;
			}

			const chosenFile = captchaFiles[Math.floor(Math.random() * captchaFiles.length)];
			const correctAnswer = path.parse(chosenFile).name;

			const options = new Set([correctAnswer]);
			while (options.size < 5) {
				options.add(generateRandomString());
			}

			const shuffledOptions = Array.from(options).sort(() => Math.random() - 0.5);
			const attachment = new AttachmentBuilder(path.join(SAMPLES_PATH, chosenFile), { name: 'captcha.png' });

			const embed = new EmbedBuilder()
				.setColor(0x5865F2)
				.setTitle('Welcome! Please Verify You\'re Human')
				.setDescription('To keep our community safe, please solve the CAPTCHA below by clicking the button with the matching text. You have **2 attempts** and **10 minutes**.')
				.setImage('attachment://captcha.png');

			const row = new ActionRowBuilder();
			shuffledOptions.forEach(option => {
				row.addComponents(
					new ButtonBuilder()
						.setCustomId(`captcha_verify_${option}`)
						.setLabel(option)
						.setStyle(ButtonStyle.Secondary),
				);
			});

			const channel = await member.guild.channels.fetch(VERIFY_CHANNEL_ID);
			const message = await channel.send({
				content: `${member}`,
				embeds: [embed],
				components: [row],
				files: [attachment],
			});

			const expiresAt = new Date(Date.now() + VERIFICATION_TIMEOUT_MS).toISOString();
			db.prepare(`
                INSERT INTO captcha_sessions (message_id, user_id, guild_id, correct_answer, expires_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(message.id, member.id, member.guild.id, correctAnswer, expiresAt);

			// Schedule the timeout job
			const job = schedule.scheduleJob(new Date(expiresAt), () => handleTimeout(member.client, message.id));
			activeJobs.set(message.id, job);

		}
		catch (error) {
			console.error('[CAPTCHA] Failed to start verification process:', error);
		}
	},

	/**
     * Resumes pending verification timeouts on bot startup.
     * @param {import('discord.js').Client} client The Discord client instance.
     */
	resumePendingVerifications(client) {
		console.log('[CAPTCHA] Resuming pending verification sessions...');
		const sessions = db.prepare('SELECT * FROM captcha_sessions').all();
		const now = new Date();
		let resumed = 0;
		let expired = 0;

		for (const session of sessions) {
			const expiryTime = new Date(session.expires_at);
			if (expiryTime <= now) {
				// Expired while bot was offline
				handleTimeout(client, session.message_id);
				expired++;
			}
			else {
				// Still active, reschedule job
				const job = schedule.scheduleJob(expiryTime, () => handleTimeout(client, session.message_id));
				activeJobs.set(session.message_id, job);
				resumed++;
			}
		}
		console.log(`[CAPTCHA] Resumed ${resumed} pending verifications and handled ${expired} expired sessions.`);
	},
};