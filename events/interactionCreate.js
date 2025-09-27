// events/interactionCreate.js
const { Events, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { handleMonarchEntry } = require('../utils/handleMonarchGiveaway');
const { scheduleDailyReminder, sendReminder } = require('../tasks/dailyReminder');
const { updateMultiplier } = require('../utils/handleCrownRewards');
const sendMessageToChannel = require('../utils/sendMessageToChannel');
const config = require('../config.json');
const db = require('../database');
const { scrambleMessage } = require('../utils/translateText');
const BOT_COMMANDS_CHANNEL_ID = config?.discord?.botCommandsId || '1354187940246327316';
const { splitMessage } = require('../utils/messageUtils');


function formatOption(option) {
	return `${option.name}:(${
		option.user ? `@${option.user.username}` :
			option.role ? `@${option.role.name}` :
				option.channel ? `#${option.channel.name}` :
					option.attachment ? '[Attachment]' :
						option.value !== undefined ? option.value : 'undefined'
	})`;
}

async function sendIteratedChunks(contentToSend, interaction, ephemeral = false) {
	const chunks = splitMessage(contentToSend, 1950);

	for (let i = 0; i < chunks.length; i++) {
		const replyMethod = i === 0 ? (interaction.deferred ? 'editReply' : 'reply') : 'followUp';
		let chunk = chunks[i];

		if (chunks.length > 1) chunk = `*( ${i + 1} / ${chunks.length} )*\n\n${chunk}`;

		await interaction[replyMethod]({ content: chunk, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
	}
}

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		const characterCommand = interaction.client.commands.get('character');
		const inventoryCommand = interaction.client.commands.get('inventory');
		const marketCommand = interaction.client.commands.get('market');
		const shopCommand = interaction.client.commands.get('shop');
		const unsealCommand = interaction.client.commands.get('unseal');

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
				}${
					interaction.customId ? ` [customId: ${interaction.customId}]` : ''
				}`,
			);

			if (interaction.isAutocomplete()) {
				// 1. Find the command object based on the command name the user is typing.
				const command = interaction.client.commands.get(interaction.commandName);

				// 2. If the command doesn't exist or doesn't have an autocomplete handler, exit gracefully.
				if (!command || typeof command.autocomplete !== 'function') {
					console.error(`No autocomplete handler found for command "${interaction.commandName}".`);
					// Respond with an empty array to satisfy Discord's API.
					await interaction.respond([]);
					return;
				}

				// 3. Delegate the autocomplete logic to the specific command's handler.
				try {
					await command.autocomplete(interaction);
				}
				catch (error) {
					console.error(`Error in autocomplete for command "${interaction.commandName}":`, error);
					// If an error occurs, still respond so the interaction doesn't fail.
					if (!interaction.responded) {
						await interaction.respond([]);
					}
				}
				return;
			}

			if (interaction.isModalSubmit() && interaction.customId.startsWith('shop_')) {
				if (shopCommand && typeof shopCommand.modals === 'function') {
					try {
						await shopCommand.modals(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Shop modal error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your shop action.', flags: MessageFlags.Ephemeral });
						}
					}
				}
				return;
			}
			if (interaction.isButton() && interaction.customId.startsWith('shop_')) {
				if (shopCommand && typeof shopCommand.buttons === 'function') {
					try {
						await shopCommand.buttons(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Shop button error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your shop action.', flags: MessageFlags.Ephemeral });
						}
					}
				}
				return;
			}
			if (interaction.isStringSelectMenu() && interaction.customId.startsWith('shop_')) {
				if (shopCommand && typeof shopCommand.menus === 'function') {
					try {
						await shopCommand.menus(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Shop menu error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your shop action.', flags: MessageFlags.Ephemeral });
						}
					}
				}
				return;
			}
			if (interaction.isStringSelectMenu() && interaction.customId.startsWith('unseal_')) {
				if (unsealCommand && typeof unsealCommand.menus === 'function') {
					try {
						await unsealCommand.menus(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Unseal menu error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your selection.', flags: MessageFlags.Ephemeral });
						}
					}
				}
				return;
			}
			if (interaction.isButton() && interaction.customId.startsWith('captcha_verify_')) {
				const clickedAnswer = interaction.customId.split('_')[2];
				const messageId = interaction.message.id;
				const userId = interaction.user.id;

				const session = db.prepare('SELECT * FROM captcha_sessions WHERE message_id = ?').get(messageId);

				if (!session) {
					return interaction.update({ content: 'This verification has expired or is invalid.', components: [], embeds: [], files: [] }).catch((e) => {console.error(e);});
				}

				if (session.user_id !== userId) {
					return interaction.reply({ content: 'This is not your verification prompt.', flags: MessageFlags.Ephemeral });
				}

				if (clickedAnswer === session.correct_answer) {
					// SUCCESS
					try {
						const verifiedRole = await interaction.guild.roles.fetch(config.discord.verifiedRoleId);
						const unverifiedRole = await interaction.guild.roles.fetch(config.discord.unverifiedRoleId);

						if (verifiedRole) {
							await interaction.member.roles.add(verifiedRole);
						}
						else {
							console.warn('[CAPTCHA] Verified Role ID is invalid or role was not found.');
						}

						if (unverifiedRole) {
							await interaction.member.roles.remove(unverifiedRole);
						}
						else {
							console.warn('[CAPTCHA] UNverified Role ID is invalid or role was not found.');
						}

						// Award 1,000 Crowns
						db.prepare(`
							INSERT INTO user_economy (user_id, crowns) VALUES (?, 1000)
							ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + 1000
						`).run(userId);

						const successEmbed = new EmbedBuilder()
							.setColor(0x2ECC71)
							.setTitle('✅ Verification Successful!')
							.setDescription(`Welcome to the Westwind Tavern, ${interaction.user.displayName}! You now have access to the server. **1,000 Crowns** have been added to your account.`);

						await interaction.update({ embeds: [successEmbed], components: [], files: [] });
						db.prepare('DELETE FROM captcha_sessions WHERE message_id = ?').run(messageId);

					}
					catch (error) {
						console.error('[CAPTCHA] Success handling error:', error);
						await interaction.reply({ content: 'Verification succeeded, but there was an error granting your role. Please contact staff.', flags: MessageFlags.Ephemeral });
					}
				}
				else {
					// FAILURE
					const newAttempts = session.attempts_left - 1;

					if (newAttempts > 0) {
						db.prepare('UPDATE captcha_sessions SET attempts_left = ? WHERE message_id = ?').run(newAttempts, messageId);
						await interaction.reply({
							content: `❌ Incorrect. You have **${newAttempts}** attempt remaining.`,
							flags: MessageFlags.Ephemeral,
						});
					}
					else {
						// Final failure
						try {
							const dmEmbed = new EmbedBuilder()
								.setColor(0xE74C3C)
								.setTitle('Verification Failed')
								.setDescription('You failed to solve the CAPTCHA and have been removed from the Westwind Tavern. You are welcome to try again!')
								.addFields({ name: 'Re-join Link', value: 'https://dsc.gg/westwindtavern' });

							await interaction.user.send({ embeds: [dmEmbed] }).catch((e) => {console.error(e);});
							await interaction.member.kick('Failed CAPTCHA verification.');

							const failedEmbed = new EmbedBuilder()
								.setColor(0xE74C3C)
								.setTitle('Verification Failed')
								.setDescription(`${interaction.user.username} failed the verification and has been removed.`);

							await interaction.update({ embeds: [failedEmbed], components: [], files: [] });
							db.prepare('DELETE FROM captcha_sessions WHERE message_id = ?').run(messageId);

						}
						catch (error) {
							console.error('[CAPTCHA] Final failure handling error:', error);
							await interaction.update({ content: 'Verification failed. An error occurred while trying to remove you from the server.', components: [] });
						}
					}
				}
				return;
			}
			if (interaction.isButton() && interaction.customId === 'start_char_creation') {
				if (characterCommand && typeof characterCommand.handleCreate === 'function') {
					// This directly calls the function that starts the character creation modal flow.
					await characterCommand.handleCreate(interaction);
				}
				else {
					await interaction.reply({ content: 'Character creation is currently unavailable.', flags: MessageFlags.Ephemeral });
				}
				return;
			}

			if (interaction.isButton() && interaction.customId.startsWith('opt_out_char_creation_')) {
				const clickerId = interaction.user.id;
				const intendedUserId = interaction.customId.split('_')[4];

				if (clickerId !== intendedUserId) {
					return interaction.reply({ content: 'This is not your message to opt out from!', flags: MessageFlags.Ephemeral });
				}
				try {
					// Add user to the opt-out list. INSERT OR IGNORE prevents errors if they click it multiple times.
					db.prepare('INSERT OR IGNORE INTO character_creation_opt_out (user_id) VALUES (?)').run(intendedUserId);
					// Disable the buttons on the original message to show the action was completed.
					const originalEmbed = interaction.message.embeds[0];
					const disabledRow = new ActionRowBuilder();
					for (const component of interaction.message.components[0].components) {
						disabledRow.addComponents(ButtonBuilder.from(component).setDisabled(true));
					}

					// Update the original message with a confirmation.
					await interaction.update({
						embeds: [originalEmbed],
						components: [disabledRow],
						content: 'Your preference has been saved. You won\'t see this prompt again.',
					});
				}
				catch (error) {
					console.error('[Opt-Out Error] Failed to save user preference:', error);
					await interaction.reply({ content: 'An error occurred while saving your preference.', flags: MessageFlags.Ephemeral });
				}
				return;
			}

			if (interaction.isModalSubmit() && interaction.customId.startsWith('char_')) {
				if (characterCommand && typeof characterCommand.modals === 'function') {
					try {
						await characterCommand.modals(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Character modal error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your character details.', flags: MessageFlags.Ephemeral });
						}
					}
				}
				return;
			}
			if (interaction.isButton() && interaction.customId.startsWith('char_')) {
				if (characterCommand && typeof characterCommand.buttons === 'function') {
					try {
						await characterCommand.buttons(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Character button error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your selection.', flags: MessageFlags.Ephemeral });
						}
					}
				}
				return;
			}
			if (interaction.isStringSelectMenu() && interaction.customId.startsWith('char_')) {
				if (characterCommand && typeof characterCommand.menus === 'function') {
					try {
						await characterCommand.menus(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Character menu error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your selection.', flags: MessageFlags.Ephemeral });
						}
					}
				}
				return;
			}
			if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('speak_')) {
				const parts = interaction.customId.split('_');
				const [, action, subAction] = parts;

				const messageId = parts[parts.length - 1];

				const spokenMessage = db.prepare('SELECT * FROM spoken_messages WHERE message_id = ?').get(messageId);
				if (!spokenMessage) {
					return interaction.reply({ content: 'This message is too old to be translated.', flags: MessageFlags.Ephemeral });
				}
				if (interaction.user.id === spokenMessage.speaker_user_id) {
					return interaction.reply({ content: `You wrote the message:\n\n${spokenMessage.original_content}`, flags: MessageFlags.Ephemeral });
				}
				const translatorCharacter = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(interaction.user.id);
				if (!translatorCharacter) {
					return interaction.reply({ content: 'You need a character to attempt a translation.', flags: MessageFlags.Ephemeral });
				}
				const language = db.prepare('SELECT name, avatar_url, scramble_type FROM languages WHERE language_id = ?').get(spokenMessage.language_id);

				const updateFluency = (points) => {
					const result = db.prepare(`
						INSERT INTO character_languages (user_id, language_id, fluency_points) VALUES (?, ?, ?)
						ON CONFLICT(user_id, language_id) DO UPDATE SET
							fluency_points = MIN(100, fluency_points + excluded.fluency_points)
						RETURNING fluency_points
					`).get(interaction.user.id, spokenMessage.language_id, points);
					return result.fluency_points;
				};

				// --- MODAL SUBMISSION HANDLER ---
				if (interaction.isModalSubmit() && action === 'wits' && subAction === 'submit') {
					const encodedSnippet = parts[4];
					const originalSnippet = Buffer.from(encodedSnippet, 'base64').toString('utf8');
					const userGuess = interaction.fields.getTextInputValue('wits_guess_input');
					const originalWords = originalSnippet.toLowerCase().split(' ').filter(w => w);
					const guessWords = userGuess.toLowerCase().split(' ').filter(w => w);
					let correctWords = 0;
					for (let i = 0; i < originalWords.length; i++) {
						if (originalWords[i] === guessWords[i]) correctWords++;
					}
					const successRatio = originalWords.length > 0 ? correctWords / originalWords.length : 0;
					const points = successRatio === 1 ? 3 : (successRatio > 0.5 ? 2 : 1);
					updateFluency(points);

					db.prepare('INSERT OR IGNORE INTO translation_attempts (message_id, translator_user_id, attempt_method, success_ratio) VALUES (?, ?, ?, ?)').run(messageId, interaction.user.id, 'wits', successRatio);

					const successEmbed = new EmbedBuilder()
						.setColor(0x3498DB)
						.setTitle('🧠 Interpretation Attempt Logged')
						.setDescription(`You focus your mind and attempt to decode the message snippet.\n\nYour attempt has been recorded. Click below to view your interpretation based on a **${Math.round(successRatio * 100)}%** success rate.`)
						.setFooter({ text: `+${points} Fluency Points` });

					const row = new ActionRowBuilder().addComponents(
						new ButtonBuilder().setCustomId(`speak_translate_show_${messageId}`).setLabel('Show My Translation').setStyle(ButtonStyle.Success).setEmoji('📜'),
					);
					return interaction.update({ embeds: [successEmbed], components: [row] });
				}

				// --- BUTTON HANDLERS ---
				if (interaction.isButton() && action === 'translate') {
					const existingAttempt = db.prepare('SELECT * FROM translation_attempts WHERE message_id = ? AND translator_user_id = ?').get(messageId, interaction.user.id);

					// Handle showing a previously completed translation
					if (subAction === 'show') {
						if (!existingAttempt) return interaction.reply({ content: 'You have not attempted to translate this message yet.', flags: MessageFlags.Ephemeral });

						const revealedContent = scrambleMessage(spokenMessage.original_content, language.scramble_type, { decode: true, successRatio: existingAttempt.success_ratio });
						await sendIteratedChunks(revealedContent, interaction, true);
						return interaction.followUp({ content: `This is your interpretation of the message. Your percent of understanding was \`${existingAttempt.success_ratio}%\`!`, flags: MessageFlags.Ephemeral });
					}

					// Handle initiating a translation
					if (subAction === 'init') {
						if (existingAttempt) {
							const embed = new EmbedBuilder()
								.setColor(0x1ABC9C)
								.setTitle('Translation Already Attempted')
								.setDescription('You have already made an attempt to translate this message. You can view your previous interpretation.');
							const row = new ActionRowBuilder().addComponents(
								new ButtonBuilder().setCustomId(`speak_translate_show_${messageId}`).setLabel('Show My Translation').setStyle(ButtonStyle.Success).setEmoji('📜'),
							);
							return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
						}

						const translationEmbed = new EmbedBuilder()
							.setColor(0x95A5A6)
							.setTitle(`Translate message in ${language.name}`)
							.setThumbnail(language.avatar_url)
							.setDescription('The message appears to be scrambled nonsense!\nChoose a method to interpret its meaning. You only get one attempt!');
						const row = new ActionRowBuilder().addComponents(
							new ButtonBuilder().setCustomId(`speak_translate_direct_${messageId}`).setLabel(`Read The Message [Req. ${language.name}]`).setStyle(ButtonStyle.Primary).setEmoji('📖'),
							new ButtonBuilder().setCustomId(`speak_translate_fortune_${messageId}`).setLabel('Interpret by Luck [FORTUNE]').setStyle(ButtonStyle.Secondary).setEmoji('🍀'),
							new ButtonBuilder().setCustomId(`speak_translate_charm_${messageId}`).setLabel('Interpret by Experience [CHARM]').setStyle(ButtonStyle.Secondary).setEmoji('😊'),
							new ButtonBuilder().setCustomId(`speak_translate_wits_${messageId}`).setLabel('Interpret by Skill [WITS]').setStyle(ButtonStyle.Secondary).setEmoji('🧠'),
						);
						return interaction.reply({ embeds: [translationEmbed], components: [row], flags: MessageFlags.Ephemeral });
					}

					if (existingAttempt) {
						return interaction.update({ content: 'You have already made your attempt to translate this message.', components: [], embeds: [] });
					}

					// This is where the translation attempt is processed
					let successRatio = 0.0;
					let fluencyPoints = 0;
					const attemptMethod = subAction;

					switch (subAction) {
					case 'direct': {
						const fluency = db.prepare('SELECT fluency_points FROM character_languages WHERE user_id = ? AND language_id = ?').get(interaction.user.id, spokenMessage.language_id);
						if (fluency && fluency.fluency_points >= 100) successRatio = 1.0;
						break;
					}
					case 'fortune': {
						const roll = (Math.random() * 100) + (translatorCharacter.stat_fortune / 2);
						successRatio = roll >= 95 ? 1.0 : roll >= 70 ? 0.6 : roll >= 40 ? 0.3 : 0;
						fluencyPoints = 1;
						break;
					}
					case 'charm': {
						const successChance = 0.25 + (translatorCharacter.stat_charm * 0.015);
						if (Math.random() < successChance) {
							successRatio = 1.0;
							fluencyPoints = 5 + Math.floor(translatorCharacter.stat_charm / 4);
						}
						break;
					}
					case 'wits': {
						const originalContent = spokenMessage.original_content;
						const words = originalContent.split(' ');
						const originalSnippet = words.slice(0, 8).join(' ').slice(0, 42);

						if (originalSnippet.trim().length < 3) {
							updateFluency(1);
							db.prepare('INSERT OR IGNORE INTO translation_attempts (message_id, translator_user_id, attempt_method, success_ratio) VALUES (?, ?, ?, ?)').run(messageId, interaction.user.id, 'wits', 0.0);
							return interaction.update({ content: 'This message is too short to be decoded with Wits. Your attempt has been logged as a failure, granting +1 Fluency Point!', components: [], embeds: [] });
						}

						const obscureSnippet = (snippet) => {
							const resultArr = snippet.split('');
							for (let i = 0; i < resultArr.length; i++) {
								const char = resultArr[i];
								if (/[aeiou]/i.test(char) && Math.random() < 0.4) resultArr[i] = '_';
								else if (/[rstlne]/i.test(char) && Math.random() < 0.2) resultArr[i] = '_';
							}
							return resultArr.join('') === snippet && snippet.length > 1 ? snippet.substring(0, snippet.length - 1) + '_' : resultArr.join('');
						};

						const modal = new ModalBuilder().setCustomId(`speak_wits_submit_${messageId}_${Buffer.from(originalSnippet).toString('base64')}_${messageId}`).setTitle('Decode the Message Snippet');
						const textInput = new TextInputBuilder().setCustomId('wits_guess_input').setLabel(obscureSnippet(originalSnippet)).setStyle(TextInputStyle.Short).setPlaceholder('Type the completed phrase here...').setRequired(true);
						modal.addComponents(new ActionRowBuilder().addComponents(textInput));
						return interaction.showModal(modal);
					}
					}

					// Store the result of the attempt
					db.prepare('INSERT OR IGNORE INTO translation_attempts (message_id, translator_user_id, attempt_method, success_ratio) VALUES (?, ?, ?, ?)').run(messageId, interaction.user.id, attemptMethod, successRatio);
					if (fluencyPoints > 0) updateFluency(fluencyPoints);

					// Update the original ephemeral message with the result
					const resultEmbed = new EmbedBuilder();
					const resultComponents = [];

					if (successRatio > 0.0) {
						resultEmbed.setColor(0x2ECC71).setTitle('Translation Attempted: Success!').setDescription(`You've managed to grasp some or all of the message's meaning. Your interpretation is ready to view.\n\nFluency Gained: +${fluencyPoints} points.`);
						const row = new ActionRowBuilder().addComponents(
							new ButtonBuilder().setCustomId(`speak_translate_show_${messageId}`).setLabel('Show My Translation').setStyle(ButtonStyle.Success).setEmoji('📜'),
						);
						resultComponents.push(row);
					}
					else {
						resultEmbed.setColor(0xE74C3C).setTitle('Translation Attempted: Failure').setDescription('You were unable to understand any part of the message. Your one attempt has been used!');
					}

					return interaction.update({ embeds: [resultEmbed], components: resultComponents });
				}
				return;
			}
			if (interaction.isModalSubmit() && interaction.customId.startsWith('trade_')) {
				if (marketCommand && typeof marketCommand.modals === 'function') {
					try {
						await marketCommand.modals(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Trade modal error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your trade action.', flags: MessageFlags.Ephemeral });
						}
						return;
					}
				}
				else if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({ content: 'Trade actions are currently unavailable.', flags: MessageFlags.Ephemeral });
					return;
				}
			}

			if (interaction.isStringSelectMenu() && interaction.customId.startsWith('trade_')) {
				if (marketCommand && typeof marketCommand.menus === 'function') {
					try {
						await marketCommand.menus(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Trade stringmenu error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your trade action.', flags: MessageFlags.Ephemeral });
						}
						return;
					}
				}
				else if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({ content: 'Trade actions are currently unavailable.', flags: MessageFlags.Ephemeral });
					return;
				}
			}


			if (interaction.isButton() && interaction.customId.startsWith('inventory_')) {
				if (inventoryCommand && typeof inventoryCommand.buttons === 'function') {
					try {
						await inventoryCommand.buttons(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Inventory button error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your inventory action.', flags: MessageFlags.Ephemeral });
						}
						return;
					}
				}
			}
			if (interaction.isStringSelectMenu() && interaction.customId.startsWith('inventory_')) {
				if (inventoryCommand && typeof inventoryCommand.menus === 'function') {
					try {
						await inventoryCommand.menus(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Inventory menu error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your inventory action.', flags: MessageFlags.Ephemeral });
						}
						return;
					}
				}
			}

			let gameMasterCommand = null;
			try {
				gameMasterCommand = require('../utils/handleGameMasterInteraction.js');
			}
			catch (err) {
				if (err.code !== 'MODULE_NOT_FOUND') {
					console.error('[GM] Failed to load handleGameMasterInteraction.js:', err);
				}
				// Continue gracefully without GM support.
			}
			 if (
				(interaction.isButton() && interaction.customId.startsWith('gm_')) ||
   				(interaction.isModalSubmit() && interaction.customId.startsWith('gm_modal_')) ||
				(interaction.isStringSelectMenu() && interaction.customId.startsWith('gm_select_'))
			) {
				if (gameMasterCommand && typeof gameMasterCommand.handleGameMasterInteraction === 'function') {
					try {
						await gameMasterCommand.handleGameMasterInteraction(interaction);
						return;
					}
					catch (error) {
						console.error(`[Error] Game Master ${interaction.isButton() ? 'button' : 'modal'} interaction error:`, error);
						if (!interaction.replied && !interaction.deferred) {
							const errMsg = interaction.isButton()
								? 'There was an error processing this game management action.'
								: 'There was an error processing this modal.';
							await interaction.reply({ content: errMsg, flags: MessageFlags.Ephemeral });
						}
						return;
					}
				}
			}
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
						await interaction.reply({ content: 'There was an error processing your bet.', flags: MessageFlags.Ephemeral });
						return;
					}
				}
			}
			if (interaction.isModalSubmit() && interaction.customId.startsWith('guild_')) {
				if (guildCommand && typeof guildCommand.modals === 'function') {
					try {
						await guildCommand.modals(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Guild modal error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'There was an error processing your guild action.', flags: MessageFlags.Ephemeral });
						}
					}
				}
				return;
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
						await interaction.reply({ content: 'There was an error processing your custom contribution.', flags: MessageFlags.Ephemeral });
						return;
					}
				}
			}
			if (interaction.isButton() && interaction.customId.startsWith('pve_')) {
				const pveCommand = interaction.client.commands.get('pve');
				if (pveCommand && typeof pveCommand.buttons === 'function') {
					try {
						await pveCommand.buttons(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] PvE button interaction error:', error);
						// Attempt to inform user if possible
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'An error occurred during combat.', flags: MessageFlags.Ephemeral });
						}
						return;
					}
				}
				else if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({ content: 'PvE is currently unavailable.', flags: MessageFlags.Ephemeral });
					return;
				}
			}
			if (interaction.isStringSelectMenu() && interaction.customId.startsWith('pve_')) {
				const pveCommand = interaction.client.commands.get('pve');
				if (pveCommand && typeof pveCommand.menus === 'function') {
					try {
						await pveCommand.menus(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] PvE menu interaction error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'An error occurred during combat.', flags: MessageFlags.Ephemeral });
						}
						return;
					}
				}
				else if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({ content: 'PvE is currently unavailable.', flags: MessageFlags.Ephemeral });
					return;
				}
			}
			if (interaction.isButton() && interaction.customId.startsWith('trade_')) {
				if (marketCommand && typeof marketCommand.buttons === 'function') {
					try {
						await marketCommand.buttons(interaction);
						return;
					}
					catch (error) {
						console.error('[Error] Trade button interaction error:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'An error occurred while processing this trade action.', flags: MessageFlags.Ephemeral });
						}
						return;
					}
				}
				else if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({ content: 'Trade actions are currently unavailable.', flags: MessageFlags.Ephemeral });
					return;
				}
			}
			if (interaction.isButton()) {

				if (interaction.customId.startsWith('tony_quote_')) {
					try {
						const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
						if (!member || !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
							return interaction.reply({ content: 'You are not authorized to perform this action.', flags: MessageFlags.Ephemeral });
						}

						const [, , action, id] = interaction.customId.split('_');
						const pendingId = Number(id);
						if (!action || !Number.isInteger(pendingId)) {
							return interaction.reply({ content: 'Malformed interaction.', flags: MessageFlags.Ephemeral });
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
								const del = db.prepare('DELETE FROM tony_quotes_pending WHERE id = ?').run(pendingId);
								if (del.changes !== 1) throw new Error('Quote has already been processed');

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
							const refundAmount = quote_type === 'idle'
								? Math.max(1, parseInt(config.tonyQuote?.idleSubmissionCost ?? 100, 10))
								: Math.max(1, parseInt(config.tonyQuote?.triggerSubmissionCost ?? 200, 10));

							db.transaction(() => {
								// Ensure this pending row wasn't already processed
								const del = db.prepare('DELETE FROM tony_quotes_pending WHERE id = ?').run(pendingId);
								if (del.changes !== 1) throw new Error('Quote has already been processed');
								db.prepare(`
									INSERT INTO user_economy (user_id, crowns) VALUES (?, ?)
									ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
								`).run(user_id, refundAmount, refundAmount);
							})();
							originalEmbed.setColor(0xE74C3C).setFooter({ text: `Rejected by ${interaction.user.username}` });
							await interaction.update({ embeds: [originalEmbed], components: row ? [row] : [] });

							const typeText = quote_type === 'idle' ? 'idle phrase' : `trigger quote for \`${trigger_word}\``;
							const rejectionMessage = `Hey <@${user_id}>, your Tony Quote submission for the ${typeText} wasn't approved this time. The **${refundAmount} Crowns** have been refunded to your account.`;
							try {
								await sendMessageToChannel(interaction.client, BOT_COMMANDS_CHANNEL_ID, rejectionMessage);
							}
							catch (error) {
								console.warn('[Tony Quote Reject] Failed to send channel notice:', error);
							}
						}
						return;
					}
					catch (error) {
						console.error('[Error] Failed to handle Tony Quote button interaction:', error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'An error occurred while handling this submission.', flags: MessageFlags.Ephemeral });
						}
						return;
					}
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
							return interaction.reply({ content: 'This guild has not written its lore yet.', flags: MessageFlags.Ephemeral });
						}
						const loreEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📜 Lore of ${guild.guild_name}`).setDescription(guild.lore);
						return interaction.reply({ embeds: [loreEmbed], flags: MessageFlags.Ephemeral });
					}
					catch (error) {
						console.error('[Error] Failed to fetch guild lore:', error);
						return interaction.reply({ content: 'There was an error fetching the guild lore. Please try again later.', flags: MessageFlags.Ephemeral });
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
							await interaction.reply({ content: '👋 That daily claim message isn\'t yours, but you can set your own notification preferences here!', components: [row], flags: MessageFlags.Ephemeral });
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
						await handleMonarchEntry(interaction);
						console.log(`[Execute] Successfully handled Monarch entry, requested by ${interaction.user.displayName}`);
					}
					catch (error) {
						console.error('[Error] Monarch entry button interaction error:', error);
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
							await interaction.reply({ content: 'There was an error processing this game action.', flags: MessageFlags.Ephemeral });
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
						await interaction.reply({ content: 'There was an error cancelling this action.', flags: MessageFlags.Ephemeral });
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
						else if (interaction.customId.startsWith('guild_diplomacy_')) {
							await guildCommand.buttons.handleDiplomacyResponse(interaction);
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
						await interaction.reply({ content: 'There was an error processing this button interaction.', flags: MessageFlags.Ephemeral });
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
					await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
				}
				else {
					await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
				}
			}
		}
		catch (topLevelError) {
			console.error('[Top Level Interaction Error]', topLevelError);
		}
	},
};