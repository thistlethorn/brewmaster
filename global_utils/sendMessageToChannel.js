const { EmbedBuilder } = require('discord.js');

async function sendMessageToChannel(client, channelId, messageContent) {
	try {
		const channel = await client.channels.fetch(channelId);
		if (!channel?.isTextBased()) {
			throw new Error('Channel not found or not a text channel');
		}

		// Check if messageContent is an EmbedBuilder or has embeds
		if (messageContent instanceof EmbedBuilder || messageContent?.data) {
			return await channel.send({ embeds: [messageContent] });
		}

		// Check if it's a message object with embeds
		if (messageContent?.embeds?.length > 0) {
			return await channel.send({ embeds: messageContent.embeds });
		}

		// Default case (string or simple content)
		return await channel.send(messageContent);
	}
	catch (error) {
		console.error('[sendMessageToChannel] Error:', error);
		throw error;
	}
}

module.exports = sendMessageToChannel;