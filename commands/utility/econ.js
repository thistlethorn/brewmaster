const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, MessageFlags, ButtonStyle } = require('discord.js');
const db = require('../../database');
const { updateMultiplier } = require('../../utils/handleCrownRewards');
const { scheduleDailyReminder } = require('../../tasks/dailyReminder');
const { getTierData } = require('../../utils/getTierBenefits');
const { ONLY_CRESTS } = require('../../utils/emoji');


module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('econ')
		.setDescription('Manage your Crowns economy')
		.addSubcommand(subcommand =>
			subcommand
				.setName('daily')
				.setDescription('Claim your daily Crowns!'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('pay')
				.setDescription('Pay Crowns to another user!')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('User to pay')
						.setRequired(true))
				.addIntegerOption(option =>
					option.setName('amount')
						.setDescription('Amount of Crowns to pay')
						.setRequired(true)
						.setMinValue(1)))
		.addSubcommandGroup(subcommandGroup =>
			subcommandGroup
				.setName('dev')
				.setDescription('Economy Developer Commands - Restricted')
				.addSubcommand(subcommand =>
					subcommand
						.setName('add')
						.setDescription('Give Crowns to a user')
						.addUserOption(option =>
							option.setName('user')
								.setDescription('Target user')
								.setRequired(true))
						.addIntegerOption(option =>
							option.setName('amount')
								.setDescription('Amount of Crowns to adjust')
								.setRequired(true))
						.addStringOption(option =>
							option.setName('reason')
								.setDescription('Reason for payout')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('remove')
						.setDescription('Remove Crowns from a user')
						.addUserOption(option =>
							option.setName('user')
								.setDescription('Target user')
								.setRequired(true))
						.addIntegerOption(option =>
							option.setName('amount')
								.setDescription('Amount of Crowns to adjust')
								.setRequired(true))
						.addStringOption(option =>
							option.setName('reason')
								.setDescription('Reason for payout')
								.setRequired(true))))
		.addSubcommandGroup(subcommandGroup =>
			subcommandGroup
				.setName('balance')
				.setDescription('Check Crown balances!')
				.addSubcommand(subcommand =>
					subcommand
						.setName('self')
						.setDescription('Check your own Crown balance!'))
				.addSubcommand(subcommand =>
					subcommand
						.setName('user')
						.setDescription('Check another user\'s Crown balance!')
						.addUserOption(option =>
							option.setName('target')
								.setDescription('The user to check')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('leaderboard')
						.setDescription('View the Crown & Guild Tier leaderboard!'))),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const subcommandGroup = interaction.options.getSubcommandGroup();

		if (subcommandGroup === 'balance') {
			if (subcommand === 'self') {
				await handleBalance(interaction, interaction.user);
			}
			else if (subcommand === 'user') {
				await handleBalance(interaction, interaction.options.getUser('target'));
			}
			else if (subcommand === 'leaderboard') {
				await handleBalanceLeaderboard(interaction);
			}
		}
		else if (subcommandGroup === 'dev') {
			const user = interaction.options.getUser('user');
			const amount = interaction.options.getInteger('amount');
			if (subcommand === 'add') {
				await handleDevAdd(interaction, user, amount);
			}
			else if (subcommand === 'remove') {
				await handleDevRemove(interaction, user, amount);
			}
		}
		else if (subcommand === 'daily') {
			await handleDaily(interaction);
		}
		else if (subcommand === 'pay') {
			await handlePay(interaction);
		}
	},
};
async function handleDevAdd(interaction, user, amount) {
	const userId = user.id;
	const userEcon = db.prepare('SELECT * FROM user_economy WHERE user_id = ?').get(userId);
	const reason = interaction.options.getString('reason');

	db.prepare(`
        INSERT INTO user_economy (user_id, crowns)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            crowns = crowns + ?
    `).run(userId, amount, amount);

	const embed = new EmbedBuilder()
		.setColor(0x9B59B6)
		.setTitle('✅ Successfully __Added__ Crowns - Crown Payments/Adjustments')
		.setThumbnail(user.displayAvatarURL())
		.addFields(
			{
				name: 'Member:',
				value: `${user}`,
				inline: true,
			},
			{
				name: 'Amount Paid:',
				value: `👑 ${amount}`,
				inline: true,
			},
			{
				name: 'Original Crown balance:',
				value: `${userEcon?.crowns || 0 >= 1 ? `${userEcon.crowns} Crowns` : '0 Crowns'}`,
				inline: false,
			},
			{
				name: '💰 **NEW** Crown Balance:',
				value: `${(userEcon?.crowns || 0) + amount} Crowns`,
				inline: false,
			},
			{
				name: 'Reason/Invoice for Brewmaster Payout:',
				value: `${reason}`,
				inline: false,
			},
		);

	await interaction.reply({ embeds: [embed] });
}
async function handleDevRemove(interaction, user, amount) {
	const reason = interaction.options.getString('reason');

	const userId = user.id;
	const userEcon = db.prepare('SELECT * FROM user_economy WHERE user_id = ?').get(userId);
	const correctedAmount = amount >= userEcon?.crowns || 0 ? 0 : userEcon.crowns - amount;
	if (amount == 0 || userEcon.crowns == 0) {
		const text = amount == 0 ? 'Remove 0 Crowns' : 'Go Below 0 Crowns';
		const embed = new EmbedBuilder()
			.setColor(0x9B59B6)
			.setThumbnail(user.displayAvatarURL())
			.setTitle(`❌ Failure, Cannot ${text} - Crown Payments/Adjustments`)
			.addFields(
				{
					name: 'Member:',
					value: `${user}`,
					inline: false,
				},
				{
					name: '👑 Current Crown balance:',
					value: `${userEcon?.crowns || 0} Crowns`,
					inline: false,
				},
			);

		await interaction.reply({ embeds: [embed] });
	}
	else {
		db.prepare(`
			INSERT INTO user_economy (user_id, crowns)
			VALUES (?, ?)
			ON CONFLICT(user_id) DO UPDATE SET
				crowns = ?
		`).run(userId, correctedAmount, correctedAmount);

		const embed = new EmbedBuilder()
			.setColor(0x9B59B6)
			.setTitle('✅ Successfully __Removed__ Crowns - Crown Payments/Adjustments')
			.setThumbnail(user.displayAvatarURL())
			.addFields(
				{
					name: 'Member:',
					value: `${user}`,
					inline: true,
				},
				{
					name: 'Amount Taken:',
					value: `👑 ${amount}`,
					inline: true,
				},
				{
					name: 'Original Crown balance:',
					value: `${userEcon?.crowns || 0 >= 1 ? `${userEcon.crowns} Crowns` : '0 Crowns'}`,
					inline: false,
				},
				{
					name: '👑 **NEW** Crown Balance:',
					value: `${correctedAmount} Crowns`,
					inline: false,
				},
				{
					name: 'Reason/Invoice for Brewmaster Payout:',
					value: `${reason}`,
					inline: false,
				},
			);

		await interaction.reply({ embeds: [embed] });
	}
}

