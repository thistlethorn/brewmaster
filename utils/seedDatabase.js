// utils/seedDatabase.js
const db = require('../database');

const originsData = [
	{ name: 'City Guard', description: 'A watchful protector of the urban expanse.', bonus_stat_1: 'might', bonus_stat_2: 'grit', base_perk_name: 'Watchful Lookout', base_perk_description: 'You get pinged in a specific channel for "thief" events, allowing you to be there first.' },
	{ name: 'Tinker', description: 'An inventive mind with a knack for mechanics.', bonus_stat_1: 'wits', bonus_stat_2: 'finesse', base_perk_name: 'Scrap Savant', base_perk_description: 'You have a slightly higher chance (5%) to find mechanical parts or extra components as bonus loot.' },
	{ name: 'Farmer', description: 'A hardworking soul connected to the land.', bonus_stat_1: 'grit', bonus_stat_2: 'fortune', base_perk_name: 'Centre of the Village', base_perk_description: 'Your /econ daily bonus roll will always yield the average/half (rounded up) of its potential.' },
	{ name: 'Hedge Mage', description: 'A self-taught practitioner of arcane arts.', bonus_stat_1: 'wits', bonus_stat_2: 'fortune', base_perk_name: 'Arcane Dabbler', base_perk_description: 'You get a (+1) passive bonus when attempting to understand magically-encrypted text.' },
	{ name: 'Urchin', description: 'A survivor of the streets, quick and clever.', bonus_stat_1: 'finesse', bonus_stat_2: 'fortune', base_perk_name: 'Street Smarts', base_perk_description: 'You completely avoid personal Crown loss from guild raid events, except when the treasury is vulnerable.' },
	{ name: 'Noble Scion', description: 'Born to privilege, with a sharp mind and social grace.', bonus_stat_1: 'charm', bonus_stat_2: 'wits', base_perk_name: 'Strongly Backed', base_perk_description: 'Your contribution to a guild is worth more (+25%) due to your reputation boost.' },
	{ name: 'Hermit', description: 'A solitary figure who finds wisdom in isolation.', bonus_stat_1: 'grit', bonus_stat_2: 'wits', base_perk_name: 'Self-Sufficient', base_perk_description: 'You have a small chance (5%) to find a minor healing item alongside your /econ daily reward.' },
	{ name: 'Entertainer', description: 'A charismatic performer who thrives in the spotlight.', bonus_stat_1: 'charm', bonus_stat_2: 'finesse', base_perk_name: 'Spotlight Stealer', base_perk_description: 'When you win Member of the Week, you earn double the prize crowns.' },
	{ name: 'Street Magician', description: 'A performer of illusions with steady hands.', bonus_stat_1: 'finesse', bonus_stat_2: 'grit', base_perk_name: 'Slighthand', base_perk_description: 'You have a slightly better chance to succeed at /gamble coinflip (+3% chance).' },
	{ name: 'Acolyte', description: 'A devoted follower of a higher power or ideal.', bonus_stat_1: 'wits', bonus_stat_2: 'charm', base_perk_name: 'Sanctuary', base_perk_description: 'Your guild\'s shield lasts for a slightly longer duration (+1hr) when purchased.' },
	{ name: 'Hunter', description: 'A master of the wilds and a keen tracker.', bonus_stat_1: 'finesse', bonus_stat_2: 'grit', base_perk_name: 'Tracker\'s Eye', base_perk_description: 'You can see more detailed information in /guild info, such as optimal raid times for extra loot or success.' },
	{ name: 'Blacksmith', description: 'A skilled artisan of metal and forge.', bonus_stat_1: 'might', bonus_stat_2: 'wits', base_perk_name: 'Master Craftsman', base_perk_description: 'When your guild upgrades its Tier, the cost is slightly reduced (-5%) thanks to your expertise.' },
];

