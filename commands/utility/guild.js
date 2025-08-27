// commands/utility/guild.js
const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	PermissionFlagsBits,
	ModalBuilder,
	TextInputBuilder,
	Collection,
	MessageFlags,
} = require('discord.js');
const db = require('../../database');
const config = require('../../config.json');
const RESERVED_TERMS = [
	'admin', 'mod', 'staff', 'bot', 'everyone', 'here',
	'discord', 'guild', 'system', 'owner', 'official',
];
const {
	arrayTierEmoji,
	ONLY_CRESTS,
} = require('../../utils/emoji');

const { getTonyQuote } = require('../../utils/tonyDialogue.js');
const { getTierBenefits, getTierData } = require('../../utils/getTierBenefits');
const { scheduleRoleRemoval } = require('../../tasks/tempRoleManager');
const { updateMultiplier } = require('../../utils/handleCrownRewards');

const TIER_DATA = getTierData();
const tierEmojis = arrayTierEmoji();

const GUILD_CREATION_WITHDRAWAL_LIMIT = config.guild.creationWithdrawalLimit;

const RAID_DEFENDER_ROLE_ID = config.discord.raidDefenderRoleId;
const DEFENDER_ROLE_DURATION_MS = config.guild.defenderRoleDurationMs;
const GUILD_VULNERABILITY_THRESHOLD = config.guild.vulnerabilityThreshold;
const GUILD_RAID_MAX_STOLEN_PERCENT = config.guild.raidMaxStolenPercent;
const GUILD_RAID_MIN_PER_MEMBER_PERCENT = config.guild.raidMinPerMemberPercent;
const GUILD_RAID_MAX_PER_MEMBER_CAP = config.guild.raidMaxPerMemberCap;
// Alliance Raid constants (10 minutes)
const ALLIANCE_RAID_DURATION_MS = config.guild.allianceRaidDurationMs;

// Originally starting this at 15 but may change the upper limit later.
const NUMBER_OF_GUILDS_LIMIT = Number(config.guild?.maxAmountOfGuildsExisting) || 15;


// NEW: Helper function for creating delays
const wait = (ms) => new Promise(res => setTimeout(res, ms));


/**
 * Splits a long log into multiple embed fields to avoid character limits.
 * @param {EmbedBuilder} embed The embed to add fields to.
 * @param {string[]} log The array of log strings.
 * @param {string} title The title for the log field(s).
 */
function addLogFields(embed, log, title) {
	const MAX_LENGTH = 1024;
	let currentField = '';
	let part = 1;

	// Handle the initial empty state
	if (log.length === 0) {
		embed.addFields({ name: `🧾 ${title}`, value: 'Initializing collection...', inline: false });
		return;
	}

	for (const line of log) {
		// If adding the next line would exceed the limit...
		if (currentField.length + line.length + 2 > MAX_LENGTH) {
			// +2 for '\n'
			// ...add the current field to the embed...
			embed.addFields({
				name: part === 1 ? `🧾 ${title}` : `🧾 ${title} (cont.)`,
				value: currentField,
				inline: false,
			});
			// ...and start a new field with the current line.
			currentField = line + '\n';
			part++;
		}
		else {
			// Otherwise, just append the line.
			currentField += line + '\n';
		}
	}

	// Add the last remaining field if it has content
	if (currentField) {
		embed.addFields({
			name: part === 1 ? `🧾 ${title}` : `🧾 ${title} (cont.)`,
			value: currentField.trimEnd(),
			inline: false,
		});
	}
}

/**
 * Sends a standardized embed to the global guild announcements channel.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {EmbedBuilder} embed The embed to send.
 */
async function sendGuildAnnouncement(client, embed) {
	const ANNOUNCEMENT_CHANNEL_ID = '1395191465206091888';
	try {
		const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
		if (channel && channel.isTextBased()) {
			await channel.send({ embeds: [embed] });
		}
		else {
			console.error(`[Guild Announcement] Channel ${ANNOUNCEMENT_CHANNEL_ID} not found or is not a text channel.`);
		}
	}
	catch (error) {
		console.error('[Guild Announcement] Failed to send announcement:', error);
	}
}

