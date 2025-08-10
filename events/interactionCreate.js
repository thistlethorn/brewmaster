// events/interactionCreate.js
const { Events, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { handleMotwEntry } = require('../utils/handleMotwGiveaway');
const { scheduleDailyReminder, sendReminder } = require('../tasks/dailyReminder');
const { updateMultiplier } = require('../utils/handleCrownRewards');
const sendMessageToChannel = require('../utils/sendMessageToChannel');
const config = require('../config.json');
const db = require('../database');
const BOT_COMMANDS_CHANNEL_ID = config?.discord?.botCommandsId || '1354187940246327316';


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
			const gameCommand = interaction.client.commands.get('gamble');
			const guildCommand = interaction.client.commands.get('guild');

			if (interaction.isModalSubmit() && interaction.customId.startsWith('gamble_')) {
				if (gameCommand && typeof gameCommand.modals?.handleModalSubmit === 'function') {
					try {
						await gameCommand.modals.handleModalSubmit(interaction);
						console.log(`[Execute] Successfully handled Gamble Modal, requested by ${interaction.user.displayName}`);
						return;
					}
					catch (error) {
						console.error('[Error] Gamble modal interaction error:', error);
						await interaction.reply({ content: 'There was an error processing your bet.', flags: [MessageFlags.Ephemeral] });
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
						await interaction.reply({ content: 'There was an error processing your custom contribution.', flags: [MessageFlags.Ephemeral] });
						return;
					}
				}
			}
			if (interaction.isButton()) {

				if (interaction.customId.startsWith('tony_quote_')) {
					const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
					if (!member || !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
						return interaction.reply({ content: 'You are not authorized to perform this action.', flags: [MessageFlags.Ephemeral] });
					}

					const [, , action, pendingId] = interaction.customId.split('_');
					if (!action || !pendingId || !/^\d+$/.test(pendingId)) {
						return interaction.reply({ content: 'Malformed interaction.', flags: [MessageFlags.Ephemeral] });
					}

					const pendingQuote = db.prepare('SELECT * FROM tony_quotes_pending WHERE id = ?').get(pendingId);
					if (!pendingQuote) {
						return interaction.update({ content: 'This submission was already handled or has an error.', embeds: [], components: [] });
					}

					const { trigger_word, quote_text, user_id, quote_type } = pendingQuote;

					const baseEmbed = interaction.message.embeds?.[0];
					const originalEmbed = baseEmbed ? new EmbedBuilder(baseEmbed.data) : new EmbedBuilder();
					const firstRow = interaction.message.components?.[0];
					const row = firstRow
						? new ActionRowBuilder().addComponents(
							...firstRow.components.map(c => ButtonBuilder.from(c).setDisabled(true)),
						)
						: null;
					if (action === 'approve') {
						db.transaction(() => {
							// atomically delete the pending row and ensure it wasn’t already handled
							const stillPending = db
								.prepare('DELETE FROM tony_quotes_pending WHERE id = ? RETURNING 1')
								.get(pendingId);
							if (!stillPending) throw new Error('Quote has already been processed');

							db.prepare(`
                                INSERT INTO tony_quotes_active (trigger_word, quote_text, user_id, quote_type)
                                VALUES (?, ?, ?, ?)
                            `).run(trigger_word, quote_text, user_id, quote_type);
						})();

						originalEmbed
							.setColor(0x2ECC71)
							.setFooter({ text: `Approved by ${interaction.user.username}` });
						await interaction.update({
							embeds: [originalEmbed],
							components: row ? [row] : [],
						});
					}
					else if (action === 'reject') {
						const refundAmount = quote_type === 'idle' ? 100 : 200;
						db.transaction(() => {
							db.prepare(`
                                INSERT INTO user_economy (user_id, crowns) VALUES (?, ?)
                                ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
                            `).run(user_id, refundAmount, refundAmount);
							db.prepare('DELETE FROM tony_quotes_pending WHERE id = ?').run(pendingId);
						})();
						originalEmbed.setColor(0xE74C3C).setFooter({ text: `Rejected by ${interaction.user.username}` });
						await interaction.update({ embeds: [originalEmbed], components: [row] });

						const typeText = quote_type === 'idle' ? 'idle phrase' : `trigger quote for \`${trigger_word}\``;
						const rejectionMessage = `Hey <@${user_id}>, your Tony Quote submission for the ${typeText} wasn't approved this time. The **${refundAmount} Crowns** have been refunded to your account.`;
						await sendMessageToChannel(interaction.client, BOT_COMMANDS_CHANNEL_ID, rejectionMessage);
					}
					return;
				}
				// handle Tony Quote view button
				else if (interaction.customId.startsWith('tonyquote_view_')) {
					const cmd = interaction.client.commands.get('tonyquote');
					if (cmd && typeof cmd.execute === 'function') {
						return cmd.execute(interaction);
			    	}
			    }

				else if (interaction.customId.startsWith('guild_info_')) {
					if (guildCommand && typeof guildCommand.buttons?.handleGuildInfoButton === 'function') {
						return guildCommand.buttons.handleGuildInfoButton(interaction);
					}
				}
				else if (interaction.customId.startsWith('guild_show_lore_')) {
					const guildTag = interaction.customId.split('_')[3];
					try {
						const guild = db.prepare('SELECT guild_name, lore FROM guild_list WHERE guild_tag = ?').get(guildTag);
						if (!guild || !guild.lore) {
							return interaction.reply({ content: 'This guild has not written its lore yet.', flags: [MessageFlags.Ephemeral] });
						}
						const loreEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📜 Lore of ${guild.guild_name}`).setDescription(guild.lore);
						return interaction.reply({ embeds: [loreEmbed], flags: [MessageFlags.Ephemeral] });
					}
					catch (error) {
						console.error('[Error] Failed to fetch guild lore:', error);
						return interaction.reply({ content: 'There was an error fetching the guild lore. Please try again later.', flags: [MessageFlags.Ephemeral] });
					}
				}
				else if (interaction.customId.startsWith('daily_notify_')) {

					const parts = interaction.customId.split('_');
					const action = parts[2];
					const decision = parts[3];
					const targetUserId = parts[4];

					if (action === 'opt') {
						if (interaction.user.id === targetUserId) {
							const newStatus = decision === 'in' ? 1 : -1;
							db.prepare('INSERT INTO daily_ping_preferences (user_id, opt_in_status) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET opt_in_status = ?').run(targetUserId, newStatus, newStatus);
							if (newStatus === 1) {
								const userEcon = db.prepare('SELECT last_daily FROM user_economy WHERE user_id = ?').get(targetUserId);
								if (userEcon && userEcon.last_daily) {
									scheduleDailyReminder(interaction.client, targetUserId, new Date(userEcon.last_daily));
								}
							}
							const confirmationEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
							const confirmationText = newStatus === 1 ? '✅ You\'ve opted in! I\'ll send you a reminder 24 hours after your claim.' : '☑️ Got it. I won\'t show you this option again.';
							confirmationEmbed.setFooter({ text: confirmationText });
							await interaction.update({ embeds: [confirmationEmbed], components: [] });
						}
						else {
							const row = new ActionRowBuilder().addComponents(
								new ButtonBuilder().setCustomId('daily_notify_personal_in').setLabel('Yes, Notify Me!').setStyle(ButtonStyle.Success).setEmoji('🔔'),
								new ButtonBuilder().setCustomId('daily_notify_personal_out').setLabel('No, Thanks').setStyle(ButtonStyle.Secondary),
							);
							await interaction.reply({ content: '👋 That daily claim message isn\'t yours, but you can set your own notification preferences here!', components: [row], flags: [MessageFlags.Ephemeral] });
						}
						return;
					}
					else if (action === 'personal') {
						const userId = interaction.user.id;
						const newStatus = decision === 'in' ? 1 : -1;

						if (newStatus === -1) {
							db.prepare('INSERT INTO daily_ping_preferences (user_id, opt_in_status) VALUES (?, -1) ON CONFLICT(user_id) DO UPDATE SET opt_in_status = -1').run(userId);
							await interaction.update({ content: '☑️ Got it. Your preference is saved!', components: [] });
							return;
						}

						db.prepare('INSERT INTO daily_ping_preferences (user_id, opt_in_status) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET opt_in_status = 1').run(userId);

						const userData = db.prepare('SELECT ue.last_daily, dpp.last_notified_claim_time FROM user_economy ue LEFT JOIN daily_ping_preferences dpp ON ue.user_id = dpp.user_id WHERE ue.user_id = ?').get(userId);

						if (userData && userData.last_daily) {
							if (userData.last_daily === userData.last_notified_claim_time) {
								scheduleDailyReminder(interaction.client, userId, new Date(userData.last_daily));
								await interaction.update({ content: '✅ You\'re opted in! I\'ll send you a reminder for your next claim.', components: [] });
								return;
							}
							const now = new Date();
							const lastClaimTime = new Date(userData.last_daily);
							const reminderTime = new Date(lastClaimTime.getTime() + 24 * 60 * 60 * 1000);
							const streakExpiryTime = new Date(lastClaimTime.getTime() + 48 * 60 * 60 * 1000);

							if (streakExpiryTime > now && reminderTime <= now) {
								sendReminder(interaction.client, userId, userData.last_daily);
								await interaction.update({ content: '✅ You\'re opted in! You can claim your daily right now, so I\'ve sent you a reminder in the channel.', components: [] });
							}
							else {
								scheduleDailyReminder(interaction.client, userId, lastClaimTime);
								await interaction.update({ content: '✅ You\'re opted in! I\'ll send you a reminder when your next daily is ready.', components: [] });
							}
						}
						else {
							const now = new Date();
							const baseAmount = 20;
							const guildInfo = db.prepare('SELECT gt.tier FROM guildmember_tracking gmt JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag WHERE gmt.user_id = ?').get(userId);
							const guildBonus = guildInfo ? guildInfo.tier * 5 : 0;
							const multiplier = await updateMultiplier(userId, interaction.guild);
							const payout = Math.floor((baseAmount + guildBonus) * multiplier);
							db.prepare('INSERT INTO user_economy (user_id, crowns, last_daily, multiplier, daily_streak, daily_prestige) VALUES (?, ?, ?, ?, 1, 0) ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?, last_daily = ?, multiplier = ?, daily_streak = 1, daily_prestige = 0').run(userId, payout, now.toISOString(), multiplier, payout, now.toISOString(), multiplier);
							scheduleDailyReminder(interaction.client, userId, now);
							await interaction.update({ content: `✅ Welcome! You've received your first daily bonus of **${payout}** Crowns and have been opted-in for future reminders.`, components: [] });
						}
						return;
					}
				}

				else if (interaction.customId === 'motw_enter') {
					try {
						await handleMotwEntry(interaction);
						console.log(`[Execute] Successfully handled MotW entry, requested by ${interaction.user.displayName}`);
					}
					catch (error) {
						console.error('[Error] MotW entry button interaction error:', error);
					}
					return;
				}
				else if (interaction.customId.startsWith('gamble_')) {
					if (gameCommand && typeof gameCommand.buttons?.handleGameButton === 'function') {
						try {
							await gameCommand.buttons.handleGameButton(interaction);
							console.log(`[Execute] Successfully handled Gamble Button, requested by ${interaction.user.displayName}`);
							return;
						}
						catch (error) {
							console.error('[Error] Gamble button interaction error:', error);
							await interaction.reply({ content: 'There was an error processing this game action.', flags: [MessageFlags.Ephemeral] });
							return;
						}
					}
				}

				else if (interaction.customId === 'raid_cancel' || interaction.customId === 'upgrade_cancel' || interaction.customId === 'shield_cancel') {
					try {
						await interaction.update({ content: 'Action cancelled.', components: [], embeds: [] });
						return;
					}
					catch (error) {
						console.error('[Error] Cancel button interaction error:', error);
						await interaction.reply({ content: 'There was an error cancelling this action.', flags: [MessageFlags.Ephemeral] });
						return;
					}
				}
				else if (interaction.customId.startsWith('guild_') || interaction.customId.startsWith('raid_') || interaction.customId.startsWith('upgrade_') || interaction.customId.startsWith('shield_') || interaction.customId.startsWith('fundraise_') || interaction.customId.startsWith('raidmsg_')) {
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
						await interaction.reply({ content: 'There was an error processing this button interaction.', flags: [MessageFlags.Ephemeral] });
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
				const errorMessage = error.code === 'SQLITE_ERROR' ? 'A database error occurred. Please try again later.' : 'There was an error while executing this command!';
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
				}
				else {
					await interaction.reply({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
				}
			}
		}
		catch (topLevelError) {
			console.error('[Top Level Interaction Error]', topLevelError);
		}
	},
};