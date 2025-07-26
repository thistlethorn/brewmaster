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

try {
	db.pragma('foreign_keys = ON;');
	console.log('[database] Foreign key support is enabled via PRAGMA.');
}
catch (error) {
	console.log('[database] This instance of SQLite/better-sqlite3 does not support foreign keys or has failed initializing. ' + error);
}

try {
	// Migration for raid_history table to add alliance tracking
	const historyCols = db.prepare('PRAGMA table_info(raid_history)').all();
	if (!historyCols.some(col => col.name === 'attacker_allies')) {
		db.prepare('ALTER TABLE raid_history ADD COLUMN attacker_allies TEXT').run();
		console.log('[Database Migration] Added attacker_allies to raid_history.');
	}
	if (!historyCols.some(col => col.name === 'defender_allies')) {
		db.prepare('ALTER TABLE raid_history ADD COLUMN defender_allies TEXT').run();
		console.log('[Database Migration] Added defender_allies to raid_history.');
	}
	// Rename defender_roll to defender_ac for clarity
	if (historyCols.some(col => col.name === 'defender_roll')) {
		db.prepare('ALTER TABLE raid_history RENAME COLUMN defender_roll TO defender_ac').run();
		console.log('[Database Migration] Renamed defender_roll to defender_ac in raid_history.');
	}


	// Migration for raid_cooldowns table
	const cooldownsCols = db.prepare('PRAGMA table_info(raid_cooldowns)').all();
	if (!cooldownsCols.some(col => col.name === 'is_under_raid')) {
		db.prepare('ALTER TABLE raid_cooldowns ADD COLUMN is_under_raid INTEGER DEFAULT 0').run();
		console.log('[Database Migration] Added is_under_raid to raid_cooldowns.');
	}
}
catch (error) {
	console.error('[Database Migration] Error altering raid_history or raid_cooldowns:', error);
}


try {
	console.log('[Database Migration] Checking for guild_list schema updates...');
	const columns = db.prepare('PRAGMA table_info(guild_list)').all();
	const hasPublicChannelId = columns.some(col => col.name === 'public_channel_id');

	// Add the column if it doesn't exist
	if (!hasPublicChannelId) {
		console.log('[Database Migration] Column "public_channel_id" not found. Altering table...');
		db.prepare('ALTER TABLE guild_list ADD COLUMN public_channel_id TEXT').run();
		console.log('[Database Migration] Table "guild_list" altered successfully.');
	}
	else {
		console.log('[Database Migration] Column "public_channel_id" already exists. Skipping alteration.');
	}

	// Run the backfill logic now, the column is guaranteed to exist.
	const backfillData = [
		{ tag: 'FUN', public_id: '1396220445593829617' },
		{ tag: 'RIC', public_id: '1396220670249013358' },
		{ tag: 'RIP', public_id: '1396220991147085996' },
		{ tag: 'RYE', public_id: '1396220567534833674' },
		{ tag: 'HMC', public_id: '1396220926634361053' },
		{ tag: 'MHA', public_id: '1396221209783566416' },
		{ tag: 'GRG', public_id: '1396221315979018252' },
	];

	const updateStmt = db.prepare('UPDATE guild_list SET public_channel_id = ? WHERE guild_tag = ? AND public_channel_id IS NULL');

	const backfillTransaction = db.transaction(() => {
		let updatedCount = 0;
		for (const item of backfillData) {
			const result = updateStmt.run(item.public_id, item.tag);
			if (result.changes > 0) {
				updatedCount++;
			}
		}
		if (updatedCount > 0) {
			console.log(`[Database Backfill] Successfully backfilled public_channel_id for ${updatedCount} guilds.`);
		}
		else {
			console.log('[Database Backfill] All existing guilds already have a public_channel_id. No backfill needed.');
		}
	});

	// Run the transaction as a whole
	backfillTransaction();

}
catch (error) {
	console.error('[Database Migration/Backfill] An error occurred:', error);
}

