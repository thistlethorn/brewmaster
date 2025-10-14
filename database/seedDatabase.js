// utils/seedDatabase.js
const db = require('@database/database.js');

const speciesData = [
	{ name: 'Humanfolk', description: 'Known for their adaptability and ambition, Humanfolk are the most common sight in the Tavern.', stat_bonus_json: '{"fortune": 2}', base_perk_name: 'Versatility', base_perk_description: 'Gain one extra unspent stat point every 5 levels.' },
	{ name: 'Primordialfolk', description: 'Beings infused with the raw power of the elements.', stat_bonus_json: null, base_perk_name: 'Elemental Affinity', base_perk_description: 'Your elemental spells and attacks deal slightly increased damage.' },
	{ name: 'Beastfolk', description: 'A diverse group of humanoids with distinct animalistic features and instincts.', stat_bonus_json: '{"finesse": 1}', base_perk_name: 'Primal Instincts', base_perk_description: 'You have a higher chance to act first in combat.' },
	{ name: 'Faefolk', description: 'Mysterious and often whimsical beings with a deep connection to nature and magic.', stat_bonus_json: '{"charm": 2}', base_perk_name: 'Fey Ancestry', base_perk_description: 'You have advantage on resisting magical charm effects.' },
	{ name: 'Dragonfolk', description: 'Proud and powerful humanoids who carry the blood of dragons, granting them immense resilience.', stat_bonus_json: '{"grit": 1, "might": 1}', base_perk_name: 'Draconic Resilience', base_perk_description: 'You take reduced damage from elemental attacks.' },
	{ name: 'Weirdfolk', description: 'Unconventional beings that defy easy categorization, from mechanical constructs to sentient slimes.', stat_bonus_json: null, base_perk_name: 'Uncanny Nature', base_perk_description: 'You are immune to poison and disease.' },
	{ name: 'Nightfolk', description: 'Creatures of shadow and twilight, often misunderstood and possessing unique, dark gifts.', stat_bonus_json: null, base_perk_name: 'Nocturnal', base_perk_description: 'You gain a bonus to evasion and critical chance in dark environments.' },
];

const subspeciesData = [
	// Primordialfolk
	{ species_name: 'Primordialfolk', name: 'Ignan (Fire-Elemental)', description: 'Passionate and volatile, with an affinity for all things flame.', stat_bonus_json: '{"might": 2}' },
	{ species_name: 'Primordialfolk', name: 'Auran (Air-Elemental)', description: 'Quick-witted and free-spirited, as unpredictable as the wind.', stat_bonus_json: '{"finesse": 2}' },
	{ species_name: 'Primordialfolk', name: 'Aquan (Water-Elemental)', description: 'Calm and adaptable, possessing the patience of the deep oceans.', stat_bonus_json: '{"wits": 2}' },
	{ species_name: 'Primordialfolk', name: 'Sylvan (Wood-Elemental)', description: 'Patient and resilient, with a deep connection to the forest.', stat_bonus_json: '{"fortune": 2}' },
	{ species_name: 'Primordialfolk', name: 'Ferran (Iron-Elemental)', description: 'Unyielding and resolute, with a body as tough as metal.', stat_bonus_json: '{"grit": 2}' },
	// Beastfolk
	{ species_name: 'Beastfolk', name: 'Vulpine (Fox Hybrid)', description: 'Cunning and agile, known for their sharp minds and reflexes.', stat_bonus_json: '{"wits": 1}' },
	{ species_name: 'Beastfolk', name: 'Feline (Cat Hybrid)', description: 'Graceful and independent, with keen senses and natural agility.', stat_bonus_json: '{"finesse": 1}' },
	{ species_name: 'Beastfolk', name: 'Chelonian (Turtle Hybrid)', description: 'Stoic and defensive, protected by natural resilience and patience.', stat_bonus_json: '{"grit": 1}' },
	{ species_name: 'Beastfolk', name: 'Canine (Dog Hybrid)', description: 'Loyal and tenacious, excelling in teamwork and tracking.', stat_bonus_json: '{"charm": 1}' },
	{ species_name: 'Beastfolk', name: 'Lapine (Rabbit Hybrid)', description: 'Quick and perceptive, with an uncanny knack for avoiding danger.', stat_bonus_json: '{"fortune": 1}' },
	// Weirdfolk
	{ species_name: 'Weirdfolk', name: 'Oozeling', description: 'A sentient, amorphous humanoid slime, capable of squeezing into tight spaces.', stat_bonus_json: '{"grit": 2}' },
	{ species_name: 'Weirdfolk', name: 'Gearforged', description: 'A steampunk-inspired mechanical being, built for a purpose.', stat_bonus_json: '{"might": 2}' },
	{ species_name: 'Weirdfolk', name: 'Myconid', description: 'A humanoid fungus, capable of communicating with other fungi.', stat_bonus_json: '{"wits": 2}' },
	// Nightfolk
	{ species_name: 'Nightfolk', name: 'Umbra', description: 'A being of pure shadow, hard to see and harder to hit.', stat_bonus_json: '{"finesse": 2}' },
	{ species_name: 'Nightfolk', name: 'Bloodwraith', description: 'A vampire-esque being that draws strength from the life force of others.', stat_bonus_json: '{"might": 2}' },
];

const spellsData = [
	// --- LVL 1 (COMMON) ---
	{ name: 'Arcane Bolt', description: 'A simple bolt of raw magical energy.', required_level: 1, spell_school: 'EVOCATION', required_wits: 10, mana_cost: 5, effects_json: '{"damage": "1d8", "damage_type": "Arcane", "target": "single"}' },
	{ name: 'Minor Heal', description: 'A faint glow that mends minor wounds.', required_level: 1, spell_school: 'RESTORATION', required_wits: 12, mana_cost: 8, effects_json: '{"heal": "1d6", "target": "self"}' },
	{ name: 'Light', description: 'Creates a harmless, floating orb of light. (No combat effect)', required_level: 1, spell_school: 'UTILITY', required_wits: 10, mana_cost: 2, effects_json: '{"utility": "light", "target": "self"}' },

	// --- LVL 3 (UNCOMMON) ---
	{ name: 'Fireblast', description: 'Hurl a ball of fire at a single target.', required_level: 3, spell_school: 'EVOCATION', required_wits: 14, mana_cost: 12, effects_json: '{"damage": "2d6", "damage_type": "Fire", "target": "single"}' },
	{ name: 'Ice Shard', description: 'Launch a piercing shard of magical ice.', required_level: 3, spell_school: 'EVOCATION', required_wits: 14, mana_cost: 12, effects_json: '{"damage": "1d10", "damage_type": "Ice", "target": "single"}' },
	{ name: 'Shield of Faith', description: 'Bolster your defenses with divine energy.', required_level: 3, spell_school: 'ABJURATION', required_wits: 13, mana_cost: 10, effects_json: '{"buff": {"stat": "armor_class", "value": 2, "duration_seconds": 180}, "target": "self"}' },

	// --- LVL 5 (RARE) ---
	{ name: 'Heal', description: 'A significant pulse of healing energy.', required_level: 5, spell_school: 'RESTORATION', required_wits: 16, mana_cost: 20, effects_json: '{"heal": "3d6+3", "target": "self"}' },
	{ name: 'Mage Armor', description: 'Surround yourself with a shimmering field of protective magic.', required_level: 5, spell_school: 'ABJURATION', required_wits: 16, mana_cost: 15, effects_json: '{"buff": {"stat": "armor_class", "value": 3, "duration_seconds": 180}, "target": "self"}' },
	{ name: 'Enfeeble', description: 'Weaken a target, reducing their damage output.', required_level: 5, spell_school: 'NECROMANCY', required_wits: 17, mana_cost: 18, effects_json: '{"debuff": {"stat": "damage", "multiplier": 0.75, "duration_turns": 3}, "target": "single"}' },

	// --- LVL 10 (EPIC) ---
	{ name: 'Chain Lightning', description: 'Unleash a bolt of lightning that arcs to nearby foes.', required_level: 10, spell_school: 'EVOCATION', required_wits: 22, mana_cost: 40, effects_json: '{"damage": "4d8", "damage_type": "Lightning", "target": "multi", "hits": 3}' },
	{ name: 'Stoneskin', description: 'Harden your skin to be as tough as stone, absorbing a significant amount of damage.', required_level: 10, spell_school: 'ABJURATION', required_wits: 20, mana_cost: 35, effects_json: '{"buff": {"stat": "damage_reduction", "value": 10, "duration_turns": 4}, "target": "self"}' },

	// --- LVL 15 (LEGENDARY) ---
	{ name: 'Meteor Swarm', description: 'Call down a devastating shower of fiery meteors upon your enemies.', required_level: 15, spell_school: 'EVOCATION', required_wits: 30, mana_cost: 75, effects_json: '{"damage": "8d10", "damage_type": "Fire", "target": "all"}' },
	{ name: 'Restoration', description: 'Fully restore your health and remove all negative effects.', required_level: 15, spell_school: 'RESTORATION', required_wits: 28, mana_cost: 60, effects_json: '{"heal": "full", "cleanse": "all", "target": "self"}' },
];

