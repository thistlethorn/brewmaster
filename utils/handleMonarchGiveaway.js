const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');
const { getMonthIdentifier, getMonthName } = require('./getMonthIdentifier');
const { updateMultiplier } = require('./handleCrownRewards');
const { addXp } = require('./addXp');
const config = require('../config.json');

const EVENT_PING_ROLE = '1363538515576750130';
const HALL_OF_FAME_CHANNEL = '1365345890591703080';
const MONARCH_ROLE = '1363537152658378793';
const TOP_BUMPER_ROLE = '1382828074789503128';

async function createMonarchGiveaway(client) {
	try {
		// Get current month identifier
		const monthIdentifier = getMonthIdentifier();
		const now = new Date();
		const monthName = getMonthName(now.getMonth());
		const year = now.getFullYear();

		const existingGiveaway = db.prepare('SELECT 1 FROM motw_giveaways WHERE week_identifier = ?').get(monthIdentifier);
		if (existingGiveaway) {
			console.log(`[MotM] Giveaway for ${monthIdentifier} already exists. Skipping creation.`);
			return;
		}

		const endTime = new Date(now.getTime() + 16 * 60 * 60 * 1000);
		// 16 hours from now

		const channel = await client.channels.fetch(HALL_OF_FAME_CHANNEL);
		if (!channel?.isTextBased()) {
			throw new Error('Hall of Fame channel not found or not text channel');
		}

		// Ping event role first
		await channel.send(`<@&${EVENT_PING_ROLE}>`);

		const embed = new EmbedBuilder()
			.setColor(0x9B59B6)
			.setTitle(`👑 ${monthName} ${year}'s Monarch of the Month Giveaway! 👑`)
			.setDescription(
				'Join our free monthly raffle to win the **Monarch of the Month** title, a feature on our socials, **300 Crowns**, and a **3X Crown multiplier** for the month! Good luck!',
			)
			.addFields(
				{ name: 'Ends', value: `<t:${Math.floor(endTime.getTime() / 1000)}:R> (<t:${Math.floor(endTime.getTime() / 1000)}:F>)`, inline: false },
				{ name: 'Entries', value: '0', inline: true },
				{ name: 'Winners', value: '1', inline: true },
			)
			.setTimestamp(now);
		// Use a native Discord timestamp for the footer

		const enterButton = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId('motw_enter')
				.setLabel('Enter Giveaway')
				.setEmoji('🎉')
				.setStyle(ButtonStyle.Primary),
		);

		const giveawayMessage = await channel.send({ embeds: [embed], components: [enterButton] });

		db.prepare(`
            INSERT INTO motw_giveaways (message_id, channel_id, week_identifier, start_time, end_time)
            VALUES (?, ?, ?, ?, ?)
        `).run(giveawayMessage.id, channel.id, monthIdentifier, now.toISOString(), endTime.toISOString());

		console.log(`[MotM] Giveaway for ${monthIdentifier} created. Ending at ${endTime.toISOString()}`);
		scheduleGiveawayEnd(client, giveawayMessage.id, endTime);

	}
	catch (error) {
		console.error('[MotM] Error creating giveaway:', error);
	}
}

async function handleMonarchEntry(interaction) {
	const giveawayId = interaction.message.id;
	const userId = interaction.user.id;

	try {
		const giveaway = db.prepare(`
            SELECT * FROM motw_giveaways
            WHERE message_id = ? AND completed = 0 AND datetime(end_time) > datetime('now', 'localtime')
        `).get(giveawayId);

		if (!giveaway) {
			return interaction.reply({ content: 'This giveaway has already ended or is invalid.', ephemeral: true });
		}

		// Prevent last month's winner from entering
		// this is now YYYY-MM
		const currentMonthIdentifier = giveaway.week_identifier;
		const [year, month] = currentMonthIdentifier.split('-').map(Number);
		// Get previous month
		const lastMonthDate = new Date(year, month - 2, 1);
		const lastMonthIdentifier = `${lastMonthDate.getFullYear()}-${(lastMonthDate.getMonth() + 1).toString().padStart(2, '0')}`;

		const lastMonthWinner = db.prepare(`
			SELECT winner_id FROM motw_giveaways WHERE week_identifier = ?
		`).get(lastMonthIdentifier)?.winner_id;


		if (userId === lastMonthWinner) {
			return interaction.reply({ content: 'Congratulations on your win last month! You can\'t enter this month to give others a chance.', ephemeral: true });
		}

		const existingEntry = db.prepare('SELECT 1 FROM motw_entries WHERE giveaway_id = ? AND user_id = ?').get(giveawayId, userId);
		if (existingEntry) {
			return interaction.reply({ content: 'You have already entered this giveaway!', ephemeral: true });
		}

		db.prepare('INSERT INTO motw_entries (giveaway_id, user_id, entry_time) VALUES (?, ?, ?)')
			.run(giveawayId, userId, new Date().toISOString());

		const reason = 'Entered the monthly Monarch of the Month giveaway in <#1365345890591703080>!';

		await addXp(userId, config.xpRewards.motwEntry, interaction, reason);

		const newCount = db.prepare(`
            UPDATE motw_giveaways SET entries_count = entries_count + 1 WHERE message_id = ? RETURNING entries_count
        `).get(giveawayId).entries_count;

		const embed = EmbedBuilder.from(interaction.message.embeds[0]);
		embed.data.fields = embed.data.fields.map(field => field.name === 'Entries' ? { ...field, value: newCount.toString() } : field);

		await interaction.message.edit({ embeds: [embed] });
		await interaction.reply({ content: 'You have successfully entered the Monarch of the Month giveaway! Good luck!', ephemeral: true });

	}
	catch (error) {
		console.error('[MotM] Error handling entry:', error);
		await interaction.reply({ content: 'There was an error processing your entry.', ephemeral: true });
	}
}

