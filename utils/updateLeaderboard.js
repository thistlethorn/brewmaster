const { EmbedBuilder } = require('discord.js');
const db = require('../database');

async function updateLeaderboard(client) {
	const topBumpers = db.prepare(`
        SELECT user_id, bumps 
        FROM bump_leaderboard 
        ORDER BY bumps DESC 
        LIMIT 10
    `).all();

	const messageInfo = db.prepare(`
        SELECT channel_id, message_id 
        FROM leaderboard_message 
        LIMIT 1
    `).get();


	if (!messageInfo) return;

	try {
		const channel = await client.channels.fetch(messageInfo.channel_id);
		const message = await channel.messages.fetch(messageInfo.message_id);

		console.log('[updateLeaderboard] Initializing, listing out the database.');
		console.log('[updateLeaderboard] [Location Info] channel_id:' + messageInfo.channel_id + '\nmessage_id:' + messageInfo.message_id);
		topBumpers.forEach((row, index) => {
			console.log(`[updateLeaderboard] [User Info] User ${index + 1}: user_id: ` + row.user_id + ' bumps: ' + row.bumps);

		});


		const embed = new EmbedBuilder()
			.setTitle('🏆 Weekly Bump Leaderboard 🏆')
			.setColor(0x5865F2)
			.setTimestamp()
			.setFooter({ text: 'Resets every Sunday at midnight UTC' });

		if (topBumpers.length === 0) {
			console.log('[updateLeaderboard] No bumps have been recorded, embed set to that description.');
			embed.setDescription('No bumps recorded yet! Use `/bump` to get on the board!');
		}
		else {
			console.log('[updateLeaderboard] Found the bump data, and updated the embed with the users.');
			embed.setDescription('Top members who helped bump our server this week!')
				.addFields({
					name: 'Top Bumpers',
					value: topBumpers.map((user, i) =>
						// eslint-disable-next-line space-infix-ops
						`**${i+1}.** <@${user.user_id}> - ${user.bumps} bump${user.bumps !== 1 ? 's' : ''}`,
					).join('\n'),
				});
		}

		await message.edit({ embeds: [embed] });
		console.log('[updateLeaderboard] Message has been edited successfully');

	}
	catch (error) {
		console.error('[updateLeaderboard] [Error] Leaderboard update error:', error);
	}


}

module.exports = updateLeaderboard;