const archetypesData = [
	{ name: 'Channeler', description: 'A focused elementalist who attunes themselves to a single, primal force.', primary_stat_1: 'wits', primary_stat_2: 'grit' },
	{ name: 'Golemancer', description: 'A brilliant engineer who constructs and commands a single, powerful clockwork golem.', primary_stat_1: 'wits', primary_stat_2: 'might' },
	{ name: 'Justicar', description: 'A reactive vigilante and arbiter of honor.', primary_stat_1: 'grit', primary_stat_2: 'wits' },
	{ name: 'Slayer', description: 'The ultimate hunter, specializing in preparing for and executing attacks.', primary_stat_1: 'might', primary_stat_2: 'finesse' },
	{ name: 'Shifter', description: 'A living conduit for wild, untamable magic.', primary_stat_1: 'fortune', primary_stat_2: 'finesse' },
	{ name: 'Reaper', description: 'A dark, parasitic opportunist who profits from the misfortune of others.', primary_stat_1: 'wits', primary_stat_2: 'fortune' },
	{ name: 'Ascetic', description: 'A self-reliant martial artist who channels their inner energy ("Ki").', primary_stat_1: 'might', primary_stat_2: 'grit' },
	{ name: 'Saboteur', description: 'A proactive master of espionage and indirect warfare.', primary_stat_1: 'finesse', primary_stat_2: 'wits' },
	{ name: 'Scholar', description: 'A seeker of knowledge who unlocks new layers of information.', primary_stat_1: 'wits', primary_stat_2: 'fortune' },
	{ name: 'Artisan', description: 'A master crafter who gathers resources and produces tangible items.', primary_stat_1: 'wits', primary_stat_2: 'finesse' },
	{ name: 'Zealot', description: 'A charismatic and inspiring internal motivator.', primary_stat_1: 'charm', primary_stat_2: 'grit' },
	{ name: 'Warden', description: 'An active defensive bastion who protects their guild through heroic intervention.', primary_stat_1: 'grit', primary_stat_2: 'might' },
];

const pveItems = [
	// Materials
	{ name: 'Rat Pelt', description: 'A rough patch of fur from a giant rat.', item_type: 'MATERIAL', is_stackable: 1, crown_value: 2 },
	{ name: 'Rat Tail', description: 'A surprisingly tough and wiry rat tail.', item_type: 'MATERIAL', is_stackable: 1, crown_value: 1 },
	{ name: 'Goblin Ear', description: 'A grisly trophy taken from a goblin.', item_type: 'MATERIAL', is_stackable: 1, crown_value: 3 },
	{ name: 'Spider Silk', description: 'A bundle of strong, sticky spider silk.', item_type: 'MATERIAL', is_stackable: 1, crown_value: 5 },
	{ name: 'Venom Gland', description: 'A gland filled with a weak, but usable, poison.', item_type: 'MATERIAL', is_stackable: 1, crown_value: 8 },
	{ name: 'Bone Fragments', description: 'Shards of animated bone.', item_type: 'MATERIAL', is_stackable: 1, crown_value: 2 },
	// Weapons
	{ name: 'Crude Dagger', description: 'A poorly made goblin shiv.', item_type: 'WEAPON', rarity: 'COMMON', is_stackable: 0, crown_value: 10, effects_json: '{"slot": "weapon", "stats": {"crit_chance": 0.01}}' },
	{ name: 'Rusty Shortsword', description: 'A standard shortsword, degraded by time and undeath.', item_type: 'WEAPON', rarity: 'COMMON', is_stackable: 0, crown_value: 15, effects_json: '{"slot": "weapon", "stats": {"might": 1}}' },
];

const lootTables = [
	{ id: 1, name: 'Vermin Scraps', description: 'Bits and pieces from common pests.' },
	{ id: 2, name: 'Goblin Pouch', description: 'The meager contents of a goblin\'s satchel.' },
	{ id: 3, name: 'Spider Sac', description: 'Harvestable materials from a forest spider.' },
	{ id: 4, name: 'Bone Pile', description: 'The remains of a skeletal creature.' },
];

