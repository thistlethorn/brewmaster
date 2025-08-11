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

	//  Dynamic configuration keypair settings
	//
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

});

setupTables();

module.exports = db;
module.exports.JACKPOT_BASE_AMOUNT = JACKPOT_BASE_AMOUNT;