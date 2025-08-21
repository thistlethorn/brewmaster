// utils/addXp.js
const { EmbedBuilder } = require('discord.js');
const db = require('../database');

/**
 * Adds XP to a character, handles level-ups, and sends a notification.
 * @param {string} userId The ID of the user whose character is gaining XP.
 * @param {number} amount The amount of XP to add.
 * @param {import('discord.js').Interaction} interaction The interaction object, used for replying with a level-up message.
 * @returns {Promise<void>}
 */
async function addXp(userId, amount, interaction) {
	const character = db.prepare('SELECT level, xp, stat_points_unspent FROM characters WHERE user_id = ?').get(userId);

	if (!character) {
		console.log(`[addXp] Attempted to add XP to user ${userId}, but they have no character.`);
		return;
	}

	let { level, xp } = character;
	let stat_points_unspent = character.stat_points_unspent;
	let hasLeveledUp = false;

	xp += amount;

	let xpToNextLevel = Math.floor(100 * (level ** 1.5));

	// Loop to handle multiple level-ups from a single XP gain
	while (xp >= xpToNextLevel) {
		level++;
		xp -= xpToNextLevel;

		// Award 2 stat points per level
		stat_points_unspent += 2;
		hasLeveledUp = true;
		xpToNextLevel = Math.floor(100 * (level ** 1.5));
	}

	// Use a transaction to update the character's stats atomically
	try {
		db.prepare(`
            UPDATE characters
            SET level = ?, xp = ?, stat_points_unspent = ?
            WHERE user_id = ?
        `).run(level, xp, stat_points_unspent, userId);

		// If a level-up occurred, send a notification.
		if (hasLeveledUp && interaction) {
			const levelUpEmbed = new EmbedBuilder()
				.setColor(0xF1C40F)
				.setTitle('🌟 LEVEL UP! 🌟')
				.setDescription(`Congratulations, you have reached **Level ${level}**!`)
				.addFields(
					{ name: 'Stat Points Gained', value: 'You have received **2** unspent stat points!', inline: true },
					{ name: 'Total Unspent Points', value: `You now have **${stat_points_unspent}** points available.`, inline: true },
				)
				.setFooter({ text: 'Use /character spendpoints (coming soon) to improve your stats!' });

			// Use followUp to avoid "interaction already replied" errors if the command has other responses.
			await interaction.followUp({ embeds: [levelUpEmbed], ephemeral: true });
		}
	}
	catch (error) {
		console.error(`[addXp] Failed to update character data for user ${userId}:`, error);
	}
}

module.exports = { addXp };