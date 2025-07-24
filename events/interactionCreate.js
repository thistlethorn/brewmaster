// events/interactionCreate.js
const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { handleMotwEntry } = require('../utils/handleMotwGiveaway');
const { scheduleDailyReminder, sendReminder } = require('../tasks/dailyReminder');
const { updateMultiplier } = require('../utils/handleCrownRewards');
const db = require('../database');


function formatOption(option) {
	return `${option.name}:(${
		option.user ? `@${option.user.username}` :
			option.role ? `@${option.role.name}` :
				option.channel ? `#${option.channel.name}` :
					option.attachment ? '[Attachment]' :
						option.value !== undefined ? option.value : 'undefined'
	})`;
}

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		try {
			const subcommand = interaction.options?.getSubcommand(false) || null;
			const subcommandGroup = interaction.options?.getSubcommandGroup(false) || null;

			console.log(
				`[interactionCreate] [LOGS]${interaction.user.displayName ? ' [User: ' + interaction.user.displayName + ']' : ''}${interaction.commandName ?
					` [Command: /${interaction.commandName}${
						subcommandGroup ? ` ${subcommandGroup}` : ''
					}${
						subcommand ? ` ${subcommand}` : ''
					}${
						interaction.options.data.length ?
							` ${interaction.options.data.map(opt => {
								if (opt.type === 2) {
									return opt.options.map(subGroupOpt => {
										return (
											subGroupOpt.options?.length
												? subGroupOpt.options.map(formatOption).join(' ')
												: ''
										);
									}).join(' ');
								}
								else if (opt.type === 1) {
									return (
										opt.options?.length
											? opt.options.map(formatOption).join(' ')
											: ''
									);
								}
								else {
									return formatOption(opt);
								}
							}).join(' ')}` : ''
					}]` : ''
				}${
					interaction.isModalSubmit() ? ' [ModalSubmit]' : ''
				}${
					interaction.isButton() ? ' [Button]' : ''
				}${
					interaction.isAutocomplete() ? ' [Autocomplete]' : ''
				}`,
			);
			// Find the command for game buttons/modals
			const gameCommand = interaction.client.commands.get('gamble');
			const guildCommand = interaction.client.commands.get('guild');

			// Handle game modals first
			if (interaction.isModalSubmit() && interaction.customId.startsWith('gamble_')) {
				if (gameCommand && typeof gameCommand.modals?.handleModalSubmit === 'function') {
					try {
						await gameCommand.modals.handleModalSubmit(interaction);
						console.log(`[Execute] Successfully handled Gamble Modal, requested by ${interaction.user.displayName}`);
						return;
					}
					catch (error) {
						console.error('[Error] Gamble modal interaction error:', error);
						await interaction.reply({
							content: 'There was an error processing your bet.',
							ephemeral: true,
						});
						return;
					}
				}
			}


			if (interaction.isModalSubmit() && interaction.customId.startsWith('fundraise_custommodal_')) {
				if (guildCommand && typeof guildCommand.buttons?.handleFundraiseCustomModal === 'function') {
					try {
						await guildCommand.buttons.handleFundraiseCustomModal(interaction);
						console.log(`[Execute] Successfully handled Fundraiser Custom Modal, requested by ${interaction.user.displayName}`);
						return;
					}
					catch (error) {
						console.error('[Error] Fundraiser modal interaction error:', error);
						await interaction.reply({
							content: 'There was an error processing your custom contribution.',
							ephemeral: true,
						});
						return;
					}
				}
			}
			// Handle button interactions first
			if (interaction.isButton()) {
				// --- DAILY NOTIFICATION BUTTON HANDLER ---
				if (interaction.customId.startsWith('daily_notify_')) {

					const parts = interaction.customId.split('_');
					// 'opt' or 'personal'
					const action = parts[2];
					// 'in' or 'out'
					const decision = parts[3];
					// The ID of the user who the message is for
					const targetUserId = parts[4];

					if (action === 'opt') {
						// --- SECURITY CHECK: Is the button clicker the intended user? ---
						if (interaction.user.id === targetUserId) {
							// YES: This is the correct user.
							const newStatus = decision === 'in' ? 1 : -1;

							db.prepare(`
								INSERT INTO daily_ping_preferences (user_id, opt_in_status)
								VALUES (?, ?)
								ON CONFLICT(user_id) DO UPDATE SET opt_in_status = ?
							`).run(targetUserId, newStatus, newStatus);

							if (newStatus === 1) {
								const userEcon = db.prepare('SELECT last_daily FROM user_economy WHERE user_id = ?').get(targetUserId);
								if (userEcon && userEcon.last_daily) {
									scheduleDailyReminder(interaction.client, targetUserId, new Date(userEcon.last_daily));
								}
							}

							const confirmationEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
							const confirmationText = newStatus === 1
								? '✅ You\'ve opted in! I\'ll send you a reminder 24 hours after your claim.'
								: '☑️ Got it. I won\'t show you this option again.';

							confirmationEmbed.setFooter({ text: confirmationText });

							await interaction.update({ embeds: [confirmationEmbed], components: [] });
						}
						else {
							// NO: A different user clicked the button.
							const row = new ActionRowBuilder()
								.addComponents(
									new ButtonBuilder()
										.setCustomId('daily_notify_personal_in')
										.setLabel('Yes, Notify Me!')
										.setStyle(ButtonStyle.Success)
										.setEmoji('🔔'),
									new ButtonBuilder()
										.setCustomId('daily_notify_personal_out')
										.setLabel('No, Thanks')
										.setStyle(ButtonStyle.Secondary),
								);
							await interaction.reply({
								content: '👋 That daily claim message isn\'t yours, but you can set your own notification preferences here!',
								components: [row],
								ephemeral: true,
							});
						}
						return;
					}
					else if (action === 'personal') {
						// --- PERSONAL NOTIFICATION BUTTON HANDLER (for the ephemeral message) ---
						const userId = interaction.user.id;
						const newStatus = decision === 'in' ? 1 : -1;

						if (newStatus === -1) {
							db.prepare('INSERT INTO daily_ping_preferences (user_id, opt_in_status) VALUES (?, -1) ON CONFLICT(user_id) DO UPDATE SET opt_in_status = -1').run(userId);
							await interaction.update({ content: '☑️ Got it. Your preference is saved!', components: [] });
							return;
						}

						// User wants to opt-in. First, set their status to opted-in.
						db.prepare('INSERT INTO daily_ping_preferences (user_id, opt_in_status) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET opt_in_status = 1').run(userId);

						const userData = db.prepare(`
							SELECT ue.last_daily, dpp.last_notified_claim_time
							FROM user_economy ue
							LEFT JOIN daily_ping_preferences dpp ON ue.user_id = dpp.user_id
							WHERE ue.user_id = ?
						`).get(userId);

						if (userData && userData.last_daily) {
							// User has claimed before. Check if they need an immediate reminder.
							if (userData.last_daily === userData.last_notified_claim_time) {
								// Already notified for this cycle. Just confirm their opt-in.
								scheduleDailyReminder(interaction.client, userId, new Date(userData.last_daily));
								await interaction.update({ content: '✅ You\'re opted in! I\'ll send you a reminder for your next claim.', components: [] });
								return;
							}

							const now = new Date();
							const lastClaimTime = new Date(userData.last_daily);
							const reminderTime = new Date(lastClaimTime.getTime() + 24 * 60 * 60 * 1000);
							const streakExpiryTime = new Date(lastClaimTime.getTime() + 48 * 60 * 60 * 1000);

							if (streakExpiryTime > now && reminderTime <= now) {
								// They are eligible for a claim right now and haven't been notified.
								sendReminder(interaction.client, userId, userData.last_daily);
								await interaction.update({ content: '✅ You\'re opted in! You can claim your daily right now, so I\'ve sent you a reminder in the channel.', components: [] });
							}
							else {
								// They are not yet eligible. Schedule for the future.
								scheduleDailyReminder(interaction.client, userId, lastClaimTime);
								await interaction.update({ content: '✅ You\'re opted in! I\'ll send you a reminder when your next daily is ready.', components: [] });
							}
						}
						else {
							// --- MANUAL FIRST-TIME CLAIM LOGIC ---
							const now = new Date();
							const baseAmount = 20;
							const guildInfo = db.prepare('SELECT gt.tier FROM guildmember_tracking gmt JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag WHERE gmt.user_id = ?').get(userId);
							const guildBonus = guildInfo ? guildInfo.tier * 5 : 0;
							const multiplier = await updateMultiplier(userId, interaction.guild);
							const payout = Math.floor((baseAmount + guildBonus) * multiplier);

							db.prepare(`
								INSERT INTO user_economy (user_id, crowns, last_daily, multiplier, daily_streak, daily_prestige)
								VALUES (?, ?, ?, ?, 1, 0)
								ON CONFLICT(user_id) DO UPDATE SET
									crowns = crowns + ?,
									last_daily = ?,
									multiplier = ?,
									daily_streak = 1,
									daily_prestige = 0
							`).run(userId, payout, now.toISOString(), multiplier, payout, now.toISOString(), multiplier);

							scheduleDailyReminder(interaction.client, userId, now);
							await interaction.update({ content: `✅ Welcome! You've received your first daily bonus of **${payout}** Crowns and have been opted-in for future reminders.`, components: [] });
						}
						return;
					}
				}


				if (interaction.customId === 'motw_enter') {
					try {
						await handleMotwEntry(interaction);
						console.log(`[Execute] Successfully handled MotW entry, requested by ${interaction.user.displayName}`);
					}
					catch (error) {
						console.error('[Error] MotW entry button interaction error:', error);
						// The handleMotwEntry function already replies, so we just log here.
					}
					return;
					// Stop further processing
				}
				if (interaction.customId.startsWith('gamble_')) {
					if (gameCommand && typeof gameCommand.buttons?.handleGameButton === 'function') {
						try {
							await gameCommand.buttons.handleGameButton(interaction);
							console.log(`[Execute] Successfully handled Gamble Button, requested by ${interaction.user.displayName}`);
							return;
						}
						catch (error) {
							console.error('[Error] Gamble button interaction error:', error);
							await interaction.reply({
								content: 'There was an error processing this game action.',
								ephemeral: true,
							});
							return;
						}
					}
				}

				// Handle raid cancel/upgrade cancel
				if (interaction.customId === 'raid_cancel' || interaction.customId === 'upgrade_cancel' || interaction.customId === 'shield_cancel') {
					try {
						await interaction.update({
							content: 'Action cancelled.',
							components: [],
							embeds: [],
						});
						return;
					}
					catch (error) {
						console.error('[Error] Cancel button interaction error:', error);
						await interaction.reply({
							content: 'There was an error cancelling this action.',
							ephemeral: true,
						});
						return;
					}
				}
				if (interaction.customId.startsWith('join_attack_') || interaction.customId.startsWith('aid_defence_')) {
					if (!guildCommand) {
						console.error('[Error] Guild command not found for alliance button handling');
						return;
					}

					try {
						// This specifically calls the function to handle joining a raid alliance
						await guildCommand.buttons.handleAllianceJoin(interaction);
						console.log(`[Execute] Successfully handled a Guild Alliance Button (${interaction.customId}), requested by ${interaction.user.displayName}`);
						return;
					}
					catch (error) {
						console.error(`[Error] Alliance Join button interaction error for ${interaction.customId}:`, error);
						// Use followUp if the interaction was already deferred in the handler
						const replyMethod = interaction.deferred ? 'followUp' : 'reply';
						await interaction[replyMethod]({
							content: 'There was an error processing this raid action.',
							ephemeral: true,
						});
						return;
					}
				}
				// Handle all guild-related buttons by routing them to the 'guild' command file.
				if (interaction.customId.startsWith('guild_') || interaction.customId.startsWith('raid_') || interaction.customId.startsWith('upgrade_') || interaction.customId.startsWith('shield_') || interaction.customId.startsWith('fundraise_') || interaction.customId.startsWith('raidmsg_')) {
					if (!guildCommand) {
						console.error('[Error] Guild command not found for button handling');
						return;
					}

					try {
						if (interaction.customId.startsWith('guild_invite_')) {
							await guildCommand.buttons.handleInviteResponse(interaction);
						}
						else if (interaction.customId.startsWith('raid_confirm_')) {
							await guildCommand.buttons.handleRaidConfirmation(interaction);
						}
						else if (interaction.customId.startsWith('upgrade_confirm_')) {
							await guildCommand.buttons.handleUpgradeConfirmation(interaction);
						}
						else if (interaction.customId.startsWith('shield_confirm_')) {
							await guildCommand.buttons.handleShieldConfirmation(interaction);
						}
						else if (interaction.customId.startsWith('fundraise_')) {
							await guildCommand.buttons.handleFundraiseButton(interaction);
						}
						else if (interaction.customId.startsWith('raidmsg_')) {
							await guildCommand.buttons.handleRaidMessageButton(interaction);
						}

						console.log(`[Execute] Successfully handled a Guild Button (${interaction.customId}), requested by ${interaction.user.displayName}`);
						return;
					}
					catch (error) {
						console.error(`[Error] Button interaction error for ${interaction.customId}:`, error);
						await interaction.reply({
							content: 'There was an error processing this button interaction.',
							ephemeral: true,
						});
						return;
					}
				}

			}

			const command = interaction.client.commands.get(interaction.commandName);

			if (!command) {
				console.error(`[Error] No command matching ${interaction.commandName} was found.`);
				return;
			}

			try {
				await command.execute(interaction);
				console.log(`[Execute] Successfully ran /${interaction.commandName}, requested by ${interaction.user.displayName}`);
			}
			catch (error) {
				console.error('[Command Execution Error]', error);

				const errorMessage = error.code === 'SQLITE_ERROR'
					? 'A database error occurred. Please try again later.'
					: 'There was an error while executing this command!';

				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({
						content: errorMessage,
						ephemeral: true,
					});
				}
				else {
					await interaction.reply({
						content: errorMessage,
						ephemeral: true,
					});
				}
			}
		}
		catch (topLevelError) {
			console.error('[Top Level Interaction Error]', topLevelError);
		}

	},
};