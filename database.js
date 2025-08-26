const Database = require('better-sqlite3');
const path = require('path');

const config = require('./config.json');
const rawJackpot = Number.parseInt(config?.gamble?.jackpotBaseAmount, 10);
const JACKPOT_BASE_AMOUNT = Number.isFinite(rawJackpot) && rawJackpot > 0 ? rawJackpot : 5000;


const db = new Database(path.join(__dirname, 'bump_data.db'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');


// Initialize tables in one transaction
const setupTables = db.transaction(() => {

	// "Bump tracking & rewards" via /events/ @ [messageCreate.js]

	db.prepare(`
        CREATE TABLE IF NOT EXISTS bump_leaderboard (
            user_id TEXT PRIMARY KEY,
            bumps INTEGER DEFAULT 0,
            last_bump_week INTEGER,
            last_bump_time TEXT
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS leaderboard_message (
            channel_id TEXT PRIMARY KEY,
            message_id TEXT
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS bump_streak (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            user_id TEXT,
            streak_count INTEGER DEFAULT 0
        )
    `).run();

	// "Tony Quote System" via /commands/utility/ @ [tonyQuote.js]

	db.prepare(`
        CREATE TABLE IF NOT EXISTS tony_quotes_pending (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger_word TEXT COLLATE NOCASE,
            quote_text TEXT NOT NULL COLLATE NOCASE,
            user_id TEXT NOT NULL,
            approval_message_id TEXT NOT NULL,
            submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
            quote_type TEXT DEFAULT 'trigger' NOT NULL,
            CHECK (quote_type IN ('trigger','idle')),
            CHECK (quote_type = 'idle' OR trigger_word IS NOT NULL),
            CHECK (quote_text = TRIM(quote_text)),
            CHECK (length(quote_text) > 0),
            CHECK (trigger_word IS NULL OR trigger_word = TRIM(trigger_word)),
            CHECK (trigger_word IS NULL OR length(trigger_word) > 0),
            UNIQUE(approval_message_id)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS tony_quotes_active (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger_word TEXT COLLATE NOCASE,
            quote_text TEXT NOT NULL COLLATE NOCASE,
            user_id TEXT NOT NULL,
            times_triggered INTEGER DEFAULT 0 CHECK (times_triggered >= 0),
            last_triggered_at TEXT,
            quote_type TEXT DEFAULT 'trigger' NOT NULL,
            CHECK (quote_type IN ('trigger','idle')),
            CHECK (quote_type = 'idle' OR trigger_word IS NOT NULL),
            CHECK (quote_text = TRIM(quote_text)),
            CHECK (length(quote_text) > 0),
            CHECK (trigger_word IS NULL OR trigger_word = TRIM(trigger_word)),
            CHECK (trigger_word IS NULL OR length(trigger_word) > 0)
        )
    `).run();
	db.prepare(`
		CREATE TABLE IF NOT EXISTS tony_quotes_global_cooldown (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			last_triggered_at TEXT
		)
	`).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS tony_idle_chatter_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            next_chatter_time TEXT
        )
    `).run();

	db.prepare(`
		CREATE TABLE IF NOT EXISTS tony_quotes_archive (
			id INTEGER,
            source_table TEXT NOT NULL CHECK (source_table IN ('pending','active')),
			trigger_word TEXT,
			quote_text TEXT,
			user_id TEXT,
			approval_message_id TEXT,
			submitted_at TEXT,
			quote_type TEXT CHECK (quote_type IN ('trigger','idle')),
			archived_at TEXT DEFAULT CURRENT_TIMESTAMP,
			reason TEXT
		)
	`).run();

	// "Guild management system" via /commands/utility/ @ [guild.js]

	db.prepare(`
        CREATE TABLE IF NOT EXISTS guildmember_tracking (
            user_id TEXT PRIMARY KEY,
            guild_tag TEXT,
            owner INTEGER DEFAULT 0,
            vice_gm INTEGER DEFAULT 0
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_list (
            guild_name TEXT,
            guild_tag TEXT PRIMARY KEY,
            channel_id TEXT,
            public_channel_id TEXT,
            role_id TEXT,
            is_open INTEGER DEFAULT 0,
            motto TEXT DEFAULT '',
            hook TEXT DEFAULT '',
            lore TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            guildmember_title TEXT DEFAULT 'Member',
            attitude TEXT DEFAULT 'Neutral',
            UNIQUE(guild_name)
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_economy (
            guild_tag TEXT PRIMARY KEY,
            balance INTEGER DEFAULT 0,
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_tiers (
            guild_tag TEXT PRIMARY KEY,
            tier INTEGER DEFAULT 1,
            last_upgrade_time TEXT,
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_fundraisers (
            message_id TEXT PRIMARY KEY,
            guild_tag TEXT NOT NULL,
            creator_id TEXT NOT NULL,
            target_amount INTEGER NOT NULL,
            current_amount INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed INTEGER DEFAULT 0,
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS fundraiser_contributions (
            fundraiser_id TEXT,
            user_id TEXT,
            amount INTEGER NOT NULL,
            contributed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (fundraiser_id, user_id),
            FOREIGN KEY(fundraiser_id) REFERENCES guild_fundraisers(message_id) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_emojis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_tag TEXT NOT NULL,
            emoji_name TEXT NOT NULL,
            emoji_id TEXT NOT NULL,
            is_default INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_stickers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_tag TEXT NOT NULL UNIQUE,
            sticker_id TEXT NOT NULL,
            sticker_name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_daily_dues (
            guild_tag TEXT PRIMARY KEY,
            last_dues_date TEXT NOT NULL,
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();

	// "Guild diplomacy and relationships" via /commands/utility/ @ [guild.js]

	// Enforce ordered pairs (lexicographically) so (A,B) only
	db.prepare(`
		CREATE TABLE IF NOT EXISTS guild_relationships (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_one_tag TEXT NOT NULL,
            guild_two_tag TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('alliance', 'enemy', 'truce')),
            initiator_tag TEXT NOT NULL,
            expires_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(guild_one_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE,
            FOREIGN KEY(guild_two_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE,
            FOREIGN KEY(initiator_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE,
            CHECK (guild_one_tag < guild_two_tag),
            UNIQUE(guild_one_tag, guild_two_tag)
		)
	`).run();

	db.prepare(`
		CREATE TABLE IF NOT EXISTS diplomacy_cooldowns (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_one_tag TEXT NOT NULL,
			guild_two_tag TEXT NOT NULL,
			cooldown_type TEXT NOT NULL CHECK (cooldown_type IN ('enemy_declaration', 'alliance_break')),
			expires_at TEXT NOT NULL,
			FOREIGN KEY(guild_one_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE,
			FOREIGN KEY(guild_two_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE,
			UNIQUE(guild_one_tag, guild_two_tag, cooldown_type)
		)
	`).run();

	db.prepare(`
		CREATE TABLE IF NOT EXISTS attitude_cooldowns (
			guild_tag TEXT PRIMARY KEY,
			changed_at TEXT NOT NULL,
			FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
		)
	`).run();

	// "Guild raiding backend" via /commands/utility/ @ [guild.js]

	db.prepare(`
        CREATE TABLE IF NOT EXISTS raid_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            attacker_tag TEXT NOT NULL,
            defender_tag TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            success INTEGER NOT NULL,
            stolen_amount INTEGER,
            lost_amount INTEGER,
            wager_pot INTEGER DEFAULT 0,
            attacker_roll INTEGER,
            defender_ac INTEGER,
            attacker_allies TEXT,
            defender_allies TEXT,
            FOREIGN KEY(attacker_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE,
            FOREIGN KEY(defender_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();

	// NEW TABLE FOR ALLIANCE RAIDS
	db.prepare(`
		CREATE TABLE IF NOT EXISTS active_raid_allies (
			raid_id INTEGER NOT NULL,
			allied_guild_tag TEXT NOT NULL,
			side TEXT NOT NULL,
			PRIMARY KEY (raid_id, allied_guild_tag),
			FOREIGN KEY(raid_id) REFERENCES raid_history(id) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS raid_cooldowns (
            guild_tag TEXT PRIMARY KEY,
            shield_expiry TEXT,
            last_raid_time TEXT,
            is_under_raid INTEGER DEFAULT 0,
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_raid_messages (
            guild_tag TEXT PRIMARY KEY,
            raiding_description TEXT DEFAULT 'The war horns of {raidingGuild} sound across the plains, their banners held high as they march towards their target.',
            defending_description TEXT DEFAULT 'The stronghold of {defendingGuild} stands defiantly, its gates barred and sentries on the walls, awaiting the coming storm.',
            raiding_attack TEXT DEFAULT '{raidingGuild}''s forces, led by {raidingGuildmaster}, begin their assault, crashing against the defenses of {defendingGuild}!',
            defending_success TEXT DEFAULT 'The defenders of {defendingGuild}, under the command of {defendingGuildmaster}, have repelled the invaders! The attackers are routed!',
            defending_failure TEXT DEFAULT 'The defenses of {defendingGuild} have been breached! The attackers pour into the stronghold, overwhelming the defenders led by {defendingGuildmaster}.',
            raiding_victory TEXT DEFAULT 'Victory for {raidingGuild}! They have plundered the enemy and stand triumphant on the battlefield.',
            raiding_retreat TEXT DEFAULT 'The attack has failed! The forces of {raidingGuild} are forced to retreat, their assault broken by the stalwart defenders.',
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS raid_leaderboard (
            guild_tag TEXT PRIMARY KEY,
            successful_raids INTEGER DEFAULT 0,
            crowns_stolen INTEGER DEFAULT 0,
			guilds_destroyed INTEGER DEFAULT 0,
            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
		CREATE TABLE IF NOT EXISTS temp_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            expiry_time TEXT NOT NULL
        )
    `).run();

	// "Economy system" via /commands/utility/ @ [econ.js]

	db.prepare(`
        CREATE TABLE IF NOT EXISTS user_economy (
            user_id TEXT PRIMARY KEY,
            crowns INTEGER DEFAULT 0,
            last_daily TEXT,
            multiplier REAL DEFAULT 1.0,
            daily_streak INTEGER DEFAULT 0,
            daily_prestige INTEGER DEFAULT 0
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS user_activity (
            user_id TEXT PRIMARY KEY,
            normal_messages INTEGER DEFAULT 0,
            last_message_time TEXT
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS game_jackpot (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            amount INTEGER DEFAULT ${JACKPOT_BASE_AMOUNT}
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS user_game_streaks (
            user_id TEXT PRIMARY KEY,
            blackjack_wins INTEGER DEFAULT 0,
            coinflip_losses INTEGER DEFAULT 0,
            horserace_wins INTEGER DEFAULT 0
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS daily_ping_preferences (
            user_id TEXT PRIMARY KEY,
            opt_in_status INTEGER DEFAULT 0,
            last_notified_claim_time TEXT
        )
    `).run();


	// "Welcome rewards system" via /events/ @ [guildMemberAdd.js]

	db.prepare(`
        CREATE TABLE IF NOT EXISTS welcome_messages (
            message_id TEXT PRIMARY KEY,
            new_member_id TEXT NOT NULL,
            welcome_time INTEGER NOT NULL
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS welcome_rewards_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            welcome_id TEXT NOT NULL,
            welcomer_id TEXT NOT NULL,
            payout INTEGER NOT NULL,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(welcome_id, welcomer_id),
            FOREIGN KEY(welcome_id) REFERENCES welcome_messages(message_id)
        )
	`).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS welcome_mentioned_channels (
            welcome_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            mentioned_by TEXT NOT NULL,
            PRIMARY KEY (welcome_id, channel_id),
            FOREIGN KEY(welcome_id) REFERENCES welcome_messages(message_id)
        )
    `).run();


	// "Member of the Week giveaway" via /tasks/ @ [weeklyReset.js]

	db.prepare(`
        CREATE TABLE IF NOT EXISTS motw_giveaways (
            message_id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            week_identifier TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            entries_count INTEGER DEFAULT 0,
            winner_id TEXT,
            completed INTEGER DEFAULT 0
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS motw_entries (
            giveaway_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            entry_time TEXT NOT NULL,
            PRIMARY KEY (giveaway_id, user_id),
            FOREIGN KEY(giveaway_id) REFERENCES motw_giveaways(message_id)
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS motw_winners_history (
            user_id TEXT NOT NULL,
            week_identifier TEXT NOT NULL,
            win_time TEXT NOT NULL,
            was_top_bumper INTEGER DEFAULT 0,
            PRIMARY KEY (user_id, week_identifier)
        )
    `).run();

	// "Game Master Session Tracking" via /commands/admin/ @ [system.js]

	db.prepare(`
        CREATE TABLE IF NOT EXISTS game_sessions (
            game_id INTEGER PRIMARY KEY AUTOINCREMENT,
            dm_user_id TEXT NOT NULL,
            game_name TEXT DEFAULT 'Unnamed Game',
            category_id TEXT NOT NULL UNIQUE,
            management_channel_id TEXT NOT NULL UNIQUE,
            wizard_message_id TEXT,
            key_role_id TEXT NOT NULL UNIQUE,
            forum_post_id TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS game_channels (
            channel_id TEXT PRIMARY KEY,
            game_id INTEGER NOT NULL,
            channel_type TEXT NOT NULL,
            FOREIGN KEY(game_id) REFERENCES game_sessions(game_id) ON DELETE CASCADE
        )
    `).run();


	// "MASTER CHARACTER SYSTEM" for /main/brewmaster/ @ [WHOLE REPO]
	// BEGIN CHARACTER SUPERSYSTEM TABLES


	db.prepare(`
        CREATE TABLE IF NOT EXISTS characters (

            -- === Core Identity (Mandatory) ===
            user_id TEXT PRIMARY KEY,
            character_name TEXT NOT NULL,
            origin_id INTEGER NOT NULL,
            archetype_id INTEGER NOT NULL,

            -- === Role-Playing Fields  ===
            character_backstory TEXT NOT NULL DEFAULT '',
            character_image TEXT NOT NULL DEFAULT '',
            character_alignment TEXT NOT NULL DEFAULT '',
            character_ideals TEXT NOT NULL DEFAULT '',
            character_bonds TEXT NOT NULL DEFAULT '',
            character_flaws TEXT NOT NULL DEFAULT '',
            character_traits TEXT NOT NULL DEFAULT '',
            character_languages TEXT NOT NULL DEFAULT '',
            character_title TEXT NOT NULL DEFAULT '',

            -- === Progression & State ===
            level INTEGER DEFAULT 1 CHECK (level >= 1),
            xp INTEGER DEFAULT 0 CHECK (xp >= 0),
            character_status TEXT NOT NULL DEFAULT 'IDLE',
            stat_points_unspent INTEGER DEFAULT 0 CHECK (stat_points_unspent >= 0),

            -- === Resource Pools ===
            max_health INTEGER DEFAULT 10 CHECK (max_health >= 1),
            current_health INTEGER DEFAULT 10 CHECK (current_health >= 0 AND current_health <= max_health),
            temporary_health INTEGER DEFAULT 0 CHECK (temporary_health >= 0),
            max_mana INTEGER DEFAULT 10 CHECK (max_mana >= 1),
            current_mana INTEGER DEFAULT 10 CHECK (current_mana >= 0 AND current_mana <= max_mana),
            max_ki INTEGER DEFAULT 0 CHECK (max_ki >= 0),
            current_ki INTEGER DEFAULT 0 CHECK (current_ki >= 0 AND current_ki <= max_ki),

            -- === Base Stats ===
            stat_might INTEGER DEFAULT 5,
            stat_finesse INTEGER DEFAULT 5,
            stat_wits INTEGER DEFAULT 5,
            stat_grit INTEGER DEFAULT 5,
            stat_charm INTEGER DEFAULT 5,
            stat_fortune INTEGER DEFAULT 5,
            
            -- === Combat Stats ===
            armor_class INTEGER DEFAULT 10,
            crit_chance REAL DEFAULT 0.05 CHECK (crit_chance >= 0.0 AND crit_chance <= 1.0),
            crit_damage_modifier REAL DEFAULT 1.5 CHECK (crit_damage_modifier >= 1.0),  

            -- === Nullable Fields ===
            -- NULL means no trophy is equipped
            active_trophy_id INTEGER,

            -- NULL means has never died
            last_death_timestamp TEXT,
            
            -- === Metadata ===
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(origin_id) REFERENCES origins(id),
            FOREIGN KEY(archetype_id) REFERENCES archetypes(id),
            FOREIGN KEY(active_trophy_id) REFERENCES items(item_id) ON DELETE SET NULL
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS origins (

            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,

            -- e.g., 'might (only storing the name, but in reality, it's +1 starting might)'
            bonus_stat_1 TEXT NOT NULL,

            -- e.g., 'grit (only storing the name, but in reality, it's +1 starting grit)'
            bonus_stat_2 TEXT NOT NULL,

            base_perk_name TEXT,
            base_perk_description TEXT
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS archetypes (

            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            primary_stat_1 TEXT NOT NULL,
            primary_stat_2 TEXT NOT NULL
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS items (

            item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,

            -- Core Categorization

            -- e.g., 'WEAPON', 'ARMOR', 'CONSUMABLE', 'MATERIAL', 'TROPHY', 'EMBLEM', 'LOOTCRATE', 'BLUEPRINT'
            item_type TEXT NOT NULL,

            -- 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'
            rarity TEXT DEFAULT 'COMMON',

            -- Behavioral Flags

            -- Boolean (0 or 1)
            is_stackable INTEGER DEFAULT 1,

            -- Also Boolean (Trophies/Emblems would be a 0)
            is_tradeable INTEGER DEFAULT 1,

            -- Data Fields
            crown_value INTEGER DEFAULT 0,

            -- A flexible field for all item-specific data
            effects_json TEXT CHECK(effects_json IS NULL OR json_valid(effects_json))
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS user_inventory (

            -- Unique ID for this specific item instance
            inventory_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),

            -- It's NULL if the item is just in the inventory.
            -- Examples: 'weapon', 'offhand', 'helmet', 'ring1', 'ring2'
             equipped_slot TEXT
                CHECK (
                    equipped_slot IS NULL OR
                    equipped_slot IN ('weapon','offhand','helmet','chestplate','leggings','boots','ring1','ring2','amulet')
                ),

            -- For unique properties like durability
            instance_data_json TEXT CHECK(instance_data_json IS NULL OR json_valid(instance_data_json)),
            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(item_id)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS abilities (

            ability_id INTEGER PRIMARY KEY AUTOINCREMENT,
            archetype_id INTEGER NOT NULL,
            level_unlocked INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,

            -- 'ACTIVE', 'PASSIVE', 'PINNACLE'
            ability_type TEXT,
            cooldown_seconds INTEGER DEFAULT 0,

            -- e.g., '{"ki": 20}' or '{"mana": 50}'
            cost_json TEXT CHECK(cost_json IS NULL OR json_valid(cost_json)),

            -- e.g., '{"damage": 10, "heal": 5}' or '{"buff": "strength", "duration": 30}'
            effects_json TEXT CHECK(effects_json IS NULL OR json_valid(effects_json)),
            FOREIGN KEY(archetype_id) REFERENCES archetypes(id)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS character_abilities (

            user_id TEXT NOT NULL,
            ability_id INTEGER NOT NULL,
            PRIMARY KEY (user_id, ability_id),
            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(ability_id) REFERENCES abilities(ability_id)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS crafting_recipes (
            recipe_id INTEGER PRIMARY KEY AUTOINCREMENT,

            -- The item this recipe creates
            crafted_item_id INTEGER NOT NULL,

            -- NULL if anyone can craft it
            required_archetype_id INTEGER,
            required_level INTEGER DEFAULT 1 CHECK (required_level >= 1),

            -- e.g., '{"iron_ore_id": 5, "oak_wood_id": 2}'
            reagents_json TEXT NOT NULL CHECK(json_valid(reagents_json)),

            FOREIGN KEY(crafted_item_id) REFERENCES items(item_id),
            FOREIGN KEY(required_archetype_id) REFERENCES archetypes(id)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS quests (

            quest_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,

            -- 'SLAY', 'GATHER', 'CRAFT', 'DELIVER'
            quest_type TEXT,
            required_level INTEGER DEFAULT 1 CHECK (required_level >= 1),
            xp_reward INTEGER,
            crown_reward INTEGER,

            -- e.g., '[{"item_id": 25, "quantity": 3}]'
            item_reward_json TEXT CHECK(item_reward_json IS NULL OR json_valid(item_reward_json))
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS character_quests (

            user_id TEXT NOT NULL,
            quest_id INTEGER NOT NULL,

            -- 'ACTIVE', 'COMPLETED', 'FAILED'
            status TEXT DEFAULT 'ACTIVE',

            -- e.g., '{"goblins_slain": 3, "target": 5}'
            progress_json TEXT CHECK(progress_json IS NULL OR json_valid(progress_json)),
            PRIMARY KEY (user_id, quest_id),
            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(quest_id) REFERENCES quests(quest_id) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS character_status_effects (

            effect_id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_user_id TEXT NOT NULL,

            -- Who applied the effect? (NULL for self-inflicted)
            source_user_id TEXT,

            -- Which ability caused this? (e.g., from the 'abilities' table)
            ability_id INTEGER,

            -- e.g., 'Hunter's Mark', 'Specter of Failure'
            effect_name TEXT NOT NULL,

            -- e.g., '{"stat_change": {"might": 5}, "ac_penalty": -2}'
            effects_json TEXT CHECK(effects_json IS NULL OR json_valid(effects_json)),

            -- ISO timestamp for when the effect wears off
            expires_at TEXT NOT NULL,
            FOREIGN KEY(target_user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(ability_id) REFERENCES abilities(ability_id)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS golems (

            -- Allows for possible multi-golem abilities in the future
            golem_id INTEGER PRIMARY KEY AUTOINCREMENT,

            golem_created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            owner_user_id TEXT,
            golem_name TEXT NOT NULL DEFAULT 'Clockwork Golem',

            -- Basic stats for golem
            level INTEGER DEFAULT 1,
            current_health INTEGER DEFAULT 50,
            max_health INTEGER DEFAULT 50,
            golem_ac INTEGER DEFAULT 12,

            current_energy INTEGER DEFAULT 50,
            max_energy INTEGER DEFAULT 50,

            -- Protocols: 'BASTION', 'SIEGE', 'PROSPECTOR', or 'IDLE'
            active_protocol TEXT NOT NULL DEFAULT 'IDLE',

            -- JSON to store installed parts, e.g., '{"chassis_id": 101, "power_core_id": 203}'
            components_json TEXT CHECK(components_json IS NULL OR json_valid(components_json)),

            FOREIGN KEY(owner_user_id) REFERENCES characters(user_id) ON DELETE CASCADE
    )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS character_bonuses (

            bonus_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,

            -- e.g., the ID for 'Trophy Hunter'
            source_ability_id INTEGER,

            -- 'GUILD', 'BOSS_TYPE', 'MONSTER_RACE'
            target_type TEXT NOT NULL,

            -- The specific target, e.g., the guild's TAG, 'GOBLIN', 'DRAGON'
            target_identifier TEXT NOT NULL,

            -- The bonus itself, e.g., '{"damage_increase": 0.05, "crit_chance_increase": 0.02}'
            bonus_effects_json TEXT CHECK(bonus_effects_json IS NULL OR json_valid(bonus_effects_json)),

            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS monsters (

            monster_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL DEFAULT '',

            -- e.g., 'Goblinoid', 'Undead', 'Elemental'
            monster_race TEXT NOT NULL DEFAULT 'Beast',
            level INTEGER NOT NULL CHECK (level >= 1),

            -- Core Stats
            max_health INTEGER NOT NULL CHECK (max_health >= 1),
            armor_class INTEGER NOT NULL CHECK (armor_class >= 0),
            base_damage INTEGER NOT NULL CHECK (base_damage >= 0),

            -- Special ability IDs from a future 'monster_abilities' table

            -- e.g., '{"on_hit": ["poison_1"], "on_death": ["explode"]}'
            abilities_json TEXT CHECK(abilities_json IS NULL OR json_valid(abilities_json)),
            -- Links to the loot_tables table
            loot_table_id INTEGER,
            xp_reward INTEGER CHECK (xp_reward IS NULL OR xp_reward >= 0),

            FOREIGN KEY(loot_table_id) REFERENCES loot_tables(loot_table_id)
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS bosses (

            boss_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            -- e.g., "The Crown-Hoarding Dragon"
            title TEXT,
            description TEXT NOT NULL DEFAULT '',
            level INTEGER NOT NULL CHECK (level >= 1),

            -- Bosses have more complex stats
            health_pool INTEGER NOT NULL CHECK (health_pool >= 1),
            armor_class INTEGER NOT NULL CHECK (armor_class >= 0),

            -- JSON for different phases, weaknesses, and mechanics

            -- e.g., '{"phase_2_threshold": 0.50, "enrage_timer_ms": 300000, "vulnerabilities": ["fire"]}'
            mechanics_json TEXT CHECK(mechanics_json IS NULL OR json_valid(mechanics_json)),

            -- Special, named attacks
            pinnacle_abilities_json TEXT CHECK(pinnacle_abilities_json IS NULL OR json_valid(pinnacle_abilities_json)),
            loot_table_id INTEGER,

            FOREIGN KEY(loot_table_id) REFERENCES loot_tables(loot_table_id)
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS loot_tables (

            loot_table_id INTEGER PRIMARY KEY AUTOINCREMENT,
            -- e.g., "Goblin Grunt Drops", "Dragon's Hoard"
            name TEXT NOT NULL UNIQUE,
            description TEXT
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS loot_table_entries (

            entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
            loot_table_id INTEGER NOT NULL,

            -- The item that can drop
            item_id INTEGER NOT NULL,

            -- A value from 0.0 to 1.0 (e.g., 0.25 for 25%)
            drop_chance REAL NOT NULL CHECK (drop_chance >= 0.0 AND drop_chance <= 1.0),
            min_quantity INTEGER DEFAULT 1,
            max_quantity INTEGER DEFAULT 1,
            CHECK (min_quantity >= 1 AND max_quantity >= min_quantity),

            FOREIGN KEY(loot_table_id) REFERENCES loot_tables(loot_table_id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(item_id)
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS pve_nodes (

            node_id INTEGER PRIMARY KEY AUTOINCREMENT,

            -- e.g., "Goblin Outpost", "Spider-Infested Cave"
            name TEXT NOT NULL,
            description TEXT,
            required_level INTEGER DEFAULT 1 CHECK (required_level >= 1),

            -- Bonus for the first time clearing it
            first_completion_reward_json TEXT CHECK(first_completion_reward_json IS NULL OR json_valid(first_completion_reward_json)),

            -- Reward for all subsequent clears
            repeatable_reward_json TEXT CHECK(repeatable_reward_json IS NULL OR json_valid(repeatable_reward_json))
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS pve_node_monsters (
            node_id INTEGER NOT NULL,
            monster_id INTEGER NOT NULL,
            count INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (node_id, monster_id),
            FOREIGN KEY(node_id) REFERENCES pve_nodes(node_id) ON DELETE CASCADE,
            FOREIGN KEY(monster_id) REFERENCES monsters(monster_id) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS character_pve_progress (

            user_id TEXT NOT NULL,
            node_id INTEGER NOT NULL,
            times_cleared INTEGER DEFAULT 0,
            last_cleared_at TEXT,
            PRIMARY KEY (user_id, node_id),
            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(node_id) REFERENCES pve_nodes(node_id) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS parties (

            party_id INTEGER PRIMARY KEY AUTOINCREMENT,
            leader_user_id TEXT NOT NULL,
            party_name TEXT,

            -- e.g., 'BOSS_FIGHT', 'DUNGEON_RUN', 'QUESTING'
            objective TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS party_members (

            party_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            joined_at TEXT DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY (party_id, user_id),
            FOREIGN KEY(party_id) REFERENCES parties(party_id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS npc_vendors (

            vendor_id INTEGER PRIMARY KEY AUTOINCREMENT,

            -- "Greg the Gambler", "Bertha the Blacksmith"
            name TEXT NOT NULL UNIQUE,

            -- The channel ID where this vendor "lives"
            location_channel_id TEXT
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS vendor_stock (

            vendor_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,

            -- NULL means infinite stock
            stock_quantity INTEGER,

            -- NULL means this item cannot be bought, only sold to the vendor
            buy_price INTEGER CHECK (buy_price IS NULL OR buy_price >= 0),

            -- NULL means this item cannot be sold to the vendor
            sell_price INTEGER CHECK (sell_price IS NULL OR sell_price >= 0),

            PRIMARY KEY (vendor_id, item_id),
            FOREIGN KEY(vendor_id) REFERENCES npc_vendors(vendor_id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(item_id)
        )
    `).run();


	db.prepare(`
        CREATE TABLE IF NOT EXISTS spells (

            spell_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,

            -- e.g., 'EVOCATION', 'CONJURATION', 'ABJURATION'
            spell_school TEXT,
            required_level INTEGER NOT NULL CHECK (required_level >= 1),
            mana_cost INTEGER NOT NULL DEFAULT 0 CHECK (mana_cost >= 0),

            -- e.g., '[{"item_id": 5, "quantity": 1}]' for a material component
            component_cost_json TEXT CHECK(component_cost_json IS NULL OR json_valid(component_cost_json)),
            effects_json TEXT NOT NULL CHECK(json_valid(effects_json))
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS character_location (

            user_id TEXT PRIMARY KEY,
            -- e.g., 'world', 'whispering_woods', 'goblin_cave_1'
            map_id TEXT NOT NULL,
            -- The coordinates on that specific map
            pos_x INTEGER NOT NULL,
            pos_y INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS rp_events (

            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            host_guild_tag TEXT NOT NULL,
            event_name TEXT NOT NULL,

            -- 'SMALL', 'MEDIUM', 'LARGE'
            event_tier TEXT NOT NULL,

            -- 'ACTIVE', 'COMPLETED', 'CANCELLED'
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,

            -- JSON for requirements, e.g., '{"type": "DONATION", "category": "CRAFTING"}' or '{"type": "COST", "amount": 500}'
            requirements_json TEXT CHECK(requirements_json IS NULL OR json_valid(requirements_json)),

            FOREIGN KEY(host_guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS rp_event_participants (

            event_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,

            -- To log what they donated
            contribution_json TEXT CHECK(contribution_json IS NULL OR json_valid(contribution_json)),

            PRIMARY KEY (event_id, user_id),
            FOREIGN KEY(event_id) REFERENCES rp_events(event_id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_bounties (

            bounty_id INTEGER PRIMARY KEY AUTOINCREMENT,
            placer_guild_tag TEXT NOT NULL,
            target_guild_tag TEXT NOT NULL,
            amount INTEGER NOT NULL,

            -- 'ACTIVE', 'CLAIMED'
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            placed_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(placer_guild_tag) REFERENCES guild_list(guild_tag),
            FOREIGN KEY(target_guild_tag) REFERENCES guild_list(guild_tag)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS trade_sessions (

            session_id INTEGER PRIMARY KEY AUTOINCREMENT,
            initiator_user_id TEXT NOT NULL,
            receiver_user_id TEXT NOT NULL,
            ui_message_id TEXT,

            -- 'PENDING', 'LOCKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'
            status TEXT NOT NULL DEFAULT 'PENDING',
            initiator_locked INTEGER DEFAULT 0,
            receiver_locked INTEGER DEFAULT 0,

            initiator_crown_offer INTEGER NOT NULL DEFAULT 0 CHECK (initiator_crown_offer >= 0),
            receiver_crown_offer INTEGER NOT NULL DEFAULT 0 CHECK (receiver_crown_offer >= 0),

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(initiator_user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(receiver_user_id) REFERENCES characters(user_id) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS trade_session_items (

            -- The specific trade session ID
            session_id INTEGER NOT NULL,

            -- Which user is offering this item/crowns
            user_id TEXT NOT NULL,

            -- The specific instance from their inventory
            inventory_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),


            PRIMARY KEY (session_id, user_id, inventory_id),
            FOREIGN KEY(session_id) REFERENCES trade_sessions(session_id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(inventory_id) REFERENCES user_inventory(inventory_id) ON DELETE CASCADE
        )
    `).run();

	db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_trade_item_ownership_insert
        BEFORE INSERT ON trade_session_items
        FOR EACH ROW
        BEGIN
            SELECT CASE
            WHEN NOT EXISTS (
                SELECT 1 FROM user_inventory
                WHERE inventory_id = NEW.inventory_id AND user_id = NEW.user_id
            )
            THEN RAISE(ABORT, 'Ownership Mismatch: User does not own this inventory item.')
            END;
        END;
    `);

	db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_projects (

            project_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,

            -- JSON listing required item_ids and quantities
            required_materials_json TEXT CHECK(required_materials_json IS NULL OR json_valid(required_materials_json)),

            -- JSON describing the permanent reward, e.g., '{"effect": "VAULT_DEFENSE", "value": 0.01}'
            reward_json TEXT CHECK(reward_json IS NULL OR json_valid(reward_json))
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS active_guild_projects (

            active_project_id INTEGER PRIMARY KEY AUTOINCREMENT,

            -- A guild can only have one active project
            guild_tag TEXT NOT NULL UNIQUE,
            project_id INTEGER NOT NULL,

            -- JSON tracking current donated materials
            progress_json TEXT CHECK(progress_json IS NULL OR json_valid(progress_json)),
            started_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE,
            FOREIGN KEY(project_id) REFERENCES guild_projects(project_id)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS auction_house_listings (

            listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
            seller_user_id TEXT NOT NULL,

            -- The specific item instance being sold
            inventory_id INTEGER NOT NULL UNIQUE,
            item_id INTEGER NOT NULL,
            starting_bid INTEGER,
            buyout_price INTEGER,
            current_bid INTEGER,
            current_bidder_user_id TEXT,
            expires_at TEXT NOT NULL,

            -- 'ACTIVE', 'SOLD', 'EXPIRED'
            status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SOLD','EXPIRED')),

            CHECK (starting_bid IS NULL OR starting_bid > 0),
            CHECK (buyout_price IS NULL OR buyout_price > 0),
            CHECK (current_bid IS NULL OR current_bid >= starting_bid),
            CHECK (buyout_price IS NULL OR starting_bid IS NULL OR buyout_price >= starting_bid),

            FOREIGN KEY(seller_user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(current_bidder_user_id) REFERENCES characters(user_id),
            FOREIGN KEY(inventory_id) REFERENCES user_inventory(inventory_id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(item_id)
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS espionage_missions (

            mission_id INTEGER PRIMARY KEY AUTOINCREMENT,
            saboteur_user_id TEXT NOT NULL,
            target_guild_tag TEXT NOT NULL,

            -- e.g., 'INFILTRATE_CHANNEL', 'VIEW_VAULT'
            mission_type TEXT NOT NULL,

            -- 'IN_PROGRESS', 'SUCCESS', 'FAILED'
            status TEXT NOT NULL DEFAULT 'IN_PROGRESS',

            -- When the mission ends or the effect wears off
            expires_at TEXT NOT NULL,

            FOREIGN KEY(saboteur_user_id) REFERENCES characters(user_id) ON DELETE CASCADE,
            FOREIGN KEY(target_guild_tag) REFERENCES guild_list(guild_tag) ON DELETE CASCADE
        )
    `).run();

	db.prepare(`
        CREATE TABLE IF NOT EXISTS dungeon_instances (

            instance_id INTEGER PRIMARY KEY AUTOINCREMENT,

            -- Only one instance per party
            party_id INTEGER NOT NULL UNIQUE,

            -- e.g., 'goblin_cave'
            map_id TEXT NOT NULL,

            -- e.g., the channel_id of the current room
            current_room TEXT,

            -- 'ACTIVE', 'COMPLETED'
            status TEXT NOT NULL DEFAULT 'ACTIVE',

            FOREIGN KEY(party_id) REFERENCES parties(party_id) ON DELETE CASCADE
        )
    `).run();

	/*
    Table to copy/paste for blank template:

	db.prepare(`

    `).run();
    */


	//  Dynamic configuration keypair settings

	db.prepare(`
		CREATE TABLE IF NOT EXISTS bot_settings (
			setting_key TEXT PRIMARY KEY,
			setting_value TEXT NOT NULL
		)
	`).run();

	// Initialize any default settings that should exist
	db.prepare(`
		INSERT OR IGNORE INTO bot_settings (setting_key, setting_value)
		VALUES (?, ?)
	`).run('dev_disable_reminders', 'false');
	db.prepare('INSERT OR IGNORE INTO tony_quotes_global_cooldown (id, last_triggered_at) VALUES (1, NULL)').run();
	db.prepare('INSERT OR IGNORE INTO tony_idle_chatter_state (id, next_chatter_time) VALUES (1, NULL)').run();
	db.prepare('INSERT OR IGNORE INTO game_jackpot (id, amount) VALUES (1, ?)').run(JACKPOT_BASE_AMOUNT);


	// indexes for faster recall
	db.prepare('CREATE INDEX IF NOT EXISTS idx_welcome_claims ON welcome_messages(welcome_time)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_guild_emojis_tag ON guild_emojis(guild_tag)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_motw_active ON motw_giveaways(completed, end_time)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_fundraiser_guild ON guild_fundraisers(guild_tag, completed)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_raid_history ON raid_history(attacker_tag, defender_tag, timestamp)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_guild_stickers_tag ON guild_stickers(guild_tag)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_raid_allies ON active_raid_allies(raid_id)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_temp_roles_expiry ON temp_roles(expiry_time)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_tony_quotes_type ON tony_quotes_active(quote_type, user_id)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_tony_quotes_by_user ON tony_quotes_active(user_id, quote_type, trigger_word)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_tqa_archive_lookup ON tony_quotes_archive(quote_type, trigger_word, archived_at)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_tony_quotes_trigger_by_type ON tony_quotes_active(quote_type, trigger_word)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_relationships_one ON guild_relationships(guild_one_tag)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_relationships_two ON guild_relationships(guild_two_tag)').run();

	db.prepare('CREATE INDEX IF NOT EXISTS idx_loot_entries_table ON loot_table_entries(loot_table_id)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_auction_status_expiry ON auction_house_listings(status, expires_at)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_inv_user_item ON user_inventory(user_id, item_id)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_trade_items_session ON trade_session_items(session_id)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_vendor_stock_vendor ON vendor_stock(vendor_id)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_pve_progress_user ON character_pve_progress(user_id)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_node_monsters_node ON pve_node_monsters(node_id)').run();

	// All of the unique indexes
	// NOTE: Uniqueness for quotes is GLOBAL, not per-user. The same quote/trigger cannot exist twice
	// on the server, regardless of who submitted it.


	// Pre-clean duplicates to avoid failures when creating unique indexes.

	/**
     * Archive and remove duplicates within a table for a given quote_type.
     * Keeps the smallest id per normalized group.
     * @param {'tony_quotes_active'|'tony_quotes_pending'} table
     * @param {'trigger'|'idle'} type
     * @param {string} groupBy SQL expression used in GROUP BY (pre-validated)
     */
	const cleanupAndLog = (table, type, groupBy) => {
		if (!['tony_quotes_active', 'tony_quotes_pending'].includes(table)) throw new Error('Invalid table');
		if (!['trigger', 'idle'].includes(type)) throw new Error('Invalid type');
		const allowedGroupBys = new Set([
			'LOWER(TRIM(trigger_word)), LOWER(TRIM(quote_text))',
			'LOWER(TRIM(quote_text))',
		]);
		if (!allowedGroupBys.has(groupBy)) throw new Error('Invalid groupBy');
		const whereClause = `quote_type = '${type}'`;
		const subQuery = `SELECT MIN(id) FROM ${table} WHERE ${whereClause} GROUP BY ${groupBy}`;

		db.transaction(() => {
			// 1. Archive duplicates before deleting
			db.prepare(`
                INSERT INTO tony_quotes_archive (id, source_table, trigger_word, quote_text, user_id, approval_message_id, submitted_at, quote_type, reason)
                SELECT id, '${table === 'tony_quotes_pending' ? 'pending' : 'active'}', trigger_word, quote_text, user_id, ${table === 'tony_quotes_pending' ? 'approval_message_id' : 'NULL'}, ${table === 'tony_quotes_pending' ? 'submitted_at' : 'NULL'}, quote_type, 'duplicate_cleanup'
                FROM ${table}
                WHERE ${whereClause} AND id NOT IN (${subQuery})
            `).run();

			// 2. Delete the duplicates and capture the number of changes
			const result = db.prepare(`
                DELETE FROM ${table}
                WHERE ${whereClause} AND id NOT IN (${subQuery})
            `).run();

			if (result.changes > 0) {
				console.log(`[DB Cleanup] Archived and removed ${result.changes} duplicate quotes from ${table} (type: ${type}).`);
			}
		})();
	};

	// Perform cleanup for all 4 unique index types
	// The values for table, type, and groupBy are hardcoded. They are not, and can never be, supplied by a user.
	cleanupAndLog('tony_quotes_active', 'trigger', 'LOWER(TRIM(trigger_word)), LOWER(TRIM(quote_text))');
	cleanupAndLog('tony_quotes_active', 'idle', 'LOWER(TRIM(quote_text))');
	cleanupAndLog('tony_quotes_pending', 'trigger', 'LOWER(TRIM(trigger_word)), LOWER(TRIM(quote_text))');
	cleanupAndLog('tony_quotes_pending', 'idle', 'LOWER(TRIM(quote_text))');


	db.prepare(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_tqa_trigger
        ON tony_quotes_active(LOWER(TRIM(trigger_word)), LOWER(TRIM(quote_text)))
		WHERE quote_type = 'trigger'
	`).run();
	db.prepare(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_tqa_idle
		ON tony_quotes_active(LOWER(TRIM(quote_text)))
		WHERE quote_type = 'idle'
	`).run();
	db.prepare(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_tqp_trigger
		ON tony_quotes_pending(LOWER(TRIM(trigger_word)), LOWER(TRIM(quote_text)))
		WHERE quote_type = 'trigger'
	`).run();
	db.prepare(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_tqp_idle
		ON tony_quotes_pending(LOWER(TRIM(quote_text)))
		WHERE quote_type = 'idle'
	`).run();
	db.prepare(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_user_inventory_equipped_slot
		ON user_inventory(user_id, equipped_slot)
		WHERE equipped_slot IS NOT NULL
	`).run();

});

setupTables();

module.exports = db;
module.exports.JACKPOT_BASE_AMOUNT = JACKPOT_BASE_AMOUNT;