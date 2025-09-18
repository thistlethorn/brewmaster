// utils/voucherLoot.js
const db = require('../database');
const { addXp } = require('./addXp');

// Helper for weighted random selection
function weightedRandom(items) {
	const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
	let random = Math.random() * totalWeight;
	for (const item of items) {
		if (random < item.weight) {
			return item.value;
		}
		random -= item.weight;
	}
}

// Loot Pools Definition
const lootPools = {
	'Common Armor Voucher': {
		type: 'item',
		pool: [
			{ weight: 70, value: { rarity: 'COMMON', type: 'ARMOR' } },
			{ weight: 25, value: { rarity: 'UNCOMMON', type: 'ARMOR' } },
			{ weight: 5, value: { rarity: 'RARE', type: 'ARMOR' } },
		],
	},
	'Rare Equipment Voucher': {
		type: 'item',
		pool: [
			{ weight: 60, value: { rarity: 'RARE' } },
			{ weight: 35, value: { rarity: 'EPIC' } },
			{ weight: 5, value: { rarity: 'LEGENDARY' } },
		],
	},
	'Epic Spell Scroll Voucher': {
		type: 'item',
		pool: [
			{ weight: 80, value: { rarity: 'EPIC', type: 'SPELL_SCROLL' } },
			{ weight: 20, value: { rarity: 'LEGENDARY', type: 'SPELL_SCROLL' } },
		],
	},
	'Sealed Chest of Crowns': {
		type: 'crowns',
		min: 50,
		max: 250,
	},
	'XP in a Bottle': {
		type: 'xp',
		min: 25,
		max: 100,
	},
	'Rusted Lockbox': {
		type: 'item',
		pool: [
			{ weight: 60, value: { rarity: 'COMMON' } },
			{ weight: 30, value: { rarity: 'UNCOMMON' } },
			{ weight: 9, value: { rarity: 'RARE' } },
			{ weight: 1, value: { rarity: 'EPIC' } },
		],
	},
	'Gilded Chest': {
		type: 'item',
		pool: [
			{ weight: 50, value: { rarity: 'RARE' } },
			{ weight: 40, value: { rarity: 'EPIC' } },
			{ weight: 10, value: { rarity: 'LEGENDARY' } },
		],
	},
};

/**
 * Rolls for a prize from a voucher or loot crate.
 * @param {string} itemName The name of the item being opened.
 * @returns {Promise<{type: string, value: any, name: string}|null>} The prize, or null if invalid.
 */
async function rollVoucher(itemName) {
	const poolData = lootPools[itemName];
	if (!poolData) return null;

	if (poolData.type === 'crowns') {
		const amount = Math.floor(Math.random() * (poolData.max - poolData.min + 1)) + poolData.min;
		return { type: 'crowns', value: amount, name: `${amount} Crowns` };
	}

	if (poolData.type === 'xp') {
		const amount = Math.floor(Math.random() * (poolData.max - poolData.min + 1)) + poolData.min;
		return { type: 'xp', value: amount, name: `${amount} XP` };
	}

	if (poolData.type === 'item') {
		const criteria = weightedRandom(poolData.pool);
		let query = 'SELECT item_id, name FROM items WHERE rarity = ?';
		const params = [criteria.rarity.toUpperCase()];

		if (criteria.type) {
			query += ' AND item_type = ?';
			params.push(criteria.type.toUpperCase());
		}

		// Exclude STARTER and other VOUCHER items from the pool
		query += ' AND rarity != \'STARTER\' AND item_type != \'VOUCHER\'';

		const possibleItems = db.prepare(query).all(...params);
		if (possibleItems.length === 0) {
			// Fallback if no items match (e.g., no epic spell scrolls exist yet)
			const fallbackItem = db.prepare('SELECT item_id, name FROM items WHERE name = \'Rat Pelt\'').get();
			return { type: 'item', value: fallbackItem.item_id, name: fallbackItem.name };
		}

		const chosenItem = possibleItems[Math.floor(Math.random() * possibleItems.length)];
		return { type: 'item', value: chosenItem.item_id, name: chosenItem.name };
	}

	return null;
}

/**
 * Gives the prize to the user and updates the database.
 * @param {string} userId The user who gets the prize.
 * @param {object} prize The prize object from rollVoucher.
 * @param {import('discord.js').Interaction} interaction The interaction source for XP notifications.
 */
async function givePrize(userId, prize, interaction) {
	if (prize.type === 'crowns') {
		db.prepare(`
            INSERT INTO user_economy (user_id, crowns) VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
        `).run(userId, prize.value, prize.value);
	}
	else if (prize.type === 'xp') {
		const reason = `unsealed an ${interaction.message.embeds[0].title}`;
		await addXp(userId, prize.value, interaction, reason);
	}
	else if (prize.type === 'item') {
		// This assumes items from vouchers are not stackable unless they already have a stack.
		// A more robust system would check the item's `is_stackable` property.
		db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)').run(userId, prize.value);
	}
}

module.exports = { rollVoucher, givePrize };