const originsData = [
	{ name: 'City Guard', description: 'A watchful protector of the urban expanse.', bonus_stat_1: 'might', bonus_stat_2: 'grit', base_perk_name: 'Watchful Lookout', base_perk_description: 'You get pinged in a specific channel for "thief" events, allowing you to be there first.' },
	{ name: 'Tinker', description: 'An inventive mind with a knack for mechanics.', bonus_stat_1: 'wits', bonus_stat_2: 'finesse', base_perk_name: 'Scrap Savant', base_perk_description: 'You have a slightly higher chance (5%) to find mechanical parts or extra components as bonus loot.' },
	{ name: 'Farmer', description: 'A hardworking soul connected to the land.', bonus_stat_1: 'grit', bonus_stat_2: 'fortune', base_perk_name: 'Centre of the Village', base_perk_description: 'Your /econ daily bonus roll will always yield the average/half (rounded up) of its potential.' },
	{ name: 'Hedge Mage', description: 'A self-taught practitioner of arcane arts.', bonus_stat_1: 'wits', bonus_stat_2: 'fortune', base_perk_name: 'Arcane Dabbler', base_perk_description: 'You get a (+1) passive bonus when attempting to understand magically-encrypted text.' },
	{ name: 'Urchin', description: 'A survivor of the streets, quick and clever.', bonus_stat_1: 'finesse', bonus_stat_2: 'fortune', base_perk_name: 'Street Smarts', base_perk_description: 'You completely avoid personal Crown loss from guild raid events, except when the treasury is vulnerable.' },
	{ name: 'Noble Scion', description: 'Born to privilege, with a sharp mind and social grace.', bonus_stat_1: 'charm', bonus_stat_2: 'wits', base_perk_name: 'Strongly Backed', base_perk_description: 'Your contribution to a guild is worth more (+25%) due to your reputation boost.' },
	{ name: 'Hermit', description: 'A solitary figure who finds wisdom in isolation.', bonus_stat_1: 'grit', bonus_stat_2: 'wits', base_perk_name: 'Self-Sufficient', base_perk_description: 'You have a small chance (5%) to find a minor healing item alongside your /econ daily reward.' },
	{ name: 'Entertainer', description: 'A charismatic performer who thrives in the spotlight.', bonus_stat_1: 'charm', bonus_stat_2: 'finesse', base_perk_name: 'Spotlight Stealer', base_perk_description: 'When you win Monarch of the Month, you earn double the prize crowns.' },
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
const vendorsData = [
	{ name: 'Rowan the Blacksmith', description: 'A sturdy blacksmith with a keen eye for quality arms and armor.', charm_requirement: 10 },
	{ name: 'Sable the Hunter', description: 'A rugged hunter who values trophies from dangerous beasts above all else.', charm_requirement: 12 },
	{ name: 'Pip the Alchemist', description: 'An eccentric but brilliant alchemist, always bubbling with new ideas.', charm_requirement: 15 },
	{ name: 'Greg the Oddball', description: 'The familiar, weary dealer also runs a side business in strange and wonderful trinkets.', charm_requirement: 20 },
	{ name: 'Sister Elara', description: 'A serene acolyte offering restorative services for a donation.', charm_requirement: 5 },
	{ name: 'Curio the Collector', description: 'A peculiar merchant who deals in sealed containers and vouchers of all kinds.', charm_requirement: 18 },
	{ name: 'Magus Magnus', description: 'A master of the arcane who sells spell scrolls and magical implements for a premium.', charm_requirement: 15 },
];

const vendorStockData = [
	// Rowan (Blacksmith) - Buys smithing materials and common gear
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Rat Pelt', sell_price: 1 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Bone Fragments', sell_price: 1 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Wolf Fang', sell_price: 5 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Orc Tusk', sell_price: 7 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Large Bone', sell_price: 9 },

	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Crude Iron Helm', sell_price: 20 },

	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Crude Dagger', sell_price: 5, buy_price: 20 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Rusty Shortsword', sell_price: 7, buy_price: 30 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Steel Shortsword', buy_price: 600 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Reinforced Iron Shield', buy_price: 550 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Full Iron Helm', buy_price: 500 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Dwarven Waraxe', buy_price: 4000 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Knight\'s Platebody', buy_price: 5000 },
	{ vendor_name: 'Rowan the Blacksmith', item_name: 'Blade of the Justicar', buy_price: 25000 },

	// Greg (Oddball)
	{ vendor_name: 'Greg the Oddball', item_name: 'Rusted Lockbox', buy_price: 150 },
	{ vendor_name: 'Greg the Oddball', item_name: 'Rusted Key', buy_price: 200 },
	{ vendor_name: 'Greg the Oddball', item_name: 'Gilded Chest', buy_price: 1200 },
	{ vendor_name: 'Greg the Oddball', item_name: 'Gilded Key', buy_price: 1800 },
	{ vendor_name: 'Greg the Oddball', item_name: 'Aegis of the Unbroken', buy_price: 750000 },
	{ vendor_name: 'Greg the Oddball', item_name: 'Whisperwind, the Soulrazor', buy_price: 750000 },
	{ vendor_name: 'Greg the Oddball', item_name: 'Crown of the Mad King', buy_price: 666666 },

	// Pip (Alchemist) - Buys alchemy materials
	{ vendor_name: 'Pip the Alchemist', item_name: 'Rat Tail', sell_price: 1 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Spider Silk', sell_price: 2 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Venom Gland', sell_price: 4 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Hag\'s Eye', sell_price: 12 },

	{ vendor_name: 'Pip the Alchemist', item_name: 'Minor Healing Potion', buy_price: 75 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Healing Potion', buy_price: 625 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Greater Healing Potion', buy_price: 5000 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Elixir of Might', buy_price: 1500 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Superior Healing Potion', buy_price: 10000 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Supreme Healing Potion', buy_price: 20000 },
	{ vendor_name: 'Pip the Alchemist', item_name: 'Ultimate Healing Potion', buy_price: 625000 },

	// Sable (Hunter) - Buys trophies
	{ vendor_name: 'Sable the Hunter', item_name: 'Goblin Ear', sell_price: 2 },
	{ vendor_name: 'Sable the Hunter', item_name: 'Thick Pelt', sell_price: 7 },
	{ vendor_name: 'Sable the Hunter', item_name: 'Beast-Hide Jerkin', buy_price: 750 },
	{ vendor_name: 'Sable the Hunter', item_name: 'Stalker\'s Shortbow', buy_price: 800 },
	{ vendor_name: 'Sable the Hunter', item_name: 'Cloak of the Shifting Sands', buy_price: 4200 },

	 // --- Curio the Collector's Stock ---
	{ vendor_name: 'Curio the Collector', item_name: '[Common] Armor Voucher', buy_price: 300 },
	{ vendor_name: 'Curio the Collector', item_name: '[Uncommon] Weapon Voucher', buy_price: 800 },
	{ vendor_name: 'Curio the Collector', item_name: '[Rare] Equipment Voucher', buy_price: 5000 },
	{ vendor_name: 'Curio the Collector', item_name: '[Epic] Spell Scroll Voucher', buy_price: 20000 },
	// Curio also buys materials, but at a worse rate than specialists
	{ vendor_name: 'Curio the Collector', item_name: 'Rat Pelt', sell_price: 1 },
	{ vendor_name: 'Curio the Collector', item_name: 'Goblin Ear', sell_price: 1 },
	{ vendor_name: 'Curio the Collector', item_name: 'Spider Silk', sell_price: 2 },

	// --- Magus Magnus's Stock ---
	{ vendor_name: 'Magus Magnus', item_name: 'Scroll of Minor Heal', buy_price: 750 },
	{ vendor_name: 'Magus Magnus', item_name: 'Scroll of Fireblast', buy_price: 1800 },
	{ vendor_name: 'Magus Magnus', item_name: 'Scroll of Ice Shard', buy_price: 1800 },
	{ vendor_name: 'Magus Magnus', item_name: 'Scroll of Mage Armor', buy_price: 4000 },
	{ vendor_name: 'Magus Magnus', item_name: 'Scroll of Light', buy_price: 300 },
	{ vendor_name: 'Magus Magnus', item_name: 'Scroll of Shield of Faith', buy_price: 1500 },
	{ vendor_name: 'Magus Magnus', item_name: 'Scroll of Enfeeble', buy_price: 4000 },
	{ vendor_name: 'Magus Magnus', item_name: 'Scroll of Chain Lightning', buy_price: 18000 },
	// Add some magic gear for him to sell
	{ vendor_name: 'Magus Magnus', item_name: 'Channeler\'s Focus', buy_price: 100 },
	{ vendor_name: 'Magus Magnus', item_name: 'Acolyte\'s Robes', buy_price: 80 },
];


/*

COMMON (50-200 Crowns): Basic, functional gear. Often found as drops.

UNCOMMON (250-1,000 Crowns): A solid upgrade for a new adventurer. Minor stat bonuses (+1). Low requirements (e.g., stat >= 8).

RARE (1,500-5,000 Crowns): High-quality, specialized equipment. Noticeable stat bonuses (+2 or +3) and sometimes a unique effect. Requires some character investment (e.g., stat >= 14).

EPIC (7,500-20,000 Crowns): Powerful, defining items for a build. Multiple stat bonuses or significant unique effects. Requires dedication to a stat (e.g., stat >= 20). This is where we can introduce archetype or alignment locks.

LEGENDARY (50,000-150,000 Crowns): Artifact-level gear with powerful, build-altering effects. Sold exclusively by Greg. Very high requirements (e.g., stat >= 28).

MYTHIC (250,000+ Crowns): The "Pantheon" items. Unique, server-defining artifacts. Extremely expensive with the highest requirements (stat >= 35).

*/

const pveItems = [
	// Materials
	{ name: 'Rat Pelt', description: 'A rough patch of fur from a giant rat.', item_type: 'MATERIAL', item_subtype: 'SMITHING', is_stackable: 1, is_tradeable: 1, crown_value: 2 },
	{ name: 'Rat Tail', description: 'A surprisingly tough and wiry rat tail.', item_type: 'MATERIAL', item_subtype: 'ALCHEMY', is_stackable: 1, is_tradeable: 1, crown_value: 1 },
	{ name: 'Goblin Ear', description: 'A grisly trophy taken from a goblin.', item_type: 'MATERIAL', item_subtype: 'TROPHY', is_stackable: 1, is_tradeable: 1, crown_value: 3 },
	{ name: 'Spider Silk', description: 'A bundle of strong, sticky spider silk.', item_type: 'MATERIAL', item_subtype: 'ALCHEMY', is_stackable: 1, is_tradeable: 1, crown_value: 5 },
	{ name: 'Venom Gland', description: 'A gland filled with a weak, but usable, poison.', item_type: 'MATERIAL', item_subtype: 'ALCHEMY', is_stackable: 1, is_tradeable: 1, crown_value: 8 },
	{ name: 'Bone Fragments', description: 'Shards of animated bone.', item_type: 'MATERIAL', item_subtype: 'SMITHING', is_stackable: 1, is_tradeable: 1, crown_value: 2 },
	{ name: 'Stolen Locket', description: 'A small, tarnished silver locket. It\'s empty inside.', item_type: 'MATERIAL', item_subtype: 'MISC', is_stackable: 1, is_tradeable: 1, crown_value: 12 },
	{ name: 'Wolf Fang', description: 'A sharp, curved fang from a large wolf.', item_type: 'MATERIAL', item_subtype: 'SMITHING', is_stackable: 1, is_tradeable: 1, crown_value: 10 },
	{ name: 'Thick Pelt', description: 'A durable and warm pelt from a large beast.', item_type: 'MATERIAL', item_subtype: 'TROPHY', is_stackable: 1, is_tradeable: 1, crown_value: 14 },
	{ name: 'Orc Tusk', description: 'A rugged, yellowed tusk from an orc.', item_type: 'MATERIAL', item_subtype: 'SMITHING', is_stackable: 1, is_tradeable: 1, crown_value: 15 },
	{ name: 'Large Bone', description: 'A massive, heavy bone, likely from something huge.', item_type: 'MATERIAL', item_subtype: 'SMITHING', is_stackable: 1, is_tradeable: 1, crown_value: 18 },
	{ name: 'Hag\'s Eye', description: 'A glassy, unsettling eyeball from a swamp hag.', item_type: 'MATERIAL', item_subtype: 'ALCHEMY', is_stackable: 1, is_tradeable: 1, crown_value: 25 },
	// Weapons
	{ name: 'Crude Dagger', description: 'A poorly made goblin shiv.', item_type: 'WEAPON', rarity: 'COMMON', is_stackable: 0, is_tradeable: 1, crown_value: 10, damage_dice: '1d4', damage_type: 'Piercing', handedness: 'one-handed', effects_json: '{"slot": "weapon", "stats": {"crit_chance": 0.01}}' },
	{ name: 'Rusty Shortsword', description: 'A standard shortsword, degraded by time and undeath.', item_type: 'WEAPON', rarity: 'COMMON', is_stackable: 0, is_tradeable: 1, crown_value: 15, damage_dice: '1d6', damage_type: 'Slashing', handedness: 'one-handed', effects_json: '{"slot": "weapon"}' },
	{ name: 'Ogre\'s Club', description: 'A crudely fashioned but brutally effective large club.', item_type: 'WEAPON', rarity: 'UNCOMMON', is_stackable: 0, is_tradeable: 1, crown_value: 80, damage_dice: '1d10', damage_type: 'Bludgeoning', handedness: 'two-handed', effects_json: '{"slot": "weapon", "base_stats": {"might": 1}}' },
	// Armor
	{ name: 'Crude Iron Helm', description: 'A dented and poorly fitting helmet of orcish make.', item_type: 'ARMOR', rarity: 'COMMON', is_stackable: 0, is_tradeable: 1, crown_value: 40, effects_json: '{"slot": "helmet", "ac_bonus": 1}' },

	// --- COMPLETE VOUCHER SET ---
	// ARMOR
	{ name: '[Common] Armor Voucher', description: 'Redeem for a random piece of Common or Uncommon armor.', item_type: 'VOUCHER', rarity: 'COMMON', is_stackable: 1, is_tradeable: 1, crown_value: 300 },
	{ name: '[Uncommon] Armor Voucher', description: 'Redeem for a random piece of Uncommon or Rare armor.', item_type: 'VOUCHER', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 1, crown_value: 800 },
	{ name: '[Rare] Armor Voucher', description: 'Redeem for a random piece of Rare or Epic armor.', item_type: 'VOUCHER', rarity: 'RARE', is_stackable: 1, is_tradeable: 1, crown_value: 4000 },
	{ name: '[Epic] Armor Voucher', description: 'Redeem for a random piece of Epic or Legendary armor.', item_type: 'VOUCHER', rarity: 'EPIC', is_stackable: 1, is_tradeable: 1, crown_value: 15000 },

	// WEAPON
	{ name: '[Common] Weapon Voucher', description: 'Redeem for a random Common or Uncommon weapon.', item_type: 'VOUCHER', rarity: 'COMMON', is_stackable: 1, is_tradeable: 1, crown_value: 300 },
	{ name: '[Uncommon] Weapon Voucher', description: 'Redeem for a random Uncommon or Rare weapon.', item_type: 'VOUCHER', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 1, crown_value: 800 },
	{ name: '[Rare] Weapon Voucher', description: 'Redeem for a random Rare or Epic weapon.', item_type: 'VOUCHER', rarity: 'RARE', is_stackable: 1, is_tradeable: 1, crown_value: 4000 },
	{ name: '[Epic] Weapon Voucher', description: 'Redeem for a random Epic or Legendary weapon.', item_type: 'VOUCHER', rarity: 'EPIC', is_stackable: 1, is_tradeable: 1, crown_value: 15000 },

	// SPELL SCROLLS
	{ name: '[Common] Spell Scroll Voucher', description: 'A voucher for a random, simple spell scroll.', item_type: 'VOUCHER', rarity: 'COMMON', is_stackable: 1, is_tradeable: 1, crown_value: 500 },
	{ name: '[Uncommon] Spell Scroll Voucher', description: 'A voucher for a random spell scroll of moderate power.', item_type: 'VOUCHER', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 1, crown_value: 1500 },
	{ name: '[Rare] Spell Scroll Voucher', description: 'A voucher for a random, powerful spell scroll.', item_type: 'VOUCHER', rarity: 'RARE', is_stackable: 1, is_tradeable: 1, crown_value: 5000 },
	{ name: '[Epic] Spell Scroll Voucher', description: 'A voucher for a random, truly formidable spell scroll.', item_type: 'VOUCHER', rarity: 'EPIC', is_stackable: 1, is_tradeable: 1, crown_value: 20000 },

	// LOOT-ONLY (expanded)
	{ name: '[Common] XP in a Bottle', description: 'Contains a small amount of captured experience.', item_type: 'VOUCHER', rarity: 'COMMON', is_stackable: 1, is_tradeable: 0, crown_value: 0 },
	{ name: '[Uncommon] XP in a Bottle', description: 'Contains a moderate amount of captured experience.', item_type: 'VOUCHER', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 0, crown_value: 0 },
	{ name: '[Rare] XP in a Bottle', description: 'Contains a large amount of captured experience.', item_type: 'VOUCHER', rarity: 'RARE', is_stackable: 1, is_tradeable: 0, crown_value: 0 },
	{ name: '[Common] Sealed Chest of Crowns', description: 'Contains a small amount of Crowns.', item_type: 'VOUCHER', rarity: 'COMMON', is_stackable: 1, is_tradeable: 0, crown_value: 0 },
	{ name: '[Uncommon] Sealed Chest of Crowns', description: 'Contains a moderate amount of Crowns.', item_type: 'VOUCHER', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 0, crown_value: 0 },
	{ name: '[Rare] Sealed Chest of Crowns', description: 'Contains a large amount of Crowns.', item_type: 'VOUCHER', rarity: 'RARE', is_stackable: 1, is_tradeable: 0, crown_value: 0 },

	// Spell Scrolls
	{ name: 'Scroll of Minor Heal', description: 'A single-use scroll that teaches the Minor Heal spell to a capable user.', item_type: 'SPELL_SCROLL', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 1, crown_value: 500, effects_json: '{"teaches_spell_name": "Minor Heal"}' },
	{ name: 'Scroll of Fireblast', description: 'A single-use scroll that teaches the Fireblast spell.', item_type: 'SPELL_SCROLL', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 1, crown_value: 1200, effects_json: '{"teaches_spell_name": "Fireblast"}' },
	{ name: 'Scroll of Ice Shard', description: 'A single-use scroll that teaches the Ice Shard spell.', item_type: 'SPELL_SCROLL', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 1, crown_value: 1200, effects_json: '{"teaches_spell_name": "Ice Shard"}' },
	{ name: 'Scroll of Mage Armor', description: 'A single-use scroll that teaches the Mage Armor spell.', item_type: 'SPELL_SCROLL', rarity: 'RARE', is_stackable: 1, is_tradeable: 1, crown_value: 2500, effects_json: '{"teaches_spell_name": "Mage Armor"}' },
	{ name: 'Scroll of Light', description: 'A single-use scroll that teaches the Light spell.', item_type: 'SPELL_SCROLL', rarity: 'COMMON', is_stackable: 1, is_tradeable: 1, crown_value: 200, effects_json: '{"teaches_spell_name": "Light"}' },
	{ name: 'Scroll of Shield of Faith', description: 'A single-use scroll that teaches the Shield of Faith spell.', item_type: 'SPELL_SCROLL', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 1, crown_value: 1000, effects_json: '{"teaches_spell_name": "Shield of Faith"}' },
	{ name: 'Scroll of Enfeeble', description: 'A single-use scroll that teaches the Enfeeble spell.', item_type: 'SPELL_SCROLL', rarity: 'RARE', is_stackable: 1, is_tradeable: 1, crown_value: 2800, effects_json: '{"teaches_spell_name": "Enfeeble"}' },
	{ name: 'Scroll of Chain Lightning', description: 'A single-use scroll that teaches the Chain Lightning spell.', item_type: 'SPELL_SCROLL', rarity: 'EPIC', is_stackable: 1, is_tradeable: 1, crown_value: 12000, effects_json: '{"teaches_spell_name": "Chain Lightning"}' },
	{ name: 'Scroll of Stoneskin', description: 'A single-use scroll that teaches the Stoneskin spell.', item_type: 'SPELL_SCROLL', rarity: 'EPIC', is_stackable: 1, is_tradeable: 1, crown_value: 11000, effects_json: '{"teaches_spell_name": "Stoneskin"}' },
	{ name: 'Scroll of Meteor Swarm', description: 'A single-use scroll that teaches the Meteor Swarm spell.', item_type: 'SPELL_SCROLL', rarity: 'LEGENDARY', is_stackable: 1, is_tradeable: 1, crown_value: 50000, effects_json: '{"teaches_spell_name": "Meteor Swarm"}' },
	{ name: 'Scroll of Restoration', description: 'A single-use scroll that teaches the Restoration spell.', item_type: 'SPELL_SCROLL', rarity: 'LEGENDARY', is_stackable: 1, is_tradeable: 1, crown_value: 45000, effects_json: '{"teaches_spell_name": "Restoration"}' },

	// --- ROWAN THE BLACKSMITH'S NEW WARES ---
	// UNCOMMON
	{ name: 'Steel Shortsword', description: 'A reliable and well-balanced shortsword, trusted by soldiers and adventurers alike.', item_type: 'WEAPON', rarity: 'UNCOMMON', is_stackable: 0, is_tradeable: 1, crown_value: 450, damage_dice: '1d6', damage_type: 'Slashing', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"might": 1}, "requirements": {"might": 8}}' },
	{ name: 'Reinforced Iron Shield', description: 'A sturdy shield banded with iron, offering excellent protection.', item_type: 'ARMOR', rarity: 'UNCOMMON', is_stackable: 0, is_tradeable: 1, crown_value: 400, effects_json: '{"slot": "offhand", "ac_bonus": 2, "requirements": {"grit": 8}}' },
	{ name: 'Full Iron Helm', description: 'A heavy helmet that offers complete head protection.', item_type: 'ARMOR', rarity: 'UNCOMMON', is_stackable: 0, is_tradeable: 1, crown_value: 350, effects_json: '{"slot": "helmet", "ac_bonus": 2, "base_stats": {"grit": 1}, "requirements": {"grit": 10}}' },

	// RARE
	{ name: 'Dwarven Waraxe', description: 'A masterfully crafted axe with a heavy, sharp head. It feels incredibly solid in your hands.', item_type: 'WEAPON', rarity: 'RARE', is_stackable: 0, is_tradeable: 1, crown_value: 3200, damage_dice: '1d10', damage_type: 'Slashing', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"might": 2, "grit": 1}, "requirements": {"might": 14}}' },
	{ name: 'Knight\'s Platebody', description: 'Polished steel plates that form an articulated and highly protective cuirass.', item_type: 'ARMOR', rarity: 'RARE', is_stackable: 0, is_tradeable: 1, crown_value: 4000, effects_json: '{"slot": "chestplate", "ac_bonus": 4, "base_stats": {"grit": 2}, "requirements": {"grit": 16}}' },

	// EPIC
	{ name: 'Blade of the Justicar', description: 'A holy greatsword that glows with a faint inner light. It feels heavy with purpose.', item_type: 'WEAPON', rarity: 'EPIC', is_stackable: 0, is_tradeable: 1, crown_value: 18000, damage_dice: '2d8', damage_type: 'Slashing', handedness: 'two-handed', effects_json: '{"slot": "weapon", "base_stats": {"might": 3, "charm": 2}, "requirements": {"might": 22, "archetype": "Justicar"}}' },

	// --- SABLE THE HUNTER'S NEW GEAR ---
	// UNCOMMON
	{ name: 'Beast-Hide Jerkin', description: 'Armor stitched together from the tough hides of various wild beasts.', item_type: 'ARMOR', rarity: 'UNCOMMON', is_stackable: 0, is_tradeable: 1, crown_value: 500, effects_json: '{"slot": "chestplate", "ac_bonus": 1, "base_stats": {"finesse": 1, "fortune": 1}, "requirements": {"finesse": 10}}' },
	{ name: 'Stalker\'s Shortbow', description: 'A quiet, efficient bow favored by those who hunt in dense forests.', item_type: 'WEAPON', rarity: 'UNCOMMON', is_stackable: 0, is_tradeable: 1, crown_value: 650, damage_dice: '1d8', damage_type: 'Piercing', handedness: 'two-handed', effects_json: '{"slot": "weapon", "base_stats": {"finesse": 2}, "requirements": {"finesse": 12}}' },

	// RARE
	{ name: 'Cloak of the Shifting Sands', description: 'A magical cloak that seems to blur your outline, making you harder to hit.', item_type: 'ARMOR', rarity: 'RARE', is_stackable: 0, is_tradeable: 1, crown_value: 3500, effects_json: '{"slot": "chestplate", "ac_bonus": 2, "base_stats": {"finesse": 2, "fortune": 1}, "requirements": {"archetype": "Shifter"}}' },

	// --- PIP THE ALCHEMIST'S NEW POTIONS ---
	{ name: 'Minor Healing Potion', description: 'A common red liquid that restores a small amount of health (2d4+2).', item_type: 'CONSUMABLE', rarity: 'COMMON', is_stackable: 1, is_tradeable: 1, crown_value: 50, effects_json: '{"heal": "2d4+2"}' },
	{ name: 'Healing Potion', description: 'A bubbling red potion that restores a moderate amount of health (4d6+4).', item_type: 'CONSUMABLE', rarity: 'UNCOMMON', is_stackable: 1, is_tradeable: 1, crown_value: 500, effects_json: '{"heal": "4d6+4"}' },
	{ name: 'Greater Healing Potion', description: 'A shimmering, potent red elixir that restores a large amount of health (8d8+8).', item_type: 'CONSUMABLE', rarity: 'RARE', is_stackable: 1, is_tradeable: 1, crown_value: 4000, effects_json: '{"heal": "8d8+8"}' },
	{ name: 'Elixir of Might', description: 'Temporarily boosts your Might stat by +3 for 3 minutes.', item_type: 'CONSUMABLE', rarity: 'RARE', is_stackable: 1, is_tradeable: 1, crown_value: 1200, effects_json: '{"buff": {"stat": "might", "value": 3, "duration_seconds": 180}}' },
	{ name: 'Superior Healing Potion', description: 'A rose colored life-giving draught that restores a massive amount of health (10d10+20).', item_type: 'CONSUMABLE', rarity: 'EPIC', is_stackable: 1, is_tradeable: 1, crown_value: 8000, effects_json: '{"heal": "10d10+20"}' },
	{ name: 'Supreme Healing Potion', description: 'A flask of a multicolored light that restores an enormous amount of health (20d12+40).', item_type: 'CONSUMABLE', rarity: 'EPIC', is_stackable: 1, is_tradeable: 1, crown_value: 16000, effects_json: '{"heal": "20d12+40"}' },
	{ name: 'Ultimate Healing Potion', description: 'A vial of golden light that can restore your entire health to it\'s maximum.', item_type: 'CONSUMABLE', rarity: 'MYTHIC', is_stackable: 0, is_tradeable: 1, crown_value: 500000, effects_json: '{"heal": "full"}' },


	// --- GREG THE ODDBALL'S NEW STOCK ---
	// LOOTBOXES & KEYS
	{ name: 'Rusted Lockbox', description: 'A common, dented lockbox. Requires a Rusted Key to open.', item_type: 'LOOTCRATE', rarity: 'COMMON', is_stackable: 1, is_tradeable: 1, crown_value: 100 },
	{ name: 'Rusted Key', description: 'A simple, corroded key.', item_type: 'MATERIAL', item_subtype: 'KEY', is_stackable: 1, is_tradeable: 1, crown_value: 150 },
	{ name: 'Gilded Chest', description: 'An ornate, heavy chest secured with a complex lock. Requires a Gilded Key to open.', item_type: 'LOOTCRATE', rarity: 'RARE', is_stackable: 1, is_tradeable: 1, crown_value: 1000 },
	{ name: 'Gilded Key', description: 'A masterfully crafted key, shimmering with a golden hue.', item_type: 'MATERIAL', item_subtype: 'KEY', is_stackable: 1, is_tradeable: 1, crown_value: 1500 },

	// THE PANTHEON ITEMS (MYTHIC)
	{ name: 'Aegis of the Unbroken', description: '"The last bastion against the encroaching dark. It has never yielded. It never will." - Pantheon Inscription\n\nGrants a massive boost to resilience and allows you to shrug off a fatal blow once per battle.', item_type: 'ARMOR', rarity: 'MYTHIC', is_stackable: 0, is_tradeable: 1, crown_value: 500000, effects_json: '{"slot": "offhand", "ac_bonus": 10, "base_stats": {"grit": 12}, "requirements": {"grit": 35}}' },
	{ name: 'Whisperwind, the Soulrazor', description: '"It strikes not at the flesh, but at the thread of fate itself." - Pantheon Inscription\n\nEach strike has a chance to permanently lower the target\'s defenses.', item_type: 'WEAPON', rarity: 'MYTHIC', is_stackable: 0, is_tradeable: 1, crown_value: 500000, damage_dice: '2d8', damage_type: 'Slashing', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"finesse": 8, "fortune": 8}, "requirements": {"finesse": 35}}' },
	{ name: 'Crown of the Mad King', description: '"To know all is to lose all. A worthy price." - Pantheon Inscription\n\nGrants immense intellectual power at the cost of physical resilience. Your spells are devastatingly effective.', item_type: 'ARMOR', rarity: 'MYTHIC', is_stackable: 0, is_tradeable: 1, crown_value: 450000, effects_json: '{"slot": "helmet", "ac_bonus": 2, "base_stats": {"wits": 12, "charm": 10, "grit": -8}, "requirements": {"alignment": "Evil", "wits": 35}}' },
];

