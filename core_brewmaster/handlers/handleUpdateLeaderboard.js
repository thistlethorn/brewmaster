const { EmbedBuilder } = require('discord.js');
const db = require('@database/database.js');
const log = require('@utils/logger.js');

/**
 * Update the configured Discord message to reflect the current weekly bump leaderboard.
 *
 * Queries the database for the top 10 bumpers and the stored leaderboard message location, then edits that message with an embed showing the leaderboard or a prompt if no bumps exist. If no leaderboard message is configured, the function exits without performing updates.
 */
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

		const embed = new EmbedBuilder()
			.setTitle('🏆 Weekly Bump Leaderboard 🏆')
			.setColor(0x5865F2)
			.setTimestamp()
			.setFooter({ text: 'Resets every Sunday at midnight UTC' });

		if (topBumpers.length === 0) {
			embed.setDescription('No bumps recorded yet! Use `/bump` to get on the board!');
		}
		else {
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
		log.success('[updateLeaderboard] Message has been edited successfully');

	}
	catch (error) {
		log.error('[updateLeaderboard] [Error] Leaderboard update error:', error);
	}


}

module.exports = updateLeaderboard;