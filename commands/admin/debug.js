// eslint-disable-next-line no-unused-vars
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../database');


module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('debug')
		.setDescription('[DEVELOPER COMMAND] Queries the data in every database table to output for debugging purposes.'),
	async execute(interaction) {
		// Ensure only admins or your dev ID can use this
		if (!(interaction.member.roles.cache.has('1354145856345083914') || interaction.member.id === '1126419078140153946')) {
			return interaction.reply({
				content: 'Insufficient permissions to use /debug.',
				ephemeral: true });
		}
		try {
			db.pragma('wal_checkpoint(FULL)');
			interaction.reply('Checkpoint DB: Success.');
		}
		catch (error) {
			console.log('Couldn\'t checkpoint the DB: ' + error);
		}
		/*
		try {
			const leaderboard = db.prepare('SELECT * FROM bump_leaderboard').all();
			const streaks = db.prepare('SELECT * FROM bump_streak').all();
			const messages = db.prepare('SELECT * FROM leaderboard_message').all();
			const guilds = db.prepare('SELECT * FROM guild_list').all();
			const guildmembers = db.prepare('SELECT * FROM guildmember_tracking').all();
			const userEcon = db.prepare('SELECT * FROM user_economy').all();
			const guildEcon = db.prepare('SELECT * FROM guild_economy').all();
			const userActivity = db.prepare('SELECT * FROM user_activity').all();


			const formatTable = (title, rows) => {
				if (!rows.length) return `**${title}**\n_No entries found._\n`;

				const headers = Object.keys(rows[0]);
				const formattedRows = rows.map(row =>
					headers.map(h => {
						let value = row[h];

						if (value === null || value === undefined) value = 'null';

						// Format user and channel IDs as mentions
						if (h.toLowerCase().includes('user') && /^\d+$/.test(value)) {
							value = `<@${value}>`;
						}
						else if (h.toLowerCase().includes('channel') && /^\d+$/.test(value)) {
							value = `<#${value}>`;
						}

						return `**${h}**: ${value}`;
					}).join(' | '));

				return `**${title}**\n${formattedRows.join('\n')}\n`;
			};

			const fullReport = [
				formatTable('🏰 Table: guild_list', guilds),
				formatTable('👥 Table: guildmember_tracking', guildmembers),
				formatTable('📊 Table: bump_leaderboard', leaderboard),
				formatTable('🔥 Table: bump_streak', streaks),
				formatTable('📩 Table: leaderboard_message', messages),
				formatTable('👑 Table: user_economy', userEcon),
				formatTable('💰 Table: guild_economy', guildEcon),
				formatTable('💬 Table: user_activity', userActivity),
			];
			await interaction.reply({ content: 'Debug info sent to this channel.', flags: MessageFlags.Ephemeral });

			    for (const reportSection of fullReport) {
				// Split long sections into chunks
				if (reportSection.length > 2000) {
					const chunks = reportSection.match(/[\s\S]{1,1900}/g) || [];
					for (const chunk of chunks) {
						await interaction.followUp({
							content: chunk,
							flags: MessageFlags.Ephemeral,
						});
					}
				}
				else {
					await interaction.followUp({
						content: reportSection,
						flags: MessageFlags.Ephemeral,
					});
				}
			}
		}
		catch (err) {
			console.error('Error sending debug info:', err);
			await interaction.followUp({
				content: 'Error sending some debug information.',
				flags: MessageFlags.Ephemeral,
			});
		}
		*/
	},
};