const lootTables = [
	// REFACTOR NOTE: The hardcoded 'id' field is no longer used by the script for insertion,
	// but is kept here to link to the 'lootTableEntries' data below. The script will
	// resolve the *actual* database ID dynamically.
	{ id: 1, name: 'Vermin Scraps', description: 'Bits and pieces from common pests.' },
	{ id: 2, name: 'Goblin Pouch', description: 'The meager contents of a goblin\'s satchel.' },
	{ id: 3, name: 'Spider Sac', description: 'Harvestable materials from a forest spider.' },
	{ id: 4, name: 'Bone Pile', description: 'The remains of a skeletal creature.' },
	{ id: 5, name: 'Bandit\'s Belongings', description: 'Whatever a highwayman had on them.' },
	{ id: 6, name: 'Dire Wolf Carcass', description: 'Useful parts from a slain dire wolf.' },
	{ id: 7, name: 'Orcish War-Sack', description: 'A sack of brutish and violent treasures.' },
	{ id: 8, name: 'Ogre\'s Loincloth', description: 'Surprisingly spacious and full of junk.' },
	{ id: 9, name: 'Hag\'s Concoctions', description: 'The strange and mystical contents of a hag\'s pouch.' },
];

const lootTableEntries = [
	// Vermin Scraps (Table 1)
	{ loot_table_id: 1, item_name: 'Rat Pelt', drop_chance: 0.75, min_quantity: 1, max_quantity: 1 },
	{ loot_table_id: 1, item_name: 'Rat Tail', drop_chance: 0.50, min_quantity: 1, max_quantity: 1 },
	// Goblin Pouch (Table 2)
	{ loot_table_id: 2, item_name: 'Goblin Ear', drop_chance: 0.90, min_quantity: 1, max_quantity: 2 },
	{ loot_table_id: 2, item_name: 'Crude Dagger', drop_chance: 0.15, min_quantity: 1, max_quantity: 1 },
	{ loot_table_id: 2, item_name: 'Sealed Chest of Crowns', drop_chance: 0.05, min_quantity: 1, max_quantity: 1 },
	// Spider Sac (Table 3)
	{ loot_table_id: 3, item_name: 'Spider Silk', drop_chance: 0.60, min_quantity: 1, max_quantity: 3 },
	{ loot_table_id: 3, item_name: 'Venom Gland', drop_chance: 0.25, min_quantity: 1, max_quantity: 1 },
	// Bone Pile (Table 4)
	{ loot_table_id: 4, item_name: 'Bone Fragments', drop_chance: 0.80, min_quantity: 2, max_quantity: 5 },
	{ loot_table_id: 4, item_name: 'Rusty Shortsword', drop_chance: 0.10, min_quantity: 1, max_quantity: 1 },
	// Bandit's Belongings (Table 5)
	{ loot_table_id: 5, item_name: 'Stolen Locket', drop_chance: 0.20, min_quantity: 1, max_quantity: 1 },
	{ loot_table_id: 5, item_name: 'XP in a Bottle', drop_chance: 0.10, min_quantity: 1, max_quantity: 1 },
	// Dire Wolf Carcass (Table 6)
	{ loot_table_id: 6, item_name: 'Wolf Fang', drop_chance: 0.70, min_quantity: 1, max_quantity: 2 },
	{ loot_table_id: 6, item_name: 'Thick Pelt', drop_chance: 0.40, min_quantity: 1, max_quantity: 1 },
	// Orcish War-Sack (Table 7)
	{ loot_table_id: 7, item_name: 'Orc Tusk', drop_chance: 0.60, min_quantity: 1, max_quantity: 1 },
	{ loot_table_id: 7, item_name: 'Crude Iron Helm', drop_chance: 0.10, min_quantity: 1, max_quantity: 1 },
	// Ogre's Loincloth (Table 8)
	{ loot_table_id: 8, item_name: 'Large Bone', drop_chance: 0.50, min_quantity: 1, max_quantity: 2 },
	{ loot_table_id: 8, item_name: 'Ogre\'s Club', drop_chance: 0.08, min_quantity: 1, max_quantity: 1 },
	// Hag's Concoctions (Table 9)
	{ loot_table_id: 9, item_name: 'Hag\'s Eye', drop_chance: 0.30, min_quantity: 1, max_quantity: 1 },
];

