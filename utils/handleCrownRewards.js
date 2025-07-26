const db = require('../database');

module.exports = {
	calculateBumpReward: (userId, guild, streakInfo) => {
		// Base rewards for different streak tiers
		const baseRewards = {
			normal: 5,
			blazing: 20,
			unstoppable: 80,
			legendary: 320,
		};

		// Streak break bonuses
		const streakBreakBonuses = {
			normal: 10,
			blazing: 40,
			unstoppable: 160,
			legendary: 640,
		};

		// Determine current streak tier
		let currentTier = 'normal';
		if (streakInfo.currentStreak >= 12) currentTier = 'legendary';
		else if (streakInfo.currentStreak >= 7) currentTier = 'unstoppable';
		else if (streakInfo.currentStreak >= 3) currentTier = 'blazing';

		// Calculate base reward
		let reward = baseRewards[currentTier];

		// Add streak break bonus if applicable
		if (streakInfo.brokeStreak) {
			reward += streakBreakBonuses[streakInfo.brokenTier];
		}

		// Get multiplier from database
		const userEcon = db.prepare('SELECT multiplier FROM user_economy WHERE user_id = ?').get(userId);
		const multiplier = userEcon?.multiplier || 1.0;

		// Apply multiplier
		reward = Math.floor(reward * multiplier);

		return {
			amount: reward,
			streakTier: currentTier,
			brokeStreak: streakInfo.brokeStreak,
			brokenTier: streakInfo.brokenTier,
			multiplierUsed: multiplier,
		};
	},

	updateMultiplier: async (userId, guild) => {
		const member = await guild.members.fetch(userId).catch(() => null);
		if (!member) return 1.0;

		// Check multipliers in order of priority
		// 4.0X - Successful Raid Defender
		let multiplier = 1.0;
		if (member.roles.cache.has('1387473320093548724')) {
			multiplier = 4.0;
		}
		// 3.0X - Member of the Week
		else if (member.roles.cache.has('1363537152658378793')) {
			multiplier = 3.0;
		}
		// 2.5X - Previous Top Bumper
		else if (member.roles.cache.has('1382828074789503128')) {
			multiplier = 2.5;
		}
		// 2.0X - Active Chatter
		else if (member.roles.cache.has('1382521995656302632')) {
			multiplier = 2.0;
		}
		// 1.5X - Booster/Staff/Partner
		else if (
		    // Booster
			member.roles.cache.has('1356771542025113600') ||
			// Staff
            member.roles.cache.has('1354145856345083914') ||
			// Partner
            member.roles.cache.has('1362227763758628976')
		) {
			multiplier = 1.5;
		}

		// Update database with new multiplier
		db.prepare(`
            INSERT INTO user_economy (user_id, multiplier)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET multiplier = ?
        `).run(userId, multiplier, multiplier);

		return multiplier;
	},
};