const lootTableEntries = [
	// Vermin Scraps (Table 1)
	{ loot_table_id: 1, item_name: 'Rat Pelt', drop_chance: 0.75, min_quantity: 1, max_quantity: 1 },
	{ loot_table_id: 1, item_name: 'Rat Tail', drop_chance: 0.50, min_quantity: 1, max_quantity: 1 },
	// Goblin Pouch (Table 2)
	{ loot_table_id: 2, item_name: 'Goblin Ear', drop_chance: 0.90, min_quantity: 1, max_quantity: 2 },
	{ loot_table_id: 2, item_name: 'Crude Dagger', drop_chance: 0.15, min_quantity: 1, max_quantity: 1 },
	// Spider Sac (Table 3)
	{ loot_table_id: 3, item_name: 'Spider Silk', drop_chance: 0.60, min_quantity: 1, max_quantity: 3 },
	{ loot_table_id: 3, item_name: 'Venom Gland', drop_chance: 0.25, min_quantity: 1, max_quantity: 1 },
	// Bone Pile (Table 4)
	{ loot_table_id: 4, item_name: 'Bone Fragments', drop_chance: 0.80, min_quantity: 2, max_quantity: 5 },
	{ loot_table_id: 4, item_name: 'Rusty Shortsword', drop_chance: 0.10, min_quantity: 1, max_quantity: 1 },
];

const monsters = [
	{ name: 'Giant Rat', monster_race: 'Beast', level: 1, max_health: 8, armor_class: 10, base_damage: 2, xp_reward: 5, loot_table_id: 1 },
	{ name: 'Goblin Grunt', monster_race: 'Goblinoid', level: 1, max_health: 12, armor_class: 12, base_damage: 3, xp_reward: 10, loot_table_id: 2 },
	{ name: 'Forest Spider', monster_race: 'Beast', level: 2, max_health: 15, armor_class: 13, base_damage: 4, xp_reward: 15, loot_table_id: 3 },
	{ name: 'Skeleton Warrior', monster_race: 'Undead', level: 2, max_health: 18, armor_class: 14, base_damage: 5, xp_reward: 20, loot_table_id: 4 },
];

const pveNodes = [
	{ name: 'Tavern Cellar', description: 'Rats have infested the tavern\'s cellar!', required_level: 1, monster_composition_json: '[{"name": "Giant Rat", "count": 2}]', first_completion_reward_json: '{"xp": 20, "crowns": 50}', repeatable_reward_json: '{"xp": 5, "crowns": 10}' },
	{ name: 'Whispering Woods Outskirts', description: 'Goblins and other creatures lurk at the edge of the forest.', required_level: 1, monster_composition_json: '[{"name": "Goblin Grunt", "count": 2}, {"name": "Forest Spider", "count": 1}]', first_completion_reward_json: '{"xp": 50, "crowns": 100}', repeatable_reward_json: '{"xp": 15, "crowns": 25}' },
	{ name: 'Forgotten Crypt Entrance', description: 'The restless dead guard the entrance to an ancient tomb.', required_level: 2, monster_composition_json: '[{"name": "Skeleton Warrior", "count": 3}]', first_completion_reward_json: '{"xp": 80, "crowns": 150}', repeatable_reward_json: '{"xp": 25, "crowns": 40}' },
];