const monsters = [
	{ name: 'Giant Rat', monster_race: 'Beast', level: 1, max_health: 8, armor_class: 10, base_damage: 2, xp_reward: 5, loot_table_id: 1 },
	{ name: 'Goblin Grunt', monster_race: 'Goblinoid', level: 1, max_health: 12, armor_class: 12, base_damage: 3, xp_reward: 10, loot_table_id: 2 },
	{ name: 'Forest Spider', monster_race: 'Beast', level: 2, max_health: 15, armor_class: 13, base_damage: 4, xp_reward: 15, loot_table_id: 3 },
	{ name: 'Skeleton Warrior', monster_race: 'Undead', level: 2, max_health: 18, armor_class: 14, base_damage: 5, xp_reward: 20, loot_table_id: 4 },
	{ name: 'Bandit Thug', monster_race: 'Humanoid', level: 2, max_health: 16, armor_class: 13, base_damage: 4, xp_reward: 18, loot_table_id: 5 },
	{ name: 'Dire Wolf', monster_race: 'Beast', level: 2, max_health: 20, armor_class: 14, base_damage: 6, xp_reward: 25, loot_table_id: 6 },
	{ name: 'Orc Berserker', monster_race: 'Orc', level: 3, max_health: 25, armor_class: 13, base_damage: 7, xp_reward: 35, loot_table_id: 7 },
	{ name: 'Ogre Brute', monster_race: 'Giant', level: 3, max_health: 40, armor_class: 12, base_damage: 8, xp_reward: 45, loot_table_id: 8 },
	{ name: 'Swamp Hag', monster_race: 'Fey', level: 3, max_health: 30, armor_class: 15, base_damage: 5, xp_reward: 50, loot_table_id: 9 },
];

