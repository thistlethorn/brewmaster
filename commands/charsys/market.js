const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('market')
		.setDescription('Interact with the player-driven economy.'),
	async execute(interaction) {
		await interaction.reply({ content: 'The market system is not yet implemented.', ephemeral: true });
	},
};