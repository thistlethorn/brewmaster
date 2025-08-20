const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../database');
const updateLeaderboard = require('../../utils/updateLeaderboard');

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('leaderboard')
		.setDescription('[DEVELOPER COMMAND] Command to initalize Bump Leaderboard and begin tracking.')
		.addStringOption(option =>
			option.setName('commandtype')
				.setDescription('Subcommand Choice')
				.setRequired(true)
				.addChoices(
					{ name: 'Clear', value: 'clear' },
					{ name: 'Start', value: 'start' },
				)),
	async execute(interaction) {
		const mode = interaction.options.getString('commandtype');
		if (interaction.member.roles.cache.has('1354145856345083914') || interaction.member.id === '1126419078140153946') {
			console.log('leaderboard.js');
			console.log('----------------------');
			if (mode === 'clear') {
				const messageInfo = db.prepare(`
					SELECT channel_id, message_id 
					FROM leaderboard_message 
					LIMIT 1
				`).get();

				if (!messageInfo) {
					return interaction.reply({ content: '/leaderboard [clear] failed, no leaderboard message exists.', flags: MessageFlags.Ephemeral });

				}
				else {
					await interaction.reply({ content: 'Successfully used /leaderboard [clear].', flags: MessageFlags.Ephemeral });
					const channel = await interaction.client.channels.fetch(messageInfo.channel_id);
					const message = await channel.messages.fetch(messageInfo.message_id);
					await message.delete().catch(() => null);
					db.prepare('DELETE FROM bump_leaderboard').run();
					db.prepare('DELETE FROM leaderboard_message').run();
					db.prepare('DELETE FROM bump_streak').run();

					setTimeout(async () => {
						try {
							await interaction.deleteReply();
						}
						catch (err) {
							console.error('Failed to delete reply:', err);
						}
					}, 8000);
				}

			}
			else if (mode === 'start') {
				console.log('(/leaderboard START command used. Setting up the basic embed.)');
				const embed = new EmbedBuilder()
					.setTitle('🏆 Weekly Bump Leaderboard 🏆')
					.setDescription('Top members who helped bump our server!')
					.setColor(0x5865F2)
					.setFooter({ text: 'Resets every Sunday at midnight UTC' });

				console.log('(Sending the embed.)');
				const message = await interaction.channel.send({ embeds: [embed] });
				console.log('(Preparing and sending to the DB, initializing the DB with channel_id and message_id.)');
				db.prepare(`
					INSERT INTO leaderboard_message (channel_id, message_id)
					VALUES (?, ?)
					ON CONFLICT(channel_id) DO UPDATE SET
						message_id = excluded.message_id
				`).run(interaction.channel.id, message.id);


				console.log('(Calling updateLeaderboard.)');
				await updateLeaderboard(interaction.client);
				await interaction.reply({ content: 'Successfully used /leaderboard [start].', flags: MessageFlags.Ephemeral });
				setTimeout(async () => {
					try {
						await interaction.deleteReply();
					}
					catch (err) {
						console.error('Failed to delete reply:', err);
					}
				}, 8000);


			}
		}
		else {
			console.log('Failed to run admin command /leaderboard.');
			console.log('----------------------');
			console.log('END leaderboard.js');
			await interaction.reply({ content: 'Insufficient permissions to run Administration commands!', flags: MessageFlags.Ephemeral });
			setTimeout(async () => {
				try {
					await interaction.deleteReply();
				}
				catch (err) {
					console.error('Failed to delete reply:', err);
				}
			}, 8000);
		}

		console.log('----------------------');
		console.log('END leaderboard.js');

	},
};