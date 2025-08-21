const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('pve')
		.setDescription('Engage in combat and explore PvE nodes.'),
	async execute(interaction) {
		await interaction.reply({ content: 'The PvE system is not yet implemented.', ephemeral: true });
	},
};