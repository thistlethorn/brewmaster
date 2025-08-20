const { SlashCommandBuilder, Events } = require('discord.js');

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('emit')
		.setDescription('Emit test events (Admin only)')
		.addStringOption(option =>
			option.setName('event')
				.setDescription('Event type to emit')
				.setRequired(true)
				.addChoices(
					{ name: 'Member Join', value: 'guildMemberAdd' },
					// Add more events here as needed
					// { name: 'Message Create', value: 'messageCreate' },
					// { name: 'Member Leave', value: 'guildMemberRemove' }
				))
		.addUserOption(option =>
			option.setName('member')
				.setDescription('Member to simulate (for member events)')
				.setRequired(false)),

	async execute(interaction) {
		// Permission check
		if (!interaction.member.permissions.has('ADMINISTRATOR')) {
			return interaction.reply({
				content: '❌ This command is only available to administrators',

			});
		}

		const eventType = interaction.options.getString('event');
		const targetMember = interaction.options.getMember('member') || interaction.member;

		try {
			switch (eventType) {
			case 'guildMemberAdd':
				interaction.client.emit(Events.GuildMemberAdd, targetMember);
				break;

				// Add more cases for other event types
				// case 'messageCreate':
				//    // Handle message create simulation
				//    break;

			default:
				return interaction.reply({
					content: `❌ Event type "${eventType}" not implemented yet`,
				});
			}

			await interaction.reply({
				content: `✅ Successfully emitted ${eventType} event for ${targetMember.displayName}`,

			});

		}
		catch (error) {
			console.error('Error emitting test event:', error);
			await interaction.reply({
				content: `❌ Failed to emit event: ${error.message}`,
			});
		}
	},
};