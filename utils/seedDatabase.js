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
	}
	catch (error) {
		console.error('[DB Seeding] Failed to seed database:', error);
	}
}

module.exports = { seedDatabase };