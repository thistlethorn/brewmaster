// utils/recalculateStats.js
const db = require('../database');

// === BALANCING CONSTANTS ===
// These are the "levers" you can pull to change the feel of your game's progression.

// --- Critical Hit Chance ---
// Everyone starts with a 5% base crit chance.
const BASE_CRIT_CHANCE = 0.05;
// Stats alone can give a maximum of 60% bonus crit chance.
const MAX_CRIT_BONUS_FROM_STATS = 0.60;
// How much "Crit Rating" you need to get 50% of the max bonus. Higher = harder to get crit.
const CRIT_RATING_CONSTANT = 250;


/**
 * Recalculates a character's derived stats based on their base stats, equipment, and status effects.
 * This function is the core of the game's stat system.
 * @param {string} userId The ID of the user whose character needs recalculating.
 * @returns {void}
 */
function recalculateStats(userId) {
	// Note: The async/await keywords are not needed here because better-sqlite3 is synchronous.
	// The function is wrapped in a transaction for atomicity.
	db.transaction(() => {
		const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
		if (!character) {
			throw new Error(`Character not found for user ${userId}`);
		}

		// === STEP 1: Aggregate Total Base Stats ===
		// Start with the character's inherent base stats from leveling up.
		const totalBaseStats = {
			might: character.stat_might,
			finesse: character.stat_finesse,
			wits: character.stat_wits,
			grit: character.stat_grit,
			charm: character.stat_charm,
			fortune: character.stat_fortune,
		};

		const equippedItems = db.prepare(`
            SELECT i.effects_json FROM user_inventory ui
            JOIN items i ON ui.item_id = i.item_id
            WHERE ui.user_id = ? AND ui.equipped_slot IS NOT NULL
        `).all(userId);

		// Parse once and reuse
		const parsedEffects = equippedItems.map((row) => {
			if (!row.effects_json) return null;
			try { return JSON.parse(row.effects_json); }
			catch (e) {
				console.error(`[recalculateStats] Bad effects_json for user ${userId}:`, row.effects_json, e);
				return null;
			}
		});
		// Add base stat bonuses from all equipped items.
		for (const effects of parsedEffects) {
			if (!effects || !effects.base_stats) continue;
			for (const stat in effects.base_stats) {
				if (Object.prototype.hasOwnProperty.call(totalBaseStats, stat)) {
					totalBaseStats[stat] += Number(effects.base_stats[stat]) || 0;
				}
			}
		}

		// === STEP 2: Calculate Derived Stats from Formulas ===

		// --- Special Handling for Crit Chance with Diminishing Returns ---
		// Combine Fortune and Charm into a single "Crit Rating". Here, Charm is worth half as much as Fortune.
		const effectiveCritRating = totalBaseStats.fortune + (totalBaseStats.charm * 0.5);
		// Apply the hyperbolic formula to get the bonus crit chance from stats.
		const bonusCritChance = MAX_CRIT_BONUS_FROM_STATS * (effectiveCritRating / (effectiveCritRating + CRIT_RATING_CONSTANT));
		const finalCritChance = BASE_CRIT_CHANCE + bonusCritChance;
		// --- End of Special Handling ---

		const finalDerivedStats = {
			max_health: 10 + (character.level * 5) + (totalBaseStats.grit * 8),
			max_mana: 10 + (character.level * 3) + (totalBaseStats.wits * 10),
			max_ki: (totalBaseStats.might + totalBaseStats.grit) * 2,
			armor_class: 10 + Math.floor(totalBaseStats.finesse / 3),
			// result -> calc'd formula
			crit_chance: finalCritChance,
			crit_damage_modifier: 1.5 + (totalBaseStats.might * 0.01),
		};

		// === STEP 3: Add Direct Bonuses as Exceptions ===
		// This handles special cases like a shield's flat AC bonus or rare flat health bonuses.
		for (const item of equippedItems) {
			try {
				const effects = JSON.parse(item.effects_json);
				if (!effects) continue;

				// Add direct bonuses that aren't calculated from base stats
				finalDerivedStats.armor_class += Number(effects.ac_bonus) || 0;
				finalDerivedStats.max_health += Number(effects.max_health_bonus) || 0;
			}
			catch (e) {
				console.error(`[recalculateStats] Failed to parse direct bonuses from effects_json for user ${userId}:`, item.effects_json, e);
			}
		}

		// === STEP 4: Sanitize and Clamp Final Values ===
		const toFinite = (v, fallback) => {
			const n = Number(v);
			return Number.isFinite(n) ? n : fallback;
		};
		const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

		// Sanitize the final calculated values to prevent invalid data.
		finalDerivedStats.max_health = Math.max(1, Math.floor(toFinite(finalDerivedStats.max_health, 1)));
		finalDerivedStats.max_mana = Math.max(0, Math.floor(toFinite(finalDerivedStats.max_mana, 0)));
		finalDerivedStats.max_ki = Math.max(0, Math.floor(toFinite(finalDerivedStats.max_ki, 0)));
		finalDerivedStats.armor_class = Math.max(0, Math.floor(toFinite(finalDerivedStats.armor_class, 10)));

		// Be absolutely sure to hardcap crit at 100% to avoid logic problems
		finalDerivedStats.crit_chance = clamp(toFinite(finalDerivedStats.crit_chance, 0.05), 0.0, 1.0);

		finalDerivedStats.crit_damage_modifier = Math.max(1.5, toFinite(finalDerivedStats.crit_damage_modifier, 1.5));

		// Clamp current resource pools to their new maximums, preserving the player's current health percentage.
		const healthPercent = character.max_health > 0 ? (character.current_health / character.max_health) : 1;
		const manaPercent = character.max_mana > 0 ? (character.current_mana / character.max_mana) : 1;
		const kiPercent = character.max_ki > 0 ? (character.current_ki / character.max_ki) : 1;

		const currentHealth = clamp(Math.round(finalDerivedStats.max_health * healthPercent), 0, finalDerivedStats.max_health);
		const currentMana = clamp(Math.round(finalDerivedStats.max_mana * manaPercent), 0, finalDerivedStats.max_mana);
		const currentKi = clamp(Math.round(finalDerivedStats.max_ki * kiPercent), 0, finalDerivedStats.max_ki);


		// === STEP 5: Update the Database ===
		try {
			const result = db.prepare(`
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
				finalDerivedStats.max_health, currentHealth,
				finalDerivedStats.max_mana, currentMana,
				finalDerivedStats.max_ki, currentKi,
				finalDerivedStats.armor_class, finalDerivedStats.crit_chance,
				finalDerivedStats.crit_damage_modifier,
				userId,
			);
			if (result.changes === 0) {
				throw new Error(`No character updated for user ${userId} - character may have been deleted`);
			}
			console.log(`[recalculateStats] Successfully updated stats for user ${userId}.`);
		}
		catch (error) {
			console.error(`[recalculateStats] Failed to update stats for user ${userId}:`, error);
			// Re-throw to ensure the transaction rolls back
			throw error;
		}
	})();
}

module.exports = { recalculateStats };