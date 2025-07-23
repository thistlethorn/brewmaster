const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database');


module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('pin')
		.setDescription('Pin a message in a channel (Section DMs in gamerooms, and Guildmasters in guildhalls)'),

	async execute(interaction) {
		// Check if user has a section role
		const hasSectionRole = interaction.member.roles.cache.some(role =>
			role.name.toLowerCase().includes('section'),
		);
		const userId = interaction.user.id;

		// Check if user is a guild owner
		const userGuild = db.prepare(`
			SELECT gl.* 
			FROM guildmember_tracking gmt
			JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
			WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
		`).get(userId);

		if (!hasSectionRole && !userGuild) {
			return interaction.reply({
				content: '❌ This command is only available to Section DMs, or Guildmasters/Vice-GMs in their guild channel.',
				ephemeral: true });
		}

		const correctChannel = db.prepare(`
			SELECT channel_id, public_channel_id, guild_tag
			FROM guild_list 
			WHERE guild_tag = ? AND (channel_id = ? OR public_channel_id = ?)
		`).get(userGuild?.guild_tag, interaction.channel.id, interaction.channel.id);

		// Check if in gameroom channel
		const isGameroom = interaction.channel.name.toLowerCase().includes('gameroom');

		if (hasSectionRole && !isGameroom) {
			return interaction.reply({
				content: '❌ This command can only be used (as a DM) in gameroom channels.',
				ephemeral: true });
		}
		else if (userGuild && !correctChannel) {
			return interaction.reply({
				content: `❌ This command can only be used (as a Guildmaster) in the registered guildhall channels. Your guildhall channels are <#${userGuild.channel_id}> and <#${userGuild.public_channel_id}>`,
				ephemeral: true });
		}

		// Create instructions embed
		const expiryTimestamp = Math.floor(Date.now() / 1000) + 60;
		const embed = new EmbedBuilder()
			.setColor(0x5865F2)
			.setTitle('📌 Message Pinning')
			.setDescription(`Reply **to the message you want to pin** with whatever, __as long as you're replying to it.__\n\nThis command will cancel <t:${expiryTimestamp}:R>.`);

		// Send the initial reply, then fetch it to get the message object
		await interaction.reply({ embeds: [embed] });
		const initialReply = await interaction.fetchReply();


		// Array to store warning messages
		const warningMessages = [];

		// Create message collector
		const collector = interaction.channel.createMessageCollector({
			filter: m => m.author.id === interaction.user.id,
			time: 60000,
			max: 3,
		});

		let attempts = 0;

		collector.on('collect', async (message) => {
			attempts++;

			// Check if message is a reply
			if (!message.reference) {
				if (attempts >= 3) {
					collector.stop('maxAttempts');
					return;
				}

				const warning = await message.reply({
					content: `⚠️ You must reply to the message you want to pin (attempt ${attempts}/3)` });
				warningMessages.push(warning);
				return;
			}

			try {
				// Get the referenced message
				const referencedMessage = await interaction.channel.messages.fetch(message.reference.messageId);

				// Pin the message
				await referencedMessage.pin();

				// Send success message
				await interaction.channel.send({
					content: `✅ Successfully pinned [this message](${referencedMessage.url})` });

				// --- CLEANUP ---
				// Delete the user's message that triggered the pin
				// eslint-disable-next-line no-empty-function
				await message.delete().catch(() => {});

				// Delete the initial "how-to" embed from the bot
				// eslint-disable-next-line no-empty-function
				await initialReply.delete().catch(() => {});

				// Delete all previous warning messages from the bot
				// eslint-disable-next-line no-empty-function
				await Promise.all(warningMessages.map(msg => msg.delete().catch(() => {})));


				collector.stop();
			}
			catch (error) {
				console.error('Error pinning message:', error);
				await interaction.channel.send({
					content: '❌ Failed to `/pin` the message - please try again' });
				collector.stop('error');
			}
		});

		collector.on('end', (collected, reason) => {
			if (reason === 'maxAttempts') {
				interaction.channel.send({
					content: '❌ `/pin` Command cancelled - too many failed attempts' });
			}
			else if (reason === 'time') {
				// Clean up the initial embed on timeout
				// eslint-disable-next-line no-empty-function
				initialReply.delete().catch(() => {});
				interaction.channel.send({
					content: '❌ `/pin` Command timed out - please try again' });
			}
		});
	},
};