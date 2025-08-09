const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'bump_data.db'));

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
            amount INTEGER DEFAULT 2000
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

	// indexes for faster recall
	db.prepare('CREATE INDEX IF NOT EXISTS idx_welcome_claims ON welcome_messages(welcome_time)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_guild_emojis_tag ON guild_emojis(guild_tag)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_motw_active ON motw_giveaways(completed, end_time)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_fundraiser_guild ON guild_fundraisers(guild_tag, completed)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_raid_history ON raid_history(attacker_tag, defender_tag, timestamp)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_guild_stickers_tag ON guild_stickers(guild_tag)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_raid_allies ON active_raid_allies(raid_id)').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_temp_roles_expiry ON temp_roles(expiry_time)').run();


	// Initialize the jackpot if it doesn't exist
	db.prepare('INSERT OR IGNORE INTO game_jackpot (id, amount) VALUES (1, 5000)').run();


});

setupTables();


db.pragma('journal_mode = WAL');
module.exports = db;