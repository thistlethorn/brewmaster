const { Events, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { startVerification } = require('../tasks/captchaRequest');
const config = require('../config.json');


module.exports = {
	name: Events.GuildMemberAdd,
	async execute(member) {
		// #welcome
		if (member.user.bot) return;

		try {
			// Use member.guild to access the guild, not interaction.guild
			const unverifiedRole = await member.guild.roles.fetch(config.discord.unverifiedRoleId);
			if (unverifiedRole) {
				// Add the role directly to the member object
				await member.roles.add(unverifiedRole);
			}
		}
		catch (error) {
			console.error(`[guildMemberAdd] Failed to add Unverified role to ${member.user.tag}:`, error);
		}

		await startVerification(member);
		const welcomeChannelId = '1353631829453836291';
		const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);

		// Create welcome embed
		const welcomeEmbed = new EmbedBuilder()
			.setColor('#8a3c00')
			.setTitle('A New Member Has Arrived!')
			.setDescription(`Hear hear, ${member.displayName}!\n🍻 We raise our drinks to you, o' wayward traveller! 🍻\nWelcome to the Westwind Tavern, pull up a chair near the fire.`)
			.addFields(
				{
					name: 'Firstly, let\'s get you oriented.',
					value: '⤜■■■■■ Please read the <#1375496710440358022>! ■■■■■⤛',
					inline: false,
				},
				{
					name: 'Got any questions or concerns?',
					value: 'Check out what everyone is discussing in <#1377104879025131581> and open a new thread if it\'s something that\'s not been covered! We\'ll get back to you as soon as possible.',
					inline: false,
				},
			)
			.setImage('https://i.ibb.co/Df8H2Y6h/Westwind.png')
			.setFooter({
				text: 'Use `?welcome` to join the Welcoming Table!',
				iconURL: member.guild.iconURL(),
			})
			.setTimestamp();

		try {
			await welcomeChannel.send('<@&1354156128162021467>');
			const welcomeMessage = await welcomeChannel.send({
				content: `${member}`,
				embeds: [welcomeEmbed],
			});

			// Store welcome message with timestamp
			db.prepare(`
                INSERT INTO welcome_messages (message_id, new_member_id, welcome_time) 
                VALUES (?, ?, ?)
            `).run(welcomeMessage.id, member.id, Date.now());

		}
		catch (error) {
			console.error('Error sending welcome message:', error);
		}
	},
};