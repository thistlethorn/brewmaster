// utils/addXp.js
const { EmbedBuilder, MessageFlags } = require('discord.js');
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
	// Defensive clamps: avoid level 0/negative and negative/float XP
	level = Math.max(1, Math.floor(level));
	xp = Math.max(0, Math.floor(xp));

	const rawSpu = Number(character.stat_points_unspent);
	let stat_points_unspent = Number.isFinite(rawSpu)
		? Math.max(0, Math.floor(rawSpu))
		: 0;

	// Validate and normalize XP delta
	const delta = Number.isFinite(amount) ? Math.floor(amount) : NaN;
	if (!Number.isFinite(delta) || delta < 0) {
		console.warn(`[addXp] Invalid XP amount (${amount}) for user ${userId}; must be a non-negative integer.`);
		return;
	}
	xp = Math.max(0, xp + delta);

	let xpToNextLevel = Math.max(1, Math.floor(100 * (level ** 1.5)));

	let levelsGained = 0;
	// Loop to handle multiple level-ups from a single XP gain
	while (xp >= xpToNextLevel) {
		level++;
		xp -= xpToNextLevel;

		// Award 2 stat points per level
		stat_points_unspent += 2;
		levelsGained += 1;
		xpToNextLevel = Math.max(1, Math.floor(100 * (level ** 1.5)));
	}

	// Use a transaction to update the character's stats atomically
	try {
		// Use a transaction to update the character's stats atomically
		const updateChar = db.transaction(() => {
			db.prepare(`
                UPDATE characters
                SET level = ?, xp = ?, stat_points_unspent = ?
                WHERE user_id = ?
            `).run(level, xp, stat_points_unspent, userId);
		});
		updateChar();

		// If a level-up occurred, send a notification.
		if (levelsGained > 0 && interaction) {
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

			if (interaction.deferred || interaction.replied) {
				await interaction.followUp({ embeds: [levelUpEmbed], flags: MessageFlags.Ephemeral });
			}
			else {
				await interaction.reply({ embeds: [levelUpEmbed], flags: MessageFlags.Ephemeral });
			}
		}
	}
	catch (error) {
		console.error(`[addXp] Failed to update character data for user ${userId}:`, error);
	}
}

module.exports = { addXp };