const pveNodes = [
	{ name: 'Tavern Cellar', description: 'Rats have infested the tavern\'s cellar!', required_level: 1, monster_composition_json: '[{"name": "Giant Rat", "count": 2}]', first_completion_reward_json: '{"xp": 20, "crowns": 50}', repeatable_reward_json: '{"xp": 5, "crowns": 10}' },
	{ name: 'Whispering Woods Outskirts', description: 'Goblins and other creatures lurk at the edge of the forest.', required_level: 1, monster_composition_json: '[{"name": "Goblin Grunt", "count": 2}, {"name": "Forest Spider", "count": 1}]', first_completion_reward_json: '{"xp": 50, "crowns": 100}', repeatable_reward_json: '{"xp": 15, "crowns": 25}' },
	{ name: 'Bandit Hideout', description: 'A group of bandits have made a camp near the main road.', required_level: 2, monster_composition_json: '[{"name": "Bandit Thug", "count": 3}]', first_completion_reward_json: '{"xp": 70, "crowns": 120}', repeatable_reward_json: '{"xp": 20, "crowns": 35}' },
	{ name: 'Forgotten Crypt Entrance', description: 'The restless dead guard the entrance to an ancient tomb.', required_level: 2, monster_composition_json: '[{"name": "Skeleton Warrior", "count": 3}]', first_completion_reward_json: '{"xp": 80, "crowns": 150}', repeatable_reward_json: '{"xp": 25, "crowns": 40}' },
	{ name: 'Dire Wolf Den', description: 'A pair of vicious dire wolves have claimed this cave.', required_level: 2, monster_composition_json: '[{"name": "Dire Wolf", "count": 2}]', first_completion_reward_json: '{"xp": 90, "crowns": 160}', repeatable_reward_json: '{"xp": 30, "crowns": 45}' },
	{ name: 'Orc Warcamp', description: 'A small but aggressive encampment of orcs and their goblin minions.', required_level: 3, monster_composition_json: '[{"name": "Orc Berserker", "count": 2}, {"name": "Goblin Grunt", "count": 2}]', first_completion_reward_json: '{"xp": 120, "crowns": 200}', repeatable_reward_json: '{"xp": 40, "crowns": 60}' },
	{ name: 'Ogre\'s Cave', description: 'A lumbering ogre has taken up residence in this cave, along with its orcish friend.', required_level: 3, monster_composition_json: '[{"name": "Ogre Brute", "count": 1}, {"name": "Orc Berserker", "count": 1}]', first_completion_reward_json: '{"xp": 150, "crowns": 250}', repeatable_reward_json: '{"xp": 50, "crowns": 75}' },
	{ name: 'Murky Swamp', description: 'A foul hag and her spider pets infest this murky bog.', required_level: 3, monster_composition_json: '[{"name": "Swamp Hag", "count": 1}, {"name": "Forest Spider", "count": 3}]', first_completion_reward_json: '{"xp": 180, "crowns": 300}', repeatable_reward_json: '{"xp": 60, "crowns": 90}' },
];
const standardStartingKitData = [
	{ name: 'Simple Dagger', description: 'A small, utilitarian blade. More a tool than a dedicated weapon.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 5, damage_dice: '1d4', damage_type: 'Piercing', handedness: 'one-handed', effects_json: '{"slot": "weapon"}' },
	{ name: 'Worn Buckler', description: 'A small, strap-on shield of hardened leather and wood.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "offhand", "ac_bonus": 1}' },
	{ name: 'Traveler\'s Hood', description: 'A simple but sturdy hood to protect against the elements.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 5, effects_json: '{"slot": "helmet"}' },
	{ name: 'Traveler\'s Tunic', description: 'A durable tunic of rough-spun cloth, suitable for a new adventurer.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 5, effects_json: '{"slot": "chestplate"}' },
	{ name: 'Traveler\'s Trousers', description: 'Simple, durable trousers fit for a long journey.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 5, effects_json: '{"slot": "leggings"}' },
	{ name: 'Worn Leather Boots', description: 'Sturdy boots that have seen many roads.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 5, effects_json: '{"slot": "boots"}' },
	{ name: 'Simple Iron Band', description: 'A plain, unadorned band of common iron.', item_type: 'ACCESSORY', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 2, effects_json: '{"slot": "ring"}' },
	{ name: 'Frayed Rope Amulet', description: 'A simple loop of frayed rope, perhaps once a good luck charm.', item_type: 'ACCESSORY', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 2, effects_json: '{"slot": "amulet"}' },
];


const startingEquipmentData = [
	// Channeler
	{ name: 'Channeler\'s Focus', description: 'A smooth, crystal-tipped wand that hums with latent power.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, damage_dice: '1d4', damage_type: 'Bludgeoning', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"wits": 1}, "spell_damage_bonus": 2}' },
	{ name: 'Acolyte\'s Robes', description: 'Simple, blessed robes that offer minor mystical protection.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "chestplate", "ac_bonus": 1}' },

	// Golemancer
	{ name: 'Tinkerer\'s Hammer', description: 'A heavy, versatile tool, effective for both intricate repairs and blunt dissuasion.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, damage_dice: '1d6', damage_type: 'Bludgeoning', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"might": 1}}' },
	{ name: 'Reinforced Apron', description: 'A thick leather apron, stained with oil and grease, offering surprising resilience.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "chestplate", "base_stats": {"grit": 1}}' },

	// Justicar
	{ name: 'Candor\'s Mace', description: 'A solid iron mace, designed to enforce order and deliver judgment.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, damage_dice: '1d6', damage_type: 'Bludgeoning', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"grit": 1}}' },
	{ name: 'Vow Keeper\'s Sigil', description: 'A holy symbol worn on a simple chain, representing a sacred oath.', item_type: 'ACCESSORY', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "amulet", "base_stats": {"wits": 1}}' },

	// Slayer
	{ name: 'Slayer\'s Hunting Brand', description: 'A sharp, practical blade, perfect for exploiting a creature\'s weakness.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, damage_dice: '1d6', damage_type: 'Slashing', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"fortune": 1}}' },
	{ name: 'Stalker\'s Mantle', description: 'A dark, heavy cloak that helps its wearer blend into the shadows.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "chestplate", "base_stats": {"finesse": 1}}' },

	// Shifter
	{ name: 'Unstable Effigy', description: 'A strange, shifting wooden doll that crackles with chaotic energy.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, effects_json: '{"slot": "offhand", "base_stats": {"fortune": 2}}' },
	{ name: 'Fey-Touched Tunic', description: 'A brightly colored tunic that seems to change hue in the light.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "chestplate", "base_stats": {"finesse": 1}}' },

	// Reaper
	{ name: 'Ritualist\'s Dagger', description: 'A grim dagger used for carving runes and harvesting essences.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, damage_dice: '1d4', damage_type: 'Slashing', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"wits": 1}}' },
	{ name: 'Siphoning Charm', description: 'A dark amulet that seems to draw warmth from the air around it.', item_type: 'ACCESSORY', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "amulet", "base_stats": {"fortune": 1}}' },

	// Ascetic
	{ name: 'Weighted Knuckle Wraps', description: 'Simple cloth wraps with small lead weights sewn in to add force to every strike.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, damage_dice: '1d8', damage_type: 'Bludgeoning', handedness: 'two-handed', effects_json: '{"slot": "weapon", "base_stats": {"might": 1}}' },
	{ name: 'Ring of Inner Focus', description: 'A plain iron ring that helps quiet the mind and steel the body against hardship.', item_type: 'ACCESSORY', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "ring", "base_stats": {"grit": 1}}' },

	// Saboteur
	{ name: 'Saboteur\'s Stiletto', description: 'A thin, easily concealed dagger designed for subtlety and speed.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, damage_dice: '1d4', damage_type: 'Piercing', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"finesse": 1}}' },
	{ name: 'Infiltrator\'s Charm', description: 'A small, nondescript charm that aids in observation and analysis.', item_type: 'ACCESSORY', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "amulet", "base_stats": {"wits": 1}}' },

	// Scholar
	{ name: 'Tome of Beginnings', description: 'A heavy book filled with foundational knowledge, bound in sturdy leather.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, effects_json: '{"slot": "offhand", "base_stats": {"wits": 2}}' },
	{ name: 'Amulet of Keen Insight', description: 'A simple amulet with a polished obsidian stone that seems to sharpen one\'s perception.', item_type: 'ACCESSORY', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "amulet", "base_stats": {"fortune": 1}}' },

	// Artisan
	{ name: 'Artisan\'s Hammer', description: 'A well-balanced hammer, perfect for a forge, yet serviceable in a fight.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, damage_dice: '1d6', damage_type: 'Bludgeoning', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"finesse": 1}}' },
	{ name: 'Guildsman\'s Ring', description: 'A simple ring denoting membership in a crafter\'s guild, it focuses the mind on details.', item_type: 'ACCESSORY', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "ring", "base_stats": {"wits": 1}}' },

	// Zealot
	{ name: 'Zealot\'s Banner', description: 'A tattered banner on a short pole, meant to be held aloft to inspire allies.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, effects_json: '{"slot": "offhand", "base_stats": {"charm": 2}}' },
	{ name: 'Devotee\'s Pauldrons', description: 'Simple, hardened leather pauldrons that protect the shoulders from harm.', item_type: 'ARMOR', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, effects_json: '{"slot": "chestplate", "base_stats": {"grit": 1}}' },

	// Warden
	{ name: 'Warden\'s Shield', description: 'A solid, wooden shield emblazoned with a simple protective sigil.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 15, effects_json: '{"slot": "offhand", "ac_bonus": 2}' },
	{ name: 'Enforcer\'s Cudgel', description: 'A heavy, reliable club used for maintaining order and protecting the innocent.', item_type: 'WEAPON', rarity: 'STARTER', is_stackable: 0, is_tradeable: 0, crown_value: 10, damage_dice: '1d6', damage_type: 'Bludgeoning', handedness: 'one-handed', effects_json: '{"slot": "weapon", "base_stats": {"might": 1}}' },
];

/**
 * Seed species and subspecies data into the database, updating existing records.
 *
 * Performs upsert operations for species and subspecies inside a single transaction.
 * Species entries are inserted or updated; subspecies are inserted or updated with their
 * resolved species_id. Subspecies that reference a missing species are skipped and a warning is logged.
 */
function seedSpeciesData() {
	db.transaction(() => {
		const upsertSpecies = db.prepare(`
            INSERT INTO species (name, description, stat_bonus_json, base_perk_name, base_perk_description)
            VALUES (@name, @description, @stat_bonus_json, @base_perk_name, @base_perk_description)
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                stat_bonus_json = excluded.stat_bonus_json,
                base_perk_name = excluded.base_perk_name,
                base_perk_description = excluded.base_perk_description
        `);

		const upsertSubspecies = db.prepare(`
            INSERT INTO subspecies (species_id, name, description, stat_bonus_json)
            VALUES (@species_id, @name, @description, @stat_bonus_json)
            ON CONFLICT(name) DO UPDATE SET
                species_id = excluded.species_id,
                description = excluded.description,
                stat_bonus_json = excluded.stat_bonus_json
        `);

		console.log('[DB Seeding] Upserting species...');
		for (const species of speciesData) {
			upsertSpecies.run(species);
		}

		const speciesIds = new Map(db.prepare('SELECT species_id, name FROM species').all().map(s => [s.name, s.species_id]));

		console.log('[DB Seeding] Upserting subspecies...');
		for (const subspecies of subspeciesData) {
			const speciesId = speciesIds.get(subspecies.species_name);
			if (speciesId) {
				upsertSubspecies.run({
					species_id: speciesId,
					name: subspecies.name,
					description: subspecies.description,
					stat_bonus_json: subspecies.stat_bonus_json,
				});
			}
			else {
				console.warn(`[DB Seeding] Could not find species "${subspecies.species_name}" for subspecies "${subspecies.name}".`);
			}
		}
	})();
}

/**
 * Idempotently seeds all PvE and shop data into the database.
 *
 * Performs upserts for items, spells, loot tables, vendors, monsters, and PvE nodes,
 * then populates junction tables (loot table entries, vendor stock, and node–monster associations)
 * while resolving and preserving foreign-key relationships so repeated runs do not create duplicates.
 */
function seedPveData() {
	db.transaction(() => {
		// Prepare all UPSERT statements once for efficiency.
		const upsertSpell = db.prepare(`
            INSERT INTO spells (name, description, required_level, spell_school, required_wits, mana_cost, effects_json)
            VALUES (@name, @description, @required_level, @spell_school, @required_wits, @mana_cost, @effects_json)
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                required_level = excluded.required_level,
                spell_school = excluded.spell_school,
                required_wits = excluded.required_wits,
                mana_cost = excluded.mana_cost,
                effects_json = excluded.effects_json
        `);
		const upsertItem = db.prepare(`
            INSERT INTO items (name, description, item_type, item_subtype, rarity, is_stackable, is_tradeable, crown_value, damage_dice, damage_type, handedness, effects_json)
            VALUES (@name, @description, @item_type, @item_subtype, @rarity, @is_stackable, @is_tradeable, @crown_value, @damage_dice, @damage_type, @handedness, @effects_json)
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                item_type = excluded.item_type,
                item_subtype = excluded.item_subtype,
                rarity = excluded.rarity,
                crown_value = excluded.crown_value,
                damage_dice = excluded.damage_dice,
                damage_type = excluded.damage_type,
                handedness = excluded.handedness,
                effects_json = excluded.effects_json
        `);

		const upsertLootTable = db.prepare(`
            INSERT INTO loot_tables (name, description) VALUES (@name, @description)
            ON CONFLICT(name) DO UPDATE SET description = excluded.description
        `);

		const upsertVendor = db.prepare(`
            INSERT INTO npc_vendors (name, description, charm_requirement) VALUES (@name, @description, @charm_requirement)
            ON CONFLICT(name) DO UPDATE SET description = excluded.description, charm_requirement = excluded.charm_requirement
        `);

		const upsertMonster = db.prepare(`
            INSERT INTO monsters (name, monster_race, level, max_health, armor_class, base_damage, xp_reward, loot_table_id)
            VALUES (@name, @monster_race, @level, @max_health, @armor_class, @base_damage, @xp_reward, @loot_table_id)
            ON CONFLICT(name) DO UPDATE SET
                monster_race = excluded.monster_race,
                level = excluded.level,
                max_health = excluded.max_health,
                armor_class = excluded.armor_class,
                base_damage = excluded.base_damage,
                xp_reward = excluded.xp_reward,
                loot_table_id = excluded.loot_table_id
        `);

		const upsertPveNode = db.prepare(`
            INSERT INTO pve_nodes (name, description, required_level, first_completion_reward_json, repeatable_reward_json)
            VALUES (@name, @description, @required_level, @first_completion_reward_json, @repeatable_reward_json)
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                required_level = excluded.required_level,
                first_completion_reward_json = excluded.first_completion_reward_json,
                repeatable_reward_json = excluded.repeatable_reward_json
        `);

		// Junction tables still need simple INSERT IGNORE logic
		const insertLootEntry = db.prepare('INSERT OR IGNORE INTO loot_table_entries (loot_table_id, item_id, drop_chance, min_quantity, max_quantity) VALUES (?, ?, ?, ?, ?)');
		const insertVendorStock = db.prepare('INSERT OR IGNORE INTO vendor_stock (vendor_id, item_id, buy_price, sell_price) VALUES (?, ?, ?, ?)');
		const insertPveNodeMonster = db.prepare('INSERT OR IGNORE INTO pve_node_monsters (node_id, monster_id, count) VALUES (?, ?, ?)');


		const allItems = [...pveItems, ...startingEquipmentData, ...standardStartingKitData];

		// 1. Seed Items, Loot Tables, Vendors
		console.log('[DB Seeding] Upserting items, loot tables, and vendors...');
		for (const item of allItems) {
			upsertItem.run({
				name: item.name, description: item.description, item_type: item.item_type, item_subtype: item.item_subtype || null,
				rarity: item.rarity || 'COMMON', is_stackable: item.is_stackable, is_tradeable: item.is_tradeable,
				crown_value: item.crown_value, damage_dice: item.damage_dice || null, damage_type: item.damage_type || null,
				handedness: item.handedness || null, effects_json: item.effects_json || null,
			});
		}
		for (const table of lootTables) {
			upsertLootTable.run(table);
		}
		for (const vendor of vendorsData) {
			upsertVendor.run(vendor);
		}
		console.log('[DB Seeding] Upserting spells...');
		for (const spell of spellsData) {
			upsertSpell.run(spell);
		}
		// 2. Resolve IDs for Foreign Key relationships
		const itemIds = new Map(db.prepare('SELECT item_id, name FROM items').all().map(i => [i.name, i.item_id]));
		const lootTableIds = new Map(db.prepare('SELECT loot_table_id, name FROM loot_tables').all().map(lt => [lt.name, lt.loot_table_id]));
		const vendorIds = new Map(db.prepare('SELECT vendor_id, name FROM npc_vendors').all().map(v => [v.name, v.vendor_id]));
		const localLootTableIdToDbId = new Map(lootTables.map(lt => [lt.id, lootTableIds.get(lt.name)]));

		// 3. Seed Monsters (depends on loot tables)
		console.log('[DB Seeding] Upserting monsters...');
		for (const monster of monsters) {
			upsertMonster.run({
				...monster,
				loot_table_id: localLootTableIdToDbId.get(monster.loot_table_id),
			});
		}

		// 4. Seed PvE Nodes (no dependencies)
		console.log('[DB Seeding] Upserting PvE nodes...');
		for (const node of pveNodes) {
			upsertPveNode.run(node);
		}

		// 5. Resolve final IDs
		const monsterIds = new Map(db.prepare('SELECT monster_id, name FROM monsters').all().map(m => [m.name, m.monster_id]));
		const nodeIds = new Map(db.prepare('SELECT node_id, name FROM pve_nodes').all().map(n => [n.name, n.node_id]));

		// 6. Seed Junction Tables (Vendor Stock, Loot Entries, Node Monsters)
		console.log('[DB Seeding] Seeding junction tables (stock, loot entries, etc.)...');
		for (const stock of vendorStockData) {
			insertVendorStock.run(vendorIds.get(stock.vendor_name), itemIds.get(stock.item_name), stock.buy_price || null, stock.sell_price || null);
		}
		for (const entry of lootTableEntries) {
			insertLootEntry.run(localLootTableIdToDbId.get(entry.loot_table_id), itemIds.get(entry.item_name), entry.drop_chance, entry.min_quantity, entry.max_quantity);
		}
		for (const nodeSeed of pveNodes) {
			const monsterComp = JSON.parse(nodeSeed.monster_composition_json);
			for (const comp of monsterComp) {
				insertPveNodeMonster.run(nodeIds.get(nodeSeed.name), monsterIds.get(comp.name), comp.count);
			}
		}
		console.log('[DB Seeding] All PvE and Shop data successfully seeded.');
	})();
}

/**
 * Ensures core languages and dialects are present in the languages table.
 *
 * Inserts or updates a curated list of languages (name, scramble_type, avatar_url), using the language name as the unique key.
 */
function seedLanguageData() {
	const languages = [
		// --- CORE LANGUAGES ---
		{ name: 'Axal (Common)', scramble_type: 'NONE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Draedic', scramble_type: 'DRAEDIC_SELF_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Caeric', scramble_type: 'CAERIC_SELF_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Primordial', scramble_type: 'PRIMORDIAL_SELF_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Bestial', scramble_type: 'BESTIAL_SELF_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Aberrant', scramble_type: 'ABERRANT_SELF_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Nocturne', scramble_type: 'NOCTURNE_SELF_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },

		// --- PRIMORDIAL DIALECTS ---
		{ name: 'Ignic', scramble_type: 'IGNIC_PRIMORDIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Auric', scramble_type: 'AURIC_PRIMORDIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Aquic', scramble_type: 'AQUIC_PRIMORDIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Ferric', scramble_type: 'FERRIC_PRIMORDIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Sylvic', scramble_type: 'SYLVIC_PRIMORDIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },

		// --- BESTIAL DIALECTS ---
		{ name: 'Vulpis', scramble_type: 'VULPIS_BESTIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Felis', scramble_type: 'FELIS_BESTIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Chelis', scramble_type: 'CHELIS_BESTIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Canis', scramble_type: 'CANIS_BESTIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Lapis', scramble_type: 'LAPIS_BESTIAL_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },

		// --- ABERRANT DIALECTS ---
		{ name: 'Klang', scramble_type: 'KLANG_ABERRANT_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Spoar', scramble_type: 'SPOAR_ABERRANT_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Gloop', scramble_type: 'GLOOP_ABERRANT_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },

		// --- NOCTURNE DIALECTS ---
		{ name: 'Umbral', scramble_type: 'UMBRAL_NOCTURNE_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
		{ name: 'Sanguine', scramble_type: 'SANGUINE_NOCTURNE_SUBSTITUTE', avatar_url: 'https://i.imgur.com/ETyVawk.jpeg' },
	];

	db.transaction(() => {
		const upsert = db.prepare(`
            INSERT INTO languages (name, scramble_type, avatar_url)
            VALUES (@name, @scramble_type, @avatar_url)
            ON CONFLICT(name) DO UPDATE SET
                scramble_type = excluded.scramble_type,
                avatar_url = excluded.avatar_url
        `);
		console.log('[DB Seeding] Upserting languages...');
		for (const lang of languages) {
			upsert.run(lang);
		}
	})();
}

/**
 * Orchestrates idempotent seeding of core application and game data into the database.
 *
 * Runs conditional seeding for origins and archetypes (only if their tables are empty)
 * and then executes the species, PvE, and language seeding routines in sequence.
 *
 * @returns {boolean} `true` if all seeding steps complete successfully.
 * @throws {Error} If any seeding step fails, an Error is thrown with a descriptive message.
 */
function seedDatabase() {
	// REFACTOR NOTE: The logic for Origins and Archetypes was already idempotent,
	// checking for an empty table and then inserting. This is acceptable for data
	// that is core to the application and not expected to change or have partial states.
	// It has been left as-is for simplicity.
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
		seedSpeciesData();
		seedPveData();
		seedLanguageData();
		return true;
	}
	catch (error) {
		console.error('[DB Seeding] Failed to seed database:', error);
		throw new Error(`Database seeding failed: ${error.message}`);
	}
}

module.exports = { seedDatabase };