try {
	console.log('[Database Migration] Checking for guild_list schema updates for lore/hook...');
	const columns = db.prepare('PRAGMA table_info(guild_list)').all();

	if (!columns.some(col => col.name === 'lore')) {
		db.prepare('ALTER TABLE guild_list ADD COLUMN lore TEXT DEFAULT \'\'').run();
		console.log('[Database Migration] Added "lore" column to guild_list.');
	}

	if (!columns.some(col => col.name === 'hook')) {
		db.prepare('ALTER TABLE guild_list ADD COLUMN hook TEXT DEFAULT \'\'').run();
		console.log('[Database Migration] Added "hook" column to guild_list.');
	}
}
catch (error) {
	console.error('[Database Migration] Error altering guild_list for lore/hook:', error);
}
try {
	console.log('[Database Migration] Checking for deprecated "about_text" column...');
	const columns = db.prepare('PRAGMA table_info(guild_list)').all();
	const hasAboutText = columns.some(col => col.name === 'about_text');

	if (hasAboutText) {
		console.log('[Database Migration] "about_text" column found. Beginning migration to "lore".');

		// Temporarily disable foreign keys to allow table recreation
		db.pragma('foreign_keys = OFF');

		const migration = db.transaction(() => {
			// Step 1: Backfill any empty 'lore' fields with data from 'about_text'.
			const backfillResult = db.prepare(`
                UPDATE guild_list 
                SET lore = about_text 
                WHERE (lore IS NULL OR lore = '') AND about_text IS NOT NULL AND about_text != ''
            `).run();
			console.log(`[Database Migration] Backfilled lore for ${backfillResult.changes} guilds.`);

			// Step 2: Re-create the table without the 'about_text' column.
			db.prepare('ALTER TABLE guild_list RENAME TO temp_guild_list').run();
			console.log('[Database Migration] Renamed original table.');

			// Create the new table with the final schema.
			db.prepare(`
                CREATE TABLE guild_list (
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
			console.log('[Database Migration] Created new table schema.');

			// Step 3: Copy the data from the old table to the new one.
			db.prepare(`
                INSERT INTO guild_list (guild_name, guild_tag, channel_id, public_channel_id, role_id, is_open, motto, hook, lore, created_at, guildmember_title)
                SELECT guild_name, guild_tag, channel_id, public_channel_id, role_id, is_open, motto, hook, lore, created_at, guildmember_title
                FROM temp_guild_list
            `).run();
			console.log('[Database Migration] Copied data to new table.');

			// Step 4: Drop the temporary old table.
			db.prepare('DROP TABLE temp_guild_list').run();
			console.log('[Database Migration] Dropped temporary table. Migration complete.');
		});

		migration();

		// Re-enable foreign keys
		db.pragma('foreign_keys = ON');
		console.log('[Database Migration] Foreign keys re-enabled.');

	}
	else {
		console.log('[Database Migration] "about_text" column not found. No migration needed.');
	}
}
catch (error) {
	console.error('[Database Migration] CRITICAL ERROR during about_text -> lore migration:', error);
	// Always try to re-enable foreign keys in case of an error
	db.pragma('foreign_keys = ON');
}
const raidNum = 18;
const defendingGuildTag = 'FUN';
const attackingGuildTag = 'RIP';
const overrideCheck = false;
try {
	console.log(`[Database Migration] Checking for and attempting to fix bugged raid ID ${raidNum}...`);
	const buggedRaid = db
		.prepare('SELECT id FROM raid_history WHERE id = ? AND success = -1')
		.get(raidNum);
	if (buggedRaid || overrideCheck) {
		const migrationTransaction = db.transaction(() => {
			// Step 1: Clean up the orphaned alliance entries.
			const allyDeletionResult = db
				.prepare('DELETE FROM active_raid_allies WHERE raid_id = ?')
				.run(raidNum);
			console.log(
				`[Migration] Deleted ${allyDeletionResult.changes} orphaned entries from active_raid_allies.`,
			);

			// Step 2: Remove the bugged raid history record.
			const historyDeletionResult = db
				.prepare('DELETE FROM raid_history WHERE id = ?')
				.run(raidNum);
			console.log(
				`[Migration] Deleted ${historyDeletionResult.changes} bugged record from raid_history.`,
			);

			// Step 3: Unlock the defender's guild.
			db
				.prepare(
					'UPDATE raid_cooldowns SET is_under_raid = 0 WHERE guild_tag = ? AND is_under_raid = 1',
				)
				.run(defendingGuildTag);
			console.log(
				`[Migration] Unlocked the '${defendingGuildTag}' guild by resetting its is_under_raid flag.`,
			);

			db
				.prepare(
					'UPDATE raid_cooldowns SET shield_expiry = NULL WHERE guild_tag = ?',
				)
				.run(defendingGuildTag);
			console.log(
				`[Migration] Turned off the shield for the '${defendingGuildTag}' guild.`,
			);

			// Step 4: (NEW) Remove the unfair raid cooldown for the attacker.
			const cooldownResetResult = db
				.prepare(
					'UPDATE raid_cooldowns SET last_raid_time = NULL WHERE guild_tag = ?',
				)
				.run(attackingGuildTag);
			if (cooldownResetResult.changes > 0) {
				console.log(
					`[Migration] Successfully removed the unfair raid cooldown for '${attackingGuildTag}'.`,
				);
			}
		});

		migrationTransaction();
		console.log(
			`[Database Migration] Successfully reversed and cleaned up all aspects of bugged raid ID ${raidNum}.`,
		);
	}
	else {
		console.log(
			`[Database Migration] Bugged raid ID ${raidNum} not found or already fixed. No action taken.`,
		);
	}
}
catch (error) {
	console.error(
		`[Database Migration] CRITICAL ERROR while trying to fix bugged raid ID ${raidNum}:`,
		error,
	);
}

db.pragma('journal_mode = WAL');
module.exports = db;