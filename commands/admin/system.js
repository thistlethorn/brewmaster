// commands/admin/system.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database');
const config = require('../../config.json');

const YOUR_USER_ID = '1126419078140153946';
const VERIFIED_DM_ROLE_ID = '1400980447919345694';

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('system')
		.setDescription('[OWNER COMMAND] System-level commands for server management.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('newgame_dm')
				.setDescription('Sets up a new game category for a verified DM.')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('The DM to set up the game for.')
						.setRequired(true))),

	async execute(interaction) {
		// Strict permission check
		if (interaction.user.id !== YOUR_USER_ID) {
			return interaction.reply({ content: 'This command is restricted to the bot owner.', ephemeral: true });
		}

		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'newgame_dm') {
			await handleNewGameDm(interaction);
		}
	},
};

async function handleNewGameDm(interaction) {
	await interaction.deferReply();

	const dmUser = interaction.options.getUser('user');
	const dmMember = await interaction.guild.members.fetch(dmUser.id);
	const forumPostId = interaction.channel.id;

	try {
		// --- 1. Give Verified DM Role ---
		const verifiedDmRole = await interaction.guild.roles.fetch(VERIFIED_DM_ROLE_ID);
		if (verifiedDmRole) {
			await dmMember.roles.add(verifiedDmRole);
		}

		// --- 2. Create the unique Game Key Role ---
		const gameKeyRole = await interaction.guild.roles.create({
			name: 'Key: Unnamed Game',
			permissions: [],
			reason: `Game key role for a new game run by ${dmUser.tag}`,
		});
		await dmMember.roles.add(gameKeyRole);

		// --- 3. Create the Category ---
		const gameCategory = await interaction.guild.channels.create({
			name: 'Unnamed Game Category',
			type: ChannelType.GuildCategory,
			permissionOverwrites: [
				{
					id: verifiedDmRole.id,
					allow: [PermissionFlagsBits.ManageMessages],
				},
				{
					id: interaction.guild.id,
					deny: [PermissionFlagsBits.ViewChannel],
				},
				{
					id: gameKeyRole.id,
					allow: [PermissionFlagsBits.ViewChannel],
				},
				{
					id: config.discord.staffRoleId,
					allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels],
				},
			],
		});

		// --- 4. Create Initial Channels ---
		const managementChannel = await interaction.guild.channels.create({
			name: 'category-management',
			type: ChannelType.GuildText,
			parent: gameCategory.id,
			topic: 'Use the buttons here to manage your game channels and players.',
			permissionOverwrites: [
				{
					id: gameKeyRole.id,
					deny: [PermissionFlagsBits.SendMessages],
				},
				{
					id: interaction.guild.id,
					deny: [PermissionFlagsBits.ViewChannel],
				},
				{
					id: gameKeyRole.id,
					allow: [PermissionFlagsBits.ViewChannel],
				},
				// Note: Staff and the bot (with Admin) will still be able to type.
			],
		});

		const oocChannel = await interaction.guild.channels.create({
			name: 'ooc-chat',
			type: ChannelType.GuildText,
			parent: gameCategory.id,
		});

		// --- 5. Store everything in the database ---
		const result = db.prepare(`
            INSERT INTO game_sessions (dm_user_id, category_id, management_channel_id, key_role_id, forum_post_id)
            VALUES (?, ?, ?, ?, ?)
        `).run(dmUser.id, gameCategory.id, managementChannel.id, gameKeyRole.id, forumPostId);

		const gameId = result.lastInsertRowid;

		// Update role and category with unique ID to prevent clashes
		await gameKeyRole.setName(`Key: Game ${gameId}`);
		await gameCategory.setName(`Game Setup: ${gameId}`);
		db.prepare('UPDATE game_sessions SET game_name = ? WHERE game_id = ?').run(`Game ${gameId}`, gameId);


		db.transaction(() => {
			db.prepare('INSERT INTO game_channels (channel_id, game_id, channel_type) VALUES (?, ?, ?)')
				.run(managementChannel.id, gameId, 'Text');
			db.prepare('INSERT INTO game_channels (channel_id, game_id, channel_type) VALUES (?, ?, ?)')
				.run(oocChannel.id, gameId, 'Text');
		})();


		// --- 6. Post the Wizard Embed ---
		const wizardEmbed = new EmbedBuilder()
			.setColor(0x5865F2)
			.setTitle('🧙‍♂️ Game Management Wizard')
			.setDescription('Welcome, Dungeon Master! Use these buttons to set up and manage your game category. This message will stay here for your convenience.')
			.addFields(
				{ name: 'DM/GM:', value: `- <@${dmUser.id}>`, inline: true },
				{ name: 'Players (0)', value: 'No players have been added yet.', inline: true },
			);

		// Replace the button rows with this new organization
		const row1 = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`gm_button_create_text_${gameId}`).setLabel('Create Text Channel').setStyle(ButtonStyle.Success).setEmoji('📝'),
			new ButtonBuilder().setCustomId(`gm_button_create_voice_${gameId}`).setLabel('Create Voice Channel').setStyle(ButtonStyle.Success).setEmoji('🎙️'),
			new ButtonBuilder().setCustomId(`gm_button_create_forum_${gameId}`).setLabel('Create Forum Channel').setStyle(ButtonStyle.Success).setEmoji('📰'),
		);

		const row2 = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`gm_button_rename_category_${gameId}`).setLabel('Rename Category').setStyle(ButtonStyle.Primary).setEmoji('📚'),
			new ButtonBuilder().setCustomId(`gm_button_rename_channel_${gameId}`).setLabel('Rename Channel').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
			new ButtonBuilder().setCustomId(`gm_button_reorder_start_${gameId}`).setLabel('Reorder Channels').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
			new ButtonBuilder().setCustomId(`gm_button_edit_description_${gameId}`).setLabel('Edit Channel Description').setStyle(ButtonStyle.Primary).setEmoji('📜'),
		);

		const row3 = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`gm_button_manage_players_${gameId}`).setLabel('Add/Remove Players').setStyle(ButtonStyle.Success).setEmoji('👥'),
		);

		const row4 = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`gm_button_delete_channel_${gameId}`).setLabel('Delete a Channel').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
			new ButtonBuilder().setCustomId(`gm_button_delete_game_${gameId}`).setLabel('>DELETE THE GAME<').setStyle(ButtonStyle.Danger).setEmoji('💀'),
		);


		const wizardMessage = await managementChannel.send({ embeds: [wizardEmbed], components: [row1, row2, row3, row4] });
		db.prepare('UPDATE game_sessions SET wizard_message_id = ? WHERE game_id = ?')
			.run(wizardMessage.id, gameId);
		await interaction.editReply({ content: `✅ Successfully created your own game category, click <#${managementChannel.id}> to get started!` });
		await interaction.followUp({ content: `<@${dmUser.id}>` });
	}
	catch (error) {
		console.error('Error setting up new game for DM:', error);
		await interaction.editReply({ content: '❌ An error occurred while setting up the game. Any created roles or channels may need to be manually removed.' });
	}
}