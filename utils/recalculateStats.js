// utils/recalculateStats.js
const db = require('../database');

/**
 * Recalculates a character's derived stats based on their base stats, equipment, and status effects.
 * @param {string} userId The ID of the user whose character needs recalculating.
 * @returns {Promise<void>}
 */
async function recalculateStats(userId) {
	const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
	if (!character) return;

	// 1. Initialize with base stats
	const finalStats = {
		max_health: 10,
		max_mana: 10,
		max_ki: 0,
		armor_class: 10,
		crit_chance: 0.05,
		crit_damage_modifier: 1.5,
	};

	// 2. Aggregate bonuses from equipped items
	const equippedItemIds = [];
	Object.keys(character).forEach(key => {
		if (key.startsWith('equipped_') && character[key] !== null) {
			equippedItemIds.push(character[key]);
		}
	});

	if (equippedItemIds.length > 0) {
		const placeholders = equippedItemIds.map(() => '?').join(',');
		const items = db.prepare(`
            SELECT i.effects_json FROM user_inventory ui
            JOIN items i ON ui.item_id = i.item_id
            WHERE ui.inventory_id IN (${placeholders})
        `).all(...equippedItemIds);

		for (const item of items) {
			try {
				const effects = JSON.parse(item.effects_json);
				if (!effects) continue;

				// Add flat stat bonuses (e.g., might, grit)
				// Note: This function only calculates *derived* stats. Base stats are modified elsewhere (level-ups).
				// We can, however, use item effects to modify other derived stats.
				if (effects.stats) {
					finalStats.max_health += effects.stats.max_health || 0;
					finalStats.max_mana += effects.stats.max_mana || 0;
					finalStats.max_ki += effects.stats.max_ki || 0;
					finalStats.crit_chance += effects.stats.crit_chance || 0;
					finalStats.crit_damage_modifier += effects.stats.crit_damage_modifier || 0;
				}
				// Add direct bonuses to things like AC
				finalStats.armor_class += effects.ac_bonus || 0;

			}
			catch (e) {
				console.error(`[recalculateStats] Failed to parse effects_json for an item of user ${userId}:`, item.effects_json, e);
			}
		}
	}

	// 3. (Placeholder) Aggregate bonuses/penalties from status effects
	// const statusEffects = db.prepare('SELECT effects_json FROM character_status_effects WHERE target_user_id = ? AND expires_at > ?').all(userId, new Date().toISOString());
	// for (const effect of statusEffects) { /* ... apply bonuses/penalties ... */ }


	// 4. Ensure current health/mana don't exceed the new maximums.
	const currentHealth = Math.min(character.current_health, finalStats.max_health);
	const currentMana = Math.min(character.current_mana, finalStats.max_mana);
	const currentKi = Math.min(character.current_ki, finalStats.max_ki);


	// 5. Update the character's record in the database
	try {
		db.prepare(`
            UPDATE characters
            SET
                max_health = ?,
                current_health = ?,
                max_mana = ?,
                current_mana = ?,
                max_ki = ?,
                current_ki = ?,
                armor_class = ?,
                crit_chance = ?,
                crit_damage_modifier = ?
            WHERE user_id = ?
        `).run(
			finalStats.max_health, currentHealth,
			finalStats.max_mana, currentMana,
			finalStats.max_ki, currentKi,
			finalStats.armor_class, finalStats.crit_chance,
			finalStats.crit_damage_modifier,
			userId,
		);
		console.log(`[recalculateStats] Successfully updated stats for user ${userId}.`);
	}
	catch (error) {
		console.error(`[recalculateStats] Failed to update stats for user ${userId}:`, error);
	}
}

module.exports = { recalculateStats };