function seedPveData() {
	db.transaction(() => {
		// Items first, as other tables reference them
		try {
			const itemCheck = db.prepare('SELECT COUNT(*) FROM items').get()['COUNT(*)'];
			if (itemCheck === 0) {
				console.log('[DB Seeding] Items table is empty. Seeding PvE items...');
				const stmt = db.prepare(
					'INSERT INTO items (name, description, item_type, rarity, is_stackable, crown_value, effects_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
				);
				pveItems.forEach(item =>
					stmt.run(
						item.name,
						item.description,
						item.item_type,
						item.rarity || 'COMMON',
						item.is_stackable,
						item.crown_value,
						item.effects_json || null,
					),
				);
				console.log(`[DB Seeding] Seeded ${pveItems.length} items.`);
			}
		}
		catch (error) {
			console.error('[DB Seeding] Failed to seed items:', error);
			throw error;
		}

		// Map item names to their new IDs for the next step
		const itemIds = new Map(
			db
				.prepare('SELECT item_id, name FROM items')
				.all()
				.map(i => [i.name, i.item_id]),
		);

		// Loot Tables
		try {
			const ltCheck = db.prepare('SELECT COUNT(*) FROM loot_tables').get()['COUNT(*)'];
			if (ltCheck === 0) {
				console.log('[DB Seeding] Loot Tables are empty. Seeding...');
				const stmt = db.prepare(
					'INSERT INTO loot_tables (loot_table_id, name, description) VALUES (?, ?, ?)',
				);
				lootTables.forEach(table =>
					stmt.run(table.id, table.name, table.description),
				);
				console.log(`[DB Seeding] Seeded ${lootTables.length} loot tables.`);
			}
		}
		catch (error) {
			console.error('[DB Seeding] Failed to seed loot tables:', error);
			throw error;
		}

		// Loot Table Entries
		try {
			const lteCheck = db.prepare('SELECT COUNT(*) FROM loot_table_entries').get()['COUNT(*)'];
			if (lteCheck === 0) {
				console.log('[DB Seeding] Loot Table Entries are empty. Seeding...');
				const stmt = db.prepare(
					'INSERT INTO loot_table_entries (loot_table_id, item_id, drop_chance, min_quantity, max_quantity) VALUES (?, ?, ?, ?, ?)',
				);
				lootTableEntries.forEach(entry => {
					const itemId = itemIds.get(entry.item_name);
					if (!itemId) {
						console.error(`[DB Seeding] Item not found: ${entry.item_name}`);
						throw new Error(`Missing item: ${entry.item_name}`);
					}
					stmt.run(
						entry.loot_table_id,
						itemId,
						entry.drop_chance,
						entry.min_quantity,
						entry.max_quantity,
					);
				});
				console.log(`[DB Seeding] Seeded ${lootTableEntries.length} loot table entries.`);
			}
		}
		catch (error) {
			console.error('[DB Seeding] Failed to seed loot table entries:', error);
			throw error;
		}
		 // Monsters
		try {
			const monsterCheck = db.prepare('SELECT COUNT(*) FROM monsters').get()['COUNT(*)'];
			if (monsterCheck === 0) {
				console.log('[DB Seeding] Monsters table is empty. Seeding...');
				const stmt = db.prepare(
					'INSERT INTO monsters (name, monster_race, level, max_health, armor_class, base_damage, xp_reward, loot_table_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
				);
				monsters.forEach(m =>
					stmt.run(
						m.name,
						m.monster_race,
						m.level,
						m.max_health,
						m.armor_class,
						m.base_damage,
						m.xp_reward,
						m.loot_table_id,
					),
				);
				console.log(`[DB Seeding] Seeded ${monsters.length} monsters.`);
			}
		}
		catch (error) {
			console.error('[DB Seeding] Failed to seed monsters:', error);
			throw error;
		}

		// PvE Nodes
		try {
			const nodeCheck = db.prepare('SELECT COUNT(*) FROM pve_nodes').get()['COUNT(*)'];
			if (nodeCheck === 0) {
				console.log('[DB Seeding] PvE Nodes table is empty. Seeding...');
				const stmt = db.prepare(
					'INSERT INTO pve_nodes (name, description, required_level, first_completion_reward_json, repeatable_reward_json) VALUES (?, ?, ?, ?, ?)',
				);
				pveNodes.forEach(n =>
					stmt.run(
						n.name,
						n.description,
						n.required_level,
						n.first_completion_reward_json,
						n.repeatable_reward_json,
					),
				);
				console.log(`[DB Seeding] Seeded ${pveNodes.length} PvE nodes.`);
			}
		}
		catch (error) {
			console.error('[DB Seeding] Failed to seed PvE nodes:', error);
			throw error;
		}

		// pve_node_monsters junction table
		try {
			const pnmCheck = db.prepare('SELECT COUNT(*) FROM pve_node_monsters').get()['COUNT(*)'];
			if (pnmCheck === 0) {
				console.log('[DB Seeding] pve_node_monsters table is empty. Seeding...');

				const monsterIdMap = new Map(
					db.prepare('SELECT monster_id, name FROM monsters')
					  .all()
					  .map(m => [m.name, m.monster_id]),
				);
				const nodeIdMap = new Map(
					db.prepare('SELECT node_id, name FROM pve_nodes')
					  .all()
					  .map(n => [n.name, n.node_id]),
				);

				const stmt = db.prepare(
					'INSERT INTO pve_node_monsters (node_id, monster_id, count) VALUES (?, ?, ?)',
				);

				let seededCount = 0;
				pveNodes.forEach(nodeSeed => {
					const nodeId = nodeIdMap.get(nodeSeed.name);
					if (!nodeId) {
						console.error(`[DB Seeding] Node not found: ${nodeSeed.name}`);
						throw new Error(`Missing node: ${nodeSeed.name}`);
					}

					const monsterComp = JSON.parse(nodeSeed.monster_composition_json);
					monsterComp.forEach(comp => {
						const monsterId = monsterIdMap.get(comp.name);
						if (!monsterId) {
							console.error(`[DB Seeding] Monster not found: ${comp.name} for node ${nodeSeed.name}`);
							throw new Error(`Missing monster: ${comp.name} in node ${nodeSeed.name}`);
						}
						stmt.run(nodeId, monsterId, comp.count);
						seededCount++;
					});
				});
				console.log(
					`[DB Seeding] Seeded ${seededCount} monster compositions into pve_node_monsters.`,
				);
			}
		}
		catch (error) {
			console.error('[DB Seeding] Failed to seed pve_node_monsters:', error);
			throw error;
		}
	})();
}


