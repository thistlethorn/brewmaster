// utils/gameMasterHelper.js
const { ModalBuilder, TextInputBuilder, ActionRowBuilder, EmbedBuilder, ChannelType, TextInputStyle, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const db = require('../database');

/**
 * A reusable function to fetch channels and prepare them for select menus or lists.
 * @param {import('discord.js').Interaction} interaction The interaction object.
 * @param {object} gameSession The game session data from the database.
 * @param {string[]} types An array of channel types to fetch (e.g., ['Text', 'Forum']).
 * @param {boolean} excludeManagement Excludes the management channel from the list.
 * @returns {Promise<import('discord.js').GuildChannel[]>} An array of channel objects.
 */
async function getChannelsForGame(interaction, gameSession, types, excludeManagement = false) {
	const allChannels = await interaction.guild.channels.fetch();
	const gameCategory = allChannels.get(gameSession.category_id);

	if (!gameCategory) return [];

	const filteredChannels = gameCategory.children.cache
		.filter(ch => types.includes(ChannelType[ch.type]) && (!excludeManagement || ch.id !== gameSession.management_channel_id))
		.sort((a, b) => a.position - b.position);

	return Array.from(filteredChannels.values());
}

/**
 * Main router function called by interactionCreate.js
 * @param {import('discord.js').Interaction} interaction The interaction object.
 */
async function handleGameMasterInteraction(interaction) {
	const customId = interaction.customId;
	const parts = customId.split('_');
	const [, action, subAction, ...rest] = parts;
	const gameId = rest[rest.length - 1];

	const gameSession = db.prepare('SELECT * FROM game_sessions WHERE game_id = ?').get(gameId);
	if (!gameSession) {
		return interaction.reply({ content: 'Error: This game session is no longer valid.', ephemeral: true, flags: MessageFlags.Ephemeral });
	}

	if (interaction.user.id !== gameSession.dm_user_id) {
		return interaction.reply({ content: 'You are not the DM for this game session.', ephemeral: true, flags: MessageFlags.Ephemeral });
	}

	// --- BUTTON ROUTER ---
	if (interaction.isButton()) {
		const command = `${action}_${subAction}`;
		switch (command) {
		case 'create_text': case 'create_voice': case 'create_forum':
			return showCreateModal(interaction, gameSession, subAction);
		case 'rename_channel': case 'delete_channel': case 'edit_description':
			return showChannelSelectMenu(interaction, gameSession, action);
		case 'reorder_start':
			return showReorderTypeSelect(interaction, gameSession);
		case 'rename_category':
			return showRenameCategoryModal(interaction, gameSession);
		case 'manage_players':
			return handleManagePlayers(interaction, gameSession);
		}
	}
	// --- SELECT MENU ROUTER ---
	else if (interaction.isStringSelectMenu()) {
		if (action === 'select') {
			return handleChannelSelection(interaction, gameSession, subAction);
		}
		if (action === 'reorder') {
			if (subAction === 'select-channel') {
				return showChannelToMoveSelect(interaction, gameSession);
			}
			else if (subAction === 'select-destination') {
				return showDestinationSelect(interaction, gameSession);
			}
			else if (subAction === 'execute') {
				return handleReorderExecute(interaction);
			}
		}
	}
	// --- MODAL SUBMISSION ROUTER ---
	else if (interaction.isModalSubmit()) {
		const modalAction = `modal_${action}_${subAction}`;
		switch (modalAction) {
		case 'modal_create_text': case 'modal_create_voice': case 'modal_create_forum':
			return handleCreateChannelSubmit(interaction, gameSession, subAction);
		case 'modal_rename_channel':
			return handleRenameChannelSubmit(interaction);
		case 'modal_edit_description':
			return handleEditDescriptionSubmit(interaction);
		case 'modal_rename_category':
			return handleRenameCategorySubmit(interaction, gameSession);
		}
	}
}


// --- STEP 1: BUTTON HANDLERS (Presenting Modals or Select Menus) ---

async function showCreateModal(interaction, gameSession, type) {
	const modal = new ModalBuilder()
		.setCustomId(`gm_modal_create_${type}_${gameSession.game_id}`)
		.setTitle(`Create New ${type.charAt(0).toUpperCase() + type.slice(1)} Channel`);

	modal.addComponents(new ActionRowBuilder().addComponents(
		new TextInputBuilder()
			.setCustomId('channel_name')
			.setLabel('Channel Name')
			.setStyle(TextInputStyle.Short)
			.setRequired(true),
	));
	await interaction.showModal(modal);
}

async function showRenameCategoryModal(interaction, gameSession) {
	const modal = new ModalBuilder()
		.setCustomId(`gm_modal_rename_category_${gameSession.game_id}`)
		.setTitle('Rename Game Category');

	modal.addComponents(new ActionRowBuilder().addComponents(
		new TextInputBuilder()
			.setCustomId('category_name')
			.setLabel('New Category & Role Name')
			.setStyle(TextInputStyle.Short)
			.setRequired(true)
			.setValue(gameSession.game_name),
	));
	await interaction.showModal(modal);
}

async function showChannelSelectMenu(interaction, gameSession, action) {
	const channels = await getChannelsForGame(interaction, gameSession, ['Text', 'Forum', 'Voice'], true);
	if (channels.length === 0) {
		return interaction.reply({ content: 'There are no eligible channels to perform this action on.', ephemeral: true, flags: MessageFlags.Ephemeral });
	}

	const options = channels.map(ch => ({
		label: ch.name,
		description: `Type: ${ChannelType[ch.type]}`,
		value: ch.id,
	}));

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId(`gm_select_${action}_${gameSession.game_id}`)
		.setPlaceholder(`Select a channel to ${action}...`)
		.addOptions(options.slice(0, 25));

	const row = new ActionRowBuilder().addComponents(selectMenu);
	await interaction.reply({ content: `Please select the channel you wish to **${action}**.`, components: [row], ephemeral: true, flags: MessageFlags.Ephemeral });
}


// --- REORDER WORKFLOW ---

// Step 1: Ask for channel type
async function showReorderTypeSelect(interaction, gameSession) {
	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId(`gm_reorder_select-channel_${gameSession.game_id}`)
		.setPlaceholder('Select the type of channels to reorder...')
		.addOptions([
			{ label: 'Text & Forum Channels', value: 'text' },
			{ label: 'Voice Channels', value: 'voice' },
		]);

	const row = new ActionRowBuilder().addComponents(selectMenu);
	await interaction.reply({ content: 'First, which type of channels are you reordering?', components: [row], ephemeral: true, flags: MessageFlags.Ephemeral });
}

// Step 2: Ask which channel to move
async function showChannelToMoveSelect(interaction, gameSession) {
	const type = interaction.values[0];
	const channelTypes = type === 'text' ? ['Text', 'Forum'] : ['Voice'];
	const channels = await getChannelsForGame(interaction, gameSession, channelTypes);

	if (channels.length < 2) {
		return interaction.update({ content: 'You need at least two channels of that type to reorder them.', components: [] });
	}

	const options = channels.map(ch => ({ label: ch.name, value: ch.id }));

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId(`gm_reorder_select-destination_${gameSession.game_id}`)
		.setPlaceholder('Select the channel you want to move...')
		.addOptions(options);

	const row = new ActionRowBuilder().addComponents(selectMenu);
	await interaction.update({ content: 'Great. Now, which channel do you want to move?', components: [row] });
}

// Step 3: Ask where to move it
async function showDestinationSelect(interaction, gameSession) {
	const channelToMoveId = interaction.values[0];
	const channelToMove = await interaction.guild.channels.fetch(channelToMoveId);
	const channelTypes = channelToMove.type === ChannelType.GuildVoice ? ['Voice'] : ['Text', 'Forum'];

	const allChannels = await getChannelsForGame(interaction, gameSession, channelTypes);
	const destinationChannels = allChannels.filter(ch => ch.id !== channelToMoveId);

	const options = [
		{ label: '— Move to Top of Category —', value: 'move_to_top' },
		...destinationChannels.map(ch => ({ label: `Move below "${ch.name}"`, value: ch.id })),
	];

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId(`gm_reorder_execute_${gameSession.game_id}_${channelToMoveId}`)
		.setPlaceholder('Select the new position...')
		.addOptions(options.slice(0, 25));

	const row = new ActionRowBuilder().addComponents(selectMenu);
	await interaction.update({ content: `Okay, you're moving **${channelToMove.name}**. Where should it go?`, components: [row] });
}

// Step 4: Execute the reorder
async function handleReorderExecute(interaction) {
	const parts = interaction.customId.split('_');
	const channelToMoveId = parts[parts.length - 1];
	const destinationId = interaction.values[0];

	await interaction.deferUpdate();

	const channelToMove = await interaction.guild.channels.fetch(channelToMoveId);

	try {
		if (destinationId === 'move_to_top') {
			await channelToMove.setPosition(0);
		}
		else {
			const destinationChannel = await interaction.guild.channels.fetch(destinationId);
			await channelToMove.setPosition(destinationChannel.position + 1);
		}
		await interaction.editReply({ content: `✅ Successfully moved **${channelToMove.name}** to its new position.`, components: [] });
	}
	catch (error) {
		console.error('Reorder execution error:', error);
		await interaction.editReply({ content: '❌ An error occurred while reordering the channels.', components: [] });
	}
}


// --- STEP 2 (Alternate): SELECT MENU HANDLER (Presents final modal) ---

async function handleChannelSelection(interaction, gameSession, action) {
	const channelId = interaction.values[0];
	const channel = await interaction.guild.channels.fetch(channelId);

	if (action === 'delete') {
		db.prepare('DELETE FROM game_channels WHERE channel_id = ?').run(channelId);
		await channel.delete(`Deleted by DM ${interaction.user.tag}`);
		return interaction.update({ content: `✅ Successfully deleted channel **${channel.name}**.`, components: [] });
	}

	const modal = new ModalBuilder()
		.setCustomId(`gm_modal_${action}_channel_${gameSession.game_id}`)
		.setTitle(`${action.charAt(0).toUpperCase() + action.slice(1)}: ${channel.name}`);

	if (action === 'rename') {
		modal.addComponents(new ActionRowBuilder().addComponents(
			new TextInputBuilder()
				.setCustomId(`new_name_${channelId}`)
				.setLabel('New Channel Name')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setValue(channel.name),
		));
	}
	else if (action === 'edit') {
		modal.addComponents(new ActionRowBuilder().addComponents(
			new TextInputBuilder()
				.setCustomId(`new_description_${channelId}`)
				.setLabel('New Channel Topic/Description')
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(false)
				.setValue(channel.topic || '')
				.setMaxLength(1024),
		));
	}

	await interaction.showModal(modal);
}


// --- STEP 3: MODAL SUBMISSION HANDLERS (Final Actions) ---

async function handleCreateChannelSubmit(interaction, gameSession, type) {
	const channelName = interaction.fields.getTextInputValue('channel_name');
	const sanitizedName = channelName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

	if (sanitizedName === 'category-management') {
		return interaction.reply({ content: '❌ "category-management" is a reserved name.', ephemeral: true, flags: MessageFlags.Ephemeral });
	}

	const newChannel = await interaction.guild.channels.create({
		name: type === 'voice' ? channelName : sanitizedName,
		type: type === 'text' ? ChannelType.GuildText : type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildForum,
		parent: gameSession.category_id,
	});

	db.prepare('INSERT INTO game_channels (channel_id, game_id, channel_type) VALUES (?, ?, ?)')
		.run(newChannel.id, gameSession.game_id, type.charAt(0).toUpperCase() + type.slice(1));

	await interaction.reply({ content: `✅ Successfully created ${type} channel: ${newChannel}`, ephemeral: true, flags: MessageFlags.Ephemeral });
}

async function handleRenameCategorySubmit(interaction, gameSession) {
	const newName = interaction.fields.getTextInputValue('category_name');
	const category = await interaction.guild.channels.fetch(gameSession.category_id);
	const role = await interaction.guild.roles.fetch(gameSession.key_role_id);

	await category.setName(newName);
	await role.setName(`Key: ${newName}`);
	db.prepare('UPDATE game_sessions SET game_name = ? WHERE game_id = ?').run(newName, gameSession.game_id);

	await interaction.reply({ content: `✅ Category and role successfully renamed to "${newName}".`, ephemeral: true, flags: MessageFlags.Ephemeral });
}

async function handleRenameChannelSubmit(interaction) {
	const textInput = interaction.fields.components[0].components[0];
	const channelId = textInput.customId.replace('new_name_', '');
	const newName = textInput.value;

	const channel = await interaction.guild.channels.fetch(channelId);
	const sanitizedName = newName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

	if (sanitizedName === 'category-management') {
		return interaction.reply({ content: '❌ You cannot rename a channel to "category-management".', ephemeral: true, flags: MessageFlags.Ephemeral });
	}

	const finalName = channel.type === ChannelType.GuildVoice ? newName : sanitizedName;
	await channel.setName(finalName);
	await interaction.reply({ content: `✅ Channel successfully renamed to **${finalName}**.`, ephemeral: true, flags: MessageFlags.Ephemeral });
}

async function handleEditDescriptionSubmit(interaction) {
	const textInput = interaction.fields.components[0].components[0];
	const channelId = textInput.customId.replace('new_description_', '');
	const newDescription = textInput.value;

	const channel = await interaction.guild.channels.fetch(channelId);
	await channel.setTopic(newDescription);

	await interaction.reply({ content: `✅ Successfully updated the description for ${channel}.`, ephemeral: true, flags: MessageFlags.Ephemeral });
}


// --- Player Management (No Modal Needed) ---
async function handleManagePlayers(interaction, gameSession) {
	await interaction.deferReply({ ephemeral: true, flags: MessageFlags.Ephemeral });

	const forumChannel = await interaction.client.channels.fetch(gameSession.forum_post_id).catch(() => null);
	if (!forumChannel) {
		return interaction.editReply({ content: 'Error: Could not find the original game forum post to send the prompt.' });
	}

	const promptEmbed = new EmbedBuilder()
		.setColor(0xFEE75C)
		.setTitle('👥 Player Management')
		.setDescription(`<@${interaction.user.id}>, please mention the user you wish to add or remove from your game in this channel within 3 minutes.`);

	await forumChannel.send({ embeds: [promptEmbed] });
	await interaction.editReply({ content: '✅ Prompt sent to your game\'s forum post. Please go there to mention the player.' });

	const filter = m => m.author.id === interaction.user.id && m.mentions.users.size > 0;
	const collector = forumChannel.createMessageCollector({ filter, max: 1, time: 180000 });

	collector.on('collect', async message => {
		await message.delete().catch((e) => {console.error('Failed to delete player management message:', e); });
		const targetUser = message.mentions.users.first();
		if (targetUser.bot || targetUser.id === interaction.user.id) {
			await forumChannel.send({ content: `<@${interaction.user.id}>, you cannot add or remove bots or yourself.` });
			return;
		}

		const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
		if (!targetMember) {
			await forumChannel.send({ content: `<@${interaction.user.id}>, could not find that user in this server.` });
			return;
		}

		const keyRole = await interaction.guild.roles.fetch(gameSession.key_role_id);
		if (!keyRole) {
			await forumChannel.send({ content: 'Error: The key role for this game is missing.' });
			return;
		}

		if (targetMember.roles.cache.has(keyRole.id)) {
			await targetMember.roles.remove(keyRole);
			await forumChannel.send({ content: `✅ <@${interaction.user.id}>, successfully removed ${targetUser.username} from the game.` });
		}
		else {
			await targetMember.roles.add(keyRole);
			await forumChannel.send({ content: `✅ <@${interaction.user.id}>, successfully added ${targetUser.username} to the game.` });
		}
	});

	collector.on('end', (collected, reason) => {
		if (reason === 'time') {
			forumChannel.send({ content: `<@${interaction.user.id}>, your player management request has timed out.` });
		}
	});
}


module.exports = { handleGameMasterInteraction };