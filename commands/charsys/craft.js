// commands/charsys/craft.js

const path = require('path');
const { checkBetatestLock } = require(`${global.__utils}/betaLock.js`);
const commandFilename = path.basename(__filename);
const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('craft')
		.setDescription('Craft items and recipes.'),
	async execute(interaction) {
		if (await checkBetatestLock(interaction, commandFilename)) {
			return interaction.reply({
				content: '🍻 Apologies! This feature is currently under lock and key for some super-secret beta testing. Keep an eye on <#1385675092591378452> and <#1414069644410748938> for the full release!',
				flags: MessageFlags.Ephemeral,
			});
		}
		await interaction.reply({ content: 'The crafting system is not yet implemented.', ephemeral: true });
	},
};