/**
 * Calculates the cumulative daily streak bonus based on brackets.
 * @param {number} streak The current day streak (1-21).
 * @returns {number} The total accumulated bonus for that streak.
 */
function calculateDayBonus(streak) {
	if (streak <= 0) return 0;
	// Days 1-7 give +1 each
	// Days 8-14 give +3 each
	// Days 15-21 give +7 each
	const brackets = [
		{ days: 7, bonus: 1 },
		{ days: 7, bonus: 3 },
		{ days: 7, bonus: 7 },
	];

	let totalBonus = 0;
	let daysRemaining = streak;

	for (const bracket of brackets) {
		if (daysRemaining <= 0) break;

		// Calculate how many days of the streak fall into the current bracket
		const daysInThisBracket = Math.min(daysRemaining, bracket.days);
		totalBonus += daysInThisBracket * bracket.bonus;
		daysRemaining -= daysInThisBracket;
	}

	return totalBonus;
}

async function handleDaily(interaction) {
	const userId = interaction.user.id;
	const now = new Date();
	const nowIso = now.toISOString();

	const userEcon = db.prepare('SELECT * FROM user_economy WHERE user_id = ?').get(userId);

	// --- STREAK & PRESTIGE LOGIC ---
	let currentStreak = userEcon?.daily_streak || 0;
	let currentPrestige = userEcon?.daily_prestige || 0;
	let streakBroken = false;

	if (userEcon?.last_daily) {
		const lastDaily = new Date(userEcon.last_daily);
		const hoursSinceLastDaily = (now - lastDaily) / (1000 * 60 * 60);

		// Streak is checked here, but the 24h cooldown is handled by the database write.
		if (hoursSinceLastDaily < 48 && hoursSinceLastDaily >= 24) {
			currentStreak++;
			// Streak continues
		}
		else if (hoursSinceLastDaily >= 48) {
			currentStreak = 1;
			streakBroken = true;
		}
		// If < 24h, the DB will prevent the claim, so we don't need an `else`.
	}
	else {
		// First-ever daily claim
		currentStreak = 1;
	}

	let prestigedThisClaim = false;
	if (currentStreak > 21) {
		currentPrestige++;
		currentStreak = 1;
		prestigedThisClaim = true;
	}

	// --- BONUS & PAYOUT CALCULATIONS ---
	const baseAmount = 20;
	const guildInfo = db.prepare('SELECT gt.tier FROM guildmember_tracking gmt JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag WHERE gmt.user_id = ?').get(userId);
	const guildBonus = guildInfo ? guildInfo.tier * 5 : 0;
	const prestigeBonus = currentPrestige * 10;
	const streakBonus = calculateDayBonus(currentStreak);
	const totalBase = baseAmount + guildBonus + prestigeBonus + streakBonus;
	const multiplier = await updateMultiplier(userId, interaction.guild);
	const payout = Math.floor(totalBase * multiplier);

	// --- ATOMIC DATABASE UPDATE ---
	// This statement attempts to INSERT a new record, but if a user_id already exists (ON CONFLICT),
	// it will instead try to UPDATE. The UPDATE only succeeds if the WHERE condition is met,
	// making the cooldown check atomic.
	const stmt = db.prepare(`
        INSERT INTO user_economy (user_id, crowns, last_daily, multiplier, daily_streak, daily_prestige)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            crowns = crowns + ?,
            last_daily = ?,
            multiplier = ?,
            daily_streak = ?,
            daily_prestige = ?
        WHERE (strftime('%s', ?) - strftime('%s', user_economy.last_daily)) >= 86400
    `);

	const info = stmt.run(
		// For INSERT
		userId, payout, nowIso, multiplier, currentStreak, currentPrestige,
		// For UPDATE
		payout, nowIso, multiplier, currentStreak, currentPrestige,
		// For the WHERE clause
		nowIso,

	);

	// --- HANDLE FAILED CLAIM (COOLDOWN) ---
	if (info.changes === 0 && userEcon) {
		const lastDaily = new Date(userEcon.last_daily);
		const nextDaily = new Date(lastDaily.getTime() + 24 * 60 * 60 * 1000);
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle('❌ Not so fast, adventurer!')
			.addFields({
				name: 'You\'ve already claimed your daily income.',
				value: `Your next claim is available <t:${Math.floor(nextDaily.getTime() / 1000)}:R>.`,
			});
		return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
	}

	// --- HANDLE SUCCESSFUL CLAIM ---
	const newBalance = (userEcon?.crowns || 0) + payout;
	const daysNeededForNextPrestige = 22 - currentStreak;
	const prestigeText = currentPrestige > 0 ? ` [Prestige ${currentPrestige}]` : '';
	let streakFooter;

	if (prestigedThisClaim) {
		streakFooter = `⭐ You've reached Prestige ${currentPrestige}! Your streak resets to Day 1 with new power!`;
	}
	else if (streakBroken) {
		streakFooter = 'Your streak was broken! You are back to Day 1.';
	}
	else if (currentStreak > 1) {
		streakFooter = `You are on a ${currentStreak}-day streak at Prestige ${currentPrestige}, and ${daysNeededForNextPrestige} days more until next Prestige! Keep it up! 🔥`;
	}
	else {
		streakFooter = 'You claimed your first daily! Claim again tomorrow to start a streak!';
	}

	const embed = new EmbedBuilder()
		.setColor(0xF1C40F)
		.setTitle(`💰 Daily Claim - Day ${currentStreak}${prestigeText} 💰`)
		.addFields(
			{ name: 'Breakdown:', value: `• Base: \`20 👑\`\n• Guild Bonus: \`${guildBonus} 👑\`\n• Prestige Level Bonus: \`${prestigeBonus} 👑\`\n• Daily Streak Bonus: \`${streakBonus} 👑\`\n${multiplier > 1.0 ? `• **Multiplier: ${multiplier}x**` : ''}`, inline: false },
			{ name: '🎉 Total Received:', value: `**${payout.toLocaleString()}** Crowns!`, inline: false },
			{ name: '👑 New Balance:', value: `**${newBalance.toLocaleString()}** Crowns`, inline: false },
		)
		.setFooter({ text: streakFooter });

	// --- NOTIFICATION OPT-IN LOGIC ---
	const pingPref = db.prepare('SELECT opt_in_status FROM daily_ping_preferences WHERE user_id = ?').get(userId);
	const components = [];

	if (!pingPref || pingPref.opt_in_status === 0) {
		const row = new ActionRowBuilder()
			.addComponents(
				new ButtonBuilder()
					.setCustomId(`daily_notify_opt_in_${userId}`)
					.setLabel('Notify Me When Ready!')
					.setStyle(ButtonStyle.Success)
					.setEmoji('🔔'),
				new ButtonBuilder()
					.setCustomId(`daily_notify_opt_out_${userId}`)
					.setLabel('Don\'t Ask Again')
					.setStyle(ButtonStyle.Secondary),
			);
		components.push(row);
		embed.setFooter({ text: `${streakFooter}\nWant a reminder when your next daily is ready?` });
	}
	else if (pingPref.opt_in_status === 1) {
		scheduleDailyReminder(interaction.client, userId, now);
	}

	await interaction.reply({ embeds: [embed], components: components });
}

