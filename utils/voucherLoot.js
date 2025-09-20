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
	// Fallback in case of floating point issues
	return items[items.length - 1].value;
}

// Static pools for unique items like lockboxes
const staticLootPools = {
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

// Dynamic pools based on voucher name parsing
const dynamicLootConfig = {
	// Defines the item rarities a voucher of a certain rarity can drop
	rarityTiers: {
		COMMON:    [{ weight: 75, value: 'COMMON' }, { weight: 25, value: 'UNCOMMON' }],
		UNCOMMON:  [{ weight: 70, value: 'UNCOMMON' }, { weight: 30, value: 'RARE' }],
		RARE:      [{ weight: 65, value: 'RARE' }, { weight: 35, value: 'EPIC' }],
		EPIC:      [{ weight: 70, value: 'EPIC' }, { weight: 30, value: 'LEGENDARY' }],
		LEGENDARY: [{ weight: 100, value: 'LEGENDARY' }],
	},
	// Defines the item types for different voucher categories
	typeMappings: {
		'Armor': 'ARMOR',
		'Weapon': 'WEAPON',
		'Equipment': ['ARMOR', 'WEAPON'],
		'Spell Scroll': 'SPELL_SCROLL',
	},
	// Defines the min/max for loot-only vouchers
	lootOnly: {
		'XP in a Bottle': { type: 'xp', COMMON: [25, 100], UNCOMMON: [100, 300], RARE: [300, 750] },
		'Sealed Chest of Crowns': { type: 'crowns', COMMON: [50, 250], UNCOMMON: [250, 1000], RARE: [1000, 5000] },
	},
};

/**
 * Rolls for a prize from a voucher or loot crate.
 * @param {string} itemName The name of the item being opened.
 * @returns {Promise<{type: string, value: any, name: string}|null>} The prize, or null if invalid.
 */
async function rollVoucher(itemName) {
	// 1. Check for static, unique loot pools first
	if (staticLootPools[itemName]) {
		const poolData = staticLootPools[itemName];
		const criteria = weightedRandom(poolData.pool);
		// We can reuse the item rolling logic
		return rollDynamicItem(criteria.rarity, null);
	}

	// 2. Try to parse the name for dynamic vouchers like "[Common] Armor Voucher"
	const dynamicMatch = itemName.match(/\[(.*?)\] (.*)/);
	if (dynamicMatch) {
		const rarity = dynamicMatch[1].toUpperCase();
		const namePart = dynamicMatch[2];

		// Check loot-only pools (XP, Crowns)
		if (dynamicLootConfig.lootOnly[namePart]) {
			const config = dynamicLootConfig.lootOnly[namePart];
			const [min, max] = config[rarity] || [0, 0];
			const amount = Math.floor(Math.random() * (max - min + 1)) + min;
			return { type: config.type, value: amount, name: `${amount} ${config.type.charAt(0).toUpperCase() + config.type.slice(1)}` };
		}

		// Check item vouchers
		const voucherTypeMatch = namePart.match(/(.*?) Voucher/);
		if (voucherTypeMatch) {
			const itemCategory = voucherTypeMatch[1];
			const itemType = dynamicLootConfig.typeMappings[itemCategory];
			const rolledRarity = weightedRandom(dynamicLootConfig.rarityTiers[rarity]);

			return rollDynamicItem(rolledRarity, itemType);
		}
	}

	// 3. Fallback if no pool is found
	console.warn(`[rollVoucher] No loot pool found for item: ${itemName}`);
	return null;
}

/**
 * Helper function to query the database for a random item based on criteria.
 * @param {string} rarity The target rarity (e.g., 'RARE').
 * @param {string|string[]} itemType The target item type(s) (e.g., 'ARMOR' or ['WEAPON', 'ARMOR']).
 * @returns {{type: 'item', value: number, name: string}|null}
 */
function rollDynamicItem(rarity, itemType) {
	let query = 'SELECT item_id, name FROM items WHERE rarity = ? AND rarity != \'STARTER\' AND item_type NOT IN (\'VOUCHER\', \'MATERIAL\')';
	const params = [rarity];

	if (itemType) {
		if (Array.isArray(itemType)) {
			query += ` AND item_type IN (${itemType.map(() => '?').join(',')})`;
			params.push(...itemType);
		}
		else {
			query += ' AND item_type = ?';
			params.push(itemType);
		}
	}

	const possibleItems = db.prepare(query).all(...params);

	if (possibleItems.length === 0) {
		console.warn(`[rollDynamicItem] No items found for rarity: ${rarity}, type: ${itemType}. This is a content issue.`);
		// A more graceful fallback
		const fallbackCrowns = { type: 'crowns', value: 100, name: '100 Crowns (Consolation Prize)' };
		return fallbackCrowns;
	}

	const chosenItem = possibleItems[Math.floor(Math.random() * possibleItems.length)];
	return { type: 'item', value: chosenItem.item_id, name: chosenItem.name };
}


/**
 * Gives the prize to the user and updates the database.
 * @param {string} userId The user who gets the prize.
 * @param {object} prize The prize object from rollVoucher.
 * @param {import('discord.js').Interaction} interaction The interaction source for XP notifications.
 */
async function givePrize(userId, prize, interaction) {
	if (!prize) return;

	if (prize.type === 'crowns') {
		db.prepare(`
            INSERT INTO user_economy (user_id, crowns) VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
        `).run(userId, prize.value, prize.value);
	}
	else if (prize.type === 'xp') {
		const reason = `unsealed an ${interaction.message.embeds[0].title.replace('Unsealing ', '').replace('...', '')}`;
		await addXp(userId, prize.value, interaction, reason);
	}
	else if (prize.type === 'item') {
		db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)').run(userId, prize.value);
	}
}

module.exports = { rollVoucher, givePrize, lootPools: staticLootPools };