function seedDatabase() {
	// Seed Origins
	const seedOrigins = db.transaction(() => {
		const count = db.prepare('SELECT COUNT(*) FROM origins').get()['COUNT(*)'];
		if (count === 0) {
			console.log('[DB Seeding] Origins table is empty. Seeding initial data...');
			const stmt = db.prepare(`
                INSERT INTO origins (name, description, bonus_stat_1, bonus_stat_2, base_perk_name, base_perk_description)
                VALUES (@name, @description, @bonus_stat_1, @bonus_stat_2, @base_perk_name, @base_perk_description)
            `);
			for (const origin of originsData) {
				stmt.run(origin);
			}
			console.log(`[DB Seeding] Successfully seeded ${originsData.length} origins.`);
		}
	});

	// Seed Archetypes
	const seedArchetypes = db.transaction(() => {
		const count = db.prepare('SELECT COUNT(*) FROM archetypes').get()['COUNT(*)'];
		if (count === 0) {
			console.log('[DB Seeding] Archetypes table is empty. Seeding initial data...');
			const stmt = db.prepare(`
                INSERT INTO archetypes (name, description, primary_stat_1, primary_stat_2)
                VALUES (@name, @description, @primary_stat_1, @primary_stat_2)
            `);
			for (const archetype of archetypesData) {
				stmt.run(archetype);
			}
			console.log(`[DB Seeding] Successfully seeded ${archetypesData.length} archetypes.`);
		}
	});

	try {
		seedOrigins();
		seedArchetypes();
		seedPveData();
		return true;
	}
	catch (error) {
		console.error('[DB Seeding] Failed to seed database:', error);
		throw new Error('Database seeding failed!');
	}
}

module.exports = { seedDatabase };