async function handlePay(interaction) {
	const senderId = interaction.user.id;
	const recipient = interaction.options.getUser('user');
	const amount = interaction.options.getInteger('amount');

	if (recipient.bot) {
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle('❌ Failed to Send Crowns!')
			.addFields(
				{
					name: '🤖 You can\'t pay bots!',
					value: 'Make sure the user you are attempting to send this to isn\'t an application!',
					inline: false,
				},
			);
		return interaction.reply({ embeds: [embed] });
	}

	if (senderId === recipient.id) {
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle('❌ Failed to Send Crowns!')
			.addFields(
				{
					name: '🪞 You can\'t pay yourself!',
					value: 'Make sure the user you are attempting to send this to someone else!',
					inline: false,
				},
			);
		return interaction.reply({ embeds: [embed] });
	}

	// Get sender's balance
	const senderEcon = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(senderId);
	const senderBalance = senderEcon?.crowns || 0;

	if (senderBalance < amount) {
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle('❌ Failed to Send Crowns!')
			.addFields(
				{
					name: '💸 You can\'t send more Crowns than you have!',
					value: `To pay ${amount} Crowns to ${recipient}, you'd need **${(amount - senderBalance)}** more Crowns!`,
					inline: false,
				},
				{
					name: '👑 Current Crown Balance:',
					value: `${senderBalance} Crowns`,
					inline: false,
				},
			);
		return interaction.reply({ embeds: [embed] });
	}

	// Perform the transaction
	db.prepare('BEGIN TRANSACTION').run();
	try {
		// Deduct from sender
		db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(amount, senderId);

		// Add to recipient
		db.prepare(`
            INSERT INTO user_economy (user_id, crowns)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
        `).run(recipient.id, amount, amount);

		db.prepare('COMMIT').run();
		const embed = new EmbedBuilder()
			.setColor(0xF1C40F)
			.setTitle('💰 Westwind Royal Treasury 💰')
			.addFields(
				{
					name: '💸 Successfully Sent Crowns!',
					value: `✅ You've paid ${amount} Crowns to ${recipient}!`,
					inline: false,
				},
				{
					name: '👑 **NEW** Crown Balance:',
					value: `${senderBalance - amount} Crowns`,
					inline: false,
				},
			);
		await interaction.reply({ embeds: [embed] });
	}
	catch (error) {
		db.prepare('ROLLBACK').run();
		console.error('Payment error:', error);
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle('❌ Brewmaster Error!')
			.addFields(
				{
					name: 'Payment Canceled - Database Rolled Back.',
					value: '❌ An error occurred while processing your payment. Please try again later.',
					inline: false,
				},
				{
					name: 'Error:',
					value: error,
					inline: false,
				},
			);
		await interaction.reply({ embeds: [embed] });
	}
}

