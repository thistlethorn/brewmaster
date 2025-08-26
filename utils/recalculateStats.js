// utils/recalculateStats.js
const db = require('../database');

/**
 * Recalculates a character's derived stats based on their base stats, equipment, and status effects.
 * @param {string} userId The ID of the user whose character needs recalculating.
 * @returns {Promise<void>}
 */
async function recalculateStats(userId) {
	return db.transaction(() => {
		const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
		if (!character) {
			throw new Error(`Character not found for user ${userId}`);
		}

		// 1. Initialize with the character's stored stats (sane fallbacks)
		const finalStats = {
			max_health: Number.isFinite(Number(character.max_health)) ? Number(character.max_health) : 10,
			max_mana: Number.isFinite(Number(character.max_mana)) ? Number(character.max_mana) : 10,
			max_ki: Number.isFinite(Number(character.max_ki)) ? Number(character.max_ki) : 0,
			armor_class: Number.isFinite(Number(character.armor_class)) ? Number(character.armor_class) : 10,
			crit_chance: Number.isFinite(Number(character.crit_chance)) ? Number(character.crit_chance) : 0.05,
			crit_damage_modifier: Number.isFinite(Number(character.crit_damage_modifier)) ? Number(character.crit_damage_modifier) : 1.5,
		};

		// 2. Aggregate bonuses from equipped items
		const equippedItems = db.prepare(`
            SELECT i.effects_json FROM user_inventory ui
            JOIN items i ON ui.item_id = i.item_id
            WHERE ui.user_id = ? AND ui.equipped_slot IS NOT NULL
        `).all(userId);


		for (const item of equippedItems) {
			try {
				const effects = JSON.parse(item.effects_json);
				if (!effects) continue;

				// Add flat stat bonuses (e.g., might, grit)
				// Note: This function only calculates *derived* stats. Base stats are modified elsewhere (level-ups).
				// We can, however, use item effects to modify other derived stats.
				if (effects.stats) {
					finalStats.max_health += Number(effects.stats.max_health) || 0;
					finalStats.max_mana += Number(effects.stats.max_mana) || 0;
					finalStats.max_ki += Number(effects.stats.max_ki) || 0;
					finalStats.crit_chance += Number(effects.stats.crit_chance) || 0;
					finalStats.crit_damage_modifier += Number(effects.stats.crit_damage_modifier) || 0;
				}
				// Add direct bonuses to things like AC
				finalStats.armor_class += Number(effects.ac_bonus) || 0;

			}
			catch (e) {
				console.error(`[recalculateStats] Failed to parse effects_json for an item of user ${userId}:`, item.effects_json, e);
			}
		}


		// 3. (Placeholder) Aggregate bonuses/penalties from status effects
		// const statusEffects = db.prepare('SELECT effects_json FROM character_status_effects WHERE target_user_id = ? AND expires_at > ?').all(userId, new Date().toISOString());
		// for (const effect of statusEffects) { /* ... apply bonuses/penalties ... */ }


		// 4. Ensure current health/mana don't exceed the new maximums.
		// Clamp current_* between 0 and their respective max values, handling non-finite values safely
		const toFinite = (v, fallback) => {
			const n = Number(v);
			return Number.isFinite(n) ? n : fallback;
		};
		const clamp = (n, min, max) => {
			const lo = Math.min(min, max);
			const hi = Math.max(min, max);
			return Math.min(Math.max(n, lo), hi);
		};

		// Normalize derived stats to sane, finite ranges to prevent invalid DB writes
		const normalizeFinalStats = () => {
			finalStats.max_health = Math.max(0, toFinite(finalStats.max_health, 0));
			finalStats.max_mana = Math.max(0, toFinite(finalStats.max_mana, 0));
			finalStats.max_ki = Math.max(0, toFinite(finalStats.max_ki, 0));
			finalStats.armor_class = Math.max(0, toFinite(finalStats.armor_class, 10));
			// crit_chance is a probability
			finalStats.crit_chance = clamp(toFinite(finalStats.crit_chance, 0.05), 0, 1);
			// crit damage should not drop below 1x
			finalStats.crit_damage_modifier = Math.max(1, toFinite(finalStats.crit_damage_modifier, 1.5));
		};
		normalizeFinalStats();

		const currentHealth = clamp(
			toFinite(character.current_health, finalStats.max_health),
			0,
			finalStats.max_health,
		);
		const currentMana = clamp(
			toFinite(character.current_mana, finalStats.max_mana),
			0,
			finalStats.max_mana,
		);
		const currentKi = clamp(
			toFinite(character.current_ki, finalStats.max_ki),
			0,
			finalStats.max_ki,
		);


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
			throw error;
		}
	})();
}

module.exports = { recalculateStats };