async function endMonarchGiveaway(client, messageId) {
	try {
		const giveaway = db.prepare('SELECT * FROM motw_giveaways WHERE message_id = ? AND completed = 0').get(messageId);
		if (!giveaway) return;

		console.log(`[MotM] Ending giveaway ${messageId}`);

		const channel = await client.channels.fetch(giveaway.channel_id);
		if (!channel?.isTextBased()) throw new Error('Channel not found');

		// Disable the button on the original message
		const message = await channel.messages.fetch(messageId).catch(() => null);
		if (message) {
			const disabledButton = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId('motw_closed')
					.setLabel('Giveaway Closed!')
					.setStyle(ButtonStyle.Danger)
					.setDisabled(true),
			);
			await message.edit({ components: [disabledButton] });
		}

		const entries = db.prepare('SELECT user_id FROM motw_entries WHERE giveaway_id = ?').all(messageId);
		if (entries.length === 0) {
			db.prepare('UPDATE motw_giveaways SET completed = 1 WHERE message_id = ?').run(messageId);
			await channel.send('No one entered this month\'s Monarch of the Month giveaway!');
			return;
		}

		await channel.guild.members.fetch();

		const previousMonarchRole = await channel.guild.roles.fetch(MONARCH_ROLE);
		if (previousMonarchRole) {
			const membersWithRole = previousMonarchRole.members;
			console.log(`[MotM] Found ${membersWithRole.size} member(s) with the previous Monarch role. Starting removal.`);
			for (const member of membersWithRole.values()) {
				try {
					await member.roles.remove(previousMonarchRole);
					await updateMultiplier(member.id, channel.guild);
					console.log(`[MotM] Removed Monarch role from previous winner ${member.user.tag}`);
				}
				catch (error) {
					console.error(`[MotM] Failed to remove role from ${member.user.tag}`, error);
				}
			}
		}

		// Fetch all entrants' member objects to check roles efficiently
		const members = await Promise.all(
			entries.map(entry => channel.guild.members.fetch(entry.user_id).catch(() => null)),
		).then(results => results.filter(m => m !== null));

		const entrantsWithStatus = members.map(member => {
			const hasWonBefore = db.prepare('SELECT 1 FROM motw_winners_history WHERE user_id = ?').get(member.id) !== undefined;
			const isTopBumper = member.roles.cache.has(TOP_BUMPER_ROLE);
			return { userId: member.id, hasWonBefore, isTopBumper };
		});

		const winnerData = selectWinner(entrantsWithStatus);
		if (!winnerData) {
			await channel.send('A winner could not be determined due to an issue with entrant groups.');
			return;
		}

		const winnerId = winnerData.userId;
		db.prepare('UPDATE motw_giveaways SET winner_id = ?, completed = 1, entries_count = ? WHERE message_id = ?')
			.run(winnerId, entries.length, messageId);

		db.prepare('INSERT INTO motw_winners_history (user_id, week_identifier, win_time, was_top_bumper) VALUES (?, ?, ?, ?)')
			.run(winnerId, giveaway.week_identifier, new Date().toISOString(), winnerData.isTopBumper ? 1 : 0);

		// Give rewards to the winner
		const winnerMember = await channel.guild.members.fetch(winnerId);
		let specialPrize = 0;
		if (winnerMember) {
			await winnerMember.roles.add(MONARCH_ROLE);
			// SPECIAL PRIZE LOGIC for Sep 2025
			if (giveaway.week_identifier === '2025-09') {
				specialPrize = 10000;
			}
			db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(300 + specialPrize, winnerId);
			await updateMultiplier(winnerId, channel.guild);

			const reason = '**WON** the __Monarch of the Month__ giveaway hosted in <#1365345890591703080>!';

			await addXp(winnerId, config.xpRewards.motwWin, client, reason);
		}

		// Give consolation prizes
		const consolationWinners = entries.filter(e => e.user_id !== winnerId);
		if (consolationWinners.length > 0) {
			const stmt = db.prepare('UPDATE user_economy SET crowns = crowns + 100 WHERE user_id = ?');
			const givePrizes = db.transaction((users) => {
				for (const user of users) stmt.run(user.user_id);
			});
			givePrizes(consolationWinners);
		}

		// Announce the winner
		const [year, monthNum] = giveaway.week_identifier.split('-').map(Number);
		const monthName = getMonthName(monthNum - 1);

		const winnerEmbed = new EmbedBuilder()
			.setColor(0xF1C40F)
			.setTitle(`🏆 Congratulations to ${monthName} ${year}'s Monarch of the Month! 🏆`)
			.setDescription(`Please congratulate ${winnerMember} for being selected! They will be featured on our social media and receive:`)
			.setThumbnail(winnerMember.user.displayAvatarURL())
			.addFields(
				{ name: '👑 Crowns Reward', value: `**${300 + specialPrize} Crowns** have been added to your balance!${specialPrize > 0 ? ' (Includes a special one-time bonus!)' : ''}`, inline: false },
				{ name: '✨ Multiplier Bonus', value: 'You now have a **3X Crown earnings multiplier** for the month!', inline: false },
			);

		if (consolationWinners.length > 0) {
			winnerEmbed.addFields({ name: '💸 Consolation Prizes', value: 'All other participants have received **100 Crowns**! Thank you for entering!', inline: false });
		}
		winnerEmbed.setFooter({ text: 'A new giveaway starts next month!' }).setTimestamp();

		await channel.send({ content: `🎉 Congratulations, <@${winnerId}>! 🎉`, embeds: [winnerEmbed] });
	}
	catch (error) {
		console.error(`[MotM] Error ending giveaway ${messageId}:`, error);
	}
}