async function checkAndDestroyGuildOnRaid(guildTag, attackerTag, interaction) {
	const guildEconomy = db.prepare('SELECT balance FROM guild_economy WHERE guild_tag = ?').get(guildTag);

	if (guildEconomy && guildEconomy.balance <= 0) {
		const guildInfo = db.prepare('SELECT * FROM guild_list WHERE guild_tag = ?').get(guildTag);
		if (!guildInfo) return;

		console.log(`[GUILD DESTRUCTION] Guild ${guildInfo.guild_name} (${guildTag}) is being destroyed by a raid from ${attackerTag}.`);

		try {
			const privateChannel = await interaction.guild.channels.fetch(guildInfo.channel_id).catch(() => null);
			if (privateChannel) await privateChannel.delete(`Guild destroyed by raid from ${attackerTag}.`);

			const publicChannel = await interaction.guild.channels.fetch(guildInfo.public_channel_id).catch(() => null);
			if (publicChannel) await publicChannel.delete(`Guild destroyed by raid from ${attackerTag}.`);

			const role = await interaction.guild.roles.fetch(guildInfo.role_id).catch(() => null);
			if (role) await role.delete(`Guild destroyed by raid from ${attackerTag}.`);

			// Use a transaction to ensure all parts are deleted
			db.transaction(() => {
				db.prepare('DELETE FROM guildmember_tracking WHERE guild_tag = ?').run(guildTag);
				db.prepare('DELETE FROM guild_list WHERE guild_tag = ?').run(guildTag);
			})();

			// Credit the attacker
			db.prepare(`
                INSERT INTO raid_leaderboard (guild_tag, guilds_destroyed)
                VALUES (?, 1)
                ON CONFLICT(guild_tag) DO UPDATE SET guilds_destroyed = guilds_destroyed + 1
            `).run(attackerTag);

		}
		catch (error) {
			console.error(`[GUILD DESTRUCTION] Failed to fully destroy guild ${guildTag}:`, error);
		}
	}
}
// Inside guild.js
async function handleLeave(interaction) {
	const userId = interaction.user.id;

	// Check if user is in a guild
	const userGuild = db.prepare(`
        SELECT gmt.*, gl.guild_name 
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        WHERE gmt.user_id = ?
    `).get(userId);

	if (!userGuild) {
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle(getTonyQuote('leave_notInGuild_title'))
			.setDescription(getTonyQuote('leave_notInGuild_desc'));
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	// Check if user is owner
	if (userGuild.owner === 1) {
		const ownerEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle(getTonyQuote('leave_isOwner_title'))
			.setDescription(getTonyQuote('leave_isOwner_desc', userGuild.guild_name, userGuild.guild_tag));
		return interaction.reply({ embeds: [ownerEmbed], flags: MessageFlags.Ephemeral });
	}

	// Remove guild role
	try {
		const guildData = db.prepare('SELECT role_id FROM guild_list WHERE guild_tag = ?').get(userGuild.guild_tag);
		if (guildData?.role_id) {
			const role = await interaction.guild.roles.fetch(guildData.role_id);
			if (role) await interaction.member.roles.remove(role);
		}

		// Remove from database
		db.prepare('DELETE FROM guildmember_tracking WHERE user_id = ?').run(userId);

		const leaveEmbed = new EmbedBuilder()
			.setColor(0xE67E22)
			.setTitle(getTonyQuote('leave_departed_title'))
			.setDescription(getTonyQuote('leave_departed_desc', interaction.user, userGuild.guild_name, userGuild.guild_tag))
			.setTimestamp();
		await sendGuildAnnouncement(interaction.client, leaveEmbed);

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle(getTonyQuote('leave_success_title'))
			.setDescription(getTonyQuote('leave_success_desc', userGuild.guild_name, userGuild.guild_tag));
		return interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
	}
	catch (error) {
		console.error('Leave guild error:', error);
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle(getTonyQuote('leave_error_title'))
			.setDescription(getTonyQuote('leave_error_desc'));
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
}
async function handleInvite(interaction) {
	const userId = interaction.user.id;
	const targetUser = interaction.options.getUser('user');

	// Check if inviter is in a guild and get detailed info
	const inviterGuild = db.prepare(`
        SELECT 
            gl.guild_name,
            gl.guild_tag,
            gl.motto,
            gl.lore,
            COALESCE(gt.tier, 1) AS tier
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        LEFT JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag
        WHERE gmt.user_id = ?
    `).get(userId);

	if (!inviterGuild) {
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle(getTonyQuote('invite_notInGuild_title'))
			.setDescription(getTonyQuote('invite_notInGuild_desc'));
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Check if target is already in a guild
	const targetInGuild = db.prepare('SELECT 1 FROM guildmember_tracking WHERE user_id = ?').get(targetUser.id);
	if (targetInGuild) {
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle(getTonyQuote('invite_targetInGuild_title'))
			.setDescription(getTonyQuote('invite_targetInGuild_desc', targetUser));
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	const memberCount = getGuildMemberCount(inviterGuild.guild_tag);
	const tierInfo = TIER_DATA[inviterGuild.tier - 1];

	// Create enhanced invite embed
	const embed = new EmbedBuilder()
		.setColor(0x3498db)
		.setTitle(getTonyQuote('invite_embed_title', inviterGuild.guild_name, inviterGuild.guild_tag))
		.setDescription(getTonyQuote('invite_embed_desc', inviterGuild.guild_name) || 'A promising guild is seeking new allies!')
		.setThumbnail('https://i.ibb.co/2YqsK07D/guild.jpg')
		.addFields(
			{ name: 'Motto', value: inviterGuild.motto ? `*${inviterGuild.motto}*` : 'No motto set.' },
			{ name: 'Tier', value: `${tierEmojis[inviterGuild.tier - 1]} (${tierInfo.name})`, inline: true },
			{ name: 'Members', value: memberCount.toString(), inline: true },
			{ name: 'Invited by', value: interaction.user.toString(), inline: true },
		)
		.setFooter({ text: `Use "/guild info ${inviterGuild.guild_tag}" for more details!` })
		.setTimestamp();


	// Create buttons
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`guild_invite_accept_${targetUser.id}_${inviterGuild.guild_tag}`)
			.setLabel('Accept')
			.setStyle(ButtonStyle.Success)
			.setEmoji('✅'),
		new ButtonBuilder()
			.setCustomId(`guild_invite_decline_${targetUser.id}_${inviterGuild.guild_tag}`)
			.setLabel('Decline')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('❌'),
	);

	// Send invite
	await interaction.reply({
		content: `${targetUser}`,
		embeds: [embed],
		components: [row],
	});
}
async function announceNewMember(client, newMember, guildData) {
	try {
		// --- Guild-Specific Welcome (Now in Public Channel) ---
		const channel = await client.channels.fetch(guildData.public_channel_id);
		if (channel && channel.isTextBased()) {
			await channel.send(`<@&${guildData.role_id}>`);

			const welcomeEmbed = new EmbedBuilder()
				.setColor(0x2ECC71)
				.setTitle(getTonyQuote('announce_newHero_title'))
				.setDescription(getTonyQuote('announce_newHero_desc', newMember.toString()))
				.setThumbnail(newMember.displayAvatarURL({ dynamic: true, size: 256 }))
				.addFields({
					name: `Welcome to ${guildData.guild_name}!`,
					value: getTonyQuote('announce_newHero_value', guildData.guild_name),
				})
				.setTimestamp();
			await channel.send({ embeds: [welcomeEmbed] });
		}

		// --- Global Announcement (Unchanged) ---
		const globalJoinEmbed = new EmbedBuilder()
			.setColor(0x57F287)
			.setTitle(getTonyQuote('announce_globalJoin_title'))
			.setDescription(getTonyQuote('announce_globalJoin_desc', newMember.toString(), guildData.guild_name, guildData.guild_tag))
			.setTimestamp();
		await sendGuildAnnouncement(client, globalJoinEmbed);

	}
	catch (error) {
		console.error(`[announceNewMember] Failed to send welcome message for ${newMember.tag} in guild ${guildData.guild_tag}:`, error);
	}
}
async function handleCreate(interaction) {
	const name = interaction.options.getString('name');
	const tag = interaction.options.getString('tag').toUpperCase();
	const userId = interaction.user.id;
	const guildCategoryId = config.discord.guildCategoryId;
	const staffRoleId = config.discord.staffRoleId;
	const botsRoleId = config.discord.botsRoleId;

	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle(getTonyQuote('create_failed_title'));

	// Validate guild tag
	if (!/^[A-Z]{3}$/.test(tag)) {
		errorEmbed.setDescription(getTonyQuote('create_badTag_desc'));
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	// Validate guild name (alphanumeric + spaces only)
	if (!/^[a-zA-Z0-9 ]+$/.test(name)) {
		errorEmbed.setDescription(getTonyQuote('create_badName_desc'));
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
	if (name.length < 3 || name.length > 35) {
		errorEmbed.setDescription(getTonyQuote('create_badLength_desc'));
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	// Validate against reserved terms
	const lowerName = name.toLowerCase();
	const hasReservedTerm = RESERVED_TERMS.some(term =>
		lowerName.includes(term),
	);

	if (hasReservedTerm) {
		errorEmbed.setDescription(getTonyQuote('create_reservedName_desc', RESERVED_TERMS.join(', ')));
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}


	const tagOfGuild = db.prepare('SELECT * FROM guildmember_tracking WHERE user_id = ?').get(userId);
	if (tagOfGuild) {
		const userGuild = db.prepare('SELECT * FROM guild_list WHERE guild_tag = ?').get(tagOfGuild.guild_tag);

		if (!userGuild) {
		// Cleanup: user is in a ghost guild
			db.prepare('DELETE FROM guildmember_tracking WHERE user_id = ?').run(userId);
			console.warn(`[Guild Fix] Removed ghost membership for user ${userId} in nonexistent guild [${tagOfGuild.guild_tag}]`);
		}
		else {
			errorEmbed.setDescription(getTonyQuote('create_alreadyInGuild_desc', userGuild.guild_name, tagOfGuild.guild_tag));
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
	}

	// Check if tag is already taken
	const existingGuild = db.prepare('SELECT * FROM guild_list WHERE guild_tag = ?').get(tag);
	if (existingGuild) {
		errorEmbed.setDescription(getTonyQuote('create_tagTaken_desc', tag));
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const startingBalance = 5000;

	// Create channel and role
	try {
		// Create role
		const role = await interaction.guild.roles.create({
			name: 'Guild: ' + name,
			color: '#3498db',
			reason: `Guild creation for ${interaction.user.tag}`,
		});

		// --- Create PUBLIC Channel ---
		const publicChannelName = 'guild-' + name
			.replace(/[^a-zA-Z0-9 ]/g, '')
			.replace(/\s+/g, '-')
			.toLowerCase();

		const publicChannel = await interaction.guild.channels.create({
			name: publicChannelName,
			type: 0,
			parent: guildCategoryId,
			topic: `Public square for ${name} (${tag})! All are welcome.`,
			// Permissions for public channel (everyone can view and send)
			permissionOverwrites: [
				{
					id: interaction.guild.id,
					allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
				},
				// Staff override
				{
					id: staffRoleId,
					allow: [PermissionFlagsBits.ManageMessages],
				},
			],
		});


		// --- Create PRIVATE (Hidden) Channel ---
		const privateChannelName = `guild-${tag.toLowerCase()}-hidden`;

		const privateChannel = await interaction.guild.channels.create({
			name: privateChannelName,
			type: 0,
			parent: guildCategoryId,
			topic: `Private guildhall for ${name} (${tag}) - Created by ${interaction.user.tag}`,
			// Permissions for private channel (deny everyone, allow members/staff/bots)
			permissionOverwrites: [
				{
					id: interaction.guild.id,
					deny: [PermissionFlagsBits.ViewChannel],
				},
				{
					id: role.id,
					allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
				},
				{
					id: staffRoleId,
					allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory],
				},
				{
					id: botsRoleId,
					allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
				},
			],
		});

		const motto = interaction.options.getString('motto') || '';

		// Verify all resources were created
		if (!role || !publicChannel || !privateChannel) {
			if (role) await role.delete().catch(console.error);
			if (publicChannel) await publicChannel.delete().catch(console.error);
			if (privateChannel) await privateChannel.delete().catch(console.error);
			throw new Error('Failed to create all guild resources');
		}

		// Assign role to user
		await interaction.member.roles.add(role);

		const creationTimestamp = new Date().toISOString();

		// Update databases within a transaction
		db.transaction(() => {
			db.prepare(`
				INSERT INTO guild_list (guild_name, guild_tag, channel_id, public_channel_id, role_id, motto, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run(name, tag, privateChannel.id, publicChannel.id, role.id, motto, creationTimestamp);

			db.prepare(`
				INSERT INTO guild_tiers (guild_tag, tier, last_upgrade_time)
				VALUES (?, 1, ?)
			`).run(tag, creationTimestamp);

			db.prepare(`
				INSERT INTO guild_economy (guild_tag, balance)
				VALUES (?, ?)
			`).run(tag, startingBalance);

			db.prepare(`
				INSERT INTO guild_raid_messages (guild_tag)
				VALUES (?)
			`).run(tag);

			db.prepare(`
				INSERT INTO guildmember_tracking (user_id, guild_tag, owner)
				VALUES (?, ?, ?)
			`).run(userId, tag, 1);
		})();

		const replyEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle(getTonyQuote('create_success_title', name, tag))
			.setDescription(getTonyQuote('create_success_desc', name))
			.addFields(
				{ name: 'Public Channel', value: `${publicChannel}`, inline: true },
				{ name: 'Private Guildhall', value: `${privateChannel}`, inline: true },
				{ name: 'Your New Role', value: `${role}`, inline: true },
				{ name: 'Founding Bonus', value: `Your guild has been founded with a **${startingBalance.toLocaleString()} Crown** treasury bonus!` },
			);

		const creationEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle(getTonyQuote('create_globalAnnounce_title'))
			.setDescription(getTonyQuote('create_globalAnnounce_desc', name, tag, interaction.user))
			.setTimestamp();

		await sendGuildAnnouncement(interaction.client, creationEmbed);

		// Welcome message in the new public channel
		await publicChannel.send({ content: getTonyQuote('create_publicChannelWelcome', name, tag, interaction.user) });


		return interaction.reply({ embeds: [replyEmbed], flags: MessageFlags.Ephemeral });


	}
	catch (error) {
		console.error('Guild creation error:', error);
		// Clean up any partially created resources
		const role = await interaction.guild.roles.cache.find(r => r.name === `Guild: ${name}`);
		if (role) await role.delete().catch(console.error);

		const finalErrorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle(getTonyQuote('create_error_title'))
			.setDescription(getTonyQuote('create_error_desc'));
		return interaction.reply({ embeds: [finalErrorEmbed], flags: MessageFlags.Ephemeral });
	}
}

// Inside guild.js
async function handleDelete(interaction) {
	const userId = interaction.user.id;

	// Check if user is a guild owner
	const userGuild = db.prepare(`
        SELECT gl.* 
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        WHERE gmt.user_id = ? AND gmt.owner = 1
    `).get(userId);

	if (!userGuild) {
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle(getTonyQuote('delete_notAllowed_title'))
			.setDescription(getTonyQuote('delete_notAllowed_desc'));
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
	const confirmationEmbed = new EmbedBuilder()
		.setColor(0xFEE75C)
		.setTitle(getTonyQuote('delete_confirm_title'))
		.setDescription(getTonyQuote('delete_confirm_desc', userGuild.guild_name, userGuild.guild_tag));

	// Create confirmation buttons
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId('guild_delete_confirm')
			.setLabel('Confirm Deletion')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🗑️'),
		new ButtonBuilder()
			.setCustomId('guild_delete_cancel')
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('❌'),
	);

	// Send confirmation message
	await interaction.reply({
		embeds: [confirmationEmbed],
		components: [row], flags: MessageFlags.Ephemeral });

	// Collect button responses
	const collector = interaction.channel.createMessageComponentCollector({
		time: 30000,
	});

	collector.on('collect', async (buttonInteraction) => {
		if (buttonInteraction.user.id !== userId) {
			const notOwnerEmbed = new EmbedBuilder()
				.setColor(0xE74C3C)
				.setTitle(getTonyQuote('delete_notForYou_title'))
				.setDescription(getTonyQuote('delete_notForYou_desc'));
			return buttonInteraction.reply({ embeds: [notOwnerEmbed], flags: MessageFlags.Ephemeral });
		}

		if (buttonInteraction.customId === 'guild_delete_confirm') {
			try {
				// Fetch both channels and the role
				const publicChannel = await interaction.guild.channels.fetch(userGuild.public_channel_id).catch(() => null);
				const privateChannel = await interaction.guild.channels.fetch(userGuild.channel_id).catch(() => null);
				const role = await interaction.guild.roles.fetch(userGuild.role_id).catch(() => null);

				if (publicChannel) await publicChannel.delete(`Guild ${userGuild.guild_tag} deleted by owner.`);
				if (privateChannel) await privateChannel.delete(`Guild ${userGuild.guild_tag} deleted by owner.`);
				if (role) await role.delete(`Guild ${userGuild.guild_tag} deleted by owner.`);

				// Update databases (ON DELETE CASCADE will handle related tables)
				db.prepare('DELETE FROM guild_list WHERE guild_tag = ?').run(userGuild.guild_tag);

				const deletionEmbed = new EmbedBuilder()
					.setColor(0xE74C3C)
					.setTitle(getTonyQuote('delete_globalAnnounce_title'))
					.setDescription(getTonyQuote('delete_globalAnnounce_desc', userGuild.guild_name, userGuild.guild_tag))
					.setTimestamp();
				await sendGuildAnnouncement(interaction.client, deletionEmbed);

				const successEmbed = new EmbedBuilder()
					.setColor(0x2ECC71)
					.setTitle(getTonyQuote('delete_success_title'))
					.setDescription(getTonyQuote('delete_success_desc', userGuild.guild_name, userGuild.guild_tag));
				await buttonInteraction.update({
					embeds: [successEmbed],
					components: [],
				});
			}
			catch (error) {
				console.error('Guild deletion error:', error);
				const errorEmbed = new EmbedBuilder()
					.setColor(0xE74C3C)
					.setTitle(getTonyQuote('delete_error_title'))
					.setDescription(getTonyQuote('delete_error_desc'));
				await buttonInteraction.update({
					embeds: [errorEmbed],
					components: [],
				});
			}
		}
		else if (buttonInteraction.customId === 'guild_delete_cancel') {
			const cancelEmbed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setTitle(getTonyQuote('delete_cancelled_title'))
				.setDescription(getTonyQuote('delete_cancelled_desc'));
			await buttonInteraction.update({
				embeds: [cancelEmbed],
				components: [],
			});
		}

		collector.stop();
	});

	collector.on('end', collected => {
		if (collected.size === 0) {
			const timeoutEmbed = new EmbedBuilder()
				.setColor(0xFEE75C)
				.setTitle(getTonyQuote('delete_timeout_title'))
				.setDescription(getTonyQuote('delete_timeout_desc'));
			interaction.editReply({
				embeds: [timeoutEmbed],
				components: [],
			});
		}
	});
}

// Default raid messages for reference and restoration
const DEFAULT_RAID_MESSAGES = {
	raiding_description: 'The war horns of {raidingGuild} sound across the plains, their banners held high as they march towards their target.',
	defending_description: 'The stronghold of {defendingGuild} stands defiantly, its gates barred and sentries on the walls, awaiting the coming storm.',
	raiding_attack: '{raidingGuild}\'s forces, led by {raidingGuildmaster}, begin their assault, crashing against the defenses of {defendingGuild}!',
	defending_success: 'The defenders of {defendingGuild}, under the command of {defendingGuildmaster}, have repelled the invaders! The attackers are routed!',
	defending_failure: 'The defenses of {defendingGuild} have been breached! The attackers pour into the stronghold, overwhelming the defenders led by {defendingGuildmaster}.',
	raiding_victory: 'Victory for {raidingGuild}! They have plundered the enemy and stand triumphant on the battlefield.',
	raiding_retreat: 'The attack has failed! The forces of {raidingGuild} are forced to retreat, their assault broken by the stalwart defenders.',
};

const MESSAGE_TITLES = {
	raiding_description: 'Raiding: The Approach',
	defending_description: 'Defending: The Stronghold',
	raiding_attack: 'Raiding: The Assault',
	defending_success: 'Defending: Successful Defense',
	defending_failure: 'Defending: Defenses Breached',
	raiding_victory: 'Raiding: Victory Cry',
	raiding_retreat: 'Raiding: Forced Retreat',
};

async function handleRaidMessagesSettings(interaction, guildData) {
	const mainEmbed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle('✒️ Raid Message Customization')
		.setDescription('How would you like to edit your guild\'s raid messages?');

	const mainRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`raidmsg_guided_${guildData.guild_tag}`)
			.setLabel('Guided Setup')
			.setStyle(ButtonStyle.Primary)
			.setEmoji('🗺️'),
		new ButtonBuilder()
			.setCustomId(`raidmsg_viewall_${guildData.guild_tag}`)
			.setLabel('View & Manage All')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('📖'),
	);

	await interaction.reply({ embeds: [mainEmbed], components: [mainRow], flags: MessageFlags.Ephemeral });
}

async function showAllRaidMessages(interaction, guildData) {
	const payload = buildAllRaidMessagesPayload(guildData);
	await interaction.update({ embeds: payload.embeds, components: payload.components });
}

function buildAllRaidMessagesPayload(guildData) {
	let currentMessages = db.prepare('SELECT * FROM guild_raid_messages WHERE guild_tag = ?').get(guildData.guild_tag);
	if (!currentMessages) {
		db.prepare('INSERT INTO guild_raid_messages (guild_tag) VALUES (?)').run(guildData.guild_tag);
		currentMessages = db.prepare('SELECT * FROM guild_raid_messages WHERE guild_tag = ?').get(guildData.guild_tag);
	}

	const embed = new EmbedBuilder()
		.setColor(0x57F287)
		.setTitle(`📖 Current Raid Messages for ${guildData.guild_name}`)
		.setDescription('Here are all your current raid messages. Click a button to edit a specific one.');

	const messageKeys = Object.keys(DEFAULT_RAID_MESSAGES);
	const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
	let fieldText = '';

	const componentRows = [];
	let currentRow = new ActionRowBuilder();

	messageKeys.forEach((key, index) => {
		const title = MESSAGE_TITLES[key];
		const message = currentMessages[key] || DEFAULT_RAID_MESSAGES[key];
		fieldText += `${numberEmojis[index]} **${title}**\n*_"${message}"_*\n\n`;

		if (currentRow.components.length === 5) {
			componentRows.push(currentRow);
			currentRow = new ActionRowBuilder();
		}

		currentRow.addComponents(
			new ButtonBuilder()
				.setCustomId(`raidmsg_edit_${guildData.guild_tag}_${key}`)
				.setLabel(`${index + 1}`)
				.setStyle(ButtonStyle.Primary),
		);
	});
	embed.setDescription(fieldText);

	if (currentRow.components.length > 0) {
		componentRows.push(currentRow);
	}


	const managementButtons = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`raidmsg_restore_${guildData.guild_tag}`)
			.setLabel('Restore to Defaults')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🔄'),
		new ButtonBuilder()
			.setCustomId('raidmsg_close_editor')
			.setLabel('Close')
			.setStyle(ButtonStyle.Secondary),
	);

	componentRows.push(managementButtons);

	return { embeds: [embed], components: componentRows };
}

async function processSingleMessage(interaction, guildData, keyToEdit) {
	const currentMessages = db.prepare('SELECT * FROM guild_raid_messages WHERE guild_tag = ?').get(guildData.guild_tag);

	const title = MESSAGE_TITLES[keyToEdit];
	const currentMessage = currentMessages[keyToEdit] || DEFAULT_RAID_MESSAGES[keyToEdit];

	const embed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle(`✒️ Set Raid Message: ${title}`)
		.setDescription(`Please send the new message for this phase in the chat. It must be under 1000 characters.\n\n**Current:** *"${currentMessage}"*`)
		.addFields({
			name: 'Keyword Glossary',
			value: '`{raidingGuild}` `{defendingGuild}` `{raidingGuildmaster}` `{defendingGuildmaster}` `{raidingViceGuildmaster}` `{defendingViceGuildmaster}`',
		})
		.setFooter({ text: 'You have 3 minutes to reply.' });

	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`raidmsg_back_${guildData.guild_tag}`).setLabel('Back to List').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('raidmsg_close_editor').setLabel('Exit Editor').setStyle(ButtonStyle.Danger),
	);

	// Update the message from the button press to show the prompt
	await interaction.update({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });

	const filter = (i) => i.user.id === interaction.user.id;
	const msgFilter = (m) => m.author.id === interaction.user.id;

	try {
		// Use Promise.race to wait for EITHER a button click OR a message.
		const collected = await Promise.race([
			interaction.channel.awaitMessageComponent({ filter, time: 180000 }),
			interaction.channel.awaitMessages({ filter: msgFilter, max: 1, time: 180000, errors: ['time'] }),
		]);

		if (collected instanceof Collection) {
			// A TEXT MESSAGE was sent.
			const message = collected.first();
			const newText = message.content.slice(0, 1000);

			db.prepare(`UPDATE guild_raid_messages SET ${keyToEdit} = ? WHERE guild_tag = ?`).run(newText, guildData.guild_tag);
			await message.delete().catch(console.error);

			// CORRECT: Edit the reply of the original interaction to show the full list again.
			const payload = buildAllRaidMessagesPayload(guildData);
			await interaction.editReply({ embeds: payload.embeds, components: payload.components });

		}
		else {
			// A BUTTON was clicked. `collected` is a new interaction.
			const buttonInteraction = collected;
			if (buttonInteraction.customId.startsWith('raidmsg_back')) {
				// Show the list again by updating the NEW button interaction.
				await showAllRaidMessages(buttonInteraction, guildData);
			}
			else if (buttonInteraction.customId === 'raidmsg_close_editor') {
				const closedEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription('Raid message editor closed.');
				await buttonInteraction.update({ embeds: [closedEmbed], components: [] });
			}
		}
	}
	catch (error) {
		// If it times out, we must edit the reply of the original interaction.
		const timeoutEmbed = new EmbedBuilder().setColor(0xFEE75C).setDescription('⏱️ Timed out. Editor closed.');
		await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
		console.log(error);
	}
}


async function processGuidedSetup(interaction, guildData) {
	let currentMessages = db.prepare('SELECT * FROM guild_raid_messages WHERE guild_tag = ?').get(guildData.guild_tag);
	if (!currentMessages) {
		console.log(`[Raid Messages] No record found for ${guildData.guild_tag}. Creating a default entry.`);
		db.prepare('INSERT INTO guild_raid_messages (guild_tag) VALUES (?)').run(guildData.guild_tag);
		currentMessages = db.prepare('SELECT * FROM guild_raid_messages WHERE guild_tag = ?').get(guildData.guild_tag);
	}

	const messageKeys = Object.keys(DEFAULT_RAID_MESSAGES);
	const promptsQueue = messageKeys.filter(key => currentMessages[key] === DEFAULT_RAID_MESSAGES[key]);

	if (promptsQueue.length === 0) {
		const finishedEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle(getTonyQuote('raidmsg_allSet_title'))
			.setDescription(getTonyQuote('raidmsg_allSet_desc'));
		return interaction.update({ embeds: [finishedEmbed], components: [] });
	}

	const startEmbed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setDescription(getTonyQuote('raidmsg_guidedStart_desc'));
	await interaction.update({ embeds: [startEmbed], components: [] });

	const processQueue = async (index) => {
		if (index >= promptsQueue.length) {
			const completeEmbed = new EmbedBuilder()
				.setColor(0x2ECC71)
				.setTitle(getTonyQuote('raidmsg_complete_title'))
				.setDescription(getTonyQuote('raidmsg_complete_desc'));
			await interaction.followUp({ embeds: [completeEmbed], flags: MessageFlags.Ephemeral });
			return;
		}

		const key = promptsQueue[index];
		const title = MESSAGE_TITLES[key];

		const embed = new EmbedBuilder()
			.setColor(0x3498DB)
			.setTitle(`✒️ Set Raid Message: ${title}`)
			.setDescription(`Please send the new message for this phase in the chat. It must be under 1000 characters.\n\n**Default:** *"${DEFAULT_RAID_MESSAGES[key]}"*`)
			.addFields({
				name: 'Keyword Glossary',
				value: '`{raidingGuild}` `{defendingGuild}` `{raidingGuildmaster}` `{defendingGuildmaster}` `{raidingViceGuildmaster}` `{defendingViceGuildmaster}`',
			})
			.setFooter({ text: `Setting ${index + 1} of ${promptsQueue.length} (default messages only)` });

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`skip_${key}`).setLabel('Skip for Now').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId('exit_editor').setLabel('Exit Editor').setStyle(ButtonStyle.Danger),
		);

		const promptMessage = await interaction.followUp({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral, fetchReply: true });

		const filter = (i) => i.user.id === interaction.user.id;
		const msgFilter = (m) => m.author.id === interaction.user.id;

		try {
			const collected = await Promise.race([
				promptMessage.awaitMessageComponent({ filter, time: 180000 }),
				interaction.channel.awaitMessages({ filter: msgFilter, max: 1, time: 180000, errors: ['time'] }),
			]);

			if (collected instanceof Collection) {
				const message = collected.first();
				const newText = message.content.slice(0, 1000);

				db.prepare(`UPDATE guild_raid_messages SET ${key} = ? WHERE guild_tag = ?`).run(newText, guildData.guild_tag);
				await message.delete().catch(console.error);

				const updatedEmbed = new EmbedBuilder().setColor(0x2ECC71).setDescription(getTonyQuote('raidmsg_updated_desc', title));
				await interaction.editReply({ embeds: [updatedEmbed], components: [] });
			}
			else {
				if (collected.customId === 'exit_editor') {
					const exitEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription(getTonyQuote('raidmsg_exit_desc'));
					await collected.update({ embeds: [exitEmbed], components: [] });
					return;
				}
				const skippedEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription(getTonyQuote('raidmsg_skipped_desc'));
				await collected.update({ embeds: [skippedEmbed], components: [] });
			}
		}
		catch (error) {
			const timeoutEmbed = new EmbedBuilder().setColor(0xFEE75C).setDescription(getTonyQuote('raidmsg_timeout_desc'));
			await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
			console.log(error);
			return;
		}

		await processQueue(index + 1);
	};

	await processQueue(0);
}


async function handleGuildFund(interaction) {
	const userId = interaction.user.id;
	const guildTag = interaction.options.getString('guild_tag').toUpperCase();
	const amount = interaction.options.getInteger('amount');

	if (amount <= 0) {
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle('❌ Invalid Funding Amount')
			.setDescription(`Sorry, ${amount} must be greater than 0 to fund a guild.`);
		return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}
	const guildInfo = db.prepare('SELECT guild_name FROM guild_list WHERE guild_tag = ?').get(guildTag);
	if (!guildInfo) {
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle('❌ Guild Not Found')
			.setDescription(`Couldn't find any guild with the tag [${guildTag}]. Please double-check the tag.`);
		return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}

	// Get user's balance
	const userEcon = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId);
	const userBalance = userEcon?.crowns || 0;

	if (userBalance < amount) {
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle(getTonyQuote('fund_failed_title'))
			.addFields(
				{
					name: getTonyQuote('fund_insufficient_name'),
					value: getTonyQuote('fund_insufficient_value', amount, (amount - userBalance)),
					inline: false,
				},
				{
					name: '👑 Current Crown Balance:',
					value: `${(userEcon?.crowns || 0).toLocaleString()} Crowns`,
					inline: false,
				},
			);
		return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}

	const fundTxn = db.transaction((uid, gTag, amt) => {
		const res = db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ? AND crowns >= ?').run(amt, uid, amt);
		if (res.changes === 0) throw new Error('Insufficient funds at commit time');
		db.prepare(`
				INSERT INTO guild_economy (guild_tag,balance)
				VALUES (?,?)
				ON CONFLICT(guild_tag) DO UPDATE SET balance = COALESCE(balance,0) + ?
			`).run(gTag, amt, amt);
	});

	try {
		fundTxn(userId, guildTag, amount);

		const postTransactionMemberCrownValue = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId);
		const updatedUserBalance = postTransactionMemberCrownValue?.crowns || 0;

		const embed = new EmbedBuilder()
			.setColor(0xF1C40F)
			.setTitle('💰 Treasury Contribution 💰')
			.addFields(
				{
					name: getTonyQuote('fund_success_name'),
					value: getTonyQuote('fund_success_value', amount, guildInfo.guild_name, guildTag),
					inline: false,
				},
				{
					name: '👑 **NEW** Crown Balance:',
					value: `${updatedUserBalance.toLocaleString()} Crowns`,
					inline: false,
				},
			);
		await interaction.reply({ embeds: [embed] });
	}
	catch (error) {
		console.error('Guild funding error:', error);
		const embed = new EmbedBuilder()
			.setColor(0xed4245)
			.setTitle('❌ Brewmaster Error!')
			.addFields(
				{
					name: getTonyQuote('fund_error_name'),
					value: getTonyQuote('fund_error_value'),
					inline: false,
				},
				{
					name: 'Error:',
					value: String(error),
					inline: false,
				},
			);
		await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}
}

async function handlePayout(interaction, targetUser = null) {
	const userId = interaction.user.id;
	const amount = interaction.options.getInteger('amount');
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Payout Failed');
	const successEmbed = new EmbedBuilder().setColor(0x2ECC71).setTitle('✅ Payout Successful');

	// Verify user is guild owner or vice gm
	const guildData = db.prepare(`
        SELECT gl.guild_tag, gl.guild_name, ge.balance
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
        WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
    `).get(userId);

	if (!guildData) {
		errorEmbed.setDescription('You must be the owner or vice-guildmaster of a guild to make payouts!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	const currentBalance = guildData.balance || 0;

	if (targetUser) {
		// Single user payout
		if (currentBalance < amount) {
			errorEmbed.setDescription(`Your guild only has **${currentBalance.toLocaleString()}** crowns - not enough for this payout!`);
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
		// Check withdrawal limit
		if (currentBalance - amount < GUILD_CREATION_WITHDRAWAL_LIMIT) {
			errorEmbed.setDescription(`You cannot withdraw funds if it would drop the guild balance below **${GUILD_CREATION_WITHDRAWAL_LIMIT.toLocaleString()}** Crowns. This is to protect the guild's founding bonus.`);
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}

		try {
			// Verify target is in the guild
			const isMember = db.prepare(`
                SELECT 1 FROM guildmember_tracking 
                WHERE user_id = ? AND guild_tag = ?
            `).get(targetUser.id, guildData.guild_tag);

			if (!isMember) {
				errorEmbed.setDescription(`${targetUser} is not a member of your guild!`);
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}

			// Perform payout in transaction
			db.transaction(() => {
				db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ?')
					.run(amount, guildData.guild_tag);
				db.prepare(`
                    INSERT INTO user_economy (user_id, crowns)
                    VALUES (?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
                `).run(targetUser.id, amount, amount);
			})();
			successEmbed.setDescription(`Paid out **${amount.toLocaleString()}** crowns from guild funds to ${targetUser}!`);
			return interaction.reply({
				embeds: [successEmbed],
			});
		}
		catch (error) {
			console.error('Payout error:', error);
			errorEmbed.setTitle('❌ Payout Error').setDescription('An unexpected error occurred during the payout. The transaction was rolled back.');
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
	}
	else {
		// Payout to all members
		const members = db.prepare(`
            SELECT user_id FROM guildmember_tracking 
            WHERE guild_tag = ? AND user_id != ?
        `).all(guildData.guild_tag, userId);

		if (members.length === 0) {
			errorEmbed.setDescription('Your guild has no other members to pay out to!');
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}

		const totalPayout = amount * members.length;

		if (currentBalance < totalPayout) {
			errorEmbed.setDescription(`Your guild needs **${totalPayout.toLocaleString()}** crowns to pay **${amount.toLocaleString()}** to each of the ${members.length} members, but only has **${currentBalance.toLocaleString()}**!`);
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
		// Check withdrawal limit
		if (currentBalance - totalPayout < GUILD_CREATION_WITHDRAWAL_LIMIT) {
			errorEmbed.setDescription(`You cannot withdraw funds if it would drop the guild balance below **${GUILD_CREATION_WITHDRAWAL_LIMIT.toLocaleString()}** Crowns. This payout requires **${totalPayout.toLocaleString()}** Crowns.`);
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}

		try {
			// Perform payout in transaction
			db.transaction(() => {
				db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ?')
					.run(totalPayout, guildData.guild_tag);
				members.forEach(member => {
					db.prepare(`
                        INSERT INTO user_economy (user_id, crowns)
                        VALUES (?, ?)
                        ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
                    `).run(member.user_id, amount, amount);
				});
			})();
			successEmbed.setDescription(`Paid out **${amount.toLocaleString()}** crowns to each of the **${members.length}** guild members (**${totalPayout.toLocaleString()}** crowns total)!`);
			return interaction.reply({
				embeds: [successEmbed],
			});
		}
		catch (error) {
			console.error('Payout all error:', error);
			errorEmbed.setTitle('❌ Payout Error').setDescription('An unexpected error occurred during the mass payout. The transaction was rolled back.');
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}

const DUES_SCENARIOS = [
	{ base: 'The guild used **{amount}** from **{user}** to purchase new equipment.', success: '✅ **Success!** The blacksmith, impressed by your guild\'s reputation, gave a discount!', failure: '❌ **Failure!** The blacksmith didn\'t care for discounts and charged a premium.' },
	{ base: '**{user}**\'s **{amount}** was used to restock the guild\'s potion supplies.', success: '✅ **Success!** A traveling alchemist offered a rare deal on healing potions!', failure: '❌ **Failure!** Potion prices were higher than expected due to a local griffin flu.' },
	{ base: 'With **{user}**\'s **{amount}**, the guild invested in a local merchant caravan.', success: '✅ **Success!** The caravan returned with handsome profits after finding a new trade route!', failure: '❌ **Failure!** Bandits attacked the caravan, and half the goods were lost.' },
	{ base: '**{user}**\'s dues of **{amount}** went towards guild feast preparations.', success: '✅ **Success!** The tavern keeper, in a good mood, threw in extra ale for free!', failure: '❌ **Failure!** The butcher\'s prices had mysteriously gone up since last week.' },
	{ base: 'The guild used **{amount}** from **{user}** to pay for repairs to the training grounds.', success: '✅ **Success!** A master carpenter, a guild ally, offered to work at half price!', failure: '❌ **Failure!** The damage was worse than initially thought, requiring costly materials.' },
	{ base: '**{amount}** from **{user}** was spent on new maps for the guild library.', success: '✅ **Success!** An old explorer sold a rare, treasure-filled map collection for cheap!', failure: '❌ **Failure!** The cartographer charged extra for "premium, tear-proof vellum".' },
	{ base: '**{user}**\'s contribution of **{amount}** funded a scouting mission.', success: '✅ **Success!** The scouts returned with valuable information AND unexpected loot!', failure: '❌ **Failure!** The scouts got hopelessly lost and had to use funds to bribe their way back.' },
	{ base: 'The guild used **{amount}** from **{user}** to bribe a city official for... "favors".', success: '✅ **Success!** The official was surprisingly honest and returned some of the coin!', failure: '❌ **Failure!** The greedy official demanded double the initial bribe!' },
];

// 4% Chance
const RARE_DUES_SCENARIOS = [
	{ base: '**{user}**\'s **{amount}** was invested in a promising mining expedition.', success: '💎 **RARE SUCCESS!** The expedition struck a vein of pure mythril! The profits are enormous!' },
	{ base: 'A portion of **{user}**\'s **{amount}** was used to enter a high-stakes card game.', success: '🃏 **RARE SUCCESS!** The guild\'s champion bluffed their way to a massive victory, winning the entire pot!' },
	{ base: 'The guild used **{amount}** from **{user}** to purchase a mysterious, locked chest from a shady dealer.', success: '🗝️ **RARE SUCCESS!** The chest contained a stash of forgotten royal jewels, worth a fortune!' },
	{ base: '**{user}**\'s **{amount}** was used to fund an archaeological dig at some ancient ruins.', success: '🏺 **RARE SUCCESS!** The dig uncovered a priceless artifact that was immediately sold to a wealthy collector!' },
];

// 1% Chance
const ULTRA_RARE_DUES_SCENARIOS = [
	{ base: '**{user}**\'s humble **{amount}** was used to buy a lottery ticket from a passing fay.', success: '✨ **ULTRA-RARE!!!** The ticket was a winner! The fay blessed the guild with a river of gold from the faewild!' },
	{ base: 'With **{user}**\'s **{amount}**, the guild funded a voyage to an uncharted island.', success: '🐲 **ULTRA-RARE!!!** The island was the hoard of an ancient dragon who, amused by your audacity, gifted you a mountain of treasure!' },
];

// Helper function to shuffle an array
function shuffleArray(array) {
	const newArr = [...array];
	for (let i = newArr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[newArr[i], newArr[j]] = [newArr[j], newArr[i]];
	}
	return newArr;
}


async function handleDues(interaction) {
	const userId = interaction.user.id;

	// Verify user is guild owner or vice gm
	const guildData = db.prepare(`
        SELECT gl.guild_tag, gl.guild_name, gl.channel_id, gl.public_channel_id, gl.role_id
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
    `).get(userId);

	if (!guildData) {
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle('❌ Not Authorized')
			.setDescription('Only the guild owner or vice-guildmaster can collect dues!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
	const today = new Date().toISOString().slice(0, 10);

	// guild tag is set as primary key, just to make sure ON CONFLICT works properly
	const upsert = db.prepare(`
		INSERT INTO guild_daily_dues (guild_tag, last_dues_date)
	    VALUES (?, ?)
		ON CONFLICT(guild_tag) DO UPDATE SET
			last_dues_date = excluded.last_dues_date
		WHERE last_dues_date <> excluded.last_dues_date
		`);
	const info = upsert.run(guildData.guild_tag, today);

	// Conditional upsert: if no row changed, dues were already collected today (race-safe)

	if (info.changes === 0) {
		const errorEmbed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setTitle('💰 Dues Already Collected')
			.setDescription('Your guild has already collected its dues for today. This command can be used once per day (resets at Midnight UTC).');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
	// Fetch the guild's dedicated public channel
	let guildChannel;
	try {
		guildChannel = await interaction.guild.channels.fetch(guildData.public_channel_id);
		if (!guildChannel || !guildChannel.isTextBased()) {
			throw new Error('Public channel is not a text channel or does not exist.');
		}
	}
	catch (error) {
		console.error('Failed to fetch guild public channel:', error);
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle('❌ Channel Not Found')
			.setDescription(`Could not find the guild's public channel (<#${guildData.public_channel_id}>). It may have been deleted.`);
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Acknowledge the command
	const ackEmbed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setDescription(`Starting the dues collection process in ${guildChannel}.`);
	await interaction.reply({
		embeds: [ackEmbed],
		flags: MessageFlags.Ephemeral,
	});

	// Send announcement
	await guildChannel.send({ content: `<@&${guildData.role_id}>` });
	const announcementEmbed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle('📢 Guild Announcement!')
		.setDescription(`The Guildmaster, ${interaction.user}, has begun the daily dues collection!`);
	await guildChannel.send({ embeds: [announcementEmbed] });

	// Get all guild members
	const members = db.prepare(`
        SELECT gmt.user_id, ue.crowns
        FROM guildmember_tracking gmt
        LEFT JOIN user_economy ue ON gmt.user_id = ue.user_id
        WHERE gmt.guild_tag = ?
        ORDER BY RANDOM()
    `).all(guildData.guild_tag);

	if (members.length === 0) {
		const noMembersEmbed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setDescription('The guild has no members to collect dues from!');
		return guildChannel.send({ embeds: [noMembersEmbed] });
	}

	let totalCollected = 0;
	let investmentResults = 0;
	let baseContributions = 0;
	const resultsLog = [];

	// Shuffle scenarios
	let shuffledCommon = shuffleArray(DUES_SCENARIOS);
	let shuffledRare = shuffleArray(RARE_DUES_SCENARIOS);
	let shuffledUltra = shuffleArray(ULTRA_RARE_DUES_SCENARIOS);

	const baseEmbed = new EmbedBuilder()
		.setColor(0xF1C40F)
		.setTitle(`🏦 Collecting Dues for ${guildData.guild_name}...`)
		.setDescription('Each member contributes 1% of their Crowns. These funds are then invested, with a chance for a bonus or a loss!')
		.setThumbnail('https://i.ibb.co/2YqsK07D/guild.jpg');

	addLogFields(baseEmbed, resultsLog, 'Contribution Log');
	const duesMessage = await guildChannel.send({ embeds: [baseEmbed] });

	for (const member of members) {
		const memberUser = await interaction.client.users.fetch(member.user_id).catch(() => null);
		if (!memberUser) continue;

		const contribution = Math.floor((member.crowns || 0) * 0.01);

		if (contribution < 1) {
			resultsLog.push(`- 🤷 ${memberUser} had insufficient funds to contribute.`);
			const updatedEmbed = new EmbedBuilder(baseEmbed.data);
			addLogFields(updatedEmbed, resultsLog, 'Contribution Log');
			await duesMessage.edit({ embeds: [updatedEmbed] });
			await new Promise(resolve => setTimeout(resolve, 1500));
			continue;
		}

		// --- Tiered Luck System ---
		const luckRoll = Math.random();
		let scenario;
		let investmentChange;

		const pickOutcome = (s, ok) => ok ? s.success : s.failure;
		let isSuccess = false;

		if (luckRoll < 0.01) {
			if (shuffledUltra.length === 0) shuffledUltra = shuffleArray(ULTRA_RARE_DUES_SCENARIOS);
			scenario = shuffledUltra.pop();
			investmentChange = Math.floor(contribution * (5 + Math.random() * 5));
			isSuccess = true;
		}
		else if (luckRoll < 0.05) {
			if (shuffledRare.length === 0) shuffledRare = shuffleArray(RARE_DUES_SCENARIOS);
			scenario = shuffledRare.pop();
			investmentChange = Math.floor(contribution * (1.5 + Math.random() * 1.5));
			isSuccess = true;
		}
		else {
			if (shuffledCommon.length === 0) shuffledCommon = shuffleArray(DUES_SCENARIOS);
			scenario = shuffledCommon.pop();
			isSuccess = Math.random() < 0.6;
			if (isSuccess) {
				investmentChange = Math.floor(contribution * (0.2 + Math.random() * 0.6));
			}
			else {
				investmentChange = -Math.floor(contribution * (0.1 + Math.random() * 0.4));
			}
		}
		const resultMessage = pickOutcome(scenario, isSuccess);

		const baseMessage = scenario.base
			.replace('{user}', memberUser)
			.replace('{amount}', `${contribution.toLocaleString()} Crowns`);

		// STAGE 1 & 2: Animation
		for (let i = 0; i <= 3; i++) {
			const animationEmbed = new EmbedBuilder(baseEmbed.data);
			// Clear fields first
			animationEmbed.spliceFields(0, animationEmbed.data.fields?.length || 0);
			addLogFields(animationEmbed, resultsLog, 'Contribution Log');
			animationEmbed.addFields({
				name: '🎲 Current Investment',
				value: `${baseMessage}\n***Processing${'.'.repeat(i)}***`,
				inline: false,
			});
			await duesMessage.edit({ embeds: [animationEmbed] });
			await new Promise(resolve => setTimeout(resolve, 1500));
		}

		// STAGE 3: Reveal outcome
		const resultAmount = Math.max(0, contribution + investmentChange);

		try {
			db.transaction(() => {
				db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(contribution, member.user_id);
				db.prepare('INSERT INTO guild_economy (guild_tag, balance) VALUES (?, ?) ON CONFLICT(guild_tag) DO UPDATE SET balance = balance + ?').run(guildData.guild_tag, resultAmount, resultAmount);
			})();

			baseContributions += contribution;
			investmentResults += investmentChange;
			totalCollected += resultAmount;

			resultsLog.push(`- ${baseMessage}\n${resultMessage}  **(👑 ${contribution.toLocaleString()} ➔ 👑 ${resultAmount.toLocaleString()})**`);
		}
		catch (err) {
			console.error(`Dues DB transaction failed for ${memberUser.username}:`, err);
			resultsLog.push(`- ❌ An error occurred for ${memberUser}.`);
		}

		// Update embed with the final result for this member
		const finalMemberEmbed = new EmbedBuilder(baseEmbed.data);
		addLogFields(finalMemberEmbed, resultsLog, 'Contribution Log');
		await duesMessage.edit({ embeds: [finalMemberEmbed] });
	}

	// Final summary update
	const finalEmbed = new EmbedBuilder()
		.setColor(0x2ECC71)
		.setTitle(`✅ Dues Collection Complete! - ${guildData.guild_name}`)
		.setThumbnail('https://i.ibb.co/2YqsK07D/guild.jpg')
		.setDescription('Each member contributes 1% of their Crowns. These funds are then invested, with a chance for a bonus or a loss!')
		.addFields(
			{ name: '🏛️ Base Contributions', value: `**${baseContributions.toLocaleString()}** crowns`, inline: true },
			{ name: '📈 Investment Gain/Loss', value: `**${investmentResults.toLocaleString()}** crowns`, inline: true },
			{ name: '💰 Total Collected', value: `**${totalCollected.toLocaleString()}** crowns`, inline: true },
		);
	addLogFields(finalEmbed, resultsLog, 'Final Contribution Log');
	finalEmbed.setFooter({ text: 'The Guildmaster collects DAILY DUES equal to 1% of each member\'s balance.' });
	await duesMessage.edit({ embeds: [finalEmbed] });
}

async function handleInfo(interaction) {
	const guildTag = interaction.options.getString('guild_tag').toUpperCase();

	const guildInfo = db.prepare(`
        SELECT guild_name, hook
        FROM guild_list
        WHERE guild_tag = ?
    `).get(guildTag);

	if (!guildInfo) {
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle('❌ Not Found')
			.setDescription('No guild found with that tag!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	const hookEmbed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle(`Info on ${guildInfo.guild_name} [${guildTag}]`)
		.setDescription('Click the button below to learn more about this guild!')
		.addFields(
			{
				name: '❓ What are Guilds?',
				value: 'Guilds are player-run factions. You can join one to team up with others, participate in raids, earn Crowns, and climb the leaderboards!',
			},
			{
				name: '📜 The Guild\'s Hook',
				value: guildInfo.hook ? `*${guildInfo.hook}*` : 'No hook set. Use `/guild settings hook` to add one (max 150 characters).',
			},
		);

	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`guild_info_main_${guildTag}`)
			.setLabel('📖 Learn More')
			.setStyle(ButtonStyle.Primary),
	);

	await interaction.reply({ embeds: [hookEmbed], components: [row] });
}
async function handleFullInfo(interaction) {
	try {
		const guildTag = interaction.options.getString('guild_tag').toUpperCase();

		// Get comprehensive guild info
		const guildInfo = db.prepare(`
            SELECT 
                gl.*,
                COALESCE(ge.balance, 0) AS balance,
                COALESCE(gt.tier, 1) AS tier,
                rc.shield_expiry,
                rc.last_raid_time,
                rl.successful_raids,
				rl.guilds_destroyed,
                rl.crowns_stolen
            FROM guild_list gl
            LEFT JOIN guild_economy ge ON ge.guild_tag = gl.guild_tag
            LEFT JOIN guild_tiers gt ON gt.guild_tag = gl.guild_tag
			LEFT JOIN raid_cooldowns rc ON rc.guild_tag = gl.guild_tag
            LEFT JOIN raid_leaderboard rl ON rl.guild_tag = gl.guild_tag
            WHERE gl.guild_tag = ?
        `).get(guildTag);

		if (!guildInfo) {
			const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Not Found').setDescription('No guild found with that tag!');
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
		const bounty = db.prepare('SELECT amount, placer_guild_tag FROM guild_bounties WHERE target_guild_tag = ? AND status = ?').get(guildTag, 'ACTIVE');
		const memberData = db.prepare('SELECT owner, vice_gm FROM guildmember_tracking WHERE user_id = ? AND guild_tag = ?').get(interaction.user.id, guildTag);
		const isMember = !!memberData;
		const isOwner = memberData?.owner === 1;

		const isVulnerable = guildInfo.balance < GUILD_VULNERABILITY_THRESHOLD;
		const vulnerableStatus = isVulnerable
			? `🚨 **VULNERABLE STATE** 🚨\n__Your guild treasury has less than **${GUILD_VULNERABILITY_THRESHOLD} Crowns**!__\n` +
              `• Raiders will steal **${GUILD_RAID_MAX_STOLEN_PERCENT}% from each member** (uncapped) instead of the usual capped ${GUILD_RAID_MIN_PER_MEMBER_PERCENT}% (${GUILD_RAID_MAX_PER_MEMBER_CAP} per member MAX)\n` +
              `• Your vault will be targeted for a flat **${GUILD_RAID_MAX_STOLEN_PERCENT}%** of its balance, ignoring your tier's normal damage reduction.\n` +
			  '• If your treasury is successfully raided and drops to __0 or less__ crowns, it will be **PERMANENTLY DESTROYED**.\n' +
			  '• __**Consider funding your guild**__ with `/guild fund`, `/guild fundraise`, or `/guild dues` to exit this vulnerable state!'
			: '✅ **Safe Treasury**\nYour guild has sufficient funds to withstand a raid without being destroyed.';

		const members = db.prepare(`
            SELECT gmt.user_id, gmt.owner, gmt.vice_gm, COALESCE(ue.crowns, 0) AS crowns
            FROM guildmember_tracking gmt
            LEFT JOIN user_economy ue ON gmt.user_id = ue.user_id
            WHERE gmt.guild_tag = ?
            ORDER BY gmt.owner DESC, gmt.vice_gm DESC, ue.crowns DESC
        `).all(guildInfo.guild_tag);

		const totalWealth = members.reduce((sum, member) => sum + member.crowns, guildInfo.balance);
		const now = new Date();
		const creationDate = new Date(guildInfo.created_at);
		const daysSinceCreation = (now - creationDate) / (1000 * 60 * 60 * 24);
		const shieldExpiry = guildInfo.shield_expiry ? new Date(guildInfo.shield_expiry) : null;
		const rawShieldStatus = shieldExpiry && shieldExpiry > now
			? `🛡️ Active (expires <t:${Math.floor(shieldExpiry.getTime() / 1000)}:R>)`
			: (daysSinceCreation < 7 ? `🆕 New Guild Protection (expires <t:${Math.floor((creationDate.getTime() + (7 * 24 * 60 * 60 * 1000)) / 1000)}:R>)` : '❌ No active shield');
		const shieldStatus = (isMember || isOwner) ? rawShieldStatus : '🛡️ ❓ (Hidden)';

		const defaultEmojiRecord = db.prepare('SELECT emoji_name, emoji_id FROM guild_emojis WHERE guild_tag = ? AND is_default = 1').get(guildTag);
		const guildEmoji = defaultEmojiRecord ? `<:${defaultEmojiRecord.emoji_name}:${defaultEmojiRecord.emoji_id}>` : '•';
		const memberList = [];
		let titleNameTicker = 0;
		let leader = 'the Guildmaster';

		for (const member of members) {
			try {
				const discordMember = await interaction.guild.members.fetch(member.user_id).catch(() => null);
				if (!discordMember) {
					db.prepare('DELETE FROM guildmember_tracking WHERE user_id = ?').run(member.user_id);
					continue;
				}

				let memberText;
				if (member.owner === 1) {
					memberText = `👑 __**GUILDMASTER**__\n${guildEmoji} ${discordMember.toString()}/${discordMember.displayName}`;
					leader = discordMember.displayName;
				}
				else if (member.vice_gm === 1) {
					memberText = `🛡️ __**VICE GUILDMASTER**__\n${guildEmoji} ${discordMember.toString()}/${discordMember.displayName}`;
				}
				else {
					// Logic for custom title display
					const titleHeader = titleNameTicker === 0 ? `\n**__${guildInfo.guildmember_title || 'Members'}__**\n` : '';
					memberText = `${titleHeader}${guildEmoji} ${discordMember.toString()}/${discordMember.displayName}`;
					titleNameTicker++;
				}
				memberList.push(`${memberText}\n\`[🪙 ${member.crowns.toLocaleString()}]\` Crowns`);
			}
			catch (error) {
				console.error(`Error processing member ${member.user_id}:`, error);
				memberList.push(`• <@${member.user_id}> \`[🪙 ${member.crowns.toLocaleString()}]\` (Error fetching)`);
			}
		}

		let raidCooldownStatus = '❓ (Hidden)';
		if (isMember) {
			if (guildInfo.last_raid_time) {
				const lastRaid = new Date(guildInfo.last_raid_time);
				const nextRaidTime = new Date(lastRaid.getTime() + 24 * 60 * 60 * 1000);
				raidCooldownStatus = now < nextRaidTime
					? `🕰️ Can raid <t:${Math.floor(nextRaidTime.getTime() / 1000)}:R>`
					: '✅ Ready to raid';
			}
			else {
				raidCooldownStatus = '✅ Ready to raid';
			}
		}

		const embed = new EmbedBuilder()
			.setTitle(`${guildInfo.guild_name} [${guildInfo.guild_tag}]`)
			.setDescription(guildInfo.hook || 'No hook set. Use `/guild settings hook` to add one (max 150 characters).')
			.setColor(0x3498db)
			.addFields(
				{ name: ((guildInfo.is_open || 0) === 1) ? '🔓 Open to join' : '🔒 Invite only', value: `Inquire with ${leader ? `__${leader}__` : 'the Guildmaster'}`, inline: false },
				{ name: 'Motto', value: guildInfo.motto ? `*"${guildInfo.motto}"*` : 'None set.', inline: true },
				{ name: 'Shield Status', value: shieldStatus, inline: true },
				{ name: 'Raid Stats', value: `⚔️ Raids: **${guildInfo.successful_raids || 0}**\n☠️ Destroyed: **${guildInfo.guilds_destroyed || 0}**\n👑 Stolen: **${guildInfo.crowns_stolen?.toLocaleString() || '0'}**\n⌛ Cooldown: **${raidCooldownStatus}**`, inline: true },
				{ name: `Members (${members.length})`, value: memberList.length > 0 ? memberList.slice(0, 15).join('\n') : 'No members found', inline: false },
				{ name: 'Stats & Defences', value: `• Tier: ${tierEmojis[guildInfo.tier - 1]}\n${getTierBenefits(guildInfo.tier)}`, inline: true },
				{ name: 'Wealth', value: `🏦 Vault: ${(isMember || isOwner) ? `**${guildInfo.balance.toLocaleString()}**` : '❓'}\n👥 Member Total: **${(totalWealth - guildInfo.balance).toLocaleString()}**\n💰 Combined: ${(isMember || isOwner) ? `**${totalWealth.toLocaleString()}**` : '❓'}`, inline: true },
			);

		if (isMember || isOwner) {
			embed.addFields({ name: '⚠️ Treasury Status', value: vulnerableStatus, inline: false });
		}
		const relationships = db.prepare(`
			SELECT * FROM guild_relationships 
			WHERE (guild_one_tag = ? OR guild_two_tag = ?)
			AND (status != 'truce' OR expires_at > datetime('now'))
		`).all(guildTag, guildTag);

		const attitude = guildInfo.attitude || 'Neutral';
		const allies = relationships.filter(r => r.status === 'alliance').map(r => `[${r.guild_one_tag === guildTag ? r.guild_two_tag : r.guild_one_tag}]`);
		const enemies = relationships.filter(r => r.status === 'enemy').map(r => `[${r.guild_one_tag === guildTag ? r.guild_two_tag : r.guild_one_tag}]`);
		const truces = relationships.filter(r => r.status === 'truce').map(r => `[${r.guild_one_tag === guildTag ? r.guild_two_tag : r.guild_one_tag}]`);

		let diplomacyValue = `**Attitude:** ${attitude}\n`;
		if (allies.length > 0) diplomacyValue += `**Allies:** ${allies.join(', ')}\n`;
		if (enemies.length > 0) diplomacyValue += `**Enemies:** ${enemies.join(', ')}\n`;
		if (truces.length > 0) diplomacyValue += `**Truces:** ${truces.join(', ')}\n`;

		embed.addFields({ name: 'Diplomatic Standing', value: diplomacyValue, inline: false });

		if (bounty) {
			const placerGuild = db.prepare('SELECT guild_name FROM guild_list WHERE guild_tag = ?').get(bounty.placer_guild_tag);
			const placerName = placerGuild?.guild_name || `Guild Tag [${bounty.placer_guild_tag}]`;
			embed.addFields({
				name: '🎯 ACTIVE BOUNTY 🎯',
				value: `This guild has a bounty of **👑 ${bounty.amount.toLocaleString()}** placed on it by **${placerName}**!`,
			});
		}

		embed.setFooter({ text: `Guild Tag: ${guildInfo.guild_tag} • Created on ${new Date(guildInfo.created_at).toLocaleDateString()}` }).setTimestamp();

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`guild_show_lore_${guildTag}`)
				.setLabel('📜 Show Lore')
				.setStyle(ButtonStyle.Secondary),
		);

		await interaction.reply({ embeds: [embed], components: [row] });
	}
	catch (error) {
		console.error('Error in handleFullInfo:', error);
		const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Error').setDescription('An error occurred while fetching guild info.');
		await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
}


async function buildMainMenuEmbed(guildTag) {
	const guild = db.prepare(`
		SELECT gl.guild_name, gl.guild_tag, gl.is_open, COALESCE(gt.tier, 1) as tier
		FROM guild_list gl
		LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag
		WHERE gl.guild_tag = ?
	`).get(guildTag);

	if (!guild) return null;

	const embed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle(`${tierEmojis[guild.tier - 1]} Main Menu: ${guild.guild_name} [${guild.guild_tag}]`)
		.setDescription('Select a button below to view detailed information about this guild.')
		.setThumbnail('https://i.ibb.co/2YqsK07D/guild.jpg')
		.setFooter({ text: 'This menu is only visible to you.' });

	const primaryButtons = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`guild_info_join_${guild.guild_tag}`)
			.setLabel(guild.is_open ? 'Join Guild' : 'Invite Only')
			.setStyle(ButtonStyle.Success)
			.setDisabled(!guild.is_open)
			.setEmoji('✅'),
		new ButtonBuilder()
			.setCustomId(`guild_info_lore_${guild.guild_tag}`)
			.setLabel('View Lore')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('📜'),
		new ButtonBuilder()
			.setCustomId(`guild_info_economy_${guild.guild_tag}`)
			.setLabel('View Economy')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('💰'),
		new ButtonBuilder()
			.setCustomId(`guild_info_warfare_${guild.guild_tag}`)
			.setLabel('View Warfare')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('⚔️'),
	);

	const secondaryButtons = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`guild_info_members_${guild.guild_tag}`)
			.setLabel('View Members')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('👥'),
		new ButtonBuilder()
			.setCustomId(`guild_info_customs_${guild.guild_tag}`)
			.setLabel('View Customizations')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('✨'),
		new ButtonBuilder()
			.setCustomId(`guild_info_exit_${guild.guild_tag}`)
			.setLabel('Exit')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('❌'),
	);

	return { embeds: [embed], components: [primaryButtons, secondaryButtons] };
}

async function buildDetailEmbed(guildTag, view, interaction, parts) {
	const guild = db.prepare('SELECT * FROM guild_list WHERE guild_tag = ?').get(guildTag);
	if (!guild) return null;

	const embed = new EmbedBuilder()
		.setColor(0x1ABC9C)
		.setFooter({ text: `Viewing: ${view} | This menu is only visible to you.` });

	const navigationRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`guild_info_join_${guild.guild_tag}`)
			.setLabel(guild.is_open ? 'Join Guild' : 'Invite Only')
			.setStyle(ButtonStyle.Success)
			.setDisabled(!guild.is_open)
			.setEmoji('✅'),
		new ButtonBuilder()
			.setCustomId(`guild_info_home_${guildTag}`)
			.setLabel('Go Home')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('↩️'),
		new ButtonBuilder()
			.setCustomId(`guild_info_exit_${guild.guild_tag}`)
			.setLabel('Exit')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('❌'),
	);

	const isMember = db.prepare('SELECT 1 FROM guildmember_tracking WHERE user_id = ? AND guild_tag = ?').get(interaction.user.id, guildTag);

	switch (view) {
	case 'lore':
		embed.setTitle(`📜 Lore of ${guild.guild_name}`)
			.setDescription(guild.lore || '*This guild has not written its epic tale yet.*\n\nUse `/guild settings lore` to set it (4000 character limit)!');
		break;

	case 'economy': {
		const economy = db.prepare('SELECT balance FROM guild_economy WHERE guild_tag = ?').get(guildTag);
		const members = db.prepare('SELECT COALESCE(SUM(ue.crowns), 0) as total_crowns FROM guildmember_tracking gmt LEFT JOIN user_economy ue ON gmt.user_id = ue.user_id WHERE gmt.guild_tag = ?').get(guildTag);
		const guildBalance = economy?.balance || 0;
		const memberBalance = members?.total_crowns || 0;
		embed.setTitle(`💰 Economy of ${guild.guild_name}`)
			.addFields(
				{ name: '🏦 Guild Vault', value: isMember ? `${guildBalance.toLocaleString()} Crowns` : '❓ Hidden', inline: true },
				{ name: '👥 Members\' Pockets', value: `${memberBalance.toLocaleString()} Crowns`, inline: true },
				{ name: '💰 Combined Wealth', value: isMember ? `${(guildBalance + memberBalance).toLocaleString()} Crowns` : '❓ Hidden', inline: true },
			);
		break;
	}
	case 'warfare': {
		const warfareInfo = db.prepare(`
            SELECT
                gl.attitude,
                COALESCE(gt.tier, 1) as tier,
                rl.successful_raids,
				rl.guilds_destroyed,
                rl.crowns_stolen,
                rc.shield_expiry,
                rc.last_raid_time
            FROM guild_list gl
            LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag
			LEFT JOIN raid_leaderboard rl ON rl.guild_tag = gl.guild_tag
            LEFT JOIN raid_cooldowns rc ON rc.guild_tag = gl.guild_tag
            WHERE gl.guild_tag = ?
        `).get(guildTag);
		const bounty = db.prepare('SELECT amount, placer_guild_tag FROM guild_bounties WHERE target_guild_tag = ? AND status = ?').get(guildTag, 'ACTIVE');
		// --- Diplomacy Info ---
		const relationships = db.prepare(`
			SELECT * FROM guild_relationships 
			WHERE (guild_one_tag = ? OR guild_two_tag = ?)
			AND (status != 'truce' OR expires_at > datetime('now'))
		`).all(guildTag, guildTag);
		const allies = relationships.filter(r => r.status === 'alliance').map(r => `[${r.guild_one_tag === guildTag ? r.guild_two_tag : r.guild_one_tag}]`);
		const enemies = relationships.filter(r => r.status === 'enemy').map(r => `[${r.guild_one_tag === guildTag ? r.guild_two_tag : r.guild_one_tag}]`);
		const truces = relationships.filter(r => r.status === 'truce').map(r => `[${r.guild_one_tag === guildTag ? r.guild_two_tag : r.guild_one_tag}]`);
		let diplomacyText = `**Attitude:** ${warfareInfo.attitude || 'Neutral'}`;
		if (allies.length > 0) diplomacyText += `\n**Allies:** ${allies.join(', ')}`;
		if (enemies.length > 0) diplomacyText += `\n**Enemies:** ${enemies.join(', ')}`;
		if (truces.length > 0) diplomacyText += `\n**Truces:** ${truces.join(', ')}`;

		const now = new Date();
		const creationDate = new Date(guild.created_at);
		const daysSinceCreation = (now - creationDate) / (1000 * 60 * 60 * 24);
		const shieldExpiry = warfareInfo.shield_expiry ? new Date(warfareInfo.shield_expiry) : null;

		const rawShieldStatus = shieldExpiry && shieldExpiry > now
			? `🛡️ Active (expires <t:${Math.floor(shieldExpiry.getTime() / 1000)}:R>)`
			: (daysSinceCreation < 7 ? `🆕 New Guild Protection (expires <t:${Math.floor((creationDate.getTime() + (7 * 24 * 60 * 60 * 1000)) / 1000)}:R>)` : '❌ No active shield');
		const finalShieldStatus = isMember ? rawShieldStatus : '🛡️ ❓ Hidden';

		let raidCooldownStatus = '❓ (Hidden)';
		if (isMember) {
			if (warfareInfo.last_raid_time) {
				const lastRaid = new Date(warfareInfo.last_raid_time);
				const nextRaidTime = new Date(lastRaid.getTime() + 24 * 60 * 60 * 1000);
				raidCooldownStatus = (now < nextRaidTime)
					? `🕰️ Can raid <t:${Math.floor(nextRaidTime.getTime() / 1000)}:R>`
					: '✅ Ready to raid';
			}
			else {
				raidCooldownStatus = '✅ Ready to raid';
			}
		}

		embed.setTitle(`⚔️ Warfare & Diplomacy of ${guild.guild_name}`)
			.addFields(
				{ name: 'Diplomatic Status', value: diplomacyText, inline: false },
				{ name: 'Shield Status', value: finalShieldStatus, inline: false },
				{ name: `Stats & Defences (Tier ${warfareInfo.tier})`, value: getTierBenefits(warfareInfo.tier), inline: false },
				{
					name: 'Raid Performance',
					value: [
						`⚔️ Successful Raids: **${warfareInfo.successful_raids || 0}**`,
						`☠️ Guilds Destroyed: **${warfareInfo.guilds_destroyed || 0}**`,
						`👑 Crowns Stolen: **${warfareInfo.crowns_stolen?.toLocaleString() || '0'}**`,
						`⌛ Raid Cooldown: **${raidCooldownStatus}**`,
					].join('\n'),
					inline: false,
				},
			);
		if (bounty) {
			const placerGuild = db.prepare('SELECT guild_name FROM guild_list WHERE guild_tag = ?').get(bounty.placer_guild_tag);
			const placerName = placerGuild?.guild_name ? 'Guild ' + placerGuild?.guild_name : `Guild Tag [${bounty.placer_guild_tag}]`;
			embed.addFields({
				name: '🎯 ACTIVE BOUNTY 🎯',
				value: `This guild has a bounty of **👑 ${bounty.amount.toLocaleString()}** placed on it by **${placerName}**!`,
			});
		}
		break;
	}
	case 'members': {
		const page = parseInt(parts[4]) || 1;

		const memberList = db.prepare(`
			SELECT gmt.user_id, gmt.owner, gmt.vice_gm, COALESCE(ue.crowns, 0) as crowns
			FROM guildmember_tracking gmt
			LEFT JOIN user_economy ue ON gmt.user_id = ue.user_id
			WHERE gmt.guild_tag = ?
			ORDER BY gmt.owner DESC, gmt.vice_gm DESC, ue.crowns DESC
		`).all(guildTag);

		// We need to fetch guild members asynchronously, so we do it before creating the strings.
		await interaction.guild.members.fetch({ user: memberList.map(m => m.user_id) }).catch((e) => {console.log(e);});

		const memberStrings = memberList.map(m => {
			const discordMember = interaction.guild.members.cache.get(m.user_id);
			if (!discordMember) {
				return '• *Unknown or Left Server*';
			}
			const defaultEmojiRecord = db.prepare(`
            SELECT emoji_name, emoji_id FROM guild_emojis 
            WHERE guild_tag = ? AND is_default = 1
        `).get(guildTag);

			let rolePrefix = defaultEmojiRecord
				? `<:${defaultEmojiRecord.emoji_name}:${defaultEmojiRecord.emoji_id}>`
				: '•';
			if (m.owner) rolePrefix = '👑 **GM:**';
			if (m.vice_gm) rolePrefix = '🛡️ **VGM:**';

			return `${rolePrefix} ${discordMember.toString()}/${discordMember.displayName} \`[🪙 ${m.crowns.toLocaleString()}]\``;
		});

		const perPage = 10;
		const totalPages = Math.ceil(memberStrings.length / perPage);
		const start = (page - 1) * perPage;
		const end = start + perPage;
		const pageContent = memberStrings.slice(start, end);

		embed.setTitle(`👥 Members of ${guild.guild_name} (${memberList.length})`)
			.setDescription(pageContent.join('\n') || 'This guild has no members.');

		if (totalPages > 1) {
			embed.setFooter({ text: `Page ${page}/${totalPages} | Viewing: ${view}` });

			const paginationButtons = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(`guild_info_members_${guildTag}_${page - 1}`)
					.setLabel('◀️ Previous')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page === 1),
				new ButtonBuilder()
					.setCustomId(`guild_info_members_${guildTag}_${page + 1}`)
					.setLabel('Next ▶️')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page === totalPages),
			);
			return { embeds: [embed], components: [navigationRow, paginationButtons] };
		}
		break;
	}
	case 'customs': {
		const emoji = db.prepare('SELECT emoji_name, emoji_id FROM guild_emojis WHERE guild_tag = ? AND is_default = 1').get(guildTag);
		const sticker = db.prepare('SELECT sticker_name, sticker_id FROM guild_stickers WHERE guild_tag = ?').get(guildTag);
		let stickerField = 'None set.';
		if (sticker) {
			const discordSticker = await interaction.guild.stickers.fetch(sticker.sticker_id).catch(() => null);
			stickerField = discordSticker ? `Name: \`${discordSticker.name}\`\n*Preview sticker to see it!*` : 'Could not fetch sticker.';
		}
		embed.setTitle(`✨ Customizations for ${guild.guild_name}`)
			.addFields(
				{ name: 'Default Emoji', value: emoji ? `<:${emoji.emoji_name}:${emoji.emoji_id}> \`:${emoji.emoji_name}:\`` : 'None set.', inline: true },
				{ name: 'Guild Sticker', value: stickerField, inline: true },
			);
		break;
	}
	}

	return { embeds: [embed], components: [navigationRow] };
}

async function handleGuildInfoButton(interaction) {
	const parts = interaction.customId.split('_');
	const action = parts[2];
	const guildTag = parts[3];

	try {
		if (action === 'main') {
			const payload = await buildMainMenuEmbed(guildTag);
			if (!payload) {
				return interaction.reply({ content: 'This guild no longer exists.', flags: MessageFlags.Ephemeral });
			}
			return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
		}

		await interaction.deferUpdate();

		switch (action) {
		case 'home': {
			const payload = await buildMainMenuEmbed(guildTag);
			if (!payload) return interaction.editReply({ content: 'This guild no longer exists.', embeds: [], components: [] });
			await interaction.editReply(payload);
			break;
		}

		// All cases that use the detail embed are grouped here for efficiency.
		case 'lore':
		case 'economy':
		case 'warfare':
		case 'members':
		case 'customs': {
			// The 'parts' variable is passed to the builder.
			// It will only be used by the 'members' case for pagination,
			// and safely ignored by all other cases.
			const payload = await buildDetailEmbed(guildTag, action, interaction, parts);
			if (!payload) return interaction.editReply({ content: 'This guild no longer exists.', embeds: [], components: [] });
			await interaction.editReply(payload);
			break;
		}

		case 'join': {
			const mockInteraction = {
				...interaction,
				options: { getString: () => guildTag },
				client: interaction.client,
				member: interaction.member,
				reply: (options) => interaction.followUp({ ...options, flags: MessageFlags.Ephemeral }),
			};
			await handleJoin(mockInteraction);
			break;
		}

		case 'exit':
			await interaction.deleteReply();
			break;
		}
	}
	catch (error) {
		console.error(`Error in handleGuildInfoButton (action: ${action}):`, error);
		if (!interaction.replied && !interaction.deferred) {
			await interaction.reply({ content: 'An error occurred while building this menu.', flags: MessageFlags.Ephemeral });
		}
		else {
			await interaction.followUp({ content: 'An error occurred while building this menu.', flags: MessageFlags.Ephemeral });
		}
	}
}
async function handleBequeath(interaction) {
	const userId = interaction.user.id;
	const newOwnerUser = interaction.options.getUser('new_owner');
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Ownership Transfer Failed');

	// Check if current user is guild owner
	const currentGuild = db.prepare(`
        SELECT gmt.*, gl.guild_name 
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        WHERE gmt.user_id = ? AND gmt.owner = 1
    `).get(userId);

	if (!currentGuild) {
		errorEmbed.setDescription('You must be the owner of a guild to transfer ownership!');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	// Check if new owner is in the same guild
	const newOwnerInGuild = db.prepare(`
        SELECT * FROM guildmember_tracking 
        WHERE user_id = ? AND guild_tag = ?
    `).get(newOwnerUser.id, currentGuild.guild_tag);

	if (!newOwnerInGuild) {
		errorEmbed.setDescription(`${newOwnerUser} is not a member of your guild!`);
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Transfer ownership
	try {
		db.transaction(() => {
			db.prepare(`
				UPDATE guildmember_tracking
				SET owner = 0
				WHERE user_id = ? AND guild_tag = ?
			`).run(userId, currentGuild.guild_tag);

			db.prepare(`
				UPDATE guildmember_tracking
				SET owner = 1
				WHERE user_id = ? AND guild_tag = ?
			`).run(newOwnerUser.id, currentGuild.guild_tag);
		})();

		const bequeathEmbed = new EmbedBuilder()
			.setColor(0x9B59B6)
			.setTitle('👑 Change of Leadership')
			.setDescription(`Ownership of **${currentGuild.guild_name} [${currentGuild.guild_tag}]** has been transferred from ${interaction.user} to ${newOwnerUser}. All hail the new Guildmaster!`)
			.setTimestamp();
		await sendGuildAnnouncement(interaction.client, bequeathEmbed);

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle('✅ Ownership Transferred')
			.setDescription(`You have successfully transferred ownership of **${currentGuild.guild_name} [${currentGuild.guild_tag}]** to ${newOwnerUser}.`);
		return interaction.reply({
			embeds: [successEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
	catch (error) {
		console.error('Transfer ownership error:', error);
		errorEmbed.setTitle('❌ Transaction Error').setDescription('An unexpected error occurred while transferring ownership. The operation has been rolled back.');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
}
async function handleSettings(interaction, settingType) {
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Setting Update Failed');
	const successEmbed = new EmbedBuilder().setColor(0x2ECC71).setTitle('✅ Setting Updated');

	// Verify user is guild owner
	const guildData = db.prepare(`
        SELECT gl.* 
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
    `).get(userId);

	if (!guildData) {
		errorEmbed.setDescription('You must be the owner or vice-guildmaster of a guild to change its settings!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
	if (settingType === 'raid_messages') {
		return handleRaidMessagesSettings(interaction, guildData);
	}
	try {
		switch (settingType) {
		case 'attitude': {
			const style = interaction.options.getString('style');
			const cooldown = db.prepare('SELECT changed_at FROM attitude_cooldowns WHERE guild_tag = ?').get(guildData.guild_tag);

			if (cooldown) {
				const lastChange = new Date(cooldown.changed_at);
				const nextChange = new Date(lastChange.getTime() + 7 * 24 * 60 * 60 * 1000);
				if (new Date() < nextChange) {
					errorEmbed.setTitle('Attitude Locked')
						.setDescription(`You can change your guild's attitude again <t:${Math.floor(nextChange.getTime() / 1000)}:R>.`);
					return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
				}
			}

			db.transaction(() => {
				db.prepare('UPDATE guild_list SET attitude = ? WHERE guild_tag = ?').run(style, guildData.guild_tag);
				db.prepare('INSERT INTO attitude_cooldowns (guild_tag, changed_at) VALUES (?, ?) ON CONFLICT(guild_tag) DO UPDATE SET changed_at = excluded.changed_at')
					.run(guildData.guild_tag, new Date().toISOString());
			})();

			successEmbed.setTitle('✅ Attitude Updated')
				.setDescription(`Your guild's public attitude is now set to **${style}**. You will not be able to change it again for 7 days.`);
			return interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
		}
		case 'name': {
			const newName = interaction.options.getString('new_name');
			// Validate new name
			if (!/^[a-zA-Z0-9 ]+$/.test(newName)) {
				errorEmbed.setDescription('Guild name can only contain letters, numbers, and spaces!');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}
			if (newName.length < 3 || newName.length > 35) {
				errorEmbed.setDescription('Guild name must be between 3 and 35 characters!');
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}

			// Validate against reserved terms
			const lowerName = newName.toLowerCase();
			const hasReservedTerm = RESERVED_TERMS.some(term =>
				lowerName.includes(term),
			);

			if (hasReservedTerm) {
				errorEmbed.setDescription(`That guild name contains restricted terms. Please choose another name.\nAvoid terms like: ${RESERVED_TERMS.join(', ')}`);
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}


			db.prepare('UPDATE guild_list SET guild_name = ? WHERE guild_tag = ?')
				.run(newName, guildData.guild_tag);

			// Update role name to match
			const role = await interaction.guild.roles.fetch(guildData.role_id);
			if (role) await role.setName(`Guild: ${newName}`);

			successEmbed.setDescription(`Guild name updated to **"${newName}"**`);
			return interaction.reply({
				embeds: [successEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}

		case 'tag': {
			const newTag = interaction.options.getString('new_tag').toUpperCase();
			const oldTag = guildData.guild_tag;

			// Validate new tag
			if (!/^[A-Z]{3}$/.test(newTag)) {
				errorEmbed.setDescription('Guild tag must be exactly 3 uppercase letters!');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}

			// Check if tag is available
			const existing = db.prepare('SELECT 1 FROM guild_list WHERE guild_tag = ? AND guild_tag != ?')
				.get(newTag, oldTag);
			if (existing) {
				errorEmbed.setDescription('That tag is already taken by another guild!');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}

			try {
				// IMPORTANT: disable foreign keys BEFORE transaction
				db.pragma('foreign_keys = OFF');

				const updateTagTransaction = db.transaction(() => {
					console.log('[DEBUGGING INFORMATION FOR GUILD] Performing guild_tag update in transaction');

					const allTables = [
						'guildmember_tracking', 'guild_economy', 'guild_tiers',
						'raid_cooldowns', 'raid_leaderboard', 'guild_raid_messages',
						'guild_fundraisers', 'guild_emojis',
					];

					for (const table of allTables) {
						db.prepare(`UPDATE ${table} SET guild_tag = ? WHERE guild_tag = ?`)
							.run(newTag, oldTag);
						console.log(`[DEBUGGING] Updated ${table}`);
					}

					// Handle attacker/defender references in raid_history
					db.prepare('UPDATE raid_history SET attacker_tag = ? WHERE attacker_tag = ?').run(newTag, oldTag);
					db.prepare('UPDATE raid_history SET defender_tag = ? WHERE defender_tag = ?').run(newTag, oldTag);
					console.log('[DEBUGGING] Updated raid_history references');

					// Update the main guild_list last
					db.prepare('UPDATE guild_list SET guild_tag = ? WHERE guild_tag = ?')
						.run(newTag, oldTag);
					console.log('[DEBUGGING] Updated guild_list');
				});

				// Execute transaction
				updateTagTransaction();

				// Re-enable foreign key enforcement
				db.pragma('foreign_keys = ON');

				console.log('[DEBUGGING] Tag update complete');
				successEmbed.setDescription(`Guild tag successfully updated from **[${oldTag}]** to **[${newTag}]**.`);
				return interaction.reply({
					embeds: [successEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}
			catch (error) {
				console.error('Tag update error:', error);
				// Ensure this is always re-enabled
				db.pragma('foreign_keys = ON');
				errorEmbed.setTitle('❌ Critical Error: Tag Update Failed').setDescription('A major error occurred while updating the guild tag. The database has been reverted. Please contact support.');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}
		}


		case 'visibility': {
			const status = interaction.options.getString('status');
			const isOpen = status === 'open' ? 1 : 0;

			db.prepare('UPDATE guild_list SET is_open = ? WHERE guild_tag = ?')
				.run(isOpen, guildData.guild_tag);
			successEmbed.setDescription(`Your guild is now **${status.toUpperCase()}** to new members.`);
			return interaction.reply({
				embeds: [successEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}

		case 'channel': {
			const rawName = interaction.options.getString('new_name');
			const newName = 'guild-' + rawName
				.replace(/[^a-zA-Z0-9 -]/g, '')
				.trim()
				.replace(/\s+/g, '-')
				.toLowerCase();

			// Fetch and rename the PUBLIC channel
			const channel = await interaction.guild.channels.fetch(guildData.public_channel_id);
			if (channel) await channel.setName(newName);

			successEmbed.setDescription(`Your guild's public channel has been renamed to ${channel}.`);
			return interaction.reply({
				embeds: [successEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
		case 'motto': {
			const text = interaction.options.getString('text').slice(0, 100);
			db.prepare('UPDATE guild_list SET motto = ? WHERE guild_tag = ?')
				.run(text, guildData.guild_tag);
			successEmbed.setTitle('✅ Motto Updated').setDescription(`Your new guild motto is now: *"${text}"*`);
			return interaction.reply({
				embeds: [successEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
		case 'hook': {
			const text = interaction.options.getString('text');
			if (text.length > 150) {
				errorEmbed.setDescription('Hook text cannot exceed 150 characters!');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}
			db.prepare('UPDATE guild_list SET hook = ? WHERE guild_tag = ?')
				.run(text, guildData.guild_tag);
			successEmbed.setTitle('✅ Hook Updated').setDescription(`Your guild's hook is now set:\n*_"${text}"_*`);
			return interaction.reply({
				embeds: [successEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
		case 'lore': {
			const text = interaction.options.getString('text');
			if (text.length > 4000) {
				errorEmbed.setDescription('Lore text cannot exceed 4000 characters!');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}
			db.prepare('UPDATE guild_list SET lore = ? WHERE guild_tag = ?')
				.run(text, guildData.guild_tag);
			successEmbed.setTitle('✅ Lore Updated').setDescription('Your guild\'s lore has been successfully updated.');
			return interaction.reply({
				embeds: [successEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
		case 'role': {
			const newName = 'Guild: ' + interaction.options.getString('new_name');
			const role = await interaction.guild.roles.fetch(guildData.role_id);
			if (role) await role.setName(newName);

			successEmbed.setDescription(`Your guild role has been renamed to ${role}.`);
			return interaction.reply({
				embeds: [successEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
		case 'promote': {
			const targetUser = interaction.options.getUser('user');

			const targetMember = db.prepare('SELECT * FROM guildmember_tracking WHERE user_id = ? AND guild_tag = ?').get(targetUser.id, guildData.guild_tag);
			if (!targetMember) {
				errorEmbed.setDescription(`${targetUser.username} is not in your guild.`);
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}
			if (targetMember.owner === 1 || targetMember.vice_gm === 1) {
				errorEmbed.setDescription(`${targetUser.username} already holds a leadership position.`);
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}
			// Optional: Check if there is already a vice gm
			const existingViceGm = db.prepare('SELECT 1 FROM guildmember_tracking WHERE guild_tag = ? AND vice_gm = 1').get(guildData.guild_tag);
			if (existingViceGm) {
				errorEmbed.setDescription('Your guild already has a Vice Guildmaster. Demote them first before promoting another.');
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}

			db.prepare('UPDATE guildmember_tracking SET vice_gm = 1 WHERE user_id = ? AND guild_tag = ?').run(targetUser.id, guildData.guild_tag);
			successEmbed.setTitle('👑 Promotion!').setDescription(`${targetUser.username} has been promoted to **Vice Guildmaster**!`);
			return interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
		}
		case 'demote': {
			const targetUser = interaction.options.getUser('user');

			const targetMember = db.prepare('SELECT * FROM guildmember_tracking WHERE user_id = ? AND guild_tag = ?').get(targetUser.id, guildData.guild_tag);
			if (!targetMember) {
				errorEmbed.setDescription(`${targetUser.username} is not in your guild.`);
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}
			if (targetMember.vice_gm !== 1) {
				errorEmbed.setDescription(`${targetUser.username} is not a Vice Guildmaster.`);
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}

			db.prepare('UPDATE guildmember_tracking SET vice_gm = 0 WHERE user_id = ? AND guild_tag = ?').run(targetUser.id, guildData.guild_tag);
			successEmbed.setDescription(`✅ ${targetUser.username} has been demoted to a regular member.`);
			return interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
		}
		case 'member_title': {
			const newTitle = interaction.options.getString('title');
			db.prepare('UPDATE guild_list SET guildmember_title = ? WHERE guild_tag = ?')
				.run(newTitle, guildData.guild_tag);
			successEmbed.setDescription(`Your guild members will now be known as **${newTitle}**!`);
			return interaction.reply({
				embeds: [successEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}

		case 'emoji': {
			if (!interaction.guild.members.me.permissions.has('ManageEmojisAndStickers')) {
				errorEmbed.setDescription('❌ I need the "Manage Emojis and Stickers" permission to do this!');
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}

			const existingDefault = db.prepare('SELECT * FROM guild_emojis WHERE guild_tag = ? AND is_default = 1').get(guildData.guild_tag);
			await processEmojiUpdate(interaction, guildData, existingDefault);
			break;
		}
		case 'sticker': {
			if (!interaction.guild.members.me.permissions.has('ManageEmojisAndStickers')) {
				errorEmbed.setDescription('❌ I need the "Manage Emojis and Stickers" permission to do this!');
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}

			const existingSticker = db.prepare('SELECT * FROM guild_stickers WHERE guild_tag = ?').get(guildData.guild_tag);
			await processStickerUpdate(interaction, guildData, existingSticker);
			break;
		}
		}
	}
	catch (error) {
		console.error('Guild settings error:', error);
		const finalErrorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle('❌ Error Updating Settings')
			.setDescription('An unexpected error occurred. Please try again later.');
		return interaction.reply({
			embeds: [finalErrorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
}

async function processStickerUpdate(interaction, guildData, existingSticker = null) {
	if (existingSticker) {
		// Fetch the sticker from Discord to show it
		const sticker = await interaction.guild.stickers.fetch(existingSticker.sticker_id).catch(() => null);
		const stickerName = sticker ? sticker.name : 'an old sticker';

		const confirmEmbed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setTitle('⚠️ Replace Guild Sticker?')
			.setDescription(`Your guild's sticker is currently **${stickerName}**.\n\nReplacing it will **permanently delete** the old sticker from the server. Are you sure?`)
			.setFooter({ text: 'This action cannot be undone.' });

		if (sticker) confirmEmbed.setThumbnail(sticker.url);

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId('confirm_replace_sticker').setLabel('Yes, Replace It').setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId('cancel_replace').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
		);

		await interaction.reply({ embeds: [confirmEmbed], components: [row], flags: MessageFlags.Ephemeral });

		const filter = i => i.user.id === interaction.user.id;
		const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

		collector.on('collect', async i => {
			if (i.customId === 'confirm_replace_sticker') {
				await i.deferUpdate();
				await collectAndCreateSticker(interaction, guildData, existingSticker);
			}
			else {
				const cancelEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription('Sticker replacement cancelled.');
				await i.update({ embeds: [cancelEmbed], components: [], thumbnail: null });
			}
		});
		return;
	}

	// If no sticker exists, proceed directly
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	await collectAndCreateSticker(interaction, guildData, null);;
}
async function collectAndCreateSticker(interaction, guildData, existingSticker) {
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C);
	const successEmbed = new EmbedBuilder().setColor(0x2ECC71);
	const promptEmbed = new EmbedBuilder().setColor(0x3498DB);
	const userId = interaction.user.id;
	const channel = interaction.channel;

	const editOriginalReply = async (options) => {
		try {
			await interaction.editReply(options);
		}
		catch {
			await interaction.followUp(options);
		}
	};

	try {
		promptEmbed
			.setTitle('Step 1: Sticker Name')
			.setDescription('Please send a name for your sticker in the chat.\n\nIt must be between 2 and 30 characters.')
			.setFooter({ text: 'You have 2 minutes to reply. Type "cancel" to exit.' });

		await editOriginalReply({ embeds: [promptEmbed], components: [] });

		const nameFilter = m => m.author.id === userId;
		const nameCollector = await channel.awaitMessages({ filter: nameFilter, max: 1, time: 120000, errors: ['time'] });
		const nameMessage = nameCollector.first();
		const stickerName = nameMessage.content.trim();
		await nameMessage.delete().catch(console.error);

		if (stickerName.toLowerCase() === 'cancel') {
			promptEmbed.setDescription('Sticker creation cancelled.');
			return editOriginalReply({ embeds: [promptEmbed] });
		}
		if (stickerName.length < 2 || stickerName.length > 30) {
			errorEmbed.setTitle('❌ Invalid Name').setDescription('The name must be between 2 and 30 characters. Please start over.');
			return editOriginalReply({ embeds: [errorEmbed] });
		}

		promptEmbed
			.setTitle('Step 2: Related Emoji')
			.setDescription('Great! Now, please send a **single, standard Unicode emoji** that relates to your sticker (e.g., 😄, ⚔️, 🛡️).\n\nThis helps users find your sticker.')
			.setFooter({ text: 'You have 2 minutes to reply. Type "cancel" to exit.' });

		await editOriginalReply({ embeds: [promptEmbed] });

		const emojiFilter = m => m.author.id === userId;
		const emojiCollector = await channel.awaitMessages({ filter: emojiFilter, max: 1, time: 120000, errors: ['time'] });
		const emojiMessage = emojiCollector.first();
		const emojiContent = emojiMessage.content.trim();
		await emojiMessage.delete().catch(console.error);

		if (emojiContent.toLowerCase() === 'cancel') {
			promptEmbed.setDescription('Sticker creation cancelled.');
			return editOriginalReply({ embeds: [promptEmbed] });
		}

		const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu;
		const emojiMatch = emojiContent.match(emojiRegex);
		if (!emojiMatch || emojiMatch.length > 1) {
			errorEmbed.setTitle('❌ Invalid Emoji').setDescription('You must provide a single, standard emoji. Custom server emojis are not allowed. Please start over.');
			return editOriginalReply({ embeds: [errorEmbed] });
		}
		const relatedEmoji = emojiMatch[0];


		promptEmbed
			.setTitle('Step 3: Upload Image')
			.setDescription('Perfect. Finally, please upload the image file for the sticker.')
			.setFields({
				name: '⚠️ Image Requirements',
				value: '• **File Type:** PNG or APNG\n' +
                       '• **Dimensions:** Exactly 320x320 pixels\n' +
                       '• **File Size:** Under 512 KB',
			})
			.setFooter({ text: 'You have 3 minutes to reply. Type "cancel" to exit.' });

		await editOriginalReply({ embeds: [promptEmbed] });

		const fileFilter = m => m.author.id === userId && (m.attachments.size > 0 || m.content.toLowerCase() === 'cancel');
		const fileCollector = await channel.awaitMessages({ filter: fileFilter, max: 1, time: 180000, errors: ['time'] });
		const fileMessage = fileCollector.first();
		if (fileMessage.content.toLowerCase() === 'cancel') {
			await fileMessage.delete().catch(console.error);
			promptEmbed.setDescription('Sticker creation cancelled.');
			return editOriginalReply({ embeds: [promptEmbed.setFields([])] });
		}
		const attachment = fileMessage.attachments.first();


		promptEmbed.setTitle('Processing...').setDescription('Creating your sticker. This may take a moment.').setFields([]);
		await editOriginalReply({ embeds: [promptEmbed] });


		// Delete old sticker from Discord *before* creating the new one to free up the slot
		if (existingSticker) {
			const oldSticker = await interaction.guild.stickers.fetch(existingSticker.sticker_id).catch(() => null);
			if (oldSticker) await oldSticker.delete('Replacing with new guild sticker.');
		}
		console.log('url: ' + attachment.url + '\nName:' + stickerName + '\nEmoji:' + relatedEmoji);
		const newSticker = await interaction.guild.stickers.create({
			file: attachment.url,
			name: stickerName,
			tags: relatedEmoji,
			reason: `Custom sticker for guild ${guildData.guild_name} [${guildData.guild_tag}]`,
		});

		// Update the database
		db.transaction(() => {
			if (existingSticker) {
				db.prepare('DELETE FROM guild_stickers WHERE guild_tag = ?').run(guildData.guild_tag);
			}
			db.prepare('INSERT INTO guild_stickers (guild_tag, sticker_id, sticker_name) VALUES (?, ?, ?)')
				.run(guildData.guild_tag, newSticker.id, newSticker.name);
		})();

		successEmbed
			.setTitle('✅ Success!')
			.setDescription(`Your new guild sticker, **${newSticker.name}**, has been created!`)
			.setThumbnail(newSticker.url);
		await editOriginalReply({ embeds: [successEmbed] });
		await fileMessage.delete().catch(console.error);
	}
	catch (error) {
		// This will catch timeouts from any of the collectors
		console.error('Sticker creation error:', error);
		errorEmbed
			.setTitle('❌ Sticker Creation Failed')
			.setDescription(
				'The process timed out or an unexpected error occurred. Please ensure you meet all requirements and try again.\n\n' +
                '• **Name:** 2-30 characters.\n' +
                '• **Emoji:** A single standard emoji (no custom ones).\n' +
                '• **Image:** 320x320px, <512KB, PNG/APNG format.\n' +
                '• **Server Capacity:** The server may be full of stickers.',
			);
		await editOriginalReply({ embeds: [errorEmbed], components: [] });
	}
}
async function processEmojiUpdate(interaction, guildData, existingDefault = null) {
	if (existingDefault) {
		const existingEmojiString = `<:${existingDefault.emoji_name}:${existingDefault.emoji_id}>`;
		const confirmEmbed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setTitle('⚠️ Replace Default Emoji?')
			.setDescription(`Your guild's default emoji is currently ${existingEmojiString}.\n\nReplacing it will **permanently delete** the old emoji from the server. Are you sure?`);

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId('confirm_replace_emoji').setLabel('Yes, Replace It').setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId('cancel_replace').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
		);

		await interaction.reply({ embeds: [confirmEmbed], components: [row], flags: MessageFlags.Ephemeral });

		const filter = i => i.user.id === interaction.user.id;
		const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

		collector.on('collect', async i => {
			if (i.customId === 'confirm_replace_emoji') {
				// We defer the update to let Discord know we're working,
				// then send a new follow-up message. This avoids the "Unknown Message" error.
				await i.deferUpdate();
				const followUpEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription('Please reply to this message within 2 minutes with the new emoji name and image file.');
				const followUpMessage = await interaction.followUp({ embeds: [followUpEmbed], fetchReply: true, flags: MessageFlags.Ephemeral });
				await collectAndCreateEmoji(interaction, followUpMessage, guildData, existingDefault);
			}
			else {
				const cancelEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription('Replacement cancelled.');
				await i.update({ embeds: [cancelEmbed], components: [] });
			}
		});
		return;
	}

	// If no emoji exists, proceed directly with the initial reply.
	const initialEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription('Please reply to this message within 2 minutes with the emoji name and the image file you want to use.');
	const initialMessage = await interaction.reply({ embeds: [initialEmbed], fetchReply: true, flags: MessageFlags.Ephemeral });
	await collectAndCreateEmoji(interaction, initialMessage, guildData, null);
}


async function collectAndCreateEmoji(interaction, messageToEdit, guildData, existingDefault) {
	const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
	const collector = interaction.channel.createMessageCollector({ filter, time: 120000, max: 1 });

	collector.on('collect', async m => {
		try {
			const attachment = m.attachments.first();
			let emojiName = m.content.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
			if (!emojiName || emojiName.length < 2) emojiName = 'guild_emoji';

			const finalEmojiName = `${guildData.guild_tag}_${emojiName}`.slice(0, 32);

			const processingEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription('Processing your emoji...');
			await interaction.followUp({
				embeds: [processingEmbed],
				flags: MessageFlags.Ephemeral,
			});

			let newEmoji;
			try {
				newEmoji = await interaction.guild.emojis.create({
					attachment: attachment.url,
					name: finalEmojiName,
					reason: `Default emoji for guild ${guildData.guild_name}`,
				});

				db.transaction(() => {
					if (existingDefault) {
						db.prepare('DELETE FROM guild_emojis WHERE id = ?').run(existingDefault.id);
					}
					db.prepare('INSERT INTO guild_emojis (guild_tag, emoji_name, emoji_id, is_default) VALUES (?, ?, ?, 1)')
						.run(guildData.guild_tag, newEmoji.name, newEmoji.id);
				})();

				if (existingDefault) {
					const oldEmoji = await interaction.guild.emojis.fetch(existingDefault.emoji_id).catch(() => null);
					if (oldEmoji) await oldEmoji.delete('Replaced by new default guild emoji.');
				}

				const successEmbed = new EmbedBuilder().setColor(0x2ECC71).setDescription(`✅ Success! Your new default guild emoji is ${newEmoji}.`);
				await interaction.followUp({
					embeds: [successEmbed],
					flags: MessageFlags.Ephemeral,
				});
				await m.delete().catch(console.error);
			}
			catch (error) {
				console.error('Emoji creation/DB transaction error:', error);
				const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ An error occurred. This could be because the server is full of emojis, the image was too large, or the name was invalid. Please try again.');
				await interaction.followUp({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}
		}
		catch (error) {
			console.error('Error processing emoji:', error);
			const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setDescription('❌ An error occurred while processing your emoji.');
			await interaction.followUp({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
	});

	collector.on('end', (collected, reason) => {
		if (reason === 'time') {
			const timeoutEmbed = new EmbedBuilder().setColor(0xFEE75C).setDescription('You did not reply in time. The process has been cancelled.');
			interaction.followUp({
				embeds: [timeoutEmbed],
				flags: MessageFlags.Ephemeral,
			}).catch((error) => { console.log('Couldn\'t delete message: ' + error); });
		}
	});
}

async function handleList(interaction) {
	try {
		const guilds = db.prepare(`
            SELECT 
                gl.guild_name, 
                gl.guild_tag, 
                gl.is_open, 
                gl.motto,
				gl.attitude,
                COALESCE(gt.tier, 1) AS tier,
                (SELECT COUNT(*) FROM guildmember_tracking WHERE guild_tag = gl.guild_tag) as member_count,
                (SELECT user_id FROM guildmember_tracking WHERE guild_tag = gl.guild_tag AND owner = 1 LIMIT 1) as owner_id
            FROM guild_list gl
            LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag
            ORDER BY gl.guild_name
        `).all();

		// Helper to get the correct crest based on the 1-15 tier system
		const getCrestForTier = (tier) => {
			if (tier >= 13) return ONLY_CRESTS[4];
			if (tier >= 10) return ONLY_CRESTS[3];
			if (tier >= 7) return ONLY_CRESTS[2];
			if (tier >= 4) return ONLY_CRESTS[1];
			return ONLY_CRESTS[0];
		};
		const bounties = db.prepare(`
			SELECT target_guild_tag, amount FROM guild_bounties WHERE status = 'ACTIVE'
		`).all();
		const bountyMap = new Map(bounties.map(b => [b.target_guild_tag, b.amount]));
		const embed = new EmbedBuilder()
			.setColor(0x5865F2)
			.setTitle('🏰 Guild Directory')
			.setDescription('Here are all registered guilds. Use `/guild info [tag]` for details.');

		if (guilds.length === 0) {
			embed.setDescription('There are no guilds to display yet!');
		}
		else {
			const fields = await Promise.all(guilds.map(async (guild) => {
				const owner = guild.owner_id ? `<@${guild.owner_id}>` : '*(Unknown)*';
				const crest = getCrestForTier(guild.tier);
				const statusIcon = guild.is_open ? '🔓' : '🔒';
				const attitude = guild.attitude || 'Neutral';
				const bountyAmount = bountyMap.get(guild.guild_tag);
				const bountyText = bountyAmount ? `\n**Bounty:** 👑 ${bountyAmount.toLocaleString()}` : '';
				return {
					name: `${crest} ${statusIcon} ${guild.guild_name}`,
					value: [
						`**Tag:** \`${guild.guild_tag}\` | **Attitude:** \`${attitude}\``,
						guild.motto && `📜 *"${guild.motto}"*`,
						`**Owner:** ${owner}`,
						`**Members:** ${guild.member_count}`,
						`**Status:** ${guild.is_open ? '🟢 Open to join' : '🔴 Invite only'}`,
						bountyText,
					].filter(Boolean).join('\n'),
					inline: true,
				};
			}));
			embed.setFields(fields);
		}


		embed.setTimestamp()
			.setFooter({ text: `Total Guilds: ${guilds.length}` });

		await interaction.reply({ embeds: [embed] });
	}
	catch (error) {
		console.error('Guild list error:', error);
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle('❌ Error')
			.setDescription('Failed to load the guild list.');
		await interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
}

async function handleFundraise(interaction) {
	const amount = interaction.options.getInteger('amount');
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Fundraiser Failed');


	const guildData = db.prepare(`
        SELECT gmt.guild_tag, gl.guild_name, gl.role_id, gmt.owner, gmt.vice_gm
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        WHERE gmt.user_id = ?
    `).get(userId);

	if (!guildData) {
		errorEmbed.setDescription('You must be in a guild to start a fundraiser!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	if (!guildData.owner && !guildData.vice_gm) {
		errorEmbed.setDescription('You must be the guildmaster or vice-guildmaster to start a fundraiser!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Create fundraiser embed
	const embed = new EmbedBuilder()
		.setTitle(`🏦 ${guildData.guild_name} Fundraiser`)
		.setDescription(`Goal: ${amount.toLocaleString()} Crowns\n\n` +
                       `Progress: 0% (0/${amount.toLocaleString()} Crowns)\n` +
                       getProgressBar(0, amount))
		.addFields(
			{ name: 'Started by', value: interaction.user.toString(), inline: true },
			{ name: 'Members', value: getGuildMemberCount(guildData.guild_tag).toString(), inline: true },
		)
		.setColor(0x3498db)
		.setFooter({ text: 'Contribute using the buttons below' });

	// Send the message
	const message = await interaction.reply({
		embeds: [embed],
		components: [],
		fetchReply: true,
	});

	// Create buttons
	const memberCount = getGuildMemberCount(guildData.guild_tag);
	const shareAmount = Math.ceil(amount / memberCount);


	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`fundraise_paywhatyoucan_${message.id}`)
			.setLabel('Pay What You Can')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`fundraise_share_${message.id}_${shareAmount}`)
			.setLabel(`Pay Your Share (${shareAmount})`)
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(`fundraise_max_${message.id}_${amount}`)
			.setLabel('Pay Full Amount')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(`fundraise_custom_${message.id}`)
			.setLabel('Custom Amount')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`fundraise_cancel_${message.id}`)
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Danger),
	);

	await message.edit({
		components: [row],
	});

	// Store fundraiser in database
	db.prepare(`
        INSERT INTO guild_fundraisers (message_id, guild_tag, creator_id, target_amount)
        VALUES (?, ?, ?, ?)
    `).run(message.id, guildData.guild_tag, userId, amount);
}

function getProgressBar(current, target) {
	const percent = Math.min(100, Math.floor((current / target) * 100));
	const filledSquares = Math.floor(percent / 5);
	const emptySquares = 20 - filledSquares;

	return `[${'🟦'.repeat(filledSquares)}${'⬜'.repeat(emptySquares)}] ${percent}%`;
}

function getGuildMemberCount(guildTag) {
	return db.prepare('SELECT COUNT(*) as count FROM guildmember_tracking WHERE guild_tag = ?')
		.get(guildTag).count;
}
async function handleJoin(interaction) {
	const guildTag = interaction.options.getString('guild_tag').toUpperCase();
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Join Failed');

	// Check if user is already in a guild
	const currentGuild = db.prepare('SELECT 1 FROM guildmember_tracking WHERE user_id = ?').get(userId);
	if (currentGuild) {
		errorEmbed.setDescription('You\'re already in a guild! Leave it first before joining another.');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Get guild info
	const guildData = db.prepare('SELECT * FROM guild_list WHERE guild_tag = ?').get(guildTag);
	if (!guildData) {
		errorEmbed.setDescription('No guild found with that tag!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Check if guild is open
	if (!guildData.is_open) {
		errorEmbed.setDescription('This guild is invite only! Ask the owner for an invitation.');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	try {
		// Add role to user
		const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);

		// Add role to user
		const role = await interaction.guild.roles.fetch(guildData.role_id);
		if (role && member) {
			await member.roles.add(role);
		}
		else if (!member) {
			// Handle case where member couldn't be fetched
			errorEmbed.setDescription('An error occurred trying to find your profile on this server.');
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}

		// Add to database
		db.prepare(`
            INSERT INTO guildmember_tracking (user_id, guild_tag, owner)
            VALUES (?, ?, 0)
        `).run(userId, guildTag);

		// Announce the new member in the guild's channel
		await announceNewMember(interaction.client, interaction.user, guildData);

		// Send a confirmation embed to the user, pointing to the PRIVATE channel
		const joinEmbed = new EmbedBuilder()
			.setColor(0x57F287)
			.setTitle(`🎉 Welcome to ${guildData.guild_name} [${guildTag}]!`)
			.setDescription('You have successfully joined the guild. Your new home awaits in the private guildhall!')
			.addFields({
				name: 'Your Private Guildhall',
				value: `Head over to <#${guildData.channel_id}> to meet your new guildmates in private!`,
			});

		return interaction.reply({
			embeds: [joinEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
	catch (error) {
		console.error('Guild join error:', error);
		errorEmbed.setTitle('❌ Join Error').setDescription('An unexpected error occurred while joining the guild.');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
}

// Autocomplete handler
async function handleJoinAutocomplete(interaction) {
	const focusedValue = interaction.options.getFocused();
	const guilds = db.prepare(`
        SELECT guild_tag, guild_name 
        FROM guild_list 
        WHERE is_open = 1
        AND (guild_tag LIKE ? OR guild_name LIKE ?)
        LIMIT ${NUMBER_OF_GUILDS_LIMIT}
    `).all(`%${focusedValue}%`, `%${focusedValue}%`);

	await interaction.respond(
		guilds.map(guild => ({
			name: `${guild.guild_name} [${guild.guild_tag}]`,
			value: guild.guild_tag,
		})),
	);
}
async function handleUpgrade(interaction) {
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Upgrade Failed');

	// Check if user is guild owner or vice gm
	const guildData = db.prepare(`
		SELECT 
			gl.guild_tag, 
			gl.guild_name, 
			COALESCE(gt.tier, 1) as tier, 
			COALESCE(ge.balance, 0) as balance
		FROM guildmember_tracking gmt
		JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
		LEFT JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag
		LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
		WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
	`).get(userId);


	if (!guildData) {
		errorEmbed.setDescription('You must be the owner or vice-guildmaster of a guild to upgrade it!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	const currentTier = guildData.tier;
	// Check max tier
	if (currentTier >= 15) {
		errorEmbed.setTitle('✅ Max Tier Reached').setDescription('Your guild is already at the maximum tier!').setColor(0x2ECC71);
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
	// Get upgrade cost for the *next* tier
	const cost = TIER_DATA[currentTier].cost;
	const name = TIER_DATA[currentTier].name;
	// Check balance
	if (guildData.balance < cost) {
		errorEmbed.setDescription(`Your guild needs **${cost.toLocaleString()}** crowns in the vault to upgrade to **${name}**! Your current balance is **${guildData.balance.toLocaleString()}**.`);
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	const nextTier = currentTier + 1;
	const nextTierInfo = TIER_DATA[nextTier - 1];

	// Confirm upgrade
	const confirmEmbed = new EmbedBuilder()
		.setTitle(`🏰 Guild Upgrade to ${nextTierInfo.name}`)
		.setDescription(`Upgrading **${guildData.guild_name}** will increase your defences and boost your income!`)
		.addFields(
			{ name: 'Current Tier', value: `${tierEmojis[currentTier - 1]}`, inline: true },
			{ name: '__NEW Tier__', value: `${tierEmojis[nextTier - 1]}`, inline: true },
			{ name: 'Upgrade Cost', value: `👑 ${cost.toLocaleString()} Crowns`, inline: true },
			{ name: 'Current Benefits 📊', value: getTierBenefits(currentTier), inline: true },
			{ name: '__NEW Benefits__ 📈', value: getTierBenefits(nextTier), inline: true },
		)
		.setColor(0x3498DB);

	const confirmRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`upgrade_confirm_${guildData.guild_tag}`)
			.setLabel('Confirm Upgrade')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('upgrade_cancel')
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary),
	);

	await interaction.reply({
		embeds: [confirmEmbed],
		components: [confirmRow],
		flags: MessageFlags.Ephemeral,
	});
}
async function handleRaidAutocomplete(interaction) {
	try {
		const focusedValue = interaction.options.getFocused();
		const userId = interaction.user.id;

		// Get the user's guild tag (if any)
		const userGuild = db.prepare('SELECT guild_tag FROM guildmember_tracking WHERE user_id = ?').get(userId);

		// Find potential raid targets
		const guilds = db.prepare(`
            SELECT gl.guild_tag, gl.guild_name 
            FROM guild_list gl
            LEFT JOIN raid_cooldowns rc ON gl.guild_tag = rc.guild_tag
            WHERE (gl.guild_tag LIKE ? OR gl.guild_name LIKE ?)
            ${userGuild ? 'AND gl.guild_tag != ?' : ''}
            ORDER BY gl.guild_name
            LIMIT ${NUMBER_OF_GUILDS_LIMIT}
        `).all(
			`%${focusedValue}%`,
			`%${focusedValue}%`,
			...(userGuild ? [userGuild.guild_tag] : []),
		);

		await interaction.respond(
			guilds.map(guild => ({
				name: `${guild.guild_name} [${guild.guild_tag}]`,
				value: guild.guild_tag,
			})),
		);
	}
	catch (error) {
		console.error('Raid autocomplete error:', error);
		await interaction.respond([]);
	}
}


/**
* Autocomplete handler for /guild, pulling up all guild_tag options.
* Returns up to configured limit (NUMBER_OF_GUILDS_LIMIT) of guilds matching tag or name.
* @param {import('discord.js').AutocompleteInteraction} interaction
* @returns {Promise<void>}
*/
async function fetchAllGuildsByTagAutocomplete(interaction) {
	try {
		const focusedValue = interaction.options.getFocused();

		const guilds = db.prepare(`
			SELECT guild_tag, guild_name
			FROM guild_list
			WHERE guild_tag LIKE ? OR guild_name LIKE ?
			LIMIT ${NUMBER_OF_GUILDS_LIMIT}
		    `).all(`%${focusedValue}%`, `%${focusedValue}%`);
		await interaction.respond(
			guilds.map(guild => ({
				name: `${guild.guild_name} [${guild.guild_tag}]`,
				value: guild.guild_tag,
			})),
		);
	}
	catch (e) {
		console.error('Fund autocomplete error:', e);
		await interaction.respond([]);
	}
}
async function handleInfoAutocomplete(interaction) {
	const focusedValue = interaction.options.getFocused();
	const guilds = db.prepare(`
        SELECT guild_tag, guild_name 
        FROM guild_list 
        WHERE guild_tag LIKE ? OR guild_name LIKE ?
        LIMIT ${NUMBER_OF_GUILDS_LIMIT}
    `).all(`%${focusedValue}%`, `%${focusedValue}%`);

	await interaction.respond(
		guilds.map(guild => ({
			name: `${guild.guild_name} [${guild.guild_tag}]`,
			value: guild.guild_tag,
		})),
	);
}

/**
 * Notifies relevant guilds (allies/enemies) about a new raid.
 * @param {import('discord.js').Interaction} interaction The interaction object.
 * @param {string} raidId The ID of the raid history record.
 * @param {object} attackerData The attacker's guild data.
 * @param {object} defenderData The defender's guild data.
 */
async function notifyAlliesAndEnemies(interaction, raidId, attackerData, defenderData) {
	const attackerTag = attackerData.guild_tag;
	const defenderTag = defenderData.guild_tag;

	// Find allies of the defender
	const defenderAllies = db.prepare(`
   SELECT
     CASE WHEN r.guild_one_tag = ? THEN r.guild_two_tag ELSE r.guild_one_tag END AS ally_tag,
     gl.public_channel_id AS channel_id,
     gl.role_id AS role_id
   FROM guild_relationships r
   JOIN guild_list gl
     ON gl.guild_tag = CASE WHEN r.guild_one_tag = ? THEN r.guild_two_tag ELSE r.guild_one_tag END
   WHERE (r.guild_one_tag = ? OR r.guild_two_tag = ?) AND r.status = 'alliance'
 `).all(defenderTag, defenderTag, defenderTag, defenderTag);

	// Find enemies of the attacker
	const attackerEnemies = db.prepare(`
   SELECT
     CASE WHEN r.guild_one_tag = ? THEN r.guild_two_tag ELSE r.guild_one_tag END AS enemy_tag,
     gl.public_channel_id AS channel_id,
     gl.role_id AS role_id
   FROM guild_relationships r
   JOIN guild_list gl
     ON gl.guild_tag = CASE WHEN r.guild_one_tag = ? THEN r.guild_two_tag ELSE r.guild_one_tag END
   WHERE (r.guild_one_tag = ? OR r.guild_two_tag = ?) AND r.status = 'enemy'
 `).all(attackerTag, attackerTag, attackerTag, attackerTag);

	const callToArmsRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`join_attack_${raidId}`).setLabel('Join Attack').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
		new ButtonBuilder().setCustomId(`aid_defence_${raidId}`).setLabel('Aid Defense').setStyle(ButtonStyle.Success).setEmoji('🛡️'),
	);

	// Send notifications
	for (const ally of defenderAllies) {
		if (ally.channel_id) {
			const embed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setTitle('🛡️ Call to Arms! 🛡️')
				.setDescription(`Your ally, **${defenderData.guild_name}**, is under attack by **${attackerData.guild_name}**! Your aid is requested in their public channel: <#${defenderData.public_channel_id}>`);
			try {
				const channel = await interaction.client.channels.fetch(ally.channel_id);
				const content = ally.role_id ? `<@&${ally.role_id}>` : undefined;
				await channel.send({ content, embeds: [embed], components: [callToArmsRow] });
			}
			catch (e) {
				console.error(`Failed to notify ally ${ally.ally_tag}:`, e);
			}
		}
	}

	for (const enemy of attackerEnemies) {
		if (enemy.channel_id) {
			const embed = new EmbedBuilder()
				.setColor(0xC0392B)
				.setTitle('⚔️ Opportunity Strikes! ⚔️')
				.setDescription(`Your enemy, **${attackerData.guild_name}**, has declared war on **${defenderData.guild_name}**! Now is your chance to join the fray in their public channel: <#${defenderData.public_channel_id}>`);
			try {
				const channel = await interaction.client.channels.fetch(enemy.channel_id);
				const content = enemy.role_id ? `<@&${enemy.role_id}>` : undefined;
				await channel.send({ content, embeds: [embed], components: [callToArmsRow] });
			}
			catch (e) {
				console.error(`Failed to notify enemy ${enemy.enemy_tag}:`, e);
			}
		}
	}
}

async function handleRaidStats(interaction) {
	try {
		// Top raiders
		const topRaiders = db.prepare(`
            SELECT gl.guild_name, gl.guild_tag, rl.successful_raids, rl.crowns_stolen, rl.guilds_destroyed
            FROM raid_leaderboard rl
            JOIN guild_list gl ON rl.guild_tag = gl.guild_tag
            ORDER BY rl.successful_raids DESC, rl.crowns_stolen DESC
            LIMIT 5
        `).all();

		// Recent raids
		const recentRaids = db.prepare(`
            SELECT 
                a.guild_name as attacker_name, 
                d.guild_name as defender_name,
				rh.attacker_tag,
				rh.defender_tag,
                rh.timestamp,
                rh.success,
                rh.stolen_amount,
				rh.attacker_allies,
				rh.defender_allies
            FROM raid_history rh
            JOIN guild_list a ON rh.attacker_tag = a.guild_tag
            JOIN guild_list d ON rh.defender_tag = d.guild_tag
			WHERE rh.success != -1
            ORDER BY rh.timestamp DESC
            LIMIT 5
        `).all();

		// Format leaderboard
		let raiderBoard = 'No raids recorded yet';
		if (topRaiders.length > 0) {
			raiderBoard = topRaiders.map((guild, i) =>
				`${i + 1}. ${guild.guild_name} [${guild.guild_tag}]\n` +
                `⚔️ ${guild.successful_raids} raids | 👑 ${guild.crowns_stolen.toLocaleString()} stolen | ☠️ ${guild.guilds_destroyed || 0} destroyed`,
			).join('\n\n');
		}

		// Format recent raids
		let recentBoard = 'No recent raids';
		if (recentRaids.length > 0) {
			recentBoard = recentRaids.map(raid => {
				const attackerCount = 1 + (raid.attacker_allies ? raid.attacker_allies.split(',').length : 0);
				const defenderCount = 1 + (raid.defender_allies ? raid.defender_allies.split(',').length : 0);

				return `**${raid.attacker_name}** (${attackerCount}) vs **${raid.defender_name}** (${defenderCount})\n` +
                `${raid.success ? '✅ Attackers Won' : '🛡️ Defenders Won'} | ${raid.stolen_amount?.toLocaleString() || 0} stolen\n` +
                `<t:${Math.floor(new Date(raid.timestamp).getTime() / 1000)}:R>`;
			}).join('\n\n');
		}

		const embed = new EmbedBuilder()
			.setTitle('⚔️ Guild Raid Statistics ⚔️')
			.setColor(0xE67E22)
			.addFields(
				{ name: 'Top Raiders', value: raiderBoard, inline: false },
				{ name: 'Recent Wars', value: recentBoard, inline: false },
			)
			.setFooter({ text: 'Raid another guild with /guild raid' });

		await interaction.reply({ embeds: [embed] });
	}
	catch (error) {
		console.error('Raid stats error:', error);
		const errorEmbed = new EmbedBuilder()
			.setColor(0xE74C3C)
			.setTitle('❌ Error')
			.setDescription('An error occurred while fetching raid statistics.');
		await interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}
}

/**
 * Computes raid cooldown hours based on attitude/tier.
 * Aggressive reduces base 24h by rank brackets; min 1h.
 * @param {'Neutral'|'Aggressive'|'Defensive'|'Opportunist'} attitude
 * @param {number} tier
 * @returns {number}
 */
function getRaidCooldownHours(attitude, tier) {
	let hours = 24;
	if (attitude === 'Aggressive') {
		if (tier >= 13) hours -= 16;
		else if (tier >= 10) hours -= 12;
		else if (tier >= 7) hours -= 8;
		else if (tier >= 4) hours -= 4;
	}
	return Math.max(1, hours);
}

async function handleRaid(interaction) {
	const guildTag = interaction.options.getString('guild_tag').toUpperCase();
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Raid Cannot Proceed');

	const attackerGuildTag = db.prepare('SELECT guild_tag FROM guildmember_tracking WHERE user_id = ?').get(userId)?.guild_tag;
	if (attackerGuildTag) {
		const tags = [attackerGuildTag, guildTag].sort();
		const relationship = db.prepare(`
			SELECT * FROM guild_relationships 
			WHERE guild_one_tag = ? AND guild_two_tag = ? 
			AND (status != 'truce' OR expires_at > datetime('now'))
		`).get(tags[0], tags[1]);

		if (relationship) {
			if (relationship.status === 'alliance') {
				errorEmbed.setDescription('You cannot raid a guild you have an alliance with!');
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}
			if (relationship.status === 'truce') {
				const expiry = new Date(relationship.expires_at);
				if (expiry > new Date()) {
					errorEmbed.setDescription(`You have a truce with this guild that ends <t:${Math.floor(expiry.getTime() / 1000)}:R>!`);
					return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
				}
			}
		}
		const cooldown = db.prepare('SELECT expires_at FROM diplomacy_cooldowns WHERE guild_one_tag = ? AND guild_two_tag = ? AND cooldown_type = ?').get(tags[0], tags[1], 'alliance_break');
		if (cooldown && new Date(cooldown.expires_at) > new Date()) {
			errorEmbed.setDescription(`You cannot raid this guild. A recently broken alliance has a non-aggression pact that ends <t:${Math.floor(new Date(cooldown.expires_at).getTime() / 1000)}:R>.`);
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}

	}
	// Check if user is in a guild
	const attackerGuild = db.prepare(`
		SELECT gmt.guild_tag, gl.guild_name, gl.attitude, COALESCE(gt.tier, 1) as tier, ge.balance
		FROM guildmember_tracking gmt
		JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
		LEFT JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag
		LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
		WHERE gmt.user_id = ?
	`).get(userId);

	if (!attackerGuild) {
		errorEmbed.setDescription('You must be in a guild to raid!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Check if target exists
	const defenderGuild = db.prepare(`
		SELECT 
			gl.guild_name, 
			gl.guild_tag, 
			COALESCE(gt.tier, 1) as tier, 
			COALESCE(ge.balance, 0) as balance,
			gl.created_at, 
			rc.shield_expiry, 
			rc.last_raid_time
		FROM guild_list gl
		LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag
		LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
		LEFT JOIN raid_cooldowns rc ON gl.guild_tag = rc.guild_tag
		WHERE gl.guild_tag = ?
	`).get(guildTag);

	if (!defenderGuild) {
		errorEmbed.setDescription('No guild found with that tag!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Check if raiding own guild
	if (attackerGuild.guild_tag === defenderGuild.guild_tag) {
		errorEmbed.setDescription('You cannot raid your own guild!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	const defenderCooldowns = db.prepare('SELECT shield_expiry, is_under_raid FROM raid_cooldowns WHERE guild_tag = ?').get(guildTag);

	// NEW: Check if the guild is already locked in a raid
	if (defenderCooldowns?.is_under_raid === 1) {
		errorEmbed.setDescription('This guild is currently in the middle of another war! Try again in a few minutes.');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Check new guild protection (7 days)
	const creationDate = new Date(defenderGuild.created_at);
	const now = new Date();
	const daysSinceCreation = (now - creationDate) / (1000 * 60 * 60 * 24);

	if (daysSinceCreation < 7) {
		errorEmbed.setDescription(`This guild is protected by New Guild Protection (7 days), which expires <t:${Math.floor((creationDate.getTime() + (7 * 24 * 60 * 60 * 1000)) / 1000)}:R>`);
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Check shield cooldown
	if (defenderGuild.shield_expiry) {
		const shieldExpiry = new Date(defenderGuild.shield_expiry);
		if (now < shieldExpiry) {
			errorEmbed.setDescription(`This guild is protected by a raid shield until <t:${Math.floor(shieldExpiry.getTime() / 1000)}:R>!`);
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	// Get member data for loot calculation later
	const defenderMembers = db.prepare(`
        SELECT ue.user_id, ue.crowns
        FROM guildmember_tracking gmt
        LEFT JOIN user_economy ue ON gmt.user_id = ue.user_id
        WHERE gmt.guild_tag = ?
    `).all(defenderGuild.guild_tag);

	// Calculate raid cost (attacking guild tier * 200)
	const raidCost = attackerGuild.tier * 200;

	// Check attacker guild balance
	if ((attackerGuild.balance || 0) < raidCost) {
		errorEmbed.setDescription(`Your guild needs **${raidCost.toLocaleString()}** crowns in the guild vault to declare war (Tier ${attackerGuild.tier} * 200)!`);
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Check attacker cooldown (24h between raids)
	const attackerCooldown = db.prepare(`
        SELECT last_raid_time FROM raid_cooldowns WHERE guild_tag = ?
    `).get(attackerGuild.guild_tag);

	if (attackerCooldown?.last_raid_time) {
		// Determine the correct cooldown duration for this guild
		const cooldownHours = getRaidCooldownHours(attackerGuild.attitude, attackerGuild.tier);

		const lastRaid = new Date(attackerCooldown.last_raid_time);
		const hoursSinceLastRaid = (now - lastRaid) / (1000 * 60 * 60);

		if (hoursSinceLastRaid < cooldownHours) {
			const nextRaidTime = new Date(lastRaid.getTime() + cooldownHours * 60 * 60 * 1000);
			errorEmbed.setDescription(`Your guild can declare war again <t:${Math.floor(nextRaidTime.getTime() / 1000)}:R>!`);
			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	// Confirm raid with button
	const confirmEmbed = new EmbedBuilder()
		.setTitle(`⚔️ Declare War: ${defenderGuild.guild_name} [${defenderGuild.guild_tag}]`)
		.setDescription(`You are about to declare war on **${defenderGuild.guild_name}** (${TIER_DATA[defenderGuild.tier - 1].name}). This will open a 10-minute window for other guilds to join the fight.`)
		.addFields(
			{ name: 'War Declaration Cost', value: `👑 ${raidCost.toLocaleString()} (Tier \`${attackerGuild.tier}\` * 200)`, inline: true },
			{ name: 'Base Success Chance', value: calculateSuccessChance(attackerGuild.tier, defenderGuild.tier), inline: true },
			{ name: 'Potential Loot', value: calculatePotentialLoot(defenderGuild, defenderMembers), inline: false },
		)
		.setColor(0xE67E22);

	const confirmRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`raid_confirm_${attackerGuild.guild_tag}_${defenderGuild.guild_tag}`)
			.setLabel('Declare War')
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('raid_cancel')
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary),
	);

	await interaction.reply({
		embeds: [confirmEmbed],
		components: [confirmRow],
		flags: MessageFlags.Ephemeral,
	});
}
async function handleShield(interaction) {
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('🛡️ Shield Purchase Failed');

	// Check if user is guild owner
	const guildData = db.prepare(`
        SELECT 
            gl.guild_tag, 
            gl.guild_name, 
            gl.created_at,
            COALESCE(gt.tier, 1) as tier, 
            COALESCE(ge.balance, 0) as balance
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        LEFT JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag
        LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
        WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
    `).get(userId);

	if (!guildData) {
		errorEmbed.setDescription('You must be the owner or vice-guildmaster of a guild to purchase a shield!');
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Check current shield
	const currentShield = db.prepare(`
        SELECT shield_expiry FROM raid_cooldowns WHERE guild_tag = ?
    `).get(guildData.guild_tag);

	const now = new Date();
	const creationDate = new Date(guildData.created_at);
	const daysSinceCreation = (now - creationDate) / (1000 * 60 * 60 * 24);

	// Check if guild is still under new guild protection (7 days)
	if (daysSinceCreation < 7) {
		const protectionEnd = new Date(creationDate.getTime() + 7 * 24 * 60 * 60 * 1000);
		const protectionEmbed = new EmbedBuilder()
			.setColor(0x3498DB)
			.setTitle('🛡️ New Guild Protection Active')
			.setDescription(`Since your guild is less than 7 days old, you have a __New Guild Protection__ shield, and don't need to buy one right now.\nThis ends <t:${Math.floor(protectionEnd.getTime() / 1000)}:R>!`);
		return interaction.reply({
			embeds: [protectionEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	if (currentShield?.shield_expiry) {
		const expiry = new Date(currentShield.shield_expiry);
		if (now < expiry) {
			const activeEmbed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setTitle('🛡️ Shield Already Active')
				.setDescription(`Your guild already has a shield active until <t:${Math.floor(expiry.getTime() / 1000)}:R>!`);
			return interaction.reply({
				embeds: [activeEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	// Calculate shield cost and duration based on tier
	const shieldCosts = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 14000, 16000, 18000, 20000];
	const shieldDurations = [14, 12, 10, 8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1, 1];

	const cost = shieldCosts[guildData.tier - 1];
	const durationDays = shieldDurations[guildData.tier - 1];

	// Check balance
	if ((guildData.balance || 0) < cost) {
		errorEmbed.setDescription(`Your guild needs **${cost.toLocaleString()}** crowns in the vault to purchase a shield!`);
		return interaction.reply({
			embeds: [errorEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	// Confirm purchase
	const confirmEmbed = new EmbedBuilder()
		.setTitle(`🛡️ Purchase Raid Shield for ${guildData.guild_name}`)
		.setDescription('This will protect your guild from raids, keeping your loot safe and sound.')
		.addFields(
			{ name: 'Shield Cost', value: `👑 ${cost.toLocaleString()} Crowns`, inline: true },
			{ name: 'Standard Duration', value: `${durationDays} days`, inline: true },
			{ name: 'Current Tier', value: `${tierEmojis[guildData.tier - 1]}`, inline: true },
		)
		.setColor(0x3498DB);
	const confirmRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`shield_confirm_${guildData.guild_tag}`)
			.setLabel('Confirm Purchase')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('shield_cancel')
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary),
	);

	await interaction.reply({
		embeds: [confirmEmbed],
		components: [confirmRow],
		flags: MessageFlags.Ephemeral,
	});
}

// Helper functions
function calculateSuccessChance(attackerTier, defenderTier) {
	let modifier = 0;

	// Kingslayer bonus (+3 for attacking higher tier)
	if (attackerTier < defenderTier) {
		modifier += 3;
	}
	// Bully penalty (-4 for attacking lower tier)
	else if (attackerTier > defenderTier) {
		modifier -= 4;
	}

	const baseChance = 50 + ((attackerTier - defenderTier) * 2.5) + (modifier * 2);
	return `${Math.max(5, Math.min(95, baseChance))}%`;
}

function calculatePotentialLoot(defenderGuild, members) {
	// const tierInfo = TIER_DATA[defenderGuild.tier - 1];
	const isVulnerable = defenderGuild.balance < 200;
	// const maxStolenPercent = isVulnerable ? 25 : tierInfo.stolen;
	const guildLoot = '❓ (Hidden)';
	// const guildLoot = '👑 ' + Math.floor((defenderGuild.balance || 0) * (maxStolenPercent / 100));
	// will uncomment these when /character system is set up and we actually can let certain character archetypes access beyond the hidden information
	let memberLoot = 0;
	if (isVulnerable) {
		// 25% of each member's crowns with no cap
		memberLoot = members.reduce((sum, member) => sum + Math.floor((member.crowns || 0) * 0.25), 0);
	}
	else {
		// 5% of each member's crowns capped at 100 per member
		memberLoot = members.reduce((sum, member) => sum + Math.min(100, Math.floor((member.crowns || 0) * 0.05)), 0);
	}

	return `Guild Vault: \`${guildLoot.toLocaleString()}\` Crowns\nMember Pockets: \`👑 ${memberLoot.toLocaleString()}\` Crowns`;
}
/**
 * Gets the power bonus for a guild based on its tier.
 * @param {number} tier The guild's tier.
 * @returns {number} The power bonus.
 */
function getTierPowerBonus(tier) {
	if (tier >= 13) return 5;
	if (tier >= 10) return 4;
	if (tier >= 7) return 3;
	if (tier >= 4) return 2;
	return 1;
}

/**
 * Calculates the chance of a cataclysmic failure based on the defending coalition.
 * @param {object} primaryDefender - The main defending guild.
 * @param {Array<object>} defendingAllies - An array of allied defending guilds.
 * @returns {{chance: number, triggeredBy: string|null}} - The final chance (0-1) and the name of the guild that triggered it.
 */
function calculateCataclysmicFailureChance(primaryDefender, defendingAllies) {
	// Unit tests have been conducted via external testing file raiddebugger.js, and are confirmed set up as intended.
	let highestChance = 0;
	let triggeredBy = null;

	// Check the primary defender first
	if (primaryDefender && primaryDefender.attitude === 'Defensive') {
		const rank = Math.floor((primaryDefender.tier - 1) / 3);
		// 0-4 for Stone-Adamantium
		highestChance = (rank + 1) * 0.04;
		// 4% per rank
		triggeredBy = primaryDefender.guild_name;
	}

	// Now check allies to see if any have a higher chance
	for (const ally of defendingAllies) {
		if (ally && ally.attitude === 'Defensive') {
			const rank = Math.floor((ally.tier - 1) / 3);
			const allyChance = (rank + 1) * 0.02;
			// 2% per rank for allies
			if (allyChance > highestChance) {
				highestChance = allyChance;
				triggeredBy = ally.guild_name;
			}
		}
	}

	return { chance: highestChance, triggeredBy };
}

async function handleBounty(interaction) {
	const userId = interaction.user.id;
	const targetTag = interaction.options.getString('guild_tag').toUpperCase();
	const amount = interaction.options.getInteger('amount');
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Bounty Placement Failed');

	const placerGuild = db.prepare(`
        SELECT gl.guild_tag, gl.guild_name, COALESCE(ge.balance, 0) as balance
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
        WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
    `).get(userId);

	if (!placerGuild) {
		errorEmbed.setDescription('You must be a Guildmaster or Vice-GM to place a bounty.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	if (placerGuild.guild_tag === targetTag) {
		errorEmbed.setDescription('You can\'t place a bounty on your own guild, wise guy.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const targetGuild = db.prepare('SELECT guild_name FROM guild_list WHERE guild_tag = ?').get(targetTag);
	if (!targetGuild) {
		errorEmbed.setDescription(`Couldn't find any guild with the tag [${targetTag}].`);
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const existingBounty = db.prepare('SELECT 1 FROM guild_bounties WHERE target_guild_tag = ? AND status = ?').get(targetTag, 'ACTIVE');
	if (existingBounty) {
		errorEmbed.setDescription(`**${targetGuild.guild_name}** already has an active bounty. You must wait for it to be claimed.`);
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	if (placerGuild.balance < amount) {
		errorEmbed.setDescription(`Your guild vault only has **${placerGuild.balance.toLocaleString()}** Crowns. You can't afford this bounty.`);
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	try {
		db.transaction(() => {
			const result = db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ? AND balance >= ?').run(amount, placerGuild.guild_tag, amount);
			if (result.changes === 0) {
				throw new Error('Insufficient funds at time of transaction.');
			}
			db.prepare(`
                INSERT INTO guild_bounties (placer_guild_tag, target_guild_tag, amount, status)
                VALUES (?, ?, ?, 'ACTIVE')
            `).run(placerGuild.guild_tag, targetTag, amount);
		})();

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle('✅ Bounty Placed!')
			.setDescription(`You have successfully placed a bounty of **👑 ${amount.toLocaleString()}** on **${targetGuild.guild_name} [${targetTag}]**.`);
		await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });

		const announceEmbed = new EmbedBuilder()
			.setColor(0xE67E22)
			.setTitle('🎯 A Bounty Has Been Posted! 🎯')
			.setDescription(`**${placerGuild.guild_name} [${placerGuild.guild_tag}]** has placed a bounty on **${targetGuild.guild_name} [${targetTag}]**!`)
			.addFields({ name: 'Bounty Amount', value: `**👑 ${amount.toLocaleString()}**` })
			.setFooter({ text: 'The first guild to successfully raid the target will claim the prize!' })
			.setTimestamp();
		await sendGuildAnnouncement(interaction.client, announceEmbed);

	}
	catch (error) {
		console.error('Bounty placement error:', error);
		errorEmbed.setTitle('❌ Transaction Error').setDescription('An error occurred while placing the bounty. Your funds have not been spent.');
		await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
}

async function resolveBattleSequentially(interaction, warMessage, raidId, attackerTag, defenderTag) {
	console.log(`[Raid Resolution] Collector ended for raid ID ${raidId}. Starting battle resolution.`);

	try {
		console.log(`[Raid Resolution LOG] [${raidId}] Starting battle resolution function.`);
		// --- DATA FETCHING ---
		const finalAttackerData = db.prepare('SELECT gl.guild_name, gl.role_id, gl.attitude, COALESCE(gt.tier, 1) as tier, ge.balance FROM guild_list gl LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag WHERE gl.guild_tag = ?').get(attackerTag);
		const finalDefenderData = db.prepare('SELECT gl.guild_name, gl.public_channel_id, gl.role_id, gl.attitude, COALESCE(gt.tier, 1) as tier, ge.balance FROM guild_list gl LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag WHERE gl.guild_tag = ?').get(defenderTag);
		const allParticipants = db.prepare('SELECT ara.side, gl.guild_name, gl.role_id, gt.tier, ara.allied_guild_tag FROM active_raid_allies ara JOIN guild_list gl ON ara.allied_guild_tag = gl.guild_tag LEFT JOIN guild_tiers gt ON ara.allied_guild_tag = gt.guild_tag WHERE ara.raid_id = ?').all(raidId);
		const attackingParticipants = allParticipants.filter(a => a.side === 'attacker');
		const defendingParticipants = allParticipants.filter(a => a.side === 'defender');
		console.log(`[Raid Resolution LOG] [${raidId}] Sorted participants. Attackers: ${attackingParticipants.length}, Defenders: ${defendingParticipants.length}.`);


		const attackerEmojis = attackingParticipants.map(participant => {
			const defaultEmojiRecord = db.prepare('SELECT emoji_name, emoji_id FROM guild_emojis WHERE guild_tag = ? AND is_default = 1').get(participant.allied_guild_tag);
			return defaultEmojiRecord ? `<:${defaultEmojiRecord.emoji_name}:${defaultEmojiRecord.emoji_id}>` : '⚔️';
		});

		const defenderEmojis = defendingParticipants.map(participant => {
			const defaultEmojiRecord = db.prepare('SELECT emoji_name, emoji_id FROM guild_emojis WHERE guild_tag = ? AND is_default = 1').get(participant.allied_guild_tag);
			return defaultEmojiRecord ? `<:${defaultEmojiRecord.emoji_name}:${defaultEmojiRecord.emoji_id}>` : '🛡️';
		});

		const now = new Date();
		const raidCost = finalAttackerData.tier * 200;

		// --- FORFEIT SCENARIOS ---
		if (attackingParticipants.length === 0 || defendingParticipants.length === 0) {
			console.log(`[Raid Resolution LOG] [${raidId}] Forfeit condition met. Processing forfeit.`);
			let resultEmbed, announceEmbed;
			if (attackingParticipants.length === 0) {
				const defenderGain = Math.floor(raidCost * 0.5);
				db.prepare('UPDATE guild_economy SET balance = balance + ? WHERE guild_tag = ?').run(defenderGain, defenderTag);
				const description = `The attacking alliance, led by **${finalAttackerData.guild_name}**, failed to muster their forces! The defenders win by default.`;
				resultEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('🛡️ Victory by Forfeit! 🛡️').setDescription(description).addFields({ name: 'Defender\'s Compensation', value: `👑 The defenders have been compensated with **${defenderGain.toLocaleString()}** Crowns.` });
				announceEmbed = new EmbedBuilder().setTitle('🛡️ War Report: Attackers Forfeit! 🛡️').setColor(0x3498DB).setDescription(description).setTimestamp();
				db.prepare('UPDATE raid_history SET success = 0, stolen_amount = ? WHERE id = ?').run(defenderGain, raidId);
			}
			else {
				const isVulnerable = finalDefenderData.balance < GUILD_VULNERABILITY_THRESHOLD;
				const defenderTierInfo = TIER_DATA[finalDefenderData.tier - 1];
				const maxStolenPercent = isVulnerable ? GUILD_RAID_MAX_STOLEN_PERCENT : defenderTierInfo.stolen;
				const stolenFromGuild = Math.floor((finalDefenderData.balance || 0) * (maxStolenPercent / 100));
				db.transaction(() => {
					db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ?').run(stolenFromGuild, defenderTag);
					db.prepare('UPDATE guild_economy SET balance = balance + ? WHERE guild_tag = ?').run(stolenFromGuild, attackerTag);
				})();
				await checkAndDestroyGuildOnRaid(defenderTag, attackerTag, interaction);
				const isDestroyed = !db.prepare('SELECT 1 FROM guild_list WHERE guild_tag = ?').get(defenderTag);
				const description = isDestroyed ? `The defending coalition, led by **${finalDefenderData.guild_name}**, failed to answer the call to arms and has been **destroyed**!` : `The defending coalition, led by **${finalDefenderData.guild_name}**, failed to answer the call to arms! The attackers claim victory unopposed.`;
				resultEmbed = new EmbedBuilder().setColor(0x2ECC71).setTitle('⚔️ Victory by Forfeit! ⚔️').setDescription(description).addFields({ name: 'Spoils of War', value: `👑 The attackers have plundered **${stolenFromGuild.toLocaleString()}** Crowns from the undefended vault.` });
				announceEmbed = new EmbedBuilder().setTitle('⚔️ War Report: Defenders Forfeit! ⚔️').setColor(0x2ECC71).setDescription(description).setTimestamp();
				db.prepare('INSERT INTO raid_leaderboard (guild_tag, successful_raids, crowns_stolen) VALUES (?, 1, ?) ON CONFLICT(guild_tag) DO UPDATE SET successful_raids = successful_raids + 1, crowns_stolen = crowns_stolen + ?').run(attackerTag, stolenFromGuild, stolenFromGuild);
				db.prepare('UPDATE raid_history SET success = 1, stolen_amount = ? WHERE id = ?').run(stolenFromGuild, raidId);
			}

			const shieldExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
			db.prepare('INSERT INTO raid_cooldowns (guild_tag, shield_expiry) VALUES (?, ?) ON CONFLICT(guild_tag) DO UPDATE SET shield_expiry = ?').run(defenderTag, shieldExpiry, shieldExpiry);
			db.prepare('INSERT INTO raid_cooldowns (guild_tag, last_raid_time) VALUES (?, ?) ON CONFLICT(guild_tag) DO UPDATE SET last_raid_time = ?').run(attackerTag, now.toISOString(), now.toISOString());

			await sendGuildAnnouncement(interaction.client, announceEmbed);
			await warMessage.edit({ embeds: [resultEmbed], components: [] });
			return;
		}

		console.log(`[Raid Resolution LOG] [${raidId}] Forfeit condition NOT met. Proceeding to full battle.`);

		// --- BATTLE NARRATION & RESOLUTION ---

		// 1. Fetch all necessary data for narration and calculation
		console.log(`[Raid Resolution LOG] [${raidId}] Fetching custom raid messages and guildmaster info.`);
		const attackerMsgs = db.prepare('SELECT * FROM guild_raid_messages WHERE guild_tag = ?').get(attackerTag) || {};
		const defenderMsgs = db.prepare('SELECT * FROM guild_raid_messages WHERE guild_tag = ?').get(defenderTag) || {};
		const attackerGM = db.prepare('SELECT u.user_id FROM guildmember_tracking gmt JOIN user_economy u ON gmt.user_id = u.user_id WHERE gmt.guild_tag = ? AND gmt.owner = 1').get(attackerTag);
		const defenderGM = db.prepare('SELECT u.user_id FROM guildmember_tracking gmt JOIN user_economy u ON gmt.user_id = u.user_id WHERE gmt.guild_tag = ? AND gmt.owner = 1').get(defenderTag);
		console.log(`[Raid Resolution LOG] [${raidId}] Attacker GM: ${attackerGM ? attackerGM.user_id : 'Not Found'}. Defender GM: ${defenderGM ? defenderGM.user_id : 'Not Found'}.`);

		const placeholders = {
			raidingGuild: `**${finalAttackerData.guild_name}**`,
			defendingGuild: `**${finalDefenderData.guild_name}**`,
			raidingGuildmaster: attackerGM ? `<@${attackerGM.user_id}>` : `**${finalAttackerData.guild_name}**'s leader`,
			defendingGuildmaster: defenderGM ? `<@${defenderGM.user_id}>` : `**${finalDefenderData.guild_name}**'s leader`,
			raidingViceGuildmaster: 'their second-in-command',
			defendingViceGuildmaster: 'their second-in-command',
		};
		const replacePlaceholders = (text) => {
			let result = text;
			for (const [key, value] of Object.entries(placeholders)) {
				result = result.replace(new RegExp(`{${key}}`, 'g'), value);
			}
			return result;
		};

		const primaryDefenderForCheck = db.prepare('SELECT attitude, tier, guild_name FROM guild_list WHERE guild_tag = ?').get(defenderTag);
		const defendingAlliesForCheck = defendingParticipants.map(p => db.prepare('SELECT guild_name, attitude, tier FROM guild_list WHERE guild_tag = ?').get(p.allied_guild_tag)).filter(g => g);

		const failureCheck = calculateCataclysmicFailureChance(primaryDefenderForCheck, defendingAlliesForCheck);
		const cataclysmicFailure = Math.random() < failureCheck.chance;

		// --- Attitude & Combat Modifier Calculations ---
		let attackModifier = 0;
		let defenseModifier = 0;
		let attitudeAttackerText = '';
		let attitudeDefenderText = '';

		const isNeutralDefender = finalDefenderData.attitude === 'Neutral';

		// 1. Calculate Attitude Bonuses for all participants that are present in the battle
		// If attackers/defenders have not clicked the join button, they do not get their attitude bonuses.
		// Mechanics are set up so that it filters through all current participants on both sides, and doesn't include anyone by default to encourage active participation
		// It is an intended feature to not give anyone default stats without doing anything.
		if (!isNeutralDefender) {
			for (const participant of allParticipants) {
				const attitude = db.prepare('SELECT attitude FROM guild_list WHERE guild_tag = ?').get(participant.allied_guild_tag)?.attitude;
				if (participant.side === 'attacker') {
					if (attitude === 'Aggressive') {
						attackModifier += 1;
						attitudeAttackerText += `- \`+1\` (${participant.guild_name} - Aggressive Buff)\n`;
					}
					else if (attitude === 'Opportunist' && Math.random() < 0.5) {
						// Debuff opposing side
						defenseModifier -= 1;
						attitudeDefenderText += `- \`-1\` (${participant.guild_name} - Opportunist 50% Chance)\n`;
					}
				}
				else if (participant.side !== 'attacker') {
					if (attitude === 'Defensive') {
						defenseModifier += 1;
						attitudeDefenderText += `- \`+1\` (${participant.guild_name} - Defensive Buff)\n`;
					}
					else if (attitude === 'Opportunist' && Math.random() < 0.5) {
						// Debuff opposing side
						attackModifier -= 1;
						attitudeAttackerText += `- \`-1\` (${participant.guild_name} - Opportunist 50% Chance)\n`;
					}
				}
			}
		}
		else {
			attitudeAttackerText += '- `±0` (Defender is Neutral)\n';
			attitudeDefenderText += '- `±0` (Defender is Neutral)\n';
		}

		// 2. Add standard tier-difference modifiers
		if (finalAttackerData.tier > finalDefenderData.tier) {
			attackModifier -= 4;
			attitudeAttackerText += '- `-4` (Bully Penalty)\n';
		}
		else if (finalAttackerData.tier < finalDefenderData.tier) {
			attackModifier += 3;
			attitudeAttackerText += '- `+3` (Kingslayer Bonus)\n';
		}

		// 3. Final Power Calculation
		const attackerRoll = Math.floor(Math.random() * 20) + 1;
		const attackerBasePower = getTierPowerBonus(finalAttackerData.tier);
		const defenderBasePower = TIER_DATA[finalDefenderData.tier - 1].ac;

		const attackerAllyPower = attackingParticipants.filter(p => p.allied_guild_tag !== attackerTag).reduce((sum, ally) => sum + getTierPowerBonus(ally.tier), 0);
		const defenderAllyPower = defendingParticipants.filter(p => p.allied_guild_tag !== defenderTag).reduce((sum, ally) => sum + getTierPowerBonus(ally.tier), 0);

		const finalAttackPower = attackerRoll + attackerBasePower + attackerAllyPower + attackModifier;
		const finalDefensePower = defenderBasePower + defenderAllyPower + defenseModifier;

		const success = cataclysmicFailure ? false : finalAttackPower >= finalDefensePower;

		// 4. Prepare text for the final result embed
		const attackerAllyTierList = attackingParticipants.filter(p => p.allied_guild_tag !== attackerTag).map(p => `- \`+${getTierPowerBonus(p.tier)}\` (${p.guild_name} - Ally Tier)`).join('\n');
		const defenderAllyTierList = defendingParticipants.filter(p => p.allied_guild_tag !== defenderTag).map(p => `- \`+${getTierPowerBonus(p.tier)}\` (${p.guild_name} - Ally Tier)`).join('\n');

		const fullAttackerModifierText = `${attitudeAttackerText}${attackerAllyTierList}\n- \`+${attackerBasePower}\` (Base Tier Power)\n__**MODIFIERS TOTAL**__ = \`${finalAttackPower - attackerRoll}\``;
		const fullDefenderModifierText = `${attitudeDefenderText}${defenderAllyTierList}\n__**MODIFIERS TOTAL**__ = \`${finalDefensePower - defenderBasePower}\``;

		const NARRATIVE_DELAY_MS = 60000;
		const battleStartEmbed = new EmbedBuilder(warMessage.embeds[0].data).setDescription('The time for talk is over! The battle begins now...');
		await warMessage.edit({ embeds: [battleStartEmbed], components: [] });
		const getNextActionTime = () => Math.floor((Date.now() + NARRATIVE_DELAY_MS) / 1000);

		let nextTime = getNextActionTime();
		const raidingDescEmbed = new EmbedBuilder().setTitle('⚔️ Attacker\'s Approach: Amassing of the Army! ⚔️').setColor(0xE67E22).setDescription(replacePlaceholders(attackerMsgs.raiding_description || DEFAULT_RAID_MESSAGES.raiding_description)).addFields({ name: 'Next Phase: Defender\'s Stance', value: `Starting <t:${nextTime}:R>` }).setFooter({ text: `⚔️ [${attackerTag}] vs. 🛡️ [${defenderTag}]` }).setTimestamp();
		await warMessage.channel.send({ embeds: [raidingDescEmbed] });
		await wait(NARRATIVE_DELAY_MS);

		nextTime = getNextActionTime();
		const defendingDescEmbed = new EmbedBuilder().setTitle('🛡️ Defender\'s Stance: Prepare for Siege! 🛡️').setColor(0x3498DB).setDescription(replacePlaceholders(defenderMsgs.defending_description || DEFAULT_RAID_MESSAGES.defending_description)).addFields({ name: 'Next Phase: The Assault Begins', value: `Starting <t:${nextTime}:R>` }).setFooter({ text: `⚔️ [${attackerTag}] vs. 🛡️ [${defenderTag}]` }).setTimestamp();
		await warMessage.channel.send({ embeds: [defendingDescEmbed] });
		await wait(NARRATIVE_DELAY_MS);

		nextTime = getNextActionTime();
		const attackEmbed = new EmbedBuilder().setTitle('💥 The Assault Begins: Press the Advantage! 🤺').setColor(0xC0392B).setDescription(replacePlaceholders(attackerMsgs.raiding_attack || DEFAULT_RAID_MESSAGES.raiding_attack)).addFields({ name: 'Next Phase: Final Battle Outcome', value: `Starting <t:${nextTime}:R>` }).setFooter({ text: `⚔️ [${attackerTag}] vs. 🛡️ [${defenderTag}]` }).setTimestamp();
		await warMessage.channel.send({ embeds: [attackEmbed] });
		await wait(NARRATIVE_DELAY_MS);

		let finalDescription, resultEmbed, announceEmbed, netLoot = 0, defenderGain = 0;
		const attackerParticipantList = attackingParticipants.map((p, index) => `> ${attackerEmojis[index]} <@&${p.role_id}> (${tierEmojis[(p.tier || 1) - 1]})`).join('\n');
		const defenderParticipantList = defendingParticipants.map((p, index) => `> ${defenderEmojis[index]} <@&${p.role_id}> (${tierEmojis[(p.tier || 1) - 1]})`).join('\n');

		if (success) {
			finalDescription = replacePlaceholders(defenderMsgs.defending_failure || DEFAULT_RAID_MESSAGES.defending_failure) + '\n\n' + replacePlaceholders(attackerMsgs.raiding_victory || DEFAULT_RAID_MESSAGES.raiding_victory);
			await warMessage.channel.send({ embeds: [new EmbedBuilder().setColor(0x2ECC71).setDescription(finalDescription).setTitle('⚔️📜 Final Battle Outcome: Attackers are Triumphant! 💥🏚️').setFooter({ text: `⚔️ [${attackerTag}] vs. 🛡️ [${defenderTag}]` }).setTimestamp()] });
			await wait(5000);

			const isVulnerable = finalDefenderData.balance < GUILD_VULNERABILITY_THRESHOLD;
			const defenderTierInfo = TIER_DATA[finalDefenderData.tier - 1];
			const maxStolenPercent = isVulnerable ? GUILD_RAID_MAX_STOLEN_PERCENT : defenderTierInfo.stolen;
			const stolenFromGuild = Math.floor((finalDefenderData.balance || 0) * (maxStolenPercent / 100));
			const defenderMembers = db.prepare('SELECT ue.user_id, ue.crowns FROM guildmember_tracking gmt LEFT JOIN user_economy ue ON gmt.user_id = ue.user_id WHERE gmt.guild_tag = ?').all(defenderTag);
			let stolenFromMembers = 0;
			defenderMembers.forEach(member => {
				const stealAmount = isVulnerable ? Math.floor((member.crowns || 0) * (GUILD_RAID_MAX_STOLEN_PERCENT / 100)) : Math.min(GUILD_RAID_MAX_PER_MEMBER_CAP, Math.floor((member.crowns || 0) * (GUILD_RAID_MIN_PER_MEMBER_PERCENT / 100)));
				if (stealAmount > 0) {
					db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(stealAmount, member.user_id);
					stolenFromMembers += stealAmount;
				}
			});
			const escapeLossPercent = (Math.floor(Math.random() * 10) + 1) + (Math.floor(Math.random() * 10) + 1);
			const totalLoot = stolenFromGuild + stolenFromMembers;
			const lostDuringEscape = Math.floor(totalLoot * (escapeLossPercent / 100));
			netLoot = totalLoot - lostDuringEscape;

			let bountyClaimed = 0;
			const bounty = db.prepare('SELECT bounty_id, amount FROM guild_bounties WHERE target_guild_tag = ? AND status = ?').get(defenderTag, 'ACTIVE');

			if (bounty) {
				bountyClaimed = bounty.amount;

				db.transaction(() => {
					// Mark bounty as claimed
					db.prepare('UPDATE guild_bounties SET status = ?, claimed_by_tag = ?, claimed_at = CURRENT_TIMESTAMP WHERE bounty_id = ?')
						.run('CLAIMED', attackerTag, bounty.bounty_id);

					// Add bounty directly to attacker's vault
					db.prepare('UPDATE guild_economy SET balance = balance + ? WHERE guild_tag = ?')
						.run(bountyClaimed, attackerTag);
				})();

				console.log(`[Raid Resolution] [${raidId}] Guild ${attackerTag} claimed a bounty of ${bountyClaimed} from ${defenderTag}.`);
			}

			db.transaction(() => {
				if (stolenFromGuild > 0) db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ?').run(stolenFromGuild, defenderTag);
				if (netLoot > 0) db.prepare('UPDATE guild_economy SET balance = balance + ? WHERE guild_tag = ?').run(netLoot, attackerTag);
			})();
			db.prepare('INSERT INTO raid_leaderboard (guild_tag, successful_raids, crowns_stolen) VALUES (?, 1, ?) ON CONFLICT(guild_tag) DO UPDATE SET successful_raids = successful_raids + 1, crowns_stolen = crowns_stolen + ?').run(attackerTag, netLoot, netLoot);
			await checkAndDestroyGuildOnRaid(defenderTag, attackerTag, interaction);
			const isDestroyed = !db.prepare('SELECT 1 FROM guild_list WHERE guild_tag = ?').get(defenderTag);
			const description = isDestroyed ? `The attacking alliance has utterly destroyed **${finalDefenderData.guild_name}**!` : `The attacking alliance has triumphed over **${finalDefenderData.guild_name}**!`;

			const spoilsField = { name: 'Spoils of War', value: `Plunder from Vault: **${stolenFromGuild.toLocaleString()}**\nPlunder from Members: **${stolenFromMembers.toLocaleString()}**\n**Total Loot:** **${totalLoot.toLocaleString()}**\n${bountyClaimed > 0 ? `**Bounty Claimed:** **${bountyClaimed.toLocaleString()}**` : ''}\nLost During Escape (-${escapeLossPercent}%): **-${lostDuringEscape.toLocaleString()}**\n---\nThe entire net plunder of **${netLoot.toLocaleString()} Crowns** has been transferred to **${finalAttackerData.guild_name}**'s vault.` };
			const opportunistWinningsText = await processOpportunistPayouts(raidId,
			    success ? 'attacker' : 'defender',
			    success ? attackingParticipants : defendingParticipants);


			resultEmbed = new EmbedBuilder().setTitle('⚔️ VICTORY FOR THE ATTACKERS! ⚔️').setColor(0x2ECC71).setDescription(description + opportunistWinningsText).addFields(
				{ name: 'Attacker Power Calculations', value: `__Attacker Roll:__ **${attackerRoll}**\n__Attacker Modifiers:__\n${fullAttackerModifierText}`, inline: true },
				{ name: 'Guild Defence Calculations', value: `__Guild AC:__ **${defenderBasePower}**\n__Defender Modifiers:__\n${fullDefenderModifierText}`, inline: true },
				{ name: 'Overall Scores:', value: `Final Attacking Power: 💥 **${finalAttackPower}**\nFinal Defending Resistance: 🛡️ **${finalDefensePower}**`, inline: false },
				{ name: '⚔️ Attackers', value: attackerParticipantList, inline: true }, { name: '🛡️ Defenders', value: defenderParticipantList, inline: true }, spoilsField,
			);
			announceEmbed = new EmbedBuilder().setTitle('⚔️ War Report: Attackers Win! ⚔️').setColor(0x2ECC71).setDescription(description).addFields(
				{ name: '⚔️ Victorious Alliance', value: attackerParticipantList }, { name: '🛡️ Defeated Coalition', value: defenderParticipantList },
				{ name: 'Final Scores:', value: `\`[${attackerTag}]\` Total Power: 💥 **${finalAttackPower}** (Rolled \`${attackerRoll}\` + \`${finalAttackPower - attackerRoll}\`)\n\`[${defenderTag}]\` Overall Resistance: 🛡️ **${finalDefensePower}** (AC of \`${defenderBasePower}\` + \`${finalDefensePower - defenderBasePower}\` bonus)` },
			).setTimestamp();
		}
		else {
			finalDescription = replacePlaceholders(defenderMsgs.defending_success || DEFAULT_RAID_MESSAGES.defending_success) + '\n\n' + replacePlaceholders(attackerMsgs.raiding_retreat || DEFAULT_RAID_MESSAGES.raiding_retreat);
			await warMessage.channel.send({ embeds: [new EmbedBuilder().setColor(0x27AE60).setDescription(finalDescription).setTitle('🛡️📜 Final Battle Outcome: Defenders Reign Supreme! ✨🏰').setFooter({ text: `⚔️ [${attackerTag}] vs. 🛡️ [${defenderTag}]` }).setTimestamp()] });
			await wait(5000);

			defenderGain = Math.floor(raidCost * 0.5);
			db.prepare('UPDATE guild_economy SET balance = balance + ? WHERE guild_tag = ?').run(defenderGain, defenderTag);

			const defenderMembers = db.prepare('SELECT user_id FROM guildmember_tracking WHERE guild_tag = ?').all(defenderTag);
			const defenderGuild = await interaction.client.guilds.fetch(interaction.guild.id);
			const raidDefenderRole = await defenderGuild.roles.fetch(RAID_DEFENDER_ROLE_ID);
			if (raidDefenderRole) {
				for (const dMember of defenderMembers) {
					try {
						const member = await defenderGuild.members.fetch(dMember.user_id);
						if (member) {
							await member.roles.add(raidDefenderRole);
							await updateMultiplier(member.id, defenderGuild);
							await scheduleRoleRemoval(interaction.client, member.id, defenderGuild.id, RAID_DEFENDER_ROLE_ID, DEFENDER_ROLE_DURATION_MS);
							await wait(500);
						}
					}
					catch (err) { console.error(`[Raid Resolution] Failed to award defender role to user ${dMember.user_id}:`, err); }
				}
			}

			const description = `The defending coalition has repelled the invaders led by **${finalAttackerData.guild_name}**!`;
			const compensationField = { name: 'Defender\'s Compensation', value: `Attacker's War Declaration Cost: **${raidCost.toLocaleString()}**\nCompensation Awarded (50%): **${defenderGain.toLocaleString()}**\n---\nThe entire compensation has been transferred to **${finalDefenderData.guild_name}**'s vault.` };
			const opportunistWinningsText = await processOpportunistPayouts(raidId,
			    success ? 'attacker' : 'defender',
			    success ? attackingParticipants : defendingParticipants);

			resultEmbed = new EmbedBuilder().setTitle('🛡️ VICTORY FOR THE DEFENDERS! 🛡️').setColor(0x3498DB).setDescription(description + opportunistWinningsText).addFields(
				{ name: 'Attacker Power Calculations', value: `__Attacker Roll:__ **${attackerRoll}**\n__Attacker Modifiers:__\n${fullAttackerModifierText}`, inline: true },
				{ name: 'Guild Defence Calculations', value: `__Guild AC:__ **${defenderBasePower}**\n__Defender Modifiers:__\n${fullDefenderModifierText}`, inline: true },
				{ name: 'Overall Scores:', value: `Final Attacking Power: 💥 **${finalAttackPower}**\nFinal Defending Resistance: 🛡️ **${finalDefensePower}**`, inline: false },
				{ name: '⚔️ Attackers', value: attackerParticipantList, inline: true }, { name: '🛡️ Defenders', value: defenderParticipantList, inline: true }, compensationField,
			);
			announceEmbed = new EmbedBuilder().setTitle('🛡️ War Report: Defenders Win! ⚔️').setColor(0x3498DB).setDescription(description).addFields(
				{ name: '🛡️ Victorious Coalition', value: defenderParticipantList }, { name: '⚔️ Defeated Alliance', value: attackerParticipantList },
				{ name: 'Final Scores:', value: `\`[${attackerTag}]\` Total Power: 💥 **${finalAttackPower}** (Rolled \`${attackerRoll}\` + \`${finalAttackPower - attackerRoll}\`)\n\`[${defenderTag}]\` Overall Resistance: 🛡️ **${finalDefensePower}** (AC of \`${defenderBasePower}\` + \`${finalDefensePower - defenderBasePower}\` bonus)` },
			).setTimestamp();
		}

		const allParticipantRoles = allParticipants.map(p => `<@&${p.role_id}>`).join(' ');
		await warMessage.channel.send({ content: allParticipantRoles, embeds: [resultEmbed] });

		db.prepare('UPDATE raid_history SET success = ?, stolen_amount = ?, attacker_roll = ?, defender_ac = ?, attacker_allies = ?, defender_allies = ? WHERE id = ?').run(success ? 1 : 0, success ? netLoot : defenderGain, finalAttackPower, defenderBasePower, attackingParticipants.map(a => a.allied_guild_tag).join(','), defendingParticipants.map(a => a.allied_guild_tag).join(','), raidId);
		const shieldExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
		db.prepare('INSERT INTO raid_cooldowns (guild_tag, shield_expiry) VALUES (?, ?) ON CONFLICT(guild_tag) DO UPDATE SET shield_expiry = ?').run(defenderTag, shieldExpiry, shieldExpiry);

		// Store the time of the raid correctly
		db.prepare('INSERT INTO raid_cooldowns (guild_tag, last_raid_time) VALUES (?, ?) ON CONFLICT(guild_tag) DO UPDATE SET last_raid_time = ?').run(attackerTag, now.toISOString(), now.toISOString());

		await sendGuildAnnouncement(interaction.client, announceEmbed);

	}
	catch (error) {
		console.error(`[FATAL] Error during raid resolution for raid ID ${raidId}:`, error.stack);
		const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('⚔️ War Report: Indeterminate Outcome ⚔️').setDescription('A critical error occurred while resolving the battle. The raid has been cancelled, and the Innkeepers have been notified. No costs were consumed and no cooldowns were applied.');
		db.prepare('UPDATE raid_history SET success = 0 WHERE id = ?').run(raidId);
		db.prepare('UPDATE raid_cooldowns SET is_under_raid = 0 WHERE guild_tag = ?').run(defenderTag);
		db.prepare('DELETE FROM active_raid_allies WHERE raid_id = ?').run(raidId);
		await warMessage.channel.send({ embeds: [errorEmbed], components: [] });
	}
	finally {
		console.log(`[Raid Resolution] Cleaning up state for raid ID ${raidId}.`);
		db.prepare('UPDATE raid_cooldowns SET is_under_raid = 0 WHERE guild_tag = ?').run(defenderTag);
		db.prepare('DELETE FROM active_raid_allies WHERE raid_id = ?').run(raidId);
	}
}
/**
 * Distributes opportunist winnings to victorious opportunist guilds.
 * Splits 2x wager_pot evenly among winners and zeroes the pot atomically.
 * @param {number} raidId
 * @param {'attacker'|'defender'} participantsSide
 * @param {Array<{ allied_guild_tag: string }>} participants
 * @returns {Promise<string>}
 */
async function processOpportunistPayouts(raidId, participantsSide, participants) {
	let opportunistWinningsText = '';
	const raidPot = db
		.prepare('SELECT wager_pot FROM raid_history WHERE id = ?')
		.get(raidId)?.wager_pot || 0;

	if (raidPot > 0) {
		const opportunistWinners = participants.filter(p =>
			db.prepare('SELECT attitude FROM guild_list WHERE guild_tag = ?')
				.get(p.allied_guild_tag)?.attitude === 'Opportunist',
		);

		if (opportunistWinners.length > 0) {
			const individualWinnings = Math.floor((raidPot * 2) / opportunistWinners.length);
			const successfulPayouts = [];
			const failedPayouts = [];

			try {
				db.transaction(() => {
					for (const winner of opportunistWinners) {
						const result = db.prepare('UPDATE guild_economy SET balance = balance + ? WHERE guild_tag = ?')
							.run(individualWinnings, winner.allied_guild_tag);

						if (result.changes === 0) {
							failedPayouts.push(winner.allied_guild_tag);
						}
						else {
							successfulPayouts.push(winner.allied_guild_tag);
						}
					}

					// If *all* payouts failed, roll back entirely
					if (failedPayouts.length === opportunistWinners.length) {
						throw new Error('All opportunist payouts failed');
					}
					// Clear the pot after successful (full or partial) distribution
					db.prepare('UPDATE raid_history SET wager_pot = 0 WHERE id = ?').run(raidId);
				})();

				// Build the success message
				if (successfulPayouts.length > 0) {
					opportunistWinningsText = `\n\n**Opportunist Wagers Won:**\n**${successfulPayouts.length}** winning opportunists claimed **${individualWinnings.toLocaleString()}** Crowns each!`;
				}
				if (failedPayouts.length > 0) {
					opportunistWinningsText += `\n*Note: ${failedPayouts.length} guild(s) could not receive payouts (they may have been deleted).*`;
				}
			}
			catch (error) {
				console.error(
					'[RAID RESOLUTION] CRITICAL: Failed to distribute all opportunist winnings. Transaction rolled back.',
					error,
				);
				opportunistWinningsText =
					'\n\n**Opportunist Wagers:** Payout failed due to an error. Wagers have been lost to the chaos of war.';
			}
		}
	}

	return opportunistWinningsText;
}

/**
 * Routes /guild diplomacy subcommands to specific handlers.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {'offer'|'declare_enemy'|'withdraw'|'break'|'view'} action
 * @returns {Promise<void>}
 */
async function handleDiplomacy(interaction, action) {
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Diplomacy Failed');

	const guildData = db.prepare(`
        SELECT gl.guild_tag, gl.guild_name
        FROM guildmember_tracking gmt
        JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
        WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
    `).get(userId);

	if (!guildData) {
		errorEmbed.setDescription('You must be a Guildmaster or Vice-GM to manage diplomacy.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	if (action === 'view') {
		return handleViewRelationships(interaction, guildData);
	}

	const targetTag = interaction.options.getString('guild_tag').toUpperCase();

	if (!/^[A-Z]{3}$/.test(targetTag)) {
		errorEmbed.setDescription('Guild tag must be exactly 3 uppercase letters!');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	if (targetTag === guildData.guild_tag) {
		errorEmbed.setDescription('You cannot perform diplomatic actions with your own guild.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
	const targetGuild = db.prepare('SELECT guild_name FROM guild_list WHERE guild_tag = ?').get(targetTag);
	if (!targetGuild) {
		errorEmbed.setDescription(`No guild found with the tag [${targetTag}].`);
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	switch (action) {
	case 'offer':
		return handleDiplomacyOffer(interaction, guildData, targetGuild, targetTag);
	case 'break':
		return handleBreak(interaction, guildData, targetGuild, targetTag);
	case 'declare_enemy':
		return handleDeclareEnemy(interaction, guildData, targetGuild, targetTag);
	case 'withdraw':
		return handleWithdraw(interaction, guildData, targetGuild, targetTag);
	}
}

async function handleViewRelationships(interaction, guildData) {
	const relationships = db.prepare(`
		SELECT * FROM guild_relationships 
		WHERE (guild_one_tag = ? OR guild_two_tag = ?)
		AND (status != 'truce' OR expires_at > datetime('now'))
	`).all(guildData.guild_tag, guildData.guild_tag);

	const embed = new EmbedBuilder()
		.setColor(0x95A5A6)
		.setTitle(`📜 Diplomatic Status for ${guildData.guild_name}`)
		.setDescription('Here are all of your current formal relationships.');

	const alliances = relationships.filter(r => r.status === 'alliance');
	const enemies = relationships.filter(r => r.status === 'enemy');
	const truces = relationships.filter(r => r.status === 'truce');

	embed.addFields(
		{ name: '🤝 Alliances', value: alliances.length > 0 ? alliances.map(r => `• [${r.guild_one_tag === guildData.guild_tag ? r.guild_two_tag : r.guild_one_tag}]`).join('\n') : '*None*', inline: true },
		{ name: '⚔️ Enemies', value: enemies.length > 0 ? enemies.map(r => `• [${r.guild_one_tag === guildData.guild_tag ? r.guild_two_tag : r.guild_one_tag}] (Declared by ${r.initiator_tag === guildData.guild_tag ? 'You' : 'Them'})`).join('\n') : '*None*', inline: true },
		{ name: '🕊️ Truces', value: truces.length > 0 ? truces.map(r => `• [${r.guild_one_tag === guildData.guild_tag ? r.guild_two_tag : r.guild_one_tag}] (Expires <t:${Math.floor(new Date(r.expires_at).getTime() / 1000)}:R>)`).join('\n') : '*None*', inline: true },
	);

	await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleDiplomacyOffer(interaction, guildData, targetGuild, targetTag) {
	const type = interaction.options.getString('type');
	const durationDays = interaction.options.getInteger('duration_days');

	if (type === 'truce' && (!durationDays || durationDays <= 0)) {
		return interaction.reply({ content: 'You must provide a positive duration in days for a truce.', flags: MessageFlags.Ephemeral });
	}

	const tags = [guildData.guild_tag, targetTag].sort();
	const existing = db.prepare(`
		SELECT * FROM guild_relationships 
		WHERE guild_one_tag = ? AND guild_two_tag = ? 
		AND (status != 'truce' OR expires_at > datetime('now'))
	`).get(tags[0], tags[1]);

	if (existing) {
		return interaction.reply({ content: `You already have a diplomatic relationship (${existing.status}) with this guild.`, flags: MessageFlags.Ephemeral });
	}

	const targetGuildData = db.prepare('SELECT channel_id FROM guild_list WHERE guild_tag = ?').get(targetTag);
	if (!targetGuildData?.channel_id) {
		return interaction.reply({ content: 'Cannot send offer: Target guild\'s private channel not found.', flags: MessageFlags.Ephemeral });
	}

	try {
		const targetChannel = await interaction.client.channels.fetch(targetGuildData.channel_id);
		const offerId = `${type}_${guildData.guild_tag}_${targetTag}_${durationDays || 0}`;

		const embed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setTitle(`Incoming Diplomatic Offer from ${guildData.guild_name}`)
			.setDescription(`${interaction.user} has offered a **${type.toUpperCase()}** to your guild.`);

		if (type === 'truce') {
			embed.addFields({ name: 'Duration', value: `${durationDays} days` });
		}

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`guild_diplomacy_accept_${offerId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`guild_diplomacy_decline_${offerId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
		);

		await targetChannel.send({ embeds: [embed], components: [row] });
		await interaction.reply({ content: `Your ${type} offer has been sent to [${targetTag}].`, flags: MessageFlags.Ephemeral });
	}
	catch (error) {
		console.error('Diplomacy offer error:', error);
		await interaction.reply({ content: 'Failed to send the offer. The target guild\'s channel may be inaccessible.', flags: MessageFlags.Ephemeral });
	}
}

async function handleDeclareEnemy(interaction, guildData, targetGuild, targetTag) {
	const targetAttitude = db.prepare('SELECT attitude FROM guild_list WHERE guild_tag = ?').get(targetTag)?.attitude;
	if (targetAttitude === 'Neutral') {
		return interaction.reply({ content: `You cannot declare war on **${targetGuild.guild_name}**. As a Neutral guild, they are exempt from being declared enemies.`, flags: MessageFlags.Ephemeral });
	}
	const tags = [guildData.guild_tag, targetTag].sort();

	const cooldown = db.prepare('SELECT * FROM diplomacy_cooldowns WHERE guild_one_tag = ? AND guild_two_tag = ? AND cooldown_type = ?').get(tags[0], tags[1], 'enemy_declaration');
	if (cooldown && new Date(cooldown.expires_at) > new Date()) {
		return interaction.reply({ content: `You cannot declare this guild as an enemy again so soon. The cooldown ends <t:${Math.floor(new Date(cooldown.expires_at).getTime() / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
	}

	const existing = db.prepare('SELECT * FROM guild_relationships WHERE guild_one_tag = ? AND guild_two_tag = ?').get(tags[0], tags[1]);
	if (existing) {
		return interaction.reply({ content: `You cannot declare an enemy while another relationship (${existing.status}) is active.`, flags: MessageFlags.Ephemeral });
	}
	db.transaction(() => {
		db.prepare('INSERT INTO guild_relationships (guild_one_tag, guild_two_tag, status, initiator_tag) VALUES (?, ?, ?, ?)')
			.run(tags[0], tags[1], 'enemy', guildData.guild_tag);
	})();

	// Notify target guild
	const targetGuildData = db.prepare('SELECT channel_id FROM guild_list WHERE guild_tag = ?').get(targetTag);
	if (targetGuildData?.channel_id) {
		const notifyEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('Hostile Declaration!').setDescription(`**${guildData.guild_name} [${guildData.guild_tag}]** has officially declared your guild as their ENEMY!`);
		const targetChannel = await interaction.client.channels.fetch(targetGuildData.channel_id).catch(() => null);
		if (targetChannel) await targetChannel.send({ embeds: [notifyEmbed] });
	}
	// Red for enemy
	const announceEmbed = new EmbedBuilder()
		.setColor(0xE74C3C)
		.setTitle('⚔️ A Rivalry is Born! ⚔️')
		.setDescription(`Hostilities have been declared! **${guildData.guild_name} [${guildData.guild_tag}]** has officially named **${targetGuild.guild_name} [${targetTag}]** as their enemy.`)
		.setTimestamp();

	await sendGuildAnnouncement(interaction.client, announceEmbed);
	await interaction.reply({ content: `You have successfully declared **${targetGuild.guild_name} [${targetTag}]** as your enemy.`, flags: MessageFlags.Ephemeral });
}

async function handleWithdraw(interaction, guildData, targetGuild, targetTag) {
	const tags = [guildData.guild_tag, targetTag].sort();
	const relationship = db.prepare('SELECT * FROM guild_relationships WHERE guild_one_tag = ? AND guild_two_tag = ?').get(tags[0], tags[1]);

	if (!relationship) {
		return interaction.reply({ content: 'You have no active relationship with this guild to withdraw from.', flags: MessageFlags.Ephemeral });
	}
	if (relationship.initiator_tag !== guildData.guild_tag) {
		return interaction.reply({ content: 'You cannot withdraw from this relationship as you were not the initiator.', flags: MessageFlags.Ephemeral });
	}

	db.prepare('DELETE FROM guild_relationships WHERE id = ?').run(relationship.id);

	let message = `You have withdrawn your **${relationship.status}** with **${targetGuild.guild_name}**.`;

	if (relationship.status === 'enemy') {
		const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
		db.prepare('INSERT INTO diplomacy_cooldowns (guild_one_tag, guild_two_tag, cooldown_type, expires_at) VALUES (?, ?, ?, ?)')
			.run(tags[0], tags[1], 'enemy_declaration', expires.toISOString());
		message += ' You cannot declare them as an enemy again for 7 days.';
	}

	// Notify target guild
	const targetGuildData = db.prepare('SELECT channel_id FROM guild_list WHERE guild_tag = ?').get(targetTag);
	if (targetGuildData?.channel_id) {
		const notifyEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('Diplomatic Update').setDescription(`**${guildData.guild_name} [${guildData.guild_tag}]** has withdrawn their **${relationship.status}** with your guild. They now regard you as neutral.`);
		const targetChannel = await interaction.client.channels.fetch(targetGuildData.channel_id).catch(() => null);
		if (targetChannel) await targetChannel.send({ embeds: [notifyEmbed] });
	}
	 // A calm blue to signify peace
	 const announceEmbed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle('🕊️ Hostilities Have Ceased! 🕊️')
		.setDescription(`Peace has been restored. **${guildData.guild_name} [${guildData.guild_tag}]** has withdrawn their enemy declaration against **${targetGuild.guild_name} [${targetTag}]**. The two guilds are now neutral.`)
		.setTimestamp();

	await sendGuildAnnouncement(interaction.client, announceEmbed);
	await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

async function handleBreak(interaction, guildData, targetGuild, targetTag) {
	const tags = [guildData.guild_tag, targetTag].sort();
	const relationship = db.prepare('SELECT * FROM guild_relationships WHERE guild_one_tag = ? AND guild_two_tag = ?').get(tags[0], tags[1]);

	if (!relationship || relationship.status !== 'alliance') {
		return interaction.reply({ content: 'You do not have an alliance with this guild to break.', flags: MessageFlags.Ephemeral });
	}

	// Delete the alliance and set the 24h cooldown
	db.transaction(() => {
		db.prepare('DELETE FROM guild_relationships WHERE id = ?').run(relationship.id);
		const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
		db.prepare('INSERT INTO diplomacy_cooldowns (guild_one_tag, guild_two_tag, cooldown_type, expires_at) VALUES (?, ?, ?, ?)')
			.run(tags[0], tags[1], 'alliance_break', expires.toISOString());
	})();

	// Notify target guild
	const targetGuildData = db.prepare('SELECT channel_id FROM guild_list WHERE guild_tag = ?').get(targetTag);
	if (targetGuildData?.channel_id) {
		const notifyEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('Alliance Broken!').setDescription(`**${guildData.guild_name} [${guildData.guild_tag}]** has officially broken their alliance with your guild! A 24-hour non-aggression pact is now in effect.`);
		const targetChannel = await interaction.client.channels.fetch(targetGuildData.channel_id).catch(() => null);
		if (targetChannel) await targetChannel.send({ embeds: [notifyEmbed] });
	}
	// Grey for neutral/broken
	const announceEmbed = new EmbedBuilder()
		.setColor(0x95A5A6)
		.setTitle('🛡️ An Alliance has Shattered! 🛡️')
		.setDescription(`The pact is broken! **${guildData.guild_name} [${guildData.guild_tag}]** has formally broken their alliance with **${targetGuild.guild_name} [${targetTag}]**.`)
		.setTimestamp();

	await sendGuildAnnouncement(interaction.client, announceEmbed);

	await interaction.reply({ content: `You have broken your alliance with **${targetGuild.guild_name}**. Neither guild may attack the other for 24 hours.`, flags: MessageFlags.Ephemeral });
}

module.exports = {
	category: 'utility',
	buttons: {
		handleGuildInfoButton,
		async handleDiplomacyResponse(interaction) {
			const parts = interaction.customId.split('_');
			// accept or decline
			const action = parts[2];
			const type = parts[3];
			const initiatorTag = parts[4];
			const targetTag = parts[5];
			const durationDays = parseInt(parts[6]);

			const userGuild = db.prepare('SELECT gmt.guild_tag, gl.guild_name FROM guildmember_tracking gmt JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)').get(interaction.user.id);

			if (!userGuild || userGuild.guild_tag !== targetTag) {
				return interaction.reply({ content: 'You are not a leader of the guild this offer was sent to.', flags: MessageFlags.Ephemeral });
			}

			const initiatorGuild = db.prepare('SELECT guild_name FROM guild_list WHERE guild_tag = ?').get(initiatorTag);

			if (action === 'decline') {
				await interaction.update({ content: `The offer of ${type} from **${initiatorGuild.guild_name}** has been declined.`, embeds: [], components: [] });
				return;
			}

			// On Accept
			const tags = [initiatorTag, targetTag].sort();
			const existing = db.prepare('SELECT 1 FROM guild_relationships WHERE guild_one_tag = ? AND guild_two_tag = ?').get(tags[0], tags[1]);
			if (existing) {
				await interaction.update({ content: 'A relationship has already been formed with this guild since the offer was sent.', embeds: [], components: [] });
				return;
			}

			let expires_at = null;
			if (type === 'truce') {
				if (!Number.isFinite(durationDays) || durationDays <= 0) {
					return interaction.update({ content: 'Truce duration is invalid or missing; offer expired.', embeds: [], components: [] });
				}
				expires_at = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
			}
			db.transaction(() => {
				db.prepare('INSERT INTO guild_relationships (guild_one_tag, guild_two_tag, status, initiator_tag, expires_at) VALUES (?, ?, ?, ?, ?)')
					.run(tags[0], tags[1], type, initiatorTag, expires_at);
			})();
			const announceEmbed = new EmbedBuilder()
				.setTimestamp();

			if (type === 'alliance') {
				// Blue for alliance
				announceEmbed
					.setColor(0x3498DB)
					.setTitle('🤝 A New Alliance is Forged! 🤝')
					.setDescription(`**${initiatorGuild.guild_name} [${initiatorTag}]** and **${userGuild.guild_name} [${targetTag}]** have formally entered into an alliance!`);
			}
			 // Truce
			else {
				const expiryTimestamp = Math.floor(new Date(expires_at).getTime() / 1000);
				 // Green for truce
				announceEmbed
					.setColor(0x2ECC71)
					.setTitle('🕊️ A Truce has been Declared! 🕊️')
					.setDescription(`**${initiatorGuild.guild_name} [${initiatorTag}]** and **${userGuild.guild_name} [${targetTag}]** have agreed to a temporary truce.`)
					.addFields({ name: 'Truce Expires', value: `<t:${expiryTimestamp}:R>` });
			}

			await sendGuildAnnouncement(interaction.client, announceEmbed);

			await interaction.update({ content: `You have accepted the ${type} from **${initiatorGuild.guild_name}**! Your guilds are now formally linked.`, embeds: [], components: [] });
		},
		async handleRaidMessageButton(interaction) {
			const closedEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription('Raid message editor closed.');
			if (interaction.customId === 'raidmsg_close_editor') {
				try {
					return await interaction.update({
						embeds: [closedEmbed],
						components: [],
					});
				}
				catch (error) {
					console.log(error);
					return await interaction.editReply({
						embeds: [closedEmbed],
						components: [],
					});

				}
			}


			const parts = interaction.customId.split('_');
			const action = parts[1];
			const guildTag = parts[2];
			const userId = interaction.user.id;

			// Verify user is owner/vice-gm of the guild
			const guildData = db.prepare(`
                SELECT gl.*
                FROM guildmember_tracking gmt
                JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
                WHERE gmt.user_id = ? AND gl.guild_tag = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
            `).get(userId, guildTag);

			if (!guildData) {
				const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setDescription('This is not for you.');
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}

			switch (action) {
			case 'guided':
				await processGuidedSetup(interaction, guildData);
				break;
			case 'viewall':
				await showAllRaidMessages(interaction, guildData);
				break;
			case 'edit': {
				const keyToEdit = parts.slice(3).join('_');
				await processSingleMessage(interaction, guildData, keyToEdit);
				break;
			}
			case 'restore':
			{ const confirmEmbed = new EmbedBuilder()
				.setColor(0xFEE75C)
				.setTitle('⚠️ Restore All Raid Messages?')
				.setDescription('Are you sure you want to restore **all** raid messages to their original defaults? This action cannot be undone.');
			const confirmRow = new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`raidmsg_restore-confirm_${guildTag}`).setLabel('Yes, Restore Them').setStyle(ButtonStyle.Danger),
				new ButtonBuilder().setCustomId(`raidmsg_back_${guildTag}`).setLabel('No, Go Back').setStyle(ButtonStyle.Secondary),
			);
			await interaction.update({ embeds: [confirmEmbed], components: [confirmRow] });
			break; }
			case 'restore-confirm':
			// This simply deletes the row. The next time it's accessed, it will be auto-created with defaults.
			{ db.prepare('DELETE FROM guild_raid_messages WHERE guild_tag = ?').run(guildTag);
				const restoredEmbed = new EmbedBuilder().setColor(0x2ECC71).setDescription('✅ All raid messages have been restored to their defaults.');
				await interaction.update({ embeds: [restoredEmbed], components: [] });
				await new Promise(resolve => setTimeout(resolve, 3000));
				await showAllRaidMessages(interaction, guildData);
				break; }
			case 'back':
				await showAllRaidMessages(interaction, guildData);
				break;
			case 'close':
				await interaction.update({ embeds: [closedEmbed], components: [] });
				break;
			}
		},
		async handleFundraiseButton(interaction) {
			const parts = interaction.customId.split('_');
			const action = parts[1];
			const fundraiserId = parts[2];
			const amount = parts[3] || 0;
			const userId = interaction.user.id;
			const errorEmbed = new EmbedBuilder().setColor(0xE74C3C);

			// Handle cancellation logic first
			if (action === 'cancel') {
				// Get fundraiser info
				const fundraiser = db.prepare('SELECT * FROM guild_fundraisers WHERE message_id = ?').get(fundraiserId);
				if (!fundraiser) {
					errorEmbed.setTitle('🚫 Fundraiser Not Found').setDescription('This fundraiser no longer exists!');
					return interaction.update({
						embeds: [errorEmbed],
						components: [],
					});
				}

				// Check if user is the creator
				if (interaction.user.id !== fundraiser.creator_id) {
					errorEmbed.setTitle('❌ Not Allowed').setDescription('Only the user who started the fundraiser can cancel it.');
					return interaction.reply({
						embeds: [errorEmbed],
						flags: MessageFlags.Ephemeral,
					});
				}

				// Get all contributors
				const contributors = db.prepare('SELECT * FROM fundraiser_contributions WHERE fundraiser_id = ?').all(fundraiserId);

				try {
					if (contributors.length > 0) {
						// Refund all contributions in a transaction
						const refundTx = db.transaction(() => {
							for (const contribution of contributors) {
								db.prepare(`
									INSERT INTO user_economy (user_id, crowns)
									VALUES (?, ?)
									ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?
								`).run(contribution.user_id, contribution.amount, contribution.amount);
							}
							// Delete contributions and fundraiser records
							db.prepare('DELETE FROM fundraiser_contributions WHERE fundraiser_id = ?').run(fundraiserId);
							db.prepare('DELETE FROM guild_fundraisers WHERE message_id = ?').run(fundraiserId);
						});
						refundTx();
					}
					else {
						// No contributions, just delete the fundraiser
						db.prepare('DELETE FROM guild_fundraisers WHERE message_id = ?').run(fundraiserId);
					}

					// Update the original message to show cancellation
					const originalEmbed = interaction.message.embeds[0];
					const cancelledEmbed = new EmbedBuilder(originalEmbed.data)
						.setTitle(`🚫 CANCELLED: ${originalEmbed.title}`)
						.setDescription(`This fundraiser was cancelled by the creator. ${contributors.length > 0 ? `A total of ${fundraiser.current_amount.toLocaleString()} Crowns have been refunded to all contributors.` : 'No contributions were made.'}`)
						.setColor(0xE74C3C)
						.setFields([]);

					const disabledRow = new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId('fundraise_cancelled')
							.setLabel('Fundraiser Cancelled')
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(true),
					);

					await interaction.update({ embeds: [cancelledEmbed], components: [disabledRow] });

				}
				catch (error) {
					console.error('Fundraiser cancellation error:', error);
					errorEmbed.setTitle('❌ Cancellation Error').setDescription('An error occurred while cancelling the fundraiser.');
					return interaction.reply({
						embeds: [errorEmbed],
						flags: MessageFlags.Ephemeral,
					});
				}
				return;
			}

			// Get fundraiser info
			const fundraiser = db.prepare(`
				SELECT gf.*, gl.guild_name 
				FROM guild_fundraisers gf
				JOIN guild_list gl ON gf.guild_tag = gl.guild_tag
				WHERE gf.message_id = ?
			`).get(fundraiserId);

			if (!fundraiser || fundraiser.completed) {
				errorEmbed.setTitle('🚫 Fundraiser Not Found').setDescription('This fundraiser no longer exists or has already been completed!');
				return interaction.update({
					embeds: [errorEmbed],
					components: [],
				});
			}

			// Check if user is in the guild
			const isMember = db.prepare(`
				SELECT 1 FROM guildmember_tracking 
				WHERE user_id = ? AND guild_tag = ?
			`).get(userId, fundraiser.guild_tag);

			if (!isMember) {
				errorEmbed.setTitle('❌ Not a Member').setDescription('Only guild members can contribute to this fundraiser!');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}

			// Get user balance
			const userBalance = db.prepare(`
				SELECT crowns FROM user_economy WHERE user_id = ?
			`).get(userId)?.crowns || 0;

			try {
				let contributionAmount = 0;

				if (action === 'paywhatyoucan') {
					contributionAmount = userBalance;
				}
				else if (action === 'share') {
					contributionAmount = parseInt(amount);
				}
				else if (action === 'max') {
					const remaining = fundraiser.target_amount - fundraiser.current_amount;
					contributionAmount = Math.min(remaining, userBalance);
				}
				else if (action === 'custom') {
					if (amount >= 1) {
						contributionAmount = parseInt(amount);
					}
					else {
						// Handle custom amount with a modal or follow-up message
						await interaction.showModal(
							new ModalBuilder()
								.setCustomId(`fundraise_custommodal_${fundraiser.message_id}`)
								.setTitle('Custom Contribution')
								.addComponents(
									new ActionRowBuilder().addComponents(
										new TextInputBuilder()
											.setCustomId('amount')
											.setLabel(`Amount (You have ${userBalance} crowns)`)
											.setStyle(1)
											.setMinLength(1)
											.setMaxLength(fundraiser.target_amount.toString().length + 2)
											.setPlaceholder('Enter amount to contribute')
											.setRequired(true),
									),
								),
						);
						return;
					}

				}

				const upperLimit = fundraiser.target_amount - fundraiser.current_amount;

				// Validate amount
				if (contributionAmount <= 0) {
					errorEmbed.setTitle('❌ Invalid Amount').setDescription('You cannot contribute 0 or negative crowns!');
					return interaction.reply({
						embeds: [errorEmbed],
						flags: MessageFlags.Ephemeral,
					});
				}

				if (contributionAmount > userBalance) {
					errorEmbed.setTitle('❌ Insufficient Funds').setDescription(`You only have **${userBalance.toLocaleString()}** crowns!`);
					return interaction.reply({
						embeds: [errorEmbed],
						flags: MessageFlags.Ephemeral,
					});
				}
				if (contributionAmount > upperLimit) {
					contributionAmount = upperLimit;
				}

				let isNowComplete = false;
				// Process contribution in transaction
				db.transaction(() => {
					// Deduct from user
					db.prepare(`
						INSERT INTO user_economy (user_id, crowns)
						VALUES (?, ?)
						ON CONFLICT(user_id) DO UPDATE SET crowns = crowns - ?
					`).run(userId, -contributionAmount, contributionAmount);

					// Add to fundraiser
					db.prepare(`
						UPDATE guild_fundraisers 
						SET current_amount = current_amount + ?
						WHERE message_id = ?
					`).run(contributionAmount, fundraiserId);

					// Record contribution
					db.prepare(`
						INSERT INTO fundraiser_contributions (fundraiser_id, user_id, amount)
						VALUES (?, ?, ?)
						ON CONFLICT(fundraiser_id, user_id) DO UPDATE SET amount = amount + ?
					`).run(fundraiserId, userId, contributionAmount, contributionAmount);

					// ATOMIC COMPLETION CHECK
					const completionResult = db.prepare(`
						UPDATE guild_fundraisers
						SET completed = 1
						WHERE message_id = ?
						  AND completed = 0
						  AND current_amount >= target_amount
					`).run(fundraiserId);

					if (completionResult.changes > 0) {
						isNowComplete = true;
					}
				})();


				// Get updated fundraiser info
				const updatedFundraiser = db.prepare(`
					SELECT * FROM guild_fundraisers WHERE message_id = ?
				`).get(fundraiserId);

				// Update embed
				const newEmbed = new EmbedBuilder()
					.setTitle(`🏦 ${fundraiser.guild_name} Fundraiser`)
					.setDescription(`Goal: ${fundraiser.target_amount.toLocaleString()} Crowns\n\n` +
									`Progress: ${Math.floor((updatedFundraiser.current_amount / fundraiser.target_amount) * 100)}% ` +
									`(${updatedFundraiser.current_amount.toLocaleString()}/${fundraiser.target_amount.toLocaleString()} Crowns)\n` +
									getProgressBar(updatedFundraiser.current_amount, fundraiser.target_amount))
					.addFields(
						{ name: 'Started by', value: `<@${fundraiser.creator_id}>`, inline: true },
						{ name: 'Members', value: getGuildMemberCount(fundraiser.guild_tag).toString(), inline: true },
						{ name: 'Newest Contribution', value: `${contributionAmount.toLocaleString()} Crowns, by ${interaction.user}`, inline: true },
					)
					.setColor(0x3498db)
					.setFooter({ text: 'Contribute using the buttons below' });

				await interaction.update({ embeds: [newEmbed] });

				// Check if goal reached
				if (isNowComplete) {
					// Add funds to guild
					db.prepare(`
						INSERT INTO guild_economy (guild_tag, balance)
						VALUES (?, ?)
						ON CONFLICT(guild_tag) DO UPDATE SET balance = balance + ?
					`).run(fundraiser.guild_tag, updatedFundraiser.current_amount, updatedFundraiser.current_amount);

					// Send completion message
					const completionEmbed = new EmbedBuilder()
						.setTitle('🎉 Fundraiser Goal Reached! 🎉')
						.setDescription(`**${fundraiser.guild_name}** has successfully raised **${updatedFundraiser.current_amount.toLocaleString()}** Crowns!`)
						.setColor(0x2ECC71);

					// Get top contributors
					const topContributors = db.prepare(`
						SELECT user_id, amount FROM fundraiser_contributions
						WHERE fundraiser_id = ?
						ORDER BY amount DESC
						LIMIT 3
					`).all(fundraiserId);

					if (topContributors.length > 0) {
						completionEmbed.addFields({
							name: 'Top Contributors',
							value: topContributors.map((c, i) =>
								`${i + 1}. <@${c.user_id}> - ${c.amount.toLocaleString()} Crowns`,
							).join('\n'),
						});
					}

					await interaction.followUp({ embeds: [completionEmbed] });

					// Disable buttons
					const disabledRow = new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId('fundraise_completed')
							.setLabel('Goal Reached!')
							.setStyle(ButtonStyle.Success)
							.setDisabled(true),
						new ButtonBuilder()
							.setCustomId('fundraise_completed2')
							.setLabel('Thank You!')
							.setStyle(ButtonStyle.Success)
							.setDisabled(true),
					);

					await interaction.editReply({ components: [disabledRow] });
				}
			}
			catch (error) {
				console.error('Fundraiser contribution error:', error);
				errorEmbed.setTitle('❌ Contribution Error').setDescription('An error occurred while processing your contribution.');
				await interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}
		},
		async handleFundraiseCustomModal(interaction) {
			const [,, fundraiserId] = interaction.customId.split('_');
			const amount = parseInt(interaction.fields.getTextInputValue('amount'));
			const userId = interaction.user.id;
			const errorEmbed = new EmbedBuilder().setColor(0xE74C3C);

			if (isNaN(amount) || amount <= 0) {
				errorEmbed.setTitle('❌ Invalid Amount').setDescription('Please enter a valid positive number!');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}

			// Get user balance
			const userBalance = db.prepare(`
            SELECT crowns FROM user_economy WHERE user_id = ?
        `).get(userId)?.crowns || 0;

			if (amount > userBalance) {
				errorEmbed.setTitle('❌ Insufficient Funds').setDescription(`You only have **${userBalance.toLocaleString()}** crowns!`);
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}

			// Process the custom amount using the same logic as other contributions
			interaction.customId = `fundraise_custom_${fundraiserId}_${amount}`;
			return this.handleFundraiseButton(interaction);
		},
		async handleShieldConfirmation(interaction) {
			const [,, guildTag] = interaction.customId.split('_');
			const userId = interaction.user.id;

			// Verify user is still guild owner
			const isOwner = db.prepare(`
        SELECT 1 FROM guildmember_tracking 
        WHERE user_id = ? AND guild_tag = ? AND (owner = 1 OR vice_gm = 1)
    `).get(userId, guildTag);

			if (!isOwner) {
				const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setDescription('Only the guild owner or vice-gm can confirm shield purchases!');
				return interaction.update({
					embeds: [errorEmbed],
					components: [],
				});
			}

			// Get guild data
			const guildData = db.prepare(`
        SELECT COALESCE(gt.tier, 1) as tier, COALESCE(ge.balance, 0) as balance
        FROM guild_list gl
        LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag
        LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
        WHERE gl.guild_tag = ?
    `).get(guildTag);

			// Calculate shield cost and duration based on tier
			const shieldCosts = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 14000, 16000, 18000, 20000];
			const shieldDurations = [14, 12, 10, 8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1, 1];


			const cost = shieldCosts[guildData.tier - 1];
			const durationDays = shieldDurations[guildData.tier - 1];

			// Check balance again
			if ((guildData.balance || 0) < cost) {
				const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setDescription('Your guild no longer has enough crowns for this shield!');
				return interaction.update({
					embeds: [errorEmbed],
					components: [],
				});
			}
			try {

				// Deduct cost and apply shield
				const now = new Date();
				const expiry = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

				db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ?')
					.run(cost, guildTag);

				db.prepare(`
			INSERT INTO raid_cooldowns (guild_tag, shield_expiry)
			VALUES (?, ?)
			ON CONFLICT(guild_tag) DO UPDATE SET shield_expiry = ?
		`).run(guildTag, expiry.toISOString(), expiry.toISOString());

				const resultEmbed = new EmbedBuilder()
					.setTitle('🛡️ Raid Shield Purchased! 🛡️')
					.setDescription(`Your guild is now protected from raids for ${durationDays} days`)
					.addFields(
						{ name: 'Cost', value: `👑 ${cost.toLocaleString()} Crowns`, inline: true },
						{ name: 'Expires', value: `<t:${Math.floor(expiry.getTime() / 1000)}:R>`, inline: true },
					)
					.setColor(0x2ECC71);

				await interaction.update({
					embeds: [resultEmbed],
					components: [],
				});

			}
			catch (error) {
				console.error('Shield purchase error:', error);
				const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Error').setDescription('An error occurred during the shield purchase.');
				await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}
		},
		async handleAllianceJoin(interaction) {
			console.log('[ALLIANCE JOIN] Starting alliance join flow');
			const parts = interaction.customId.split('_');
			const action = `${parts[0]}_${parts[1]}`;
			const raidId = parts[2];
			const side = action === 'join_attack' ? 'attacker' : 'defender';
			const userId = interaction.user.id;

			try {
				console.log(`[ALLIANCE JOIN] Deferring reply for ${userId}`);
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });

				console.log(`[ALLIANCE JOIN] Checking guild data for ${userId}`);
				const joiningGuildData = db.prepare(`
					SELECT gmt.guild_tag, gl.guild_name, gl.attitude, COALESCE(gt.tier, 1) as tier, COALESCE(ge.balance, 0) as balance
					FROM guildmember_tracking gmt
					JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
					LEFT JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag
					LEFT JOIN guild_economy ge ON gmt.guild_tag = ge.guild_tag
					WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
				`).get(userId);

				if (!joiningGuildData) {
					console.log('[ALLIANCE JOIN] User not authorized');
					const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Not Authorized').setDescription('Only guildmasters or vice-guildmasters can join a raid on behalf of their guild.');
					return interaction.editReply({ embeds: [errorEmbed] });
				}

				const joiningGuildTag = joiningGuildData.guild_tag;
				console.log(`[ALLIANCE JOIN] Checking raid ${raidId} exists`);
				const originalRaid = db.prepare('SELECT attacker_tag, defender_tag FROM raid_history WHERE id = ? AND success = -1').get(raidId);

				if (!originalRaid) {
					console.log('[ALLIANCE JOIN] Raid expired');
					const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Raid Expired').setDescription('This call to arms has ended.');
					return interaction.editReply({ embeds: [errorEmbed] });
				}

				console.log(`[ALLIANCE JOIN] Checking if ${joiningGuildTag} already joined`);
				const isAlreadyInRaid = db.prepare('SELECT 1 FROM active_raid_allies WHERE raid_id = ? AND allied_guild_tag = ?').get(raidId, joiningGuildTag);
				if (isAlreadyInRaid) {
					console.log('[ALLIANCE JOIN] Guild already participating');
					const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Already Participating').setDescription(`Your guild, **${joiningGuildData.guild_name}**, is already part of this war.`);
					return interaction.editReply({ embeds: [errorEmbed] });
				}

				const isPrimaryAttacker = joiningGuildTag === originalRaid.attacker_tag;
				const isPrimaryDefender = joiningGuildTag === originalRaid.defender_tag;
				console.log(`[ALLIANCE JOIN] Primary attacker? ${isPrimaryAttacker}, Primary defender? ${isPrimaryDefender}`);


				let successMessage;

				if (isPrimaryAttacker || isPrimaryDefender) {

					successMessage = `Your guild has officially joined as the ${isPrimaryAttacker ? 'leading attacker' : 'primary defender'}!`;
					console.log('[ALLIANCE JOIN] Primary participant joining for free');
				}
				else {

					successMessage = `Your guild, **${joiningGuildData.guild_name}**, has joined the war as a **${side}** for FREE!`;
				}

				console.log('[ALLIANCE JOIN] Starting transaction');
				db.transaction(() => {
					console.log(`[ALLIANCE JOIN] Adding ${joiningGuildTag} to raid ${raidId} as ${side}`);
					db.prepare('INSERT INTO active_raid_allies (raid_id, allied_guild_tag, side) VALUES (?, ?, ?)').run(raidId, joiningGuildTag, side);
				})();
				console.log('[ALLIANCE JOIN] Transaction completed');

				const successEmbed = new EmbedBuilder().setColor(0x57F287).setTitle('✅ Joined the Fray!').setDescription(successMessage);
				console.log('[ALLIANCE JOIN] Sending success message');
				return interaction.editReply({ embeds: [successEmbed] });

			}
			catch (error) {
				console.error('[ALLIANCE JOIN] Critical error:', error);
				const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Error').setDescription('An unexpected error occurred while joining the raid.');
				try {
					if (interaction.replied || interaction.deferred) {
						await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
					}
					else {
						await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
					}
				}
				catch (e) {
					console.error('[ALLIANCE JOIN] Failed to send error reply:', e);
				}
			}
		},
		async handleRaidConfirmation(interaction) {
			console.log('[RAID CONFIRM] Starting raid confirmation flow');
			const [,, attackerTag, defenderTag] = interaction.customId.split('_');
			const userId = interaction.user.id;

			try {
				console.log(`[RAID CONFIRM] Checking user ${userId} guild membership`);
				const userGuild = db.prepare('SELECT guild_tag FROM guildmember_tracking WHERE user_id = ?').get(userId);

				if (!userGuild || userGuild.guild_tag !== attackerTag) {
					console.log('[RAID CONFIRM] User not in attacking guild');
					const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setDescription('Only members of the attacking guild can confirm this action!');
					return interaction.update({ embeds: [errorEmbed], components: [] });
				}

				console.log(`[RAID CONFIRM] Fetching guild data for ${attackerTag} and ${defenderTag}`);
				const attackerData = db.prepare('SELECT gl.guild_name, gl.role_id, COALESCE(gt.tier, 1) as tier, ge.balance FROM guild_list gl LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag WHERE gl.guild_tag = ?').get(attackerTag);
				const defenderData = db.prepare('SELECT gl.guild_name, gl.public_channel_id, gl.role_id, COALESCE(gt.tier, 1) as tier, ge.balance FROM guild_list gl LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag WHERE gl.guild_tag = ?').get(defenderTag);

				const raidCost = attackerData.tier * 200;
				console.log(`[RAID CONFIRM] Checking balance (needs ${raidCost}, has ${attackerData.balance || 0})`);
				if ((attackerData.balance || 0) < raidCost) {
					console.log('[RAID CONFIRM] Insufficient balance');
					const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setDescription('Your guild no longer has enough crowns to declare war!');
					return interaction.update({ embeds: [errorEmbed], components: [] });
				}

				console.log(`[RAID CONFIRM] Fetching defender channel ${defenderData.public_channel_id}`);
				const defenderChannel = await interaction.client.channels.fetch(defenderData.public_channel_id).catch(() => null);
				if (!defenderChannel || !defenderChannel.isTextBased()) {
					console.log('[RAID CONFIRM] Defender channel not found');
					const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Channel Error').setDescription('The defending guild\'s public channel could not be found. The war cannot proceed.');
					await interaction.update({ embeds: [errorEmbed], components: [] });
					return;
				}

				console.log('[RAID CONFIRM] Creating raid history entry');
				const placeholderResult = db.prepare('INSERT INTO raid_history (attacker_tag, defender_tag, timestamp, success) VALUES (?, ?, ?, -1)').run(attackerTag, defenderTag, new Date().toISOString());
				const raidId = placeholderResult.lastInsertRowid;
				console.log(`[RAID CONFIRM] Created raid ID ${raidId}`);

				console.log('[RAID CONFIRM] Starting transaction');
				db.transaction(() => {
					db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ?').run(raidCost, attackerTag);
					db.prepare('INSERT INTO raid_cooldowns (guild_tag, is_under_raid) VALUES (?, 1) ON CONFLICT(guild_tag) DO UPDATE SET is_under_raid = 1').run(defenderTag);
				})();
				console.log('[RAID CONFIRM] Transaction completed');

				const endTime = Math.floor((Date.now() + ALLIANCE_RAID_DURATION_MS) / 1000);
				console.log(`[RAID CONFIRM] War will end at ${new Date(endTime * 1000).toISOString()}`);

				const callToArmsEmbed = new EmbedBuilder()
					.setColor(0xFEE75C)
					.setTitle(`A War Horn Sounds! ${attackerData.guild_name} has declared war on ${defenderData.guild_name}!`)
					.setDescription(`The primary guilds must rally their forces by joining below! Other guilds may join as allies. The battle begins <t:${endTime}:R>.`)
					.addFields(
						{ name: '⚔️ Attacking Alliance (0)', value: 'No one yet.', inline: true },
						{ name: '🛡️ Defending Coalition (0)', value: 'No one yet.', inline: true },
					);

				const callToArmsRow = new ActionRowBuilder().addComponents(
					new ButtonBuilder().setCustomId(`join_attack_${raidId}`).setLabel('Join Attack').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
					new ButtonBuilder().setCustomId(`aid_defence_${raidId}`).setLabel('Aid Defense').setStyle(ButtonStyle.Success).setEmoji('🛡️'),
				);

				console.log('[RAID CONFIRM] Updating interaction');
				await interaction.update({ embeds: [new EmbedBuilder().setColor(0x3498DB).setDescription(`The declaration of war has been sent! Head to ${defenderChannel} to watch the events unfold!`)], components: [] });

				console.log('[RAID CONFIRM] Sending war message');
				const warMessage = await defenderChannel.send({
					content: `<@&${attackerData.role_id}> and <@&${defenderData.role_id}>, prepare for war!`,
					embeds: [callToArmsEmbed],
					components: [callToArmsRow],
				});
				console.log(`[RAID CONFIRM] War message sent with ID ${warMessage.id}`);

				try {
					await notifyAlliesAndEnemies(interaction, raidId, attackerData, defenderData);
					console.log('[RAID CONFIRM] Sent notifications to allies and enemies.');
				}
				catch (e) {
					console.error('[RAID CONFIRM] Failed to send notifications:', e);
				}

				const collector = warMessage.createMessageComponentCollector({ time: ALLIANCE_RAID_DURATION_MS });
				console.log('[RAID CONFIRM] Collector created');

				collector.on('collect', async (i) => {
					const logPrefix = `[RAID COLLECTOR | Raid ID: ${raidId} | User: ${i.user.username}]`;
					console.log(`${logPrefix} Button interaction received. Custom ID: ${i.customId}`);

					try {
						const parts = i.customId.split('_');
						const action = `${parts[0]}_${parts[1]}`;
						const collectedRaidId = parts[2];
						const side = action === 'join_attack' ? 'attacker' : 'defender';
						const buttonUser = i.user;

						console.log(`${logPrefix} Parsed Data: action=${action}, side=${side}, collectedRaidId=${collectedRaidId}`);

						await i.deferReply({ flags: MessageFlags.Ephemeral });

						console.log(`${logPrefix} Checking authorization for user ID: ${buttonUser.id}`);
						const joiningGuildData = db.prepare(`
							SELECT gmt.guild_tag, gl.guild_name, gl.attitude, COALESCE(gt.tier, 1) as tier, COALESCE(ge.balance, 0) as balance
							FROM guildmember_tracking gmt
							JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
							LEFT JOIN guild_tiers gt ON gmt.guild_tag = gt.guild_tag
							LEFT JOIN guild_economy ge ON gmt.guild_tag = ge.guild_tag
							WHERE gmt.user_id = ? AND (gmt.owner = 1 OR gmt.vice_gm = 1)
						`).get(buttonUser.id);

						if (!joiningGuildData) {
							console.log(`${logPrefix} Authorization FAILED. User is not owner or vice-gm.`);
							const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Not Authorized').setDescription('Only guildmasters or vice-guildmasters can join a raid on behalf of their guild.');
							return i.editReply({ embeds: [errorEmbed] });
						}
						console.log(`${logPrefix} Authorization SUCCEEDED. User is in guild [${joiningGuildData.guild_tag}] with tier ${joiningGuildData.tier} and balance ${joiningGuildData.balance}.`);

						const joiningGuildTag = joiningGuildData.guild_tag;

						// Prevent the attacking guild from joining the defending side and vice versa
						if ((joiningGuildTag === attackerTag && side === 'defender') || (joiningGuildTag === defenderTag && side === 'attacker')) {
							console.log(`${logPrefix} Invalid side selection for guild [${joiningGuildTag}].`);
							const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Invalid Action').setDescription('Your guild cannot join the opposing side of the war.');
							return i.editReply({ embeds: [errorEmbed] });
						}

						console.log(`${logPrefix} Verifying if the raid is still active in the database...`);
						const originalRaid = db.prepare('SELECT attacker_tag, defender_tag FROM raid_history WHERE id = ? AND success = -1').get(collectedRaidId);

						if (!originalRaid) {
							console.log(`${logPrefix} Raid check FAILED. The raid has expired or was already resolved.`);
							const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Raid Expired').setDescription('This call to arms has ended.');
							return i.editReply({ embeds: [errorEmbed] });
						}
						console.log(`${logPrefix} Raid check SUCCEEDED. Original Attacker: [${originalRaid.attacker_tag}], Original Defender: [${originalRaid.defender_tag}]`);

						console.log(`${logPrefix} Checking if guild [${joiningGuildTag}] is already in this raid...`);
						const isAlreadyInRaid = db.prepare('SELECT 1 FROM active_raid_allies WHERE raid_id = ? AND allied_guild_tag = ?').get(collectedRaidId, joiningGuildTag);
						if (isAlreadyInRaid) {
							console.log(`${logPrefix} Participation check FAILED. Guild is already in the raid.`);
							const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Already Participating').setDescription(`Your guild, **${joiningGuildData.guild_name}**, is already part of this war.`);
							return i.editReply({ embeds: [errorEmbed] });
						}
						console.log(`${logPrefix} Participation check SUCCEEDED. Guild is not yet in the raid.`);

						const isPrimaryAttacker = joiningGuildTag === originalRaid.attacker_tag;
						const isPrimaryDefender = joiningGuildTag === originalRaid.defender_tag;


						console.log(`${logPrefix} Primary Attacker: ${isPrimaryAttacker}, Primary Defender: ${isPrimaryDefender}`);
						let successMessage;
						let wager = 0;

						if (isPrimaryAttacker || isPrimaryDefender) {
							successMessage = `Your guild has officially joined as the ${isPrimaryAttacker ? 'leading attacker' : 'primary defender'}!`;
						}
						else {
							// Check for formal alliance for a free join
							const primaryCombatantTag = (side === 'attacker') ? originalRaid.attacker_tag : originalRaid.defender_tag;
							const tags = [joiningGuildTag, primaryCombatantTag].sort();
							const alliance = db.prepare('SELECT 1 FROM guild_relationships WHERE guild_one_tag = ? AND guild_two_tag = ? AND status = ?').get(tags[0], tags[1], 'alliance');

							successMessage = `Your guild, **${joiningGuildData.guild_name}**, has joined the war as a **${side}**!`;

							if (alliance) {
								successMessage += '\nAs a formal ally, you join the fight beside your **BRETHREN**.';
							}
							else if (joiningGuildData.attitude === 'Opportunist') {
								wager = 100 * joiningGuildData.tier;
								if (joiningGuildData.balance < wager) {
									return i.editReply({ content: `Your guild vault doesn't have enough to cover the opportunist wager of **${wager} Crowns**!` });
								}
								successMessage += `\nAs an Opportunist, you wager **👑 ${wager.toLocaleString()}** on the outcome!`;
							}
							else {
								successMessage += '\nYou join the fight for **FREE** to aid the cause!';
							}
						}

						console.log(`${logPrefix} Starting database transaction to add guild [${joiningGuildTag}] to the raid...`);
						db.transaction(() => {
							if (wager > 0) {
								const result = db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ? AND balance >= ?')
									.run(wager, joiningGuildTag, wager);
								if (result.changes === 0) {
									throw new Error('Insufficient funds for wager');
								}
								db.prepare('UPDATE raid_history SET wager_pot = COALESCE(wager_pot, 0) + ? WHERE id = ?').run(wager, collectedRaidId);
							}
							db.prepare('INSERT INTO active_raid_allies (raid_id, allied_guild_tag, side) VALUES (?, ?, ?)').run(collectedRaidId, joiningGuildTag, side);
							console.log(`${logPrefix} -> Inserted guild [${joiningGuildTag}] into 'active_raid_allies' for side '${side}'.`);
						})();
						console.log(`${logPrefix} Database transaction completed successfully.`);

						const successEmbed = new EmbedBuilder().setColor(0x57F287).setTitle('✅ Joined the Fray!').setDescription(successMessage);
						console.log(`${logPrefix} Sending success reply to the user...`);
						await i.editReply({ embeds: [successEmbed] });
						console.log(`${logPrefix} Success reply sent.`);

						console.log(`${logPrefix} Fetching all current allies to update the public war message...`);
						const allAllies = db.prepare(`
							SELECT ara.side, gl.guild_name
							FROM active_raid_allies ara
							JOIN guild_list gl ON ara.allied_guild_tag = gl.guild_tag
							WHERE ara.raid_id = ?
						`).all(collectedRaidId);
						console.log(`${logPrefix} Found ${allAllies.length} total allies.`);

						const attackers = allAllies.filter(a => a.side === 'attacker');
						const defenders = allAllies.filter(a => a.side === 'defender');

						const updatedEmbed = new EmbedBuilder(warMessage.embeds[0].data)
							.setFields(
								{ name: `⚔️ Attacking Alliance (${attackers.length})`, value: attackers.map(a => `**${a.guild_name}**`).join('\n') || 'None yet.', inline: true },
								{ name: `🛡️ Defending Coalition (${defenders.length})`, value: defenders.map(d => `**${d.guild_name}**`).join('\n') || 'None yet.', inline: true },
							);

						console.log(`${logPrefix} Editing the public war message with the new alliance list...`);
						await warMessage.edit({ embeds: [updatedEmbed] });
						console.log(`${logPrefix} Public war message updated successfully. Interaction complete.`);

					}
					catch (error) {
						console.error(`${logPrefix} CRITICAL ERROR during collection:`, error);
						if (!i.replied && !i.deferred) {
							await i.reply({ content: 'An unexpected error occurred. The Innkeepers have been notified.', flags: MessageFlags.Ephemeral }).catch(e => console.error(`${logPrefix} Failed to send initial error reply:`, e));
						}
						else {
							await i.followUp({ content: 'An unexpected error occurred. The Innkeepers have been notified.', flags: MessageFlags.Ephemeral }).catch(e => console.error(`${logPrefix} Failed to send followup error reply:`, e));
						}
					}
				});

				collector.on('end', (collected) => {
					console.log(`[RAID COLLECTOR] Collector ended after ${collected.size} interactions`);
					console.log('[RAID COLLECTOR] Starting battle resolution');
					try {
						resolveBattleSequentially(interaction, warMessage, raidId, attackerTag, defenderTag)
							.then(() => console.log('[RAID COLLECTOR] Battle resolution completed'))
							.catch(err => console.error('[RAID COLLECTOR] Battle resolution failed:', err));
					}
					catch (err) {
						console.error('[RAID COLLECTOR] Error starting battle resolution:', err);
					}
				});
			}
			catch (error) {
				console.error('[RAID CONFIRM] Critical error:', error);
			}
		},
		async handleInviteResponse(interaction) {
			const [action, targetId, guildTag] = interaction.customId.split('_').slice(2);
			const targetUser = interaction.user;
			const errorEmbed = new EmbedBuilder().setColor(0xE74C3C);

			// Verify this is the intended recipient
			if (targetUser.id !== targetId) {
				errorEmbed.setTitle('❌ Not for You').setDescription('This invitation is not for you!');
				return interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}

			if (action === 'accept') {
				// Check if user is already in a guild now
				const alreadyInGuild = db.prepare('SELECT * FROM guildmember_tracking WHERE user_id = ?').get(targetId);
				if (alreadyInGuild) {
					errorEmbed.setTitle('❌ Already in a Guild').setDescription('You are already in a guild!');
					return interaction.update({
						embeds: [errorEmbed],
						components: [],
					});
				}

				// Add to guild
				try {
					const guildData = db.prepare('SELECT * FROM guild_list WHERE guild_tag = ?').get(guildTag);
					if (!guildData) {
						errorEmbed.setTitle('❌ Guild Not Found').setDescription('This guild no longer exists!');
						return interaction.update({
							embeds: [errorEmbed],
							components: [],
						});
					}

					// Add role
					const role = await interaction.guild.roles.fetch(guildData.role_id);
					if (role) {
						await interaction.member.roles.add(role);
					}

					// Add to database
					db.prepare(`
                    INSERT INTO guildmember_tracking (user_id, guild_tag, owner)
                    VALUES (?, ?, 0)
                `).run(targetId, guildTag);

					await announceNewMember(interaction.client, targetUser, guildData);

					// Disable buttons on original message
					const originalMessage = interaction.message;
					const disabledComponents = originalMessage.components.map(row => {
						const newRow = new ActionRowBuilder();
						row.components.forEach(button => {
							newRow.addComponents(new ButtonBuilder(button.data).setDisabled(true));
						});
						return newRow;
					});
					const acceptedEmbed = new EmbedBuilder(originalMessage.embeds[0].data).setFooter({ text: 'This invitation has been accepted.' });
					await originalMessage.edit({ embeds: [acceptedEmbed], components: disabledComponents });


					const joinEmbed = new EmbedBuilder()
						.setColor(0x57F287)
						.setTitle(`🎉 Welcome to ${guildData.guild_name} [${guildTag}]!`)
						.setDescription('You have successfully joined the guild. Your new home awaits!')
						.addFields({
							name: 'Your Guild Channel',
							value: `Head over to <#${guildData.channel_id}> to meet your new guildmates!`,
						});
					return interaction.reply({
						embeds: [joinEmbed],
						flags: MessageFlags.Ephemeral,
					});
				}
				catch (error) {
					console.error('Guild join error:', error);
					errorEmbed.setTitle('❌ Join Error').setDescription('An unexpected error occurred while joining the guild.');
					return interaction.update({
						embeds: [errorEmbed],
						components: [],
					});
				}
			}
			else if (action === 'decline') {
				const declinedEmbed = new EmbedBuilder().setColor(0xE74C3C).setDescription('You have declined the guild invitation.');
				// Disable buttons on original message
				const originalMessage = interaction.message;
				const disabledComponents = originalMessage.components.map(row => {
					const newRow = new ActionRowBuilder();
					row.components.forEach(button => {
						newRow.addComponents(new ButtonBuilder(button.data).setDisabled(true));
					});
					return newRow;
				});
				const inviteDeclinedEmbed = new EmbedBuilder(originalMessage.embeds[0].data).setFooter({ text: 'This invitation has been declined.' });
				await originalMessage.edit({ embeds: [inviteDeclinedEmbed], components: disabledComponents });

				return interaction.update({
					embeds: [declinedEmbed],
					components: [],
				});
			}
		},
		async handleUpgradeConfirmation(interaction) {
			const [,, guildTag] = interaction.customId.split('_');
			const userId = interaction.user.id;
			const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Upgrade Failed');

			// Verify user is still guild owner
			const isOwner = db.prepare(`
        SELECT 1 FROM guildmember_tracking 
        WHERE user_id = ? AND guild_tag = ? AND (owner = 1 OR vice_gm = 1)
    `).get(userId, guildTag);

			if (!isOwner) {
				errorEmbed.setDescription('Only the guild owner or vice-gm can confirm upgrades!');
				return interaction.update({
					embeds: [errorEmbed],
					components: [],
				});
			}

			// Get current tier and balance with proper defaults
			const guildData = db.prepare(`
        SELECT 
            gl.guild_name,
            COALESCE(gt.tier, 1) AS tier, 
            COALESCE(ge.balance, 0) AS balance
        FROM guild_list gl
        LEFT JOIN guild_tiers gt ON gl.guild_tag = gt.guild_tag
        LEFT JOIN guild_economy ge ON gl.guild_tag = ge.guild_tag
        WHERE gl.guild_tag = ?
    `).get(guildTag);

			if (!guildData) {
				errorEmbed.setDescription('Guild data could not be loaded!');
				return interaction.update({
					embeds: [errorEmbed],
					components: [],
				});
			}

			const currentTier = guildData.tier;

			if (currentTier >= 15) {
				errorEmbed.setTitle('✅ Max Tier').setDescription('Your guild is already at maximum tier!');
				return interaction.update({
					embeds: [errorEmbed],
					components: [],
				});
			}

			const cost = TIER_DATA[currentTier].cost;
			const newTier = currentTier + 1;

			if (guildData.balance < cost) {
				errorEmbed.setDescription('Your guild no longer has enough crowns to upgrade!');
				return interaction.update({
					embeds: [errorEmbed],
					components: [],
				});
			}

			// Perform upgrade
			try {
				db.transaction(() => {
					db.prepare('UPDATE guild_economy SET balance = balance - ? WHERE guild_tag = ?')
						.run(cost, guildTag);

					db.prepare(`
				INSERT INTO guild_tiers (guild_tag, tier, last_upgrade_time)
				VALUES (?, ?, ?)
				ON CONFLICT(guild_tag) DO UPDATE SET
				tier = excluded.tier,
				last_upgrade_time = excluded.last_upgrade_time
			`).run(guildTag, newTier, new Date().toISOString());
				})();

				const newTierInfo = TIER_DATA[newTier - 1];

				const resultEmbed = new EmbedBuilder()
					.setTitle(`🎉🏰 Guild Upgraded to ${newTierInfo.name}! 🎉🏰`)
					.setDescription('Your guild has been successfully upgraded!')
					.addFields(
						{ name: 'Total Upgrade Cost', value: `👑 ${cost.toLocaleString()} Crowns`, inline: true },
						{ name: '__NEW Tier__', value: `${tierEmojis[newTier - 1]}`, inline: true },
						{ name: '__NEW Benefits__ 📈', value: getTierBenefits(newTier), inline: false },
					)
					.setColor(0x2ECC71);

				await interaction.update({
					embeds: [resultEmbed],
					components: [],
				});
				const upgradeAnnounceEmbed = new EmbedBuilder()
					.setColor(0xF1C40F)
					.setTitle('⬆️ A Guild Grows Stronger!')
					.addFields(
						{ name: 'Guild', value: `**${guildData.guild_name} [${guildTag}]**`, inline: true },
						{ name: 'New Tier', value: `${tierEmojis[newTier - 1]}`, inline: true },
					)
					.setTimestamp();
				await sendGuildAnnouncement(interaction.client, upgradeAnnounceEmbed);
			}
			catch (error) {
				console.error('Guild upgrade error:', error);
				errorEmbed.setTitle('❌ Upgrade Error').setDescription('An unexpected error occurred during the upgrade process. The transaction was rolled back.');
				await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}
		},
	},
	data: new SlashCommandBuilder()
		.setName('guild')
		.setDescription('Manage your guild')
		.addSubcommand(subcommand =>
			subcommand
				.setName('create')
				.setDescription('Create a new guild')
				.addStringOption(option =>
					option.setName('name')
						.setDescription('Guild name')
						.setRequired(true))
				.addStringOption(option =>
					option.setName('tag')
						.setDescription('3-letter guild tag')
						.setRequired(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('delete')
				.setDescription('Delete your guild'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('fund')
				.setDescription('Contribute Crowns to any guild!')
				.addStringOption(option =>
					option.setName('guild_tag')
						.setDescription('The tag of the guild to fund')
						.setRequired(true)
						.setAutocomplete(true))
				.addIntegerOption(option =>
					option.setName('amount')
						.setDescription('Amount of Crowns to contribute')
						.setRequired(true)
						.setMinValue(1)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('leave')
				.setDescription('Leave your current guild'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('invite')
				.setDescription('Invite someone to your guild')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('User to invite')
						.setRequired(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('info')
				.setDescription('Get info about a guild')
				.addStringOption(option =>
					option.setName('guild_tag')
						.setDescription('Tag of the guild to look up')
						.setRequired(true)
						.setAutocomplete(true))
				.addBooleanOption(option =>
					option.setName('full_view')
						.setDescription('Display all guild info in a single message instead of the interactive menu.')))
		.addSubcommand(subcommand =>
			subcommand
				.setName('join')
				.setDescription('Join an open guild')
				.addStringOption(option =>
					option.setName('guild_tag')
						.setDescription('Tag of the guild to join')
						.setRequired(true)
						.setAutocomplete(true)),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('raid')
				.setDescription('Declare war on another guild to steal Crowns and rally allies!')
				.addStringOption(option =>
					option.setName('guild_tag')
						.setDescription('Tag of the guild to raid')
						.setRequired(true)
						.setAutocomplete(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('upgrade')
				.setDescription('Upgrade your guild tier for better defenses and rewards'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('list')
				.setDescription('List all available guilds'),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('fundraise')
				.setDescription('Start a fundraiser for your guild')
				.addIntegerOption(option =>
					option.setName('amount')
						.setDescription('Amount to raise')
						.setRequired(true)
						.setMinValue(100)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('raidstats')
				.setDescription('View raid statistics and leaderboard'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('dues')
				.setDescription('Collect 1% dues from all members with a chance to invest for bonus funds'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('shield')
				.setDescription('Purchase temporary raid immunity'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('bequeath')
				.setDescription('Transfer guild ownership')
				.addUserOption(option =>
					option.setName('new_owner')
						.setDescription('New guild owner')
						.setRequired(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('bounty')
				.setDescription('Place a bounty from your guild vault on another guild.')
				.addStringOption(option =>
					option.setName('guild_tag')
						.setDescription('The tag of the guild to place a bounty on.')
						.setRequired(true)
						.setAutocomplete(true))
				.addIntegerOption(option =>
					option.setName('amount')
						.setDescription('The bounty amount in Crowns.')
						.setRequired(true)
						.setMinValue(1000)))
		.addSubcommandGroup(subcommandGroup =>
			subcommandGroup
				.setName('payout')
				.setDescription('Distribute crowns from guild vault to members')
				.addSubcommand(subcommand =>
					subcommand
						.setName('member')
						.setDescription('Pay crowns to a specific guild member')
						.addUserOption(option =>
							option.setName('user')
								.setDescription('Guild member to pay')
								.setRequired(true))
						.addIntegerOption(option =>
							option.setName('amount')
								.setDescription('Amount of crowns to pay')
								.setRequired(true)
								.setMinValue(1)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('all')
						.setDescription('Pay crowns to all guild members equally')
						.addIntegerOption(option =>
							option.setName('amount')
								.setDescription('Amount of crowns to pay each member')
								.setRequired(true)
								.setMinValue(1))))
		.addSubcommandGroup(subcommandGroup =>
			subcommandGroup
				.setName('settings')
				.setDescription('Manage guild settings')
				.addSubcommand(subcommand =>
					subcommand
						.setName('member_title')
						.setDescription('Set the title for what to call your guildmembers.')
						.addStringOption(option =>
							option.setName('title')
								.setDescription('The title to give members (max 25 chars).')
								.setRequired(true)
								.setMaxLength(25)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('raid_messages')
						.setDescription('Customize the narrative messages for when your guild raids or is raided.'))
				.addSubcommand(subcommand =>
					subcommand
						.setName('emoji')
						.setDescription('Set or replace your guild\'s default custom emoji.'))
				.addSubcommand(subcommand =>
					subcommand
						.setName('sticker')
						.setDescription('Set or replace your guild\'s custom sticker slot.'))
				.addSubcommand(subcommand =>
					subcommand
						.setName('motto')
						.setDescription('Set your guild motto')
						.addStringOption(option =>
							option.setName('text')
								.setDescription('Short guild motto (max 50 chars)')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('hook')
						.setDescription('Set your guild\'s short, punchy recruitment hook.')
						.addStringOption(option =>
							option.setName('text')
								.setDescription('The hook text (max 150 chars).')
								.setRequired(true)
								.setMaxLength(150)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('lore')
						.setDescription('Set your guild\'s detailed backstory or lore.')
						.addStringOption(option =>
							option.setName('text')
								.setDescription('The lore text (max 4000 chars).')
								.setRequired(true)
								.setMaxLength(4000)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('name')
						.setDescription('Change guild name')
						.addStringOption(option =>
							option.setName('new_name')
								.setDescription('New guild name')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('tag')
						.setDescription('Change guild tag')
						.addStringOption(option =>
							option.setName('new_tag')
								.setDescription('New 3-letter tag')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('visibility')
						.setDescription('Set guild joinability')
						.addStringOption(option =>
							option.setName('status')
								.setDescription('Guild join status')
								.setRequired(true)
								.addChoices(
									{ name: 'Open (Anyone can join)', value: 'open' },
									{ name: 'Closed (Invite only)', value: 'closed' },
								)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('channel')
						.setDescription('Change channel name')
						.addStringOption(option =>
							option.setName('new_name')
								.setDescription('New channel name (without guild- prefix)')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('role')
						.setDescription('Change role name')
						.addStringOption(option =>
							option.setName('new_name')
								.setDescription('New role name (without Guild: prefix)')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('promote')
						.setDescription('Promote a member to Vice Guildmaster')
						.addUserOption(option =>
							option.setName('user')
								.setDescription('The member to promote')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('demote')
						.setDescription('Demote a Vice Guildmaster back to a member')
						.addUserOption(option =>
							option.setName('user')
								.setDescription('The member to demote')
								.setRequired(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('attitude')
						.setDescription('Set your guild\'s official playstyle attitude.')
						.addStringOption(option =>
							option.setName('style')
								.setDescription('Choose the attitude that best describes your guild.')
								.setRequired(true)
								.addChoices(
									{ name: 'Neutral - Balanced gameplay.', value: 'Neutral' },
									{ name: 'Aggressive - Focused on raiding and PvP.', value: 'Aggressive' },
									{ name: 'Defensive - Focused on building and protecting allies.', value: 'Defensive' },
									{ name: 'Opportunist - Mercenaries who fight for profit.', value: 'Opportunist' },
								))))
		.addSubcommandGroup(subcommandGroup =>
			subcommandGroup
				.setName('diplomacy')
				.setDescription('Manage your guild\'s relationships with other guilds.')
				.addSubcommand(subcommand =>
					subcommand
						.setName('offer')
						.setDescription('Offer an alliance or truce to another guild.')
						.addStringOption(option =>
							option.setName('type')
								.setDescription('The type of relationship to offer.')
								.setRequired(true)
								.addChoices(
									{ name: 'Alliance (Permanent)', value: 'alliance' },
									{ name: 'Truce (Temporary)', value: 'truce' },
								))
						.addStringOption(option =>
							option.setName('guild_tag')
								.setDescription('The tag of the guild to make an offer to.')
								.setRequired(true)
								.setAutocomplete(true))
						.addIntegerOption(option =>
							option.setName('duration_days')
								.setDescription('For truces, the duration in days (e.g., 7).')))
				.addSubcommand(subcommand =>
					subcommand
						.setName('declare_enemy')
						.setDescription('Declare another guild as your official enemy.')
						.addStringOption(option =>
							option.setName('guild_tag')
								.setDescription('The tag of the guild to declare as an enemy.')
								.setRequired(true)
								.setAutocomplete(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('withdraw')
						.setDescription('End an enemy declaration.')
						.addStringOption(option =>
							option.setName('guild_tag')
								.setDescription('The tag of the guild to withdraw a relationship from.')
								.setRequired(true)
								.setAutocomplete(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('break')
						.setDescription('Unilaterally break an alliance with another guild.')
						.addStringOption(option =>
							option.setName('guild_tag')
								.setDescription('The tag of the guild to break the alliance with.')
								.setRequired(true)
								.setAutocomplete(true)))
				.addSubcommand(subcommand =>
					subcommand
						.setName('view')
						.setDescription('View all of your guild\'s current diplomatic relationships.'))),
	async execute(interaction) {
		if (interaction.isAutocomplete()) {
			if (interaction.commandName === 'guild') {
				const subcommand = interaction.options.getSubcommand();
				const subcommandGroup = interaction.options.getSubcommandGroup(false);
				if (subcommand === 'join') {
					return handleJoinAutocomplete(interaction);
				}
				else if (subcommand === 'info') {
					return handleInfoAutocomplete(interaction);
				}
				else if (subcommand === 'raid') {
					return handleRaidAutocomplete(interaction);
				}
				else if (subcommand === 'fund') {
					return fetchAllGuildsByTagAutocomplete(interaction);
				}
				else if (subcommandGroup === 'diplomacy') {
					return fetchAllGuildsByTagAutocomplete(interaction);
				}
				else if (subcommand === 'bounty') {
					return fetchAllGuildsByTagAutocomplete(interaction);
				}
			}
			return;
		}

		if (interaction.isButton()) {
			if (interaction.customId.startsWith('raidmsg')) {
				return this.buttons.handleRaidMessageButton(interaction);
			}
			if (interaction.customId.startsWith('fundraise_')) {
				return this.buttons.handleFundraiseButton(interaction);
			}
			if (interaction.customId.startsWith('shield_confirm')) {
				return this.buttons.handleShieldConfirmation(interaction);
			}
			if (interaction.customId.startsWith('raid_confirm')) {
				return this.buttons.handleRaidConfirmation(interaction);
			}
			if (interaction.customId.startsWith('join_attack') || interaction.customId.startsWith('aid_defence')) {
				return this.buttons.handleAllianceJoin(interaction);
			}
			if (interaction.customId.startsWith('guild_invite')) {
				return this.buttons.handleInviteResponse(interaction);
			}
			if (interaction.customId.startsWith('upgrade_confirm')) {
				return this.buttons.handleUpgradeConfirmation(interaction);
			}
			if (interaction.customId === 'raid_cancel' || interaction.customId === 'shield_cancel' || interaction.customId === 'upgrade_cancel' || interaction.customId === 'guild_delete_cancel') {
				const cancelEmbed = new EmbedBuilder().setColor(0x3498DB).setDescription('Action cancelled.');
				return interaction.update({ embeds: [cancelEmbed], components: [] });
			}
		}

		if (interaction.isModalSubmit()) {
			if (interaction.customId.startsWith('fundraise_custommodal')) {
				return this.buttons.handleFundraiseCustomModal(interaction);
			}
		}

		const subcommand = interaction.options.getSubcommand();
		const subcommandGroup = interaction.options.getSubcommandGroup();

		if (subcommandGroup === 'settings') {
			await handleSettings(interaction, subcommand);
		}
		else if (subcommandGroup === 'diplomacy') {
			await handleDiplomacy(interaction, subcommand);
		}
		else if (subcommandGroup === 'payout') {
			if (subcommand === 'member') {
				const user = interaction.options.getUser('user');
				await handlePayout(interaction, user);
			}
			else if (subcommand === 'all') {
				await handlePayout(interaction);
			}
		}
		else if (subcommand === 'info') {
			const fullView = interaction.options.getBoolean('full_view');
			if (fullView) {
				await handleFullInfo(interaction);
			}
			else {
				await handleInfo(interaction);
			}
		}
		else if (subcommand === 'bounty') {
			await handleBounty(interaction);
		}
		else if (subcommand === 'create') {await handleCreate(interaction);}
		else if (subcommand === 'delete') {await handleDelete(interaction);}
		else if (subcommand === 'leave') {await handleLeave(interaction);}
		else if (subcommand === 'invite') {await handleInvite(interaction);}
		else if (subcommand === 'bequeath') {await handleBequeath(interaction);}
		else if (subcommand === 'list') {await handleList(interaction);}
		else if (subcommand === 'join') {await handleJoin(interaction);}
		else if (subcommand === 'raid') {await handleRaid(interaction);}
    	else if (subcommand === 'upgrade') {await handleUpgrade(interaction);}
    	else if (subcommand === 'raidstats') {await handleRaidStats(interaction);}
		else if (subcommand === 'shield') {await handleShield(interaction);}
		else if (subcommand === 'fundraise') {await handleFundraise(interaction);}
		else if (subcommand === 'fund') {await handleGuildFund(interaction);}
		else if (subcommand === 'dues') {await handleDues(interaction);}


	},

};

module.exports.calculateCataclysmicFailureChance = calculateCataclysmicFailureChance;