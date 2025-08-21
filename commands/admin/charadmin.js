// commands/admin/charadmin.js
const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { addXp } = require('../../utils/addXp');
const db = require('../../database');

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
				.addUserOption(option => option.setName('user').setDescription('The user whose character to reset.').setRequired(true))),

	async execute(interaction) {
		if (interaction.user.id !== '1126419078140153946') {
			return interaction.reply({ content: 'This is a developer-only command.', flags: MessageFlags.Ephemeral });
		}

		const subcommand = interaction.options.getSubcommand();
		const targetUser = interaction.options.getUser('user');
		const amount = interaction.options.getInteger('amount');
		const level = interaction.options.getInteger('level');

		const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(targetUser.id);
		if (!character) {
			return interaction.reply({ content: 'The target user does not have a character.', flags: MessageFlags.Ephemeral });
		}

		const embed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setAuthor({ name: `${targetUser.username}'s Character Admin`, iconURL: targetUser.displayAvatarURL() });

		try {
			switch (subcommand) {
			case 'addxp':
				await interaction.reply({ content: `Granting ${amount} XP to ${targetUser.username}...`, flags: MessageFlags.Ephemeral });
				await addXp(targetUser.id, amount, interaction);
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
						const xpForPreviousLevel = Math.floor(100 * ((newLevel - 1) ** 1.5));
						newXp += xpForPreviousLevel;
					}
					if (newLevel === 1) newXp = Math.max(0, newXp);


					db.prepare('UPDATE characters SET level = ?, xp = ?, stat_points_unspent = ? WHERE user_id = ?')
						.run(newLevel, newXp, newStatPoints, targetUser.id);

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
					const baseStats = { might: 5, finesse: 5, wits: 5, grit: 5, charm: 5, fortune: 5 };
					baseStats[origin.bonus_stat_1]++;
					baseStats[origin.bonus_stat_2]++;

					db.prepare(`
                        UPDATE characters
                        SET
                            level = 1, xp = 0, stat_points_unspent = 0,
                            current_health = 10, max_health = 10,
                            current_mana = 10, max_mana = 10,
                            stat_might = ?, stat_finesse = ?, stat_wits = ?,
                            stat_grit = ?, stat_charm = ?, stat_fortune = ?
                        WHERE user_id = ?
                    `).run(
						baseStats.might, baseStats.finesse, baseStats.wits,
						baseStats.grit, baseStats.charm, baseStats.fortune,
						targetUser.id,
					);
					embed.setTitle('Character Reset')
						.setDescription(`Successfully reset ${targetUser.username}'s character to Level 1.`)
						.addFields({ name: 'Result', value: 'Character is now at Level 1, 0 XP, with 0 unspent points and base stats according to their Origin.' });
					await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
				}
				break;
			}
		}
		catch (error) {
			console.error(`Error in /charadmin ${subcommand}:`, error);
			await interaction.followUp({ content: 'An error occurred while executing this admin command.', flags: MessageFlags.Ephemeral });
		}
	},
};