async function handleBalance(interaction, user) {
	const userId = user.id;
	await updateMultiplier(userId, interaction.guild);

	// Get user's economy data
	const userEcon = db.prepare('SELECT crowns, last_daily, multiplier FROM user_economy WHERE user_id = ?').get(userId);

	// Get guild info if in a guild
	const guildInfo = db.prepare(`
        SELECT gl.guild_name, gl.guild_tag, ge.balance
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
        WHERE gmt.user_id = ?
    `).get(userId);

	const embed = new EmbedBuilder()
		.setColor(0xF1C40F)
		.setTitle(`💰 ${user.username}'s Treasury Balance 💰`)
		.setThumbnail(user.displayAvatarURL())
		.addFields(
			{
				name: '👑 Crown Account Balance:',
				value: `${userEcon?.crowns || 0} Crowns`,
				inline: true,
			},
			{
				name: '🔁 Multiplier:',
				value: `${userEcon?.multiplier || 1.0}x`,
				inline: true,
			},
		);

	if (guildInfo) {
		embed.addFields({
			name: '🏰 Affiliated Guild:',
			value: `${guildInfo.guild_name} (${guildInfo.guild_tag})`,
			inline: false,
		});
	}

	if (userEcon?.last_daily) {
		const nextDaily = new Date(new Date(userEcon.last_daily).getTime() + 24 * 60 * 60 * 1000);
		embed.addFields({
			name: '⏳ Next Daily Claim:',
			value: `<t:${Math.floor(nextDaily / 1000)}:R>`,
			inline: false,
		});
	}
	else {
		embed.addFields({
			name: '⏳ Next Daily Claim:',
			value: 'Ready to claim now with `/econ daily`!',
			inline: false,
		});
	}

	await interaction.reply({ embeds: [embed] });
}