function selectWinner(entrants) {
	if (!entrants || entrants.length === 0) return null;

	const topBumpers = entrants.filter(e => e.isTopBumper);
	const newEntrants = entrants.filter(e => !e.hasWonBefore && !e.isTopBumper);
	const previousWinners = entrants.filter(e => e.hasWonBefore && !e.isTopBumper);

	const groupSelection = Math.random() * 100;
	let selectedGroup = [];

	if (topBumpers.length > 0 && groupSelection < 2) {
		// 2% chance
		selectedGroup = topBumpers;
	}
	else if (newEntrants.length > 0 && groupSelection < 82) {
		// 80% chance (2 + 80)
		selectedGroup = newEntrants;
	}
	else if (previousWinners.length > 0) {
		// 18% chance
		selectedGroup = previousWinners;
	}

	// Fallback logic: if the chosen group is empty, try the others
	if (selectedGroup.length === 0) {
		if (newEntrants.length > 0) selectedGroup = newEntrants;
		else if (previousWinners.length > 0) selectedGroup = previousWinners;
		else if (topBumpers.length > 0) selectedGroup = topBumpers;
		else selectedGroup = entrants;
		// Absolute fallback
	}

	return selectedGroup[Math.floor(Math.random() * selectedGroup.length)];
}

// --- Giveaway Scheduling and Persistence ---
const activeGiveawayTimeouts = new Map();

function scheduleGiveawayEnd(client, messageId, endTime) {
	const now = new Date();
	const delay = endTime.getTime() - now.getTime();

	if (delay <= 0) {
		endMonarchGiveaway(client, messageId);
		return;
	}

	// Clear any existing timeout for this giveaway to prevent duplicates
	if (activeGiveawayTimeouts.has(messageId)) {
		clearTimeout(activeGiveawayTimeouts.get(messageId));
	}

	const timeout = setTimeout(() => {
		endMonarchGiveaway(client, messageId);
		activeGiveawayTimeouts.delete(messageId);
	}, delay);

	activeGiveawayTimeouts.set(messageId, timeout);
}

// Call this function once when the bot is ready to handle missed giveaways
async function resumeActiveGiveaways(client) {
	console.log('[MonarchGiveaway] Checking for active giveaways to resume...');
	const activeGiveaways = db.prepare(`
        SELECT message_id, end_time FROM motw_giveaways
        WHERE completed = 0
    `).all();

	for (const giveaway of activeGiveaways) {
		const endTime = new Date(giveaway.end_time);
		console.log(`[MonarchGiveaway] Resuming schedule for giveaway ${giveaway.message_id}, ending at ${endTime.toISOString()}`);
		scheduleGiveawayEnd(client, giveaway.message_id, endTime);
	}
}

module.exports = {
	createMonarchGiveaway,
	handleMonarchEntry,
	resumeActiveGiveaways,
};