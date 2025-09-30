// commands/admin/charadmin.js
const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { addXp } = require('@core_tavernborne/handlers/handleAddXpToChar.js');
const db = require('@database/database.js');
const { recalculateStats } = require('@core_tavernborne/handlers/handleRecalculateCharStats.js');
const config = require('@root/config.json');

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('charadmin')
		.setDescription('[DEVELOPER COMMAND] Administrative tools for managing characters.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('addxp')
				.setDescription('Grants XP to a character.')
				.addUserOption(option => option.setName('user').setDescription('The user to grant XP to.').setRequired(true))
				.addIntegerOption(option => option.setName('amount').setDescription('The amount of XP to grant.').setRequired(true).setMinValue(1)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('removexp')
				.setDescription('Removes XP from a character, potentially de-leveling them.')
				.addUserOption(option => option.setName('user').setDescription('The user to remove XP from.').setRequired(true))
				.addIntegerOption(option => option.setName('amount').setDescription('The amount of XP to remove.').setRequired(true).setMinValue(1)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('setlevel')
				.setDescription('Sets a character to a specific level with 0 XP.')
				.addUserOption(option => option.setName('user').setDescription('The user whose character to modify.').setRequired(true))
				.addIntegerOption(option => option.setName('level').setDescription('The target level.').setRequired(true).setMinValue(1).setMaxValue(100)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('reset')
				.setDescription('Resets a character to their Level 1, post-Origin state.')
				.addUserOption(option => option.setName('user').setDescription('The user whose character to reset.').setRequired(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('additem')
				.setDescription('Adds a specific item to a user\'s inventory.')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('The user to give the item to.')
						.setRequired(true))
				.addStringOption(option =>
					option.setName('item')
						.setDescription('The name of the item to add.')
						.setRequired(true)
						.setAutocomplete(true))
				.addIntegerOption(option =>
					option.setName('quantity')
						.setDescription('The quantity of the item to add. Defaults to 1.')
						.setRequired(false)
						.setMinValue(1)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('givelanguage')
				.setDescription('Grants a character fluency in a language.')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('The user to grant the language to.')
						.setRequired(true))
				.addStringOption(option =>
					option.setName('language')
						.setDescription('The language to grant.')
						.setRequired(true)
						.setAutocomplete(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('removelanguage')
				.setDescription('Removes a language from a character.')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('The user to remove the language from.')
						.setRequired(true))
				.addStringOption(option =>
					option.setName('language')
						.setDescription('The language to remove.')
						.setRequired(true)
						.setAutocomplete(true))),

	async autocomplete(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		const focusedValue = focusedOption.value.toLowerCase();
		const targetUser = interaction.options.getUser('user');
		console.log((!targetUser && (subcommand === 'givelanguage' || subcommand === 'removelanguage')) == true);
		console.log(!targetUser == true);
		console.log(((subcommand === 'givelanguage' || subcommand === 'removelanguage')) == true);
		console.log((subcommand === 'givelanguage') == true);
		console.log((subcommand === 'removelanguage') == true);
		// if (!targetUser && (subcommand === 'givelanguage' || subcommand === 'removelanguage')) {
		// 	return interaction.respond([]);
		// }

		try {
			if (subcommand === 'additem' && focusedOption.name === 'item') {
				const items = db.prepare(`
					SELECT item_id, name 
					FROM items 
					WHERE name LIKE ? 
					ORDER BY name ASC 
					LIMIT 25
				`).all(`%${focusedValue}%`);

				await interaction.respond(
					items.map(item => ({ name: item.name, value: item.item_id.toString() })),
				);
			}
			else if (subcommand === 'givelanguage' && focusedOption.name === 'language') {
				// Show languages the user does NOT already know fluently
				const languages = db.prepare(`
					SELECT language_id, name FROM languages
					WHERE name LIKE ?
					ORDER BY name ASC
					LIMIT 25
				`).all(`%${focusedValue}%`);

				await interaction.respond(
					languages.map(lang => ({ name: lang.name, value: lang.language_id.toString() })),
				);
			}
			else if (subcommand === 'removelanguage' && focusedOption.name === 'language') {
				// Show only languages the user knows
				const languages = db.prepare(`
					SELECT l.language_id, l.name
					FROM languages l
					JOIN character_languages cl ON l.language_id = cl.language_id
					WHERE cl.user_id = ? AND l.name LIKE ?
					ORDER BY l.name ASC
					LIMIT 25
				`).all(targetUser.id, `%${focusedValue}%`);

				await interaction.respond(
					languages.map(lang => ({ name: lang.name, value: lang.language_id.toString() })),
				);
			}
		}
		catch (error) {
			console.error(`Autocomplete error for /charadmin ${subcommand}:`, error);
			await interaction.respond([]);
		}
	},

	async execute(interaction) {
		if (interaction.user.id !== config.developerId) {
			return interaction.reply({ content: 'This is a developer-only command.', flags: MessageFlags.Ephemeral });
		}

		const subcommand = interaction.options.getSubcommand();
		const targetUser = interaction.options.getUser('user');
		const amount = interaction.options.getInteger('amount');
		const level = interaction.options.getInteger('level');

		let character;
		try {
			character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(targetUser.id);
		}
		catch (dbError) {
			console.error('Database error fetching character:', dbError);
			return interaction.reply({ content: 'Failed to fetch character data.', flags: MessageFlags.Ephemeral });
		}
		if (!character) {
			return interaction.reply({ content: 'The target user does not have a character.', flags: MessageFlags.Ephemeral });
		}

		const embed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setAuthor({ name: `${targetUser.username}'s Character Admin`, iconURL: targetUser.displayAvatarURL() });

		try {
			const reason = 'DEV: Manual adjustment.';
			switch (subcommand) {
			case 'addxp':
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				await addXp(targetUser.id, amount, interaction, reason);
				recalculateStats(targetUser.id);
				await interaction.editReply({ content: `Successfully granted ${amount} XP to ${targetUser.username}.` });
				break;

			case 'removexp':
				{
					let newXp = character.xp - amount;
					let newLevel = character.level;
					let newStatPoints = character.stat_points_unspent;
					let levelsLost = 0;

					while (newXp < 0 && newLevel > 1) {
						newLevel--;
						levelsLost++;
						newStatPoints = Math.max(0, newStatPoints - 2);
						const xpForCurrentLevel = Math.floor(100 * (newLevel ** 1.5));
						newXp += xpForCurrentLevel;
					}
					newXp = Math.max(0, newXp);


					db.prepare('UPDATE characters SET level = ?, xp = ?, stat_points_unspent = ? WHERE user_id = ?')
						.run(newLevel, newXp, newStatPoints, targetUser.id);
					recalculateStats(targetUser.id);
					embed.setTitle('XP Removed')
						.setDescription(`Successfully removed **${amount}** XP from ${targetUser.username}.`)
						.addFields(
							{ name: 'Level', value: `${character.level} ➔ **${newLevel}** (${levelsLost > 0 ? `-${levelsLost}` : 'No change'})`, inline: true },
							{ name: 'XP', value: `${character.xp} ➔ **${newXp}**`, inline: true },
							{ name: 'Unspent Points', value: `${character.stat_points_unspent} ➔ **${newStatPoints}**`, inline: true },
						);
					await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
				}
				break;

			case 'setlevel':
				{
					const newStatPoints = (level - 1) * 2;
					db.prepare('UPDATE characters SET level = ?, xp = 0, stat_points_unspent = ? WHERE user_id = ?')
						.run(level, newStatPoints, targetUser.id);
					recalculateStats(targetUser.id);
					embed.setTitle('Level Set')
						.setDescription(`Successfully set ${targetUser.username}'s character to Level **${level}**.`)
						.addFields(
							{ name: 'Level', value: `${character.level} ➔ **${level}**`, inline: true },
							{ name: 'XP', value: `${character.xp} ➔ **0**`, inline: true },
							{ name: 'Unspent Points', value: `${character.stat_points_unspent} ➔ **${newStatPoints}**`, inline: true },
						);
					await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
				}
				break;

			case 'reset':
				{
					const origin = db.prepare('SELECT bonus_stat_1, bonus_stat_2 FROM origins WHERE id = ?').get(character.origin_id);
					if (!origin) {
						return interaction.reply({
							content: 'Character origin data is missing or corrupted.',
							flags: MessageFlags.Ephemeral,
						});
					}
					const baseStats = { might: 5, finesse: 5, wits: 5, grit: 5, charm: 5, fortune: 5 };
					if (origin.bonus_stat_1 && Object.prototype.hasOwnProperty.call(baseStats, origin.bonus_stat_1)) {
						baseStats[origin.bonus_stat_1]++;
					}
					if (origin.bonus_stat_2 && Object.prototype.hasOwnProperty.call(baseStats, origin.bonus_stat_2)) {
						baseStats[origin.bonus_stat_2]++;
					}

					const resetTransaction = db.transaction(() => {
						db.prepare(`
							UPDATE characters
							SET
								level = 1, xp = 0, stat_points_unspent = 0,
								current_health = 10, max_health = 10, temporary_health = 0,
								current_mana = 10, max_mana = 10,
								current_ki = 0, max_ki = 0,
								stat_might = ?, stat_finesse = ?, stat_wits = ?,
								stat_grit = ?, stat_charm = ?, stat_fortune = ?
							WHERE user_id = ?
						`).run(
							baseStats.might, baseStats.finesse, baseStats.wits,
							baseStats.grit, baseStats.charm, baseStats.fortune,
							targetUser.id,
						);
					});
					resetTransaction();
					recalculateStats(targetUser.id);
					embed.setTitle('Character Reset')
						.setDescription(`Successfully reset ${targetUser.username}'s character to Level 1.`)
						.addFields({ name: 'Result', value: 'Character is now at Level 1, 0 XP, with 0 unspent points and base stats according to their Origin.' });
					await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
				}
				break;

			case 'additem':
				{
					const itemIdString = interaction.options.getString('item');
					const quantity = interaction.options.getInteger('quantity') ?? 1;
					const finalItemId = parseInt(itemIdString, 10);

					if (isNaN(finalItemId)) {
						return interaction.reply({ content: 'Invalid item ID provided from autocomplete. Please select a valid item.', flags: MessageFlags.Ephemeral });
					}

					// Verify item exists and get its properties
					const itemData = db.prepare('SELECT name, is_stackable FROM items WHERE item_id = ?').get(finalItemId);
					if (!itemData) {
						return interaction.reply({ content: 'The selected item does not exist in the database.', flags: MessageFlags.Ephemeral });
					}

					const addTx = db.transaction(() => {
						if (itemData.is_stackable) {
							// Check if the user already has a stack of this item
							const existingStack = db.prepare('SELECT inventory_id FROM user_inventory WHERE user_id = ? AND item_id = ?').get(targetUser.id, finalItemId);
							if (existingStack) {
								db.prepare('UPDATE user_inventory SET quantity = quantity + ? WHERE inventory_id = ?').run(quantity, existingStack.inventory_id);
							}
							else {
								db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, ?)').run(targetUser.id, finalItemId, quantity);
							}
						}
						else {
							// For non-stackable items, insert one row for each
							const stmt = db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)');
							for (let i = 0; i < quantity; i++) {
								stmt.run(targetUser.id, finalItemId);
							}
						}
					});

					addTx();

					embed.setTitle('Item Added')
						.setDescription(`Successfully added **${quantity}x ${itemData.name}** to ${targetUser.username}'s inventory.`);

					await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
				}
				break;
			case 'givelanguage':
				{
					const languageIdString = interaction.options.getString('language');
					const languageId = parseInt(languageIdString, 10);

					if (isNaN(languageId)) {
						return interaction.reply({ content: 'Invalid language ID provided.', flags: MessageFlags.Ephemeral });
					}

					const language = db.prepare('SELECT name FROM languages WHERE language_id = ?').get(languageId);
					if (!language) {
						return interaction.reply({ content: 'The selected language does not exist.', flags: MessageFlags.Ephemeral });
					}

					// This will insert a new row or update an existing one to have 100 fluency.
					db.prepare(`
						INSERT INTO character_languages (user_id, language_id, fluency_points)
						VALUES (?, ?, 100)
						ON CONFLICT(user_id, language_id) DO UPDATE SET
							fluency_points = 100
					`).run(targetUser.id, languageId);

					embed.setTitle('Language Granted')
						.setDescription(`Successfully granted fluency in **${language.name}** to ${targetUser.username}.`);

					await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
				}
				break;

			case 'removelanguage':
				{
					const languageIdString = interaction.options.getString('language');
					const languageId = parseInt(languageIdString, 10);

					if (isNaN(languageId)) {
						return interaction.reply({ content: 'Invalid language ID provided.', flags: MessageFlags.Ephemeral });
					}

					const language = db.prepare('SELECT name FROM languages WHERE language_id = ?').get(languageId);
					if (!language) {
						return interaction.reply({ content: 'The selected language does not exist.', flags: MessageFlags.Ephemeral });
					}

					const result = db.prepare('DELETE FROM character_languages WHERE user_id = ? AND language_id = ?').run(targetUser.id, languageId);

					if (result.changes > 0) {
						embed.setTitle('Language Removed')
							.setDescription(`Successfully removed **${language.name}** from ${targetUser.username}.`);
					}
					else {
						embed.setColor(0xE74C3C)
							.setTitle('Language Not Found')
							.setDescription(`${targetUser.username} did not have the **${language.name}** language to remove.`);
					}

					await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
				}
				break;
			}
		}
		catch (error) {
			console.error(`Error in /charadmin ${subcommand}:`, error);
			// Use reply if not deferred/replied, otherwise use followUp
			const errorMessage = {
				content: 'An error occurred while executing this admin command.',
				flags: MessageFlags.Ephemeral,
			};
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp(errorMessage);
			}
			else {
				await interaction.reply(errorMessage);
			}

		}
	},
};