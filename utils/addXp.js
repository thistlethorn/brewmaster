const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');

/**
 * Sends a level-up notification. Can handle an interaction, a message, or just a client instance for DMs.
 * @param {object} params
 * @param {import('discord.js').Client} params.client The Discord client.
 * @param {string} params.userId The user who leveled up.
 * @param {EmbedBuilder} params.embed The embed to send.
 * @param {import('discord.js').Interaction | import('discord.js').Message | null} [params.source] The interaction or message that triggered the XP gain.
 */
async function sendLevelUpNotification({ client, userId, embed, source }) {
	// If there's an interaction, use it to reply ephemerally.
	if (source && source.isInteraction) {
		if (source.deferred || source.replied) {
			await source.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
		}
		else {
			await source.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
		}
		return;
	}

	// If it was a regular message, send in the same channel.
	if (source && source.channel) {
		await source.channel.send({ content: `<@${userId}>`, embeds: [embed] });
		return;
	}

	// As a fallback (e.g., for weekly resets), send a DM.
	try {
		const user = await client.users.fetch(userId);
		await user.send({ embeds: [embed] });
	}
	catch (error) {
		console.error(`[addXp] Failed to DM user ${userId} about their level up:`, error);
	}
}


/**
 * Adds XP to a character, handles level-ups, and sends notifications.
 * @param {string} userId The ID of the user whose character is gaining XP.
 * @param {number} amount The amount of XP to add.
 * @param {import('discord.js').Interaction | import('discord.js').Message | import('discord.js').Client} source The interaction, message, or client instance that triggered the XP gain.
 * @returns {Promise<void>}
 */
async function addXp(userId, amount, source) {
	const client = source.isInteraction || source.isMessage ? source.client : source;
	const character = db.prepare('SELECT level, xp, stat_points_unspent FROM characters WHERE user_id = ?').get(userId);

	// Case 1: User does not have a character.
	if (!character) {
		const promptEmbed = new EmbedBuilder()
			.setColor(0x3498DB)
			.setTitle('Adventure Awaits!')
			.setDescription('You\'re doing things that earn some XP, but you don\'t have a character yet! Create one now to start your journey and claim your rewards.');

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId('start_char_creation')
				.setLabel('Create Your Character')
				.setStyle(ButtonStyle.Success)
				.setEmoji('⚔️'),
		);

		const replyOptions = { embeds: [promptEmbed], components: [row], flags: MessageFlags.Ephemeral };

		// Case A: The source is a direct command/button interaction. Reply ephemerally.
		if (source.isInteraction) {
			if (source.replied || source.deferred) {
				await source.followUp(replyOptions);
			}
			else {
				await source.reply(replyOptions);
			}
		}
		// Case B: The source is a message. Send a public @mention in the same channel.
		else if (source.channel) {
			await source.channel.send({ content: `<@${userId}>`, embeds: [promptEmbed], components: [row] });
		}
		// Case C: The source is just the client (e.g., weekly reset). Send a DM.
		else {
			try {
				const user = await client.users.fetch(userId);
				// A more informative embed just for the DM
				const dmPromptEmbed = new EmbedBuilder()
					.setColor(0x3498DB)
					.setTitle('Adventure Awaits!')
					.setDescription('You\'re doing things that earn some XP, but you don\'t have a character yet! Head over to <#BOT_COMMANDS_CHANNEL_ID> and use the `/character create` command to start your journey!'.replace('BOT_COMMANDS_CHANNEL_ID', require('../config.json').discord.botCommandsId));

				await user.send({ embeds: [dmPromptEmbed], components: [row] });
			}
			catch (error) {
				console.error(`[addXp] Failed to DM user ${userId} about starting a character.`, error);
			}
		}
		return;
	}

	// Case 2: User has a character.
	let { level, xp, stat_points_unspent } = character;
	xp += amount;
	let levelsGained = 0;
	let xpToNextLevel = Math.floor(100 * (level ** 1.5));

	while (xp >= xpToNextLevel) {
		level++;
		levelsGained++;
		xp -= xpToNextLevel;
		stat_points_unspent += 2;
		xpToNextLevel = Math.floor(100 * (level ** 1.5));
	}

	try {
		db.prepare('UPDATE characters SET level = ?, xp = ?, stat_points_unspent = ? WHERE user_id = ?')
			.run(level, xp, stat_points_unspent, userId);

		if (levelsGained > 0) {
			const pointsGained = levelsGained * 2;
			const levelUpEmbed = new EmbedBuilder()
				.setColor(0xF1C40F)
				.setTitle('🌟 LEVEL UP! 🌟')
				.setDescription(`Congratulations, you have reached **Level ${level}**!`)
				.addFields(
					{ name: 'Stat Points Gained', value: `You gained **${pointsGained}** unspent stat points.`, inline: true },
					{ name: 'Total Unspent Points', value: `You now have **${stat_points_unspent}** points available.`, inline: true },
				)
				.setFooter({ text: 'Use /character spendpoints to improve your stats!' });

			await sendLevelUpNotification({ client, userId, embed: levelUpEmbed, source });
		}
	}
	catch (error) {
		console.error(`[addXp] Failed to update character data for user ${userId}:`, error);
	}
}

module.exports = { addXp };