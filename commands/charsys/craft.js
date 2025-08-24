const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('craft')
		.setDescription('Craft items and recipes.'),
	async execute(interaction) {
		await interaction.reply({ content: 'The crafting system is not yet implemented.', ephemeral: true });
	},
};