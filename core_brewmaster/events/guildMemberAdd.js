const { Events, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const db = require('@database/database.js');
const { startVerification } = require('@core_brewmaster/tasks/captchaRequest.js');
const config = require('@root/config.json');
const log = require('@utils/logger.js');
const WELCOME_PARTY_ROLE_ID = config?.discord?.welcomePartyRoleId || '1425143327317299311';


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
			log.error(`[guildMemberAdd] Failed to add Unverified role to ${member.user.tag}:`, error);
		}

		await startVerification(member);
		const welcomeChannelId = '1353631829453836291';
		const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);

		const welcomeSquadButton = new ButtonBuilder()
			.setCustomId('welcome_party_toggle')
			.setLabel('Join/Leave the Welcome Squad')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('👋');

		const row = new ActionRowBuilder().addComponents(welcomeSquadButton);

		// Create welcome embed
		const welcomeEmbed = new EmbedBuilder()
			.setColor('#8a3c00')
			.setThumbnail(member.user.displayAvatarURL())
			.setTitle('There\'s Been a New Addition to the Tavern!')
			.setDescription(`Hear hear, ${member.displayName} has arrived! Welcome to the Westwind Tavern.\nPull up a chair, warm yourself by the fire, and tell us your story.`)
			.addFields(
				{
					name: '🧭 Start Your Adventure Here!',
					// Blockquote for visibility
					value: '> **Your first quest is to read the <#1375496710440358022>!**\n> It has everything you need to know about our community and games, listed step by step!',
					inline: false,
				},
				{
					name: 'Essential Stops',
					// One-stop shop
					value: [
						'✅ Get verified in <#1375485421990969487> to access the server.',
						'📛 Grab some flair in <#1353631851734106165>.',
						'📜 Read the house rules in <#1353632019233378415>.',
						'👋 Introduce yourself over in <#1354166019203268679>!',
						'🍻 Join the main conversation in <#1353623582411984931>.',
					].join('\n'),
					inline: false,
				},
			)
			.setImage('https://i.ibb.co/Df8H2Y6h/Westwind.png')
			// Footer is like Tony talking, using his PFP and textline.
			.setFooter({
				text: 'Tony says: "Welcome fellow travelers in this channel, pal. There\'s a hefty sum of Crowns and XP in it for you, if you do."',
				iconURL: member.client.user.displayAvatarURL(),
			})
			.setTimestamp();

		try {
			const welcomeMessage = await welcomeChannel.send({
				content: `${member} & <@&${WELCOME_PARTY_ROLE_ID}>`,
				embeds: [welcomeEmbed],
				components: [row],
			});

			// Store welcome message with timestamp
			db.prepare(`
                INSERT INTO welcome_messages (message_id, new_member_id, welcome_time) 
                VALUES (?, ?, ?)
            `).run(welcomeMessage.id, member.id, Date.now());

		}
		catch (error) {
			log.error('Error sending welcome message:', error);
		}
	},
};