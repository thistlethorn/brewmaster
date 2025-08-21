const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('inventory')
		.setDescription('Manage your character\'s inventory.'),
	async execute(interaction) {
		await interaction.reply({ content: 'The inventory system is not yet implemented.', ephemeral: true });
	},
};