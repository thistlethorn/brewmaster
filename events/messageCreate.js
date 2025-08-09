const { Events, EmbedBuilder } = require('discord.js');
const db = require('../database');
const updateLeaderboard = require('../utils/updateLeaderboard');
const getWeekIdentifier = require('../utils/getWeekIdentifier');
const { reschedule } = require('../tasks/bumpReminder');
const { isBot, isInGameroom, isNormalMessage } = require('../utils/chatFilters');
const { calculateBumpReward, updateMultiplier } = require('../utils/handleCrownRewards');

function isQualityWelcome(message) {
	const content = message.content.toLowerCase();
	const minLength = 3;
	const maxLength = 500;

	// Skip if message is too short or too long
	if (content.length < minLength || content.length > maxLength) return false;

	// Skip if contains external URLs or invites
	if (/(https?:\/\/|www\.|discord\.gg\/)/i.test(content)) return false;

	// Expanded welcome words list
	const welcomeWords = [
		'welcome', 'hello', 'hi', 'greetings', 'hey', 'howdy',
		'hallo', 'hola', 'salut', 'ciao',
		'get going', 'getting started',
		'check out', 'make sure to read',
		'introduce', 'introductions', 'verify', 'roles',
		'guide', 'rules', 'started',
	];

	// Clean content by removing user and channel mentions for the word check
	const cleanContent = content.replace(/<(@|#)[!&]?\d+>/g, '').trim();

	// Check for welcome words OR channel mentions
	const hasWelcomeWord = welcomeWords.some(word => cleanContent.includes(word));
	const hasChannelMention = /<#\d+>/.test(message.content);

	// A message is quality if it contains a welcome word or mentions a channel
	return hasWelcomeWord || hasChannelMention;
}

function formatStreakProgress(streak) {
	if (streak >= 12) {
		return `${streak}/12 bumps 👑👑👑👑👑👑👑👑👑👑👑👑 LEGENDARY STATUS!`;
	}

	const tierInfo = {
		normal: { max: 2, label: 'Blazing Streak', next: 3 },
		blazing: { max: 6, label: 'Unstoppable Streak', next: 7 },
		unstoppable: { max: 11, label: 'Legendary Streak', next: 12 },
	};

	let tier;

	if (streak <= 2) {
		tier = 'normal';
		// Normal streak (1-2 bumps)
	}
	else if (streak <= 6) {
		// Blazing streak (3-6 bumps)
		tier = 'blazing';
	}
	else if (streak <= 11) {
		// Unstoppable streak (7-11 bumps)
		tier = 'unstoppable';
	}


	const { max, label, next } = tierInfo[tier];
	const filled = '🟦'.repeat(streak);
	const empty = '⬜'.repeat(Math.max(max - streak, 0));
	const remaining = next - streak;

	return `${streak}/${max} bumps ${filled}${empty} ${remaining} more until a ${label}!`;
}

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (!isBot(message) && !isInGameroom(message)) {
			// 50% chance to even check for a trigger
			if (Math.random() <= 0.5) {
				const now = new Date();
				const nowISO = now.toISOString();

				// ensure row exists once
				db.prepare('INSERT OR IGNORE INTO tony_quotes_global_cooldown (id, last_triggered_at) VALUES (1, ?)').run(nowISO);

				// Check global cooldown (5 minutes)
				const globalCooldown = db.prepare('SELECT last_triggered_at FROM tony_quotes_global_cooldown WHERE id = 1').get();
				if (globalCooldown && globalCooldown.last_triggered_at) {
					const lastTriggerTime = new Date(globalCooldown.last_triggered_at);
					if (now - lastTriggerTime < 5 * 60 * 1000) {
						return;
						// Global cooldown is active
					}
				}

				const content = message.content.toLowerCase().replace(/[.,!?;:]/g, '');
				const words = new Set(content.split(/\s+/));
				// Use a Set for faster lookups

				// Find all possible quotes that could be triggered by the words in the message
				const potentialTriggers = [];
				for (const word of words) {
					const matchingQuotes = db.prepare('SELECT id, quote_text, user_id, last_triggered_at FROM tony_quotes_active WHERE trigger_word = ?').all(word);
					for (const quote of matchingQuotes) {
						// Check this specific quote's 15-minute cooldown
						if (quote.last_triggered_at) {
							const lastWordTriggerTime = new Date(quote.last_triggered_at);
							if (now - lastWordTriggerTime < 15 * 60 * 1000) {
								continue;
								// This specific quote is on cooldown, skip it
							}
						}
						potentialTriggers.push(quote);
					}
				}

				// If we have any valid, off-cooldown quotes, pick one at random
				if (potentialTriggers.length > 0) {
					const chosenQuote = potentialTriggers[Math.floor(Math.random() * potentialTriggers.length)];

					try {
						const triggerTx = db.transaction(() => {
							// Update the specific active quote record using its unique ID
							db.prepare(`
								UPDATE tony_quotes_active
								SET times_triggered = times_triggered + 1, last_triggered_at = ?
								WHERE id = ?
							`).run(nowISO, chosenQuote.id);

							// Pay the user
							db.prepare(`
								INSERT INTO user_economy (user_id, crowns)
								VALUES (?, 20)
								ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + 20
							`).run(chosenQuote.user_id);

							// Update global cooldown
							db.prepare('UPDATE tony_quotes_global_cooldown SET last_triggered_at = ? WHERE id = 1').run(nowISO);

							// Check if the quote has been triggered 20 times and remove it
							const currentTriggers = db.prepare('SELECT times_triggered FROM tony_quotes_active WHERE id = ?').get(chosenQuote.id);
							if (currentTriggers && currentTriggers.times_triggered >= 20) {
								db.prepare('DELETE FROM tony_quotes_active WHERE id = ?').run(chosenQuote.id);
							}
						});

						triggerTx();

						// Send Tony's reply
						await message.channel.send(`*${chosenQuote.quote_text}*`);
						await message.channel.send(`||-# <@${chosenQuote.user_id}>  earned 20 Crowns for this quote! • Want to submit your own? Use \`/tonyquote\` and earn 200 bonus crowns over time, for each!||`);

					}
					catch (dbError) {
						console.error('[Tony Quote Trigger] Database transaction failed:', dbError);
					}
				}
			}
		}
		if (!isBot(message) && !isInGameroom(message) && isNormalMessage(message.content)) {
			const userId = message.author.id;
			try {
				db.prepare(`
            INSERT INTO user_activity (user_id, normal_messages, last_message_time)
            VALUES (?, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            ON CONFLICT(user_id) DO UPDATE SET
                normal_messages = normal_messages + 1,
                last_message_time = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        `).run(userId);

				// Check if they qualify for active chatter role
				const activity = db.prepare(`
            SELECT normal_messages FROM user_activity WHERE user_id = ?
        `).get(userId);
				console.log(`[messageCreate] [CHATLOG] ${message.author.displayName} sent a normal message, totaling [${activity.normal_messages}] today.`);

				const ACTIVE_CHATTER_ROLE = '1382521995656302632';
				if (!message.member.roles.cache.has(ACTIVE_CHATTER_ROLE)) {
					if (activity.normal_messages >= 15) {
						await message.member.roles.add(ACTIVE_CHATTER_ROLE);
						const nextMidnight = new Date();
   					nextMidnight.setUTCHours(24, 0, 0, 0);
						const embed = new EmbedBuilder()
							.setColor(0xF1C40F)
							.setTimestamp()
							.setTitle('🔥 Officially an Active Chatter Today! 🔥')
							.setDescription(`You're on fire, <@${userId}>!\nEnjoy the special role in the member list, and the \`2X\` bonus Crowns multiplier!\nResetting <t:${Math.floor(nextMidnight.getTime() / 1000)}:R>!`)
							.setFooter({ text: 'Don\'t forget to do `/econ daily` to collect your Crowns!' });

						// Update multiplier first
						const multiplier = await updateMultiplier(userId, message.guild);


						const reward = 20 * multiplier;

						// Update user's crowns
						db.prepare(`
							INSERT INTO user_economy (user_id, crowns)
							VALUES (?, ?)
							ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
						`).run(userId, reward, reward);


						embed.addFields({
							name: '👑 Crowns Earned',
							value: `You earned ${reward} Crowns [\`${multiplier}X\` 🔁 **MULTI**] for becoming an Active Chatter today!`,
							inline: false,
						});

						console.log(`[messageCreate] [CHATLOG] Added ${reward} Crowns [${multiplier}X Multi] to ${message.author.displayName} for getting the Active Chatter Role.`);


						await message.channel.send({ embeds: [embed] });
						console.log(`[messageCreate] [CHATLOG] ${message.author.displayName} has been given the Active Chatter role.`);

					}
				}

			}
			catch (error) {
				console.error('[messageCreate] [Error] Error tracking user activity:', error);
			}
		}

		if (message.author.id === '302050872383242240' &&
            message.embeds[0].description?.includes('Bump done!')) {
			console.log('[messageCreate] Someone has done /bump.');

			// grab the userID of the member who sent a disboard bump message, confirm it's an id.
			const userId = message.interactionMetadata.user.id;
			if (!userId) return;

			// update the leaderboard database, later on will update the embed in the designated channel
			const currentWeek = getWeekIdentifier();
			try {
				db.prepare(`
				INSERT INTO bump_leaderboard (user_id, bumps, last_bump_week, last_bump_time)
				VALUES (?, 1, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
				ON CONFLICT(user_id) DO UPDATE SET
					bumps = CASE 
						WHEN last_bump_week = ? THEN bumps + 1
						ELSE 1
					END,
					last_bump_week = ?,
					last_bump_time = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
			`).run(userId, currentWeek, currentWeek, currentWeek);
				reschedule();
				console.log('[messageCreate] Successfully updated bump_leaderboard with bump information and rescheduled reminder.');
			}
			catch (error) {
				console.error('[messageCreate] [Error] Failed to update bump leaderboard:', error);
			}
			console.log(`[messageCreate] Bump recorded for ${userId} at ${new Date().toISOString()}`);

			// start the embed and grab the top bumpers of the week ordered by the highest bumpers decending
			const embed = new EmbedBuilder()
				.setColor(0x5865F2)
				.setTimestamp();
			const topBumpers = db.prepare(`
					SELECT user_id, bumps 
					FROM bump_leaderboard 
					ORDER BY bumps DESC 
					LIMIT 10
				`).all();

			// flag to detect if the database if null, uninitialized, or empty
			let databaseEmptyFlag = false;
			let streakCountVariable = 0;
			let streakCountStatic = 0;

			// database information managing the current streak userid and streak amount
			const testDB = db.prepare('SELECT user_id, streak_count FROM bump_streak WHERE id = 1').get();

			// check if the streak database is empty
			if (!testDB) {
				console.log('[messageCreate] bump_streak was empty, populating with basic information instead.');
				databaseEmptyFlag = true;
				db.prepare(`
					INSERT OR IGNORE INTO bump_streak (id, user_id, streak_count)
					VALUES (1, NULL, 0)
				`).run();
			}

			const streakRow = db.prepare(`
				SELECT user_id, streak_count 
				FROM bump_streak 
				WHERE id = 1
			`).get();
			streakCountStatic = streakRow.streak_count;
			streakCountVariable = streakRow.streak_count;
			// 0 if streak not broken, and then 1/2/3 for different size streak broken
			let streakBreakFlag = 0;
			// streak holder was the one who bumped
			if (streakRow.user_id === userId) {
				// push to db the fact that the streak is incremented by the same user, and increment the variable streak counter
				db.prepare('UPDATE bump_streak SET streak_count = streak_count + 1 WHERE id = 1').run();
				streakCountVariable++;

			}
			// someone else was the one who bumped, set streakbreakflag to reflect how big a streak it was
			else {
				if (streakCountVariable <= 2) {
					streakBreakFlag = 0;
					// Normal streak (1-2 bumps) - no special message
				}
				else if (streakCountVariable <= 6) {
					// Blazing streak (3-6 bumps)
					streakBreakFlag = 1;
				}
				else if (streakCountVariable <= 11) {
					// Unstoppable streak (7-11 bumps)
					streakBreakFlag = 2;
				}
				else if (streakCountVariable >= 12) {
					// Legendary streak (12+ bumps)
					streakBreakFlag = 3;
				}

				// push the new bump data to the streak tracking database, and set the variable streak counter to 1 for the new streak
				db.prepare('UPDATE bump_streak SET user_id = ?, streak_count = 1 WHERE id = 1').run(userId);
				streakCountVariable = 1;
			}

			// find the person in the topbumpers list by iterating through it until we hit the same id, then add the right message details
			topBumpers.forEach((row) => {
				if (row.user_id === userId) {

					// ranking on the leaderboard of the user
					const rank = topBumpers.findIndex(num => num.user_id === userId) + 1;

					// if there was no breaking of the streak AKA streak still going unbroken
					if (streakBreakFlag == 0) {

						// bump streak database is empty, this is the first message, set information as such
						if (databaseEmptyFlag) {
							embed.setTitle('🥇 First bump this iteration! 🥇');
							embed.setDescription(`<@${row.user_id}> bumped the server, and managed to be the first!\n${formatStreakProgress(streakCountVariable)}`);
							embed.setFooter({ text: row.bumps + ' bump this week!' });
							embed.setColor(0x5865F2);
						}
						// normal bump
						else if (streakCountVariable <= 2) {
							embed.setTitle('Normal Bump Logged!');
							embed.setDescription(`<@${row.user_id}> bumped the server!\n${formatStreakProgress(streakCountVariable)}`);
							embed.setFooter({ text: row.bumps + ' bump this week!' });
							embed.setColor(0x5865F2);
						}
						// blazing streak
						else if (streakCountVariable <= 6) {
							embed.setTitle('🔥 Blazing Streak Bump 🔥');
							embed.setDescription(`<@${row.user_id}> bumped the server!\n${formatStreakProgress(streakCountVariable)}`);
							embed.setFooter({ text: row.bumps + ' bumps this week!' });
							embed.setColor(0xF1C40F);
						}
						// wildfire streak
						else if (streakCountVariable <= 11) {
							embed.setTitle('🚀🚀 Unstoppable Streak Bump! 🚀🚀');
							embed.setDescription(`<@${row.user_id}> bumped the server!\n${formatStreakProgress(streakCountVariable)}`);
							embed.setFooter({ text: row.bumps + ' bumps this week!' });
							embed.setColor(0xE67E22);
						}
						// legendary streak
						else if (streakCountVariable >= 12) {
							embed.setTitle('👑👑👑 LEGENDARY STREAK BUMP! 👑👑👑');
							embed.setDescription(`<@${row.user_id}> bumped the server!\n${formatStreakProgress(streakCountVariable)}`);
							embed.setFooter({ text: row.bumps + ' bumps this week!' });
							embed.setColor(0xE74C3C);
						}

					}
					// if there was indeed a break of streak, and setting the message as follows for the scale of bump broken.
					else if (streakBreakFlag == 1) {
						embed.setTitle('❌ Blazing Streak Broken ❌');
						embed.setDescription(`<@${row.user_id}> bumped the server!\nYou broke <@${streakRow.user_id}>'s streak of ${streakCountStatic}!\n${formatStreakProgress(streakCountVariable)}`);
						embed.setFooter({ text: row.bumps + ' bumps this week!' });
						embed.setColor(0x9B59B6);
					}
					else if (streakBreakFlag == 2) {
						embed.setTitle('❌🚀 Unstoppable Streak Broken 🚀❌');
						embed.setDescription(`<@${row.user_id}> bumped the server!\nCongratulations! You've broken <@${streakRow.user_id}>'s long held streak of ${streakCountStatic}!\n${formatStreakProgress(streakCountVariable)}`);
						embed.setFooter({ text: row.bumps + ' bumps this week!' });
						embed.setColor(0x9B59B6);
					}
					else if (streakBreakFlag == 3) {
						embed.setTitle('❌👑❌ LEGENDARY STREAK BROKEN! ❌👑❌');
						embed.setDescription(`<@${row.user_id}> bumped the server!\nYou are now dubbed Kingslayer, breaking <@${streakRow.user_id}>'s lineage of ${streakCountStatic} bumps!\n${formatStreakProgress(streakCountVariable)}`);
						embed.setFooter({ text: row.bumps + ' bumps this week!' });
						embed.setColor(0x9B59B6);
					}

					// adding rank to the bottom, for extra flair
					if (rank > 0) {
						embed.addFields({ name: 'Total Bump Ranking', value: `#${rank} out of ${topBumpers.length}`, inline: true });
					}
				}
			});
			// Update multiplier first
			await updateMultiplier(userId, message.guild);

			// Calculate crown reward
			const streakInfo = {
				currentStreak: streakCountVariable,
				brokeStreak: streakBreakFlag > 0,
				brokenTier: streakBreakFlag === 1 ? 'blazing' :
					streakBreakFlag === 2 ? 'unstoppable' :
						streakBreakFlag === 3 ? 'legendary' : 'normal',
			};

			const reward = calculateBumpReward(userId, message.guild, streakInfo);

			// Update user's crowns
			db.prepare(`
					INSERT INTO user_economy (user_id, crowns)
					VALUES (?, ?)
					ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
				`).run(userId, reward.amount, reward.amount);

			// Add reward info to embed
			if (streakBreakFlag === 0) {
				embed.addFields({
					name: '👑 Crowns Earned',
					value: `You earned ${reward.amount} Crowns [🔁 \`${reward.multiplierUsed}X\` **MULTI**] for your ${reward.streakTier} bump!`,
					inline: false,
				});
			}
			else {
				embed.addFields({
					name: '👑 Crowns Earned',
					value: `You earned ${reward.amount} Crowns [🔁 \`${reward.multiplierUsed}X\` **MULTI**] for breaking a ${reward.brokenTier} streak!`,
					inline: false,
				});
			}
			console.log(`[messageCreate] Added ${reward.amount} [${reward.multiplierUsed}X Multi] to ${message.interactionMetadata.user.displayName} for ${streakBreakFlag === 0 ? `keeping the ${reward.streakTier} streak.` : `streak breaking a ${reward.brokenTier}.`}`);

			// update the leaderboard message as defined in the bump_leaderboard table
			await updateLeaderboard(message.client);
			console.log('[messageCreate] Leaderboard was successfully updated.');

			// delete the disboard message, and send the embed with the final stylization
			await message.delete().catch(() => null);
			await message.channel.send({ embeds: [embed] });
			console.log('[messageCreate] Deleted the Disboard message, sent the bump message.');

		}

		if (message.channel.id === '1353631829453836291' && !message.author.bot) {
			// Skip if message doesn't pass quality check
			if (!isQualityWelcome(message)) return;

			const userId = message.author.id;
			const IMPORTANT_CHANNELS = new Set([
				// #getting-started-guide
				'1375496710440358022',
				// #rules
				'1353632019233378415',
				// #selfroles
				'1353631851734106165',
				// #verify-here
				'1375485421990969487',
				// #introductions
				'1354166019203268679',
			]);

			// 1. Find the current active welcome session (the most recent new member)
			const activeWelcome = db.prepare(`
				SELECT message_id, new_member_id FROM welcome_messages 
				ORDER BY welcome_time DESC 
				LIMIT 1
			`).get();

			// No one has joined since the bot started.
			if (!activeWelcome) return;

			// Prevent the new member from welcoming themselves
			if (userId === activeWelcome.new_member_id) return;

			const welcomeId = activeWelcome.message_id;

			try {
				// 2. Check if this user has already been rewarded for welcoming this member
				const alreadyWelcomed = db.prepare(`
					SELECT 1 FROM welcome_rewards_log 
					WHERE welcome_id = ? AND welcomer_id = ?
				`).get(welcomeId, userId);

				// Already got a reward for this one.
				if (alreadyWelcomed) return;

				// 3. Count how many people have already welcomed to calculate diminishing returns
				const welcomerCount = db.prepare(`
					SELECT COUNT(id) as count FROM welcome_rewards_log
					WHERE welcome_id = ?
				`).get(welcomeId).count;

				// 4. Calculate base reward (100%, 75%, 50%, then 25% for all subsequent)
				const baseRewardTiers = [1.0, 0.75, 0.50, 0.25];
				const tierIndex = Math.min(welcomerCount, baseRewardTiers.length - 1);
				const baseAmount = Math.ceil(25 * baseRewardTiers[tierIndex]);

				// 5. Find which important channels were mentioned and if they are new
				const mentionedChannelIds = message.content.match(/<#(\d+)>/g)?.map(m => m.replace(/[<#>]/g, '')) || [];
				const alreadyMentionedChannels = new Set(
					db.prepare('SELECT channel_id FROM welcome_mentioned_channels WHERE welcome_id = ?')
						.all(welcomeId).map(row => row.channel_id),
				);
				const newMentions = [...new Set(mentionedChannelIds)].filter(id =>
					IMPORTANT_CHANNELS.has(id) && !alreadyMentionedChannels.has(id),
				);

				// 6. Calculate bonus reward (10 per new channel, does not diminish)
				const bonusAmount = newMentions.length * 10;

				// Nothing to reward
				if (baseAmount === 0 && bonusAmount === 0) return;

				// 7. Calculate total payout with multiplier
				const multiplier = await updateMultiplier(userId, message.guild);
				const totalPayout = Math.floor((baseAmount + bonusAmount) * multiplier);

				if (totalPayout === 0) return;

				// 8. Use a transaction to ensure all database updates succeed or fail together
				const transaction = db.transaction(() => {
					db.prepare(`
						INSERT INTO user_economy (user_id, crowns) VALUES (?, ?)
						ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
					`).run(userId, totalPayout, totalPayout);

					db.prepare(`
						INSERT INTO welcome_rewards_log (welcome_id, welcomer_id, payout) VALUES (?, ?, ?)
					`).run(welcomeId, userId, totalPayout);

					const insertMention = db.prepare(`
						INSERT INTO welcome_mentioned_channels (welcome_id, channel_id, mentioned_by) 
						VALUES (?, ?, ?)
					`);
					for (const channelId of newMentions) {
						insertMention.run(welcomeId, channelId, userId);
					}
				});

				transaction();

				// 9. Send a detailed reward notification
				const rewardEmbed = new EmbedBuilder()
					.setColor('#2ecc71')
					.setDescription(`🎉 <@${userId}> was rewarded for welcoming our new member!`)
					.setFooter({ text: 'Thank you for helping us welcome new members!' })
					.setTimestamp();

				let breakdown = `Base: ${baseAmount} | Bonus: ${bonusAmount}`;
				if (multiplier > 1.0) {
					breakdown += ` | Multiplier: ${multiplier}x`;
				}

				rewardEmbed.addFields(
					{ name: 'Total Earned', value: `**${totalPayout}** Crowns`, inline: false },
					{ name: 'Breakdown', value: `\`${breakdown}\``, inline: false },
				);

				await message.channel.send({ embeds: [rewardEmbed] });
				console.log(`[messageCreate] [WELCOME] ${message.author.displayName} earned ${totalPayout} Crowns for welcoming. (Base: ${baseAmount}, Bonus: ${bonusAmount}, Multi: ${multiplier}x)`);

			}
			catch (error) {
				console.error('Error processing welcome reward:', error);
			}
		}


	},
};