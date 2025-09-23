const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');
const config = require('../config.json');
const BOT_COMMANDS_CHANNEL_ID = config.discord.botCommandsId;
const CHAR_LOG_CHANNEL_ID = config.tavernborne.characterLogChannelId;
const { checkBetatestLock } = require(`${global.__utils}/betaLock.js`);
// const { tavernborneEmojis } = require('./constants.js');
// const xpEmoji = tavernborneEmojis.XP;

/**
 * Sends a level-up notification. Can handle an interaction, a message, or just a client instance for DMs.
 * @param {object} params
 * @param {import('discord.js').Client} params.client The Discord client.
 * @param {string} params.userId The user who leveled up.
 * @param {EmbedBuilder} params.embed The embed to send.
 * @param {import('discord.js').Interaction | import('discord.js').Message | null} [params.source] The interaction or message that triggered the XP gain.
 */
async function sendLevelUpNotification({ activeClient, userId, embed, source }) {
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
		const user = await activeClient.users.fetch(userId);
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
async function addXp(userId, amount, source, reason, title = null) {

	if (await checkBetatestLock(source, null, userId)) return;

	let activeClient;
	if (source?.client) {
		activeClient = source.client;
	}
	else if (source?.ws) {
		activeClient = source;
	}
	else {
		throw new Error('Invalid source passed to addXp');
	}
	const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
	const otherCharData = db.prepare('SELECT character_name, character_image FROM characters WHERE user_id = ?').get(userId);
	const charLogChannel = await activeClient.channels.fetch(CHAR_LOG_CHANNEL_ID);
	const user = await activeClient.users.fetch(userId);

	// Case 1: User does not have a character.
	if (!character) {
		const isOptedOut = db.prepare('SELECT 1 FROM character_creation_opt_out WHERE user_id = ?').get(userId);
		if (isOptedOut) {
			// If they've opted out, do nothing.
			return;
		}
		const promptEmbed = new EmbedBuilder()
			.setColor(0x3498DB)
			.setTitle('Adventure Awaits!')
			.addFields({ name: 'Missed XP Amount:', value: `**${amount}** XP`, inline: true })
			.setDescription('You\'re doing **GREAT** things that would earn some __serious__ XP, but you don\'t have a character yet to use it! Create one now to start your journey and claim your rewards going forward.');

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId('start_char_creation')
				.setLabel('Create Your Character')
				.setStyle(ButtonStyle.Success)
				.setEmoji('⚔️'),
			new ButtonBuilder()
				.setCustomId(`opt_out_char_creation_${userId}`)
				.setLabel('Never show this again')
				.setStyle(ButtonStyle.Secondary),
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
				// A more informative embed just for the DM
				const dmPromptEmbed = new EmbedBuilder()
					.setColor(0x3498DB)
					.setTitle('Adventure Awaits!')
					.addFields({ name: 'Missed XP Amount:', value: `**${amount}** XP`, inline: true })
					.setDescription('You\'re doing **GREAT** things that would earn some __serious__ XP, but you don\'t have a character yet to use it! Head over to <#BOT_COMMANDS_CHANNEL_ID> and use the `/character create` command to start your journey!'.replace('BOT_COMMANDS_CHANNEL_ID', BOT_COMMANDS_CHANNEL_ID));

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
	let species;
	db.transaction(() => {
		const statGains = { might: 0, finesse: 0, wits: 0, grit: 0, charm: 0, fortune: 0 };
		const bonusMessages = [];

		if (levelsGained > 0 && character.species_id) {
			species = db.prepare('SELECT name, stat_bonus_json FROM species WHERE species_id = ?').get(character.species_id);

			const processBonus = (bonusJson, sourceName) => {
				if (!bonusJson) return;
				const bonuses = JSON.parse(bonusJson);
				for (const [stat, value] of Object.entries(bonuses)) {
					// Primordialfolk High-Risk/Reward Logic
					if (species.name === 'Primordialfolk') {
						// 75% chance for +3, 25% for -1. (3 * 0.75) + (-1 * 0.25) = 2.25 - 0.25 = 2.0 average gain.
						const roll = Math.random();
						const gain = roll < 0.75 ? 3 : -1;
						statGains[stat] += gain;
						bonusMessages.push(`**${gain > 0 ? `+${gain}` : gain}** ${stat.charAt(0).toUpperCase() + stat.slice(1)} (from ${sourceName}) ${gain > 0 ? '✨' : '💢'}`);
					}
					else {
						statGains[stat] += (value * levelsGained);
					}
				}
			};

			processBonus(species.stat_bonus_json, species.name);

			if (character.subspecies_id) {
				const subspecies = db.prepare('SELECT name, stat_bonus_json FROM subspecies WHERE subspecies_id = ?').get(character.subspecies_id);
				processBonus(subspecies.stat_bonus_json, subspecies.name);
			}

			// Add non-Primordialfolk bonuses to the message list
			if (species.name !== 'Primordialfolk') {
				for (const [stat, value] of Object.entries(statGains)) {
					if (value > 0) {
						bonusMessages.push(`**+${value}** ${stat.charAt(0).toUpperCase() + stat.slice(1)}`);
					}
				}
			}
		}

		// Prepare the dynamic part of the UPDATE query
		const statUpdateClauses = Object.keys(statGains).map(stat => `stat_${stat} = stat_${stat} + ?`).join(', ');
		const statUpdateValues = Object.values(statGains);

		const finalUpdateQuery = `
            UPDATE characters 
            SET 
                level = ?, xp = ?, stat_points_unspent = ?, 
                ${statUpdateClauses}
            WHERE user_id = ?
        `;

		try {
			db.prepare(finalUpdateQuery).run(level, xp, stat_points_unspent, ...statUpdateValues, userId);

			const xpRewardEmbed = new EmbedBuilder()
				.setColor(0xF1C40F)
				.setTitle('💠 XP Gained! 💠')
				.setThumbnail(otherCharData.character_image || null)
				.addFields(
					{ name: `${title ? title : `__${otherCharData.character_name}__`}`, value: `${reason}`, inline: false },
					{ name: `[\`${amount} XP\`] Earned`, value: '💠💠💠💠💠💠💠💠💠💠💠', inline: false },
				)
				.setFooter({ text: 'To view your character, their XP, and your progress, use /character view!' });
			charLogChannel.send({ embeds: [xpRewardEmbed] });

			if (levelsGained > 0) {
				const pointsGained = levelsGained * 2;
				const levelUpEmbed = new EmbedBuilder()
					.setColor(0x75146a)
					.setTitle('🌟 LEVEL GAINED! 🌟')
					.setDescription(`Congratulations, you have reached **Level ${level}**!`)
					.addFields(
						{ name: 'Unspent Stat Points', value: `You gained **${pointsGained}** points to spend. You now have **${stat_points_unspent}** total.`, inline: false },
					)
					.setFooter({ text: 'Use /character spendpoints to improve your stats!' });

				if (bonusMessages.length > 0) {
					levelUpEmbed.addFields({ name: `${species ? `[${species.name}] ` : ''}Automatic Species Bonuses`, value: bonusMessages.join('\n'), inline: false });
				}

				sendLevelUpNotification({ activeClient, userId, embed: levelUpEmbed, source });

				const logEmbed = new EmbedBuilder()
					.setColor(0x75146a)
					.setTitle('🌟 LEVEL GAINED! 🌟')
					.setThumbnail(otherCharData.character_image || null)
					.addFields(
						{ name: `__${otherCharData.character_name}__`, value: `Reached **Level ${level}**!`, inline: false },
						{ name: `[\`${stat_points_unspent} SP\`] Unspent Statpoints`, value: '🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟', inline: false },
					);
				if (bonusMessages.length > 0) {
					logEmbed.addFields({ name: `${species ? `[${species.name}] ` : ''}Automatic Species Bonuses`, value: bonusMessages.join('\n'), inline: false });
				}
				charLogChannel.send({ embeds: [logEmbed] });
			}
		}
		catch (error) {
			console.error(`[addXp] Failed to update character data for user ${userId}:`, error);
			throw error;
		}
	})();
}

module.exports = { addXp };