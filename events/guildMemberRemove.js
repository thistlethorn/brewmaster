const { Events, EmbedBuilder } = require('discord.js');
const db = require('../database');
const sendMessageToChannel = require('../utils/sendMessageToChannel');

/**
 * Deletes a guild when its owner leaves the server.
 * @param {import('discord.js').Client} client - The Discord client.
 * @param {import('discord.js').Guild} guild - The Discord guild object.
 * @param {string} guildTag - The tag of the guild to delete.
 */
async function handleOwnerDeparture(client, guild, guildTag) {
	const guildInfo = db.prepare('SELECT * FROM guild_list WHERE guild_tag = ?').get(guildTag);
	if (!guildInfo) return;

	console.log(`[GuildMemberRemove] Deleting guild "${guildInfo.guild_name}" [${guildTag}] because its owner has left.`);

	// 1. Announce the disbanding
	const announceEmbed = new EmbedBuilder()
		.setColor(0xE74C3C)
		.setTitle('🏛️ A Guild Has Fallen!')
		.setDescription(`The guild **${guildInfo.guild_name} [${guildTag}]** has been automatically disbanded because its Guildmaster has left the Tavern. All members have been removed.`)
		.setTimestamp();

	// Using a hardcoded channel for global announcements, as seen in guild.js
	const ANNOUNCEMENT_CHANNEL_ID = '1395191465206091888';
	try {
		await sendMessageToChannel(client, ANNOUNCEMENT_CHANNEL_ID, announceEmbed);
	}
	catch (error) {
		console.error('[GuildMemberRemove] Failed to send disband announcement:', error);
	}

	// 2. Delete Discord Assets
	try {
		const role = await guild.roles.fetch(guildInfo.role_id).catch(() => null);
		if (role) await role.delete('Guild disbanded: Owner left server.');

		const privateChannel = await guild.channels.fetch(guildInfo.channel_id).catch(() => null);
		if (privateChannel) await privateChannel.delete('Guild disbanded: Owner left server.');

		const publicChannel = await guild.channels.fetch(guildInfo.public_channel_id).catch(() => null);
		if (publicChannel) await publicChannel.delete('Guild disbanded: Owner left server.');
	}
	catch (error) {
		console.error(`[GuildMemberRemove] Error deleting Discord assets for [${guildTag}]:`, error.message);
	}

	// 3. Delete from Database
	db.prepare('DELETE FROM guild_list WHERE guild_tag = ?').run(guildTag);
	console.log(`[GuildMemberRemove] Guild [${guildTag}] and all associated data removed from the database.`);
}


module.exports = {
	name: Events.GuildMemberRemove,
	async execute(member) {
		const userId = member.id;

		// Find out if the departed member was in a guild
		const membership = db.prepare('SELECT * FROM guildmember_tracking WHERE user_id = ?').get(userId);

		// If they weren't in a guild, we don't need to do anything.
		if (!membership) {
			return;
		}

		console.log(`[GuildMemberRemove] Member ${member.user.tag} (${userId}) has left. They were in guild [${membership.guild_tag}].`);

		if (membership.owner === 1) {
			// The owner left. This is the most critical case.
			// We need to delete the guild and all its assets.
			await handleOwnerDeparture(member.client, member.guild, membership.guild_tag);
		}
		else {
			// A regular member or Vice-GM left. We just remove them from the tracking table.
			db.prepare('DELETE FROM guildmember_tracking WHERE user_id = ?').run(userId);
			console.log(`[GuildMemberRemove] Removed member ${userId} from guild [${membership.guild_tag}].`);

			// Announce the departure
			const guildInfo = db.prepare('SELECT guild_name, public_channel_id FROM guild_list WHERE guild_tag = ?').get(membership.guild_tag);

			// If the guild no longer exists (e.g., owner left first), we can't announce anything.
			if (!guildInfo) {
				console.log(`[GuildMemberRemove] Guild [${membership.guild_tag}] no longer exists. Cannot send departure announcement.`);
				return;
			}

			// 1. Send a global announcement for server-wide awareness.
			const GLOBAL_ANNOUNCEMENT_CHANNEL_ID = '1395191465206091888';
			const globalAnnounceEmbed = new EmbedBuilder()
				.setColor(0x95A5A6)
				.setTitle('🚶 A Traveler Has Departed')
				.setDescription(`Hats off, fellas. **${member.displayName}** has left the Tavern and is no longer with the **${guildInfo.guild_name}** guild.`)
				.setTimestamp();

			try {
				await sendMessageToChannel(member.client, GLOBAL_ANNOUNCEMENT_CHANNEL_ID, { embeds: [globalAnnounceEmbed] });
			}
			catch (e) {
				console.error('[GuildMemberRemove] Could not send global departure notice:', e);
			}


			// 2. Send a more personal message to the guild's own public channel.
			if (guildInfo.public_channel_id) {
				const guildAnnounceEmbed = new EmbedBuilder()
					.setColor(0x7F8C8D)
					.setDescription(`**${member.displayName}** has departed not just from our guild, but from the Tavern itself. We wish them well on their journey.`)
					.setTimestamp();
				try {
					await sendMessageToChannel(member.client, guildInfo.public_channel_id, { embeds: [guildAnnounceEmbed] });
				}
				catch (e) {
					console.error(`[GuildMemberRemove] Could not send departure notice to guild channel for [${membership.guild_tag}]:`, e);
				}
			}
		}
	},
};