async function handleBalanceLeaderboard(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0xF1C40F)
		.setTitle('🏆 Westwind Leaderboards 🏆')
		.setFooter({ text: 'Earn more Crowns with /econ daily, Disboard /bump streaks, and more!' });

	// --- User Leaderboard ---
	const topUsers = db.prepare('SELECT user_id, crowns FROM user_economy ORDER BY crowns DESC LIMIT 10').all();
	let userLeaderboard = 'No wealthy users found.';
	if (topUsers.length > 0) {
		const userEntries = await Promise.all(topUsers.map(async (user, index) => {
			try {
				const member = await interaction.guild.members.fetch(user.user_id);
				return `${index + 1}. ${member.displayName}: ${user.crowns} Crowns`;
			}
			catch {
				return `${index + 1}. <@${user.user_id}>: ${user.crowns} Crowns`;
			}
		}));
		userLeaderboard = userEntries.join('\n');
	}
	embed.addFields({ name: 'Top Users by Wealth 🥇', value: userLeaderboard, inline: false });


	// --- Guild Leaderboard ---
	const allGuilds = db.prepare(`
        SELECT gl.guild_name, gl.guild_tag, gt.tier
        FROM guild_tiers gt
        JOIN guild_list gl ON gt.guild_tag = gl.guild_tag
        ORDER BY gt.tier DESC
    `).all();

	if (allGuilds.length > 0) {
		embed.addFields({ name: '🏰 Guild Rankings 🏰', value: '\u200B', inline: false });

		const tierData = getTierData();
		const majorTierNames = ['Stone', 'Bronze', 'Silver', 'Gold', 'Adamantium'];
		const groupedGuilds = new Map();

		// Group guilds by their major tier
		for (const guild of allGuilds) {
			const majorTierIndex = Math.floor((guild.tier - 1) / 3);
			if (!groupedGuilds.has(majorTierIndex)) {
				groupedGuilds.set(majorTierIndex, []);
			}
			const tierInfo = tierData[guild.tier - 1];
			const formattedString = `${guild.guild_name} (${guild.guild_tag}): **${tierInfo.name}**`;
			groupedGuilds.get(majorTierIndex).push(formattedString);
		}

		// Create a field for each major tier that has guilds
		const sortedTiers = Array.from(groupedGuilds.keys()).sort((a, b) => b - a);
		for (const majorTierIndex of sortedTiers) {
			const crest = ONLY_CRESTS[majorTierIndex];
			const tierName = majorTierNames[majorTierIndex];
			const guildList = groupedGuilds.get(majorTierIndex).join('\n');

			embed.addFields({
				name: `${crest} ${tierName} Tier ${crest}`,
				value: guildList,
				inline: true,
			});
		}
	}
	else {
		embed.addFields({ name: '🏰 Guild Rankings 🏰', value: 'No guilds have been established yet.', inline: false });
	}


	await interaction.reply({ embeds: [embed] });
}