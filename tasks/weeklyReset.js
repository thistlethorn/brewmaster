const cron = require('node-cron');
const db = require('../database');
const { EmbedBuilder } = require('discord.js');
const updateLeaderboard = require('../utils/updateLeaderboard');
const sendMessage = require('../utils/sendMessageToChannel');
const { updateMultiplier } = require('../utils/handleCrownRewards');
const { createMotwGiveaway } = require('../utils/handleMotwGiveaway');


async function applyGuildCompoundBonus() {
	try {
		const guilds = db.prepare(`
            SELECT gl.guild_tag, gl.guild_name, gt.tier, ge.balance
            FROM guild_list gl
            JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag
            LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
            WHERE ge.balance > 0
        `).all();

		const bonusRates = [0.03, 0.06, 0.09, 0.12, 0.15];

		db.transaction(() => {
			guilds.forEach(guild => {
				const bonusRate = bonusRates[guild.tier - 1] || 0;
				const bonusAmount = Math.floor(guild.balance * bonusRate);

				if (bonusAmount > 0) {
					db.prepare(`
                        UPDATE guild_economy 
                        SET balance = balance + ? 
                        WHERE guild_tag = ?
                    `).run(bonusAmount, guild.guild_tag);

					console.log(`[weeklyReset] Applied ${bonusAmount} Crowns (${bonusRate * 100}%) bonus to ${guild.guild_name}`);
				}
			});
		})();
	}
	catch (error) {
		console.error('[weeklyReset] Error applying guild compound bonus:', error);
	}
}


async function changeTB(client, removingPrevious, userId) {
	const TOP_BUMPER_ROLE = '1382828074789503128';

	try {
		if (removingPrevious) {
			// Remove role from all current holders
			for (const guild of client.guilds.cache.values()) {
				try {
					const role = guild.roles.cache.get(TOP_BUMPER_ROLE);
					if (!role) continue;

					for (const member of role.members.values()) {
						try {
							await member.roles.remove(role);
							console.log(`[weeklyReset] Removed Top Bumper role from ${member.user.tag}`);
							await updateMultiplier(member.id, guild);
						}
						catch (error) {
							console.error(`[weeklyReset] Error removing role from ${member.user.tag}:`, error);
						}
					}
				}
				catch (guildError) {
					console.error(`[weeklyReset] Error processing guild ${guild.name}:`, guildError);
				}
			}
		}
		else if (userId) {
			// Add role to new winner
			for (const guild of client.guilds.cache.values()) {
				try {
					const role = guild.roles.cache.get(TOP_BUMPER_ROLE);
					if (!role) continue;

					const member = await guild.members.fetch(userId).catch(() => null);
					if (!member) {
						console.log(`[weeklyReset] User ${userId} not found in guild ${guild.name}`);
						continue;
					}

					await member.roles.add(role);
					console.log(`[weeklyReset] Added Top Bumper role to ${member.user.tag}`);
					await updateMultiplier(member.id, guild);
				}
				catch (guildError) {
					console.error(`[weeklyReset] Error processing guild ${guild.name}:`, guildError);
				}
			}
		}
	}
	catch (error) {
		console.error('[weeklyReset] Error in changeTB:', error);
	}
}

async function migrateLeaderboard(client) {
	const hallOfFameID = '1365345890591703080';

	try {
		const hallOfFameChannel = await client.channels.fetch(hallOfFameID);
		if (!hallOfFameChannel?.isTextBased()) {
			throw new Error('Hall of Fame channel not found or not text channel');
		}

		const messageInfo = db.prepare(`
            SELECT channel_id, message_id
            FROM leaderboard_message
            LIMIT 1
        `).get();

		const bumpLB = db.prepare(`
            SELECT user_id, bumps 
            FROM bump_leaderboard 
            ORDER BY bumps DESC 
            LIMIT 3
        `).all();

		if (!bumpLB.length) {
			console.log('[weeklyReset] No entries in bump leaderboard');
			return;
		}

		// Process rewards
		db.transaction(() => {
			bumpLB.forEach((row, index) => {
				const amount = index === 0 ? 300 : index === 1 ? 150 : 100;
				db.prepare(`
                    INSERT INTO user_economy (user_id, crowns)
                    VALUES (?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        crowns = crowns + ?
                `).run(row.user_id, amount, amount);
				console.log(`[weeklyReset] Rank ${index + 1}: ${row.user_id} - ${row.bumps} bumps (${amount} crowns)`);
			});
		})();

		// Fetch user details
		const [winner, secondPlace, thirdPlace] = await Promise.all([
			client.users.fetch(bumpLB[0].user_id).catch(() => null),
			client.users.fetch(bumpLB[1].user_id).catch(() => null),
			client.users.fetch(bumpLB[2].user_id).catch(() => null),
		]);

		// Forward leaderboard message if exists
		if (messageInfo?.channel_id && messageInfo?.message_id) {
			try {
				const leaderboardChannel = await client.channels.fetch(messageInfo.channel_id);
				const leaderboardMessage = await leaderboardChannel.messages.fetch(messageInfo.message_id);
				await leaderboardMessage.forward(hallOfFameChannel);
			}
			catch (error) {
				console.error('[weeklyReset] Error forwarding leaderboard:', error);
			}
		}

		// Update Top Bumper role
		await changeTB(client, false, bumpLB[0].user_id);

		// Create Hall of Fame embed
		const embed = new EmbedBuilder()
			.setTitle('🏆 TOP BUMPER OF THE WEEK 🏆')
			.setDescription(
				`Congratulations to ${winner?.displayName || 'Unknown User'} for taking the #1 spot on the leaderboard and becoming <@&1382828074789503128>!\n` +
                `- 🥇 With ${bumpLB[0].bumps} bumps, you've earned the Top Bumper role and 300 Crowns!\n\n` +
                `- 🥈 ${secondPlace?.displayName || 'Unknown User'}: ${bumpLB[1].bumps} bumps (Earned 150 Crowns)!\n` +
                `- 🥉 ${thirdPlace?.displayName || 'Unknown User'}: ${bumpLB[2].bumps} bumps (Earned 100 Crowns)!`,
			)
			.setColor(0x5865F2)
			.setTimestamp()
			.setFooter({ text: 'Resets every Sunday at midnight UTC' });

		await sendMessage(client, hallOfFameID, embed);
	}
	catch (error) {
		console.error('[weeklyReset] Error in migrateLeaderboard:', error);
	}
}

function setupWeeklyReset(client) {
	// Every Sunday at midnight UTC
	cron.schedule('0 0 * * 1', async () => {
		console.log('[weeklyReset] Starting weekly reset...');

		try {
			console.log('[weeklyReset] Removing previous Top Bumper role');
			await changeTB(client, true, null);

			console.log('[weeklyReset] Migrating leaderboard to Hall of Fame');
			await migrateLeaderboard(client);

			console.log('[weeklyReset] Clearing bump leaderboard');
			db.prepare('DELETE FROM bump_leaderboard').run();

			console.log('[weeklyReset] Updating leaderboard display');
			await updateLeaderboard(client);

			console.log('[weeklyReset] Applying guild compound bonuses');
        	await applyGuildCompoundBonus();
			// Add this line to start the MotW giveaway
			console.log('[weeklyReset] Starting Member of the Week giveaway');
			await createMotwGiveaway(client);
		}
		catch (error) {
			console.error('[weeklyReset] Error during weekly reset:', error);
		}
	});
}

module.exports = setupWeeklyReset;