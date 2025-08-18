// utils/handleGameMasterInteraction.js
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
	console.log(
		`[DEBUG] Fetching channels for game ${gameSession.game_id}\n` +
		`Types: ${types.join(', ')}\n` +
		`Exclude Management: ${excludeManagement}`,
	);
	// Fetch ALL channels in the guild to ensure we have fresh data, bypassing the cache.
	const allChannels = await interaction.guild.channels.fetch();

	if (!allChannels) return [];
	console.log(
		`[DEBUG] All channels in category ${gameSession.category_id}:`,
		allChannels.filter(ch => ch.parentId === gameSession.category_id).map(ch => ({
			name: ch.name,
			type: ChannelType[ch.type],
			id: ch.id,
		})),
	);
	// Map requested labels -> numeric ChannelType constants
	const typeMap = {
		Text: ChannelType.GuildText,
		Forum: ChannelType.GuildForum,
		Voice: ChannelType.GuildVoice,
	};
	const allowedTypeIds = new Set(types.map(t => typeMap[t]).filter(value => value !== undefined));
	console.log('[DEBUG] Type Mapping:', {
		inputTypes: types,
		allowedTypeIds: Array.from(allowedTypeIds),
	});
	// Filter the entire guild's channel list to find children of our target category
	const filteredChannels = allChannels
		.filter(ch =>
			ch.parentId === gameSession.category_id &&
			allowedTypeIds.has(ch.type) &&
			(!excludeManagement || ch.id !== gameSession.management_channel_id),
		)
		.sort((a, b) => {
			// Primary sort by position
			if (a.position !== b.position) return a.position - b.position;

			// Fallback: Sort by creation time if positions are equal
			return a.createdTimestamp - b.createdTimestamp;
		});

	console.log(
		`[DEBUG] Filtered ${filteredChannels.size} channels:`,
		filteredChannels.map(ch => ({
			name: ch.name,
			type: ChannelType[ch.type],
			position: ch.position,
			created: ch.createdAt.toISOString(),
		})),
	);
	return Array.from(filteredChannels.values());
}

/**
 * Main router function called by interactionCreate.js
 * @param {import('discord.js').Interaction} interaction The interaction object.
 */
async function handleGameMasterInteraction(interaction) {
	const customId = interaction.customId;
	const parts = customId.split('_');

	// Standardized format: gm_component_action_subaction_..._gameId
	// The last part is always the gameId.
	const gameId = parts[parts.length - 1];
	console.log(`[DEBUG] Handling interaction: ${interaction.customId}`);
	console.log(`[DEBUG] Game ID from interaction: ${gameId}`);

	const gameSession = db.prepare('SELECT * FROM game_sessions WHERE game_id = ?').get(gameId);

	console.log(`[GameMasterInteraction] Component: ${parts[1]}, Action: ${parts[2]}, SubAction: ${parts[3]}, Game ID: ${gameId}`);

	if (!gameSession) {
		return interaction.reply({ content: 'Error: This game session is no longer valid.', flags: MessageFlags.Ephemeral });
	}

	if (interaction.user.id !== gameSession.dm_user_id) {
		return interaction.reply({ content: 'You are not the DM for this game session.', flags: MessageFlags.Ephemeral });
	}

	const componentType = parts[1];
	const action = parts[2];
	const subAction = parts[3];

	console.log(`[GameMasterInteraction] Processing interaction: ${componentType} - ${action} - ${subAction} for Game ID: ${gameId}`);

	// --- BUTTON ROUTER ---
	if (interaction.isButton()) {
		// ID: gm_button_ACTION_SUBACTION_GAMEID
		if (action === 'create') {
			return showCreateModal(interaction, gameSession, subAction);
		}
		if (action === 'delete' && subAction === 'game') {
			return showDeleteGameModal(interaction, gameSession);
		}
		if (action === 'rename' || action === 'delete' || action === 'edit') {
			if (subAction === 'channel' || subAction === 'description') {
				return showChannelSelectMenu(interaction, gameSession, action);
			}
			if (subAction === 'category') {
				return showRenameCategoryModal(interaction, gameSession);
			}
		}
		if (action === 'reorder' && subAction === 'start') {
			return showReorderTypeSelect(interaction, gameSession);
		}
		if (action === 'manage' && subAction === 'players') {
			return handleManagePlayers(interaction, gameSession);
		}
	}
	// --- SELECT MENU ROUTER ---
	else if (interaction.isStringSelectMenu()) {
		// ID: gm_select_ACTION_SUBACTION_..._GAMEID
		if (action === 'channel') {
			return handleChannelSelection(interaction, gameSession, subAction);
		}
		if (action === 'reorder') {
			if (subAction === 'type') return showChannelToMoveSelect(interaction, gameSession);
			if (subAction === 'channel') return showDestinationSelect(interaction, gameSession);
			if (subAction === 'destination') return handleReorderExecute(interaction, gameSession);
		}
	}
	// --- MODAL SUBMISSION ROUTER ---
	else if (interaction.isModalSubmit()) {
		// ID: gm_modal_ACTION_SUBACTION_..._GAMEID
		if (action === 'create') {
			return handleCreateChannelSubmit(interaction, gameSession, subAction);
		}
		if (action === 'rename' && subAction === 'channel') return handleRenameChannelSubmit(interaction);
		if (action === 'rename' && subAction === 'category') return handleRenameCategorySubmit(interaction, gameSession);
		if (action === 'edit' && subAction === 'description') return handleEditDescriptionSubmit(interaction);
		if (action === 'delete' && subAction === 'game') {
			return handleDeleteGameSubmit(interaction, gameSession);
		}
	}
}
async function showDeleteGameModal(interaction, gameSession) {
	const modal = new ModalBuilder()
		.setCustomId(`gm_modal_delete_game_${gameSession.game_id}`)
		.setTitle('CONFIRM GAME DELETION');

	modal.addComponents(new ActionRowBuilder().addComponents(
		new TextInputBuilder()
			.setCustomId('confirmation')
			.setLabel('Type "CONFIRM" to delete this game')
			.setStyle(TextInputStyle.Short)
			.setRequired(true),
	));

	await interaction.showModal(modal);
}

// Add this function to handle the modal submission
async function handleDeleteGameSubmit(interaction, gameSession) {
	const confirmation = interaction.fields.getTextInputValue('confirmation');

	if (confirmation !== 'CONFIRM') {
		return interaction.reply({
			content: '❌ Deletion cancelled. You must type "CONFIRM" to delete the game.',
			flags: MessageFlags.Ephemeral,
		});
	}

	// This initial reply is fine. It gives immediate feedback.
	await interaction.reply({
		content: '✅ Confirmation received. Deleting game environment now. A final confirmation will be posted in the game\'s original forum thread.',
		flags: MessageFlags.Ephemeral,
	});

	try {
		// Fetch all necessary Discord objects BEFORE starting deletion
		const category = await interaction.guild.channels.fetch(gameSession.category_id).catch(() => null);
		const role = await interaction.guild.roles.fetch(gameSession.key_role_id).catch(() => null);

		// Delete all channels within the category first
		if (category) {
			const channels = await category.children.fetch();
			for (const channel of channels.values()) {
				await channel.delete(`Game Deletion by ${interaction.user.tag}`).catch(err => console.error(`[GM Deletion] Failed to delete channel ${channel.id}:`, err.message));
				// A brief pause to avoid hitting rate limits on rapid deletions
				await new Promise(resolve => setTimeout(resolve, 500));
			}
			// Now delete the category itself
			await category.delete(`Game Deletion by ${interaction.user.tag}`);
		}

		// Delete the key role
		if (role) {
			await role.delete(`Game Deletion by ${interaction.user.tag}`);
		}

		// THE DATABASE TRANSACTION IS HERE. It completes before the message sending below.
		db.transaction(() => {
			db.prepare('DELETE FROM game_channels WHERE game_id = ?').run(gameSession.game_id);
			db.prepare('DELETE FROM game_sessions WHERE game_id = ?').run(gameSession.game_id);
		})();

		// THE FIX: Send a new message to the persistent forum channel instead of editReply.
		const forumChannel = await interaction.client.channels.fetch(gameSession.forum_post_id).catch(() => null);
		if (forumChannel) {
			await forumChannel.send({
				content: `✅ The game environment "**${gameSession.game_name}**" (run by <@${gameSession.dm_user_id}>) has been successfully and completely deleted.`,
			});
		}

	}
	catch (error) {
		console.error('Game deletion error:', error);
		// THE FIX FOR THE CATCH BLOCK: Also send to the forum channel.
		const forumChannel = await interaction.client.channels.fetch(gameSession.forum_post_id).catch(() => null);
		if (forumChannel) {
			await forumChannel.send({
				content: `❌ An error occurred while deleting the game "**${gameSession.game_name}**". Some elements may need to be manually removed by server staff. Please check the logs.`,
			});
		}
	}
}

// --- STEP 1: BUTTON HANDLERS (Presenting Modals or Select Menus) ---
/**
 * Opens a modal prompting the DM to create a new channel of the given type.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {{ game_id: number }} gameSession
 * @param {'text'|'voice'|'forum'} type
 * @returns {Promise<void>}
 */
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


/**
 * Opens a modal to rename the game category and associated key role.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {{ game_id: number, game_name: string }} gameSession
 * @returns {Promise<void>}
 */
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
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	let eligibleTypes;
	switch (action) {
	case 'edit':
		// Only Text and Forum channels have a "topic" or description.
		eligibleTypes = ['Text', 'Forum'];
		break;
	case 'rename':
	case 'delete':
		// You should be able to rename or delete any channel type except management
		eligibleTypes = ['Text', 'Forum', 'Voice'];
		break;
	default:
		eligibleTypes = [];
		break;
	}

	// The key fix is passing false to include management channel in the list (it will be filtered out later)
	const channels = await getChannelsForGame(interaction, gameSession, eligibleTypes, false);

	// Now manually filter out the management channel if needed
	const filteredChannels = channels.filter(ch =>
		ch.id !== gameSession.management_channel_id,
	);

	if (filteredChannels.length === 0) {
		return interaction.reply({
			content: 'There are no eligible channels to perform this action on.',
			flags: MessageFlags.Ephemeral,
		});
	}

	const options = filteredChannels.map(ch => ({
		label: ch.name,
		description: `Type: ${ChannelType[ch.type]}`,
		value: ch.id,
	}));

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId(`gm_select_channel_${action}_${gameSession.game_id}`)
		.setPlaceholder(`Select a channel to ${action}...`)
		.addOptions(options.slice(0, 25));

	const row = new ActionRowBuilder().addComponents(selectMenu);
	await interaction.editReply({
		content: `Please select the channel you wish to **${action}**.`,
		components: [row],
		flags: MessageFlags.Ephemeral,
	});
}


// --- REORDER WORKFLOW ---

// Step 1: Ask for channel type
async function showReorderTypeSelect(interaction, gameSession) {
	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId(`gm_select_reorder_type_${gameSession.game_id}`)
		.setPlaceholder('Select the type of channels to reorder...')
		.addOptions([
			{ label: 'Text & Forum Channels', value: 'text' },
			{ label: 'Voice Channels', value: 'voice' },
		]);

	const row = new ActionRowBuilder().addComponents(selectMenu);
	await interaction.reply({ content: 'First, which type of channels are you reordering?', components: [row], flags: MessageFlags.Ephemeral });
}

// Step 2: Ask which channel to move
async function showChannelToMoveSelect(interaction, gameSession) {
	await interaction.deferUpdate();
	const type = interaction.values[0];
	const channelTypes = type === 'text' ? ['Text', 'Forum'] : ['Voice'];
	// Remove the excludeManagement flag here since we want to include all channels for reordering
	const channels = await getChannelsForGame(interaction, gameSession, channelTypes);

	if (channels.length < 2) {
		return interaction.update({
			content: 'You need at least two channels of that type to reorder them.',
			components: [],
		});
	}

	const options = channels.map(ch => ({
		label: ch.name,
		value: ch.id,
	}));

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId(`gm_select_reorder_channel_${gameSession.game_id}`)
		.setPlaceholder('Select the channel you want to move...')
		.addOptions(options);

	const row = new ActionRowBuilder().addComponents(selectMenu);
	await interaction.editReply({
		content: 'Great. Now, which channel do you want to move?',
		components: [row],
	});
}

// Step 3: Ask where to move it
async function showDestinationSelect(interaction, gameSession) {
	await interaction.deferUpdate();
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
		.setCustomId(`gm_select_reorder_destination_${channelToMoveId}_${gameSession.game_id}`)
		.setPlaceholder('Select the new position...')
		.addOptions(options.slice(0, 25));

	const row = new ActionRowBuilder().addComponents(selectMenu);
	await interaction.editReply({ content: `Okay, you're moving **${channelToMove.name}**. Where should it go?`, components: [row] });
}


/**
 * Executes the reordering of a channel in a robust way.
 * This function calculates the desired final order of all channels and sends it
 * to Discord in a single, atomic operation to prevent race conditions.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} gameSession The game session data from the database.
 */
async function handleReorderExecute(interaction, gameSession) {
	await interaction.deferUpdate();

	const parts = interaction.customId.split('_');
	const channelToMoveId = parts[4];
	const destinationId = interaction.values[0];

	try {
		const channelToMove = await interaction.guild.channels.fetch(channelToMoveId);
		if (!channelToMove) {
			throw new Error('The channel to be moved could not be found.');
		}

		// Determine which set of channels we are working with (text/forum or voice)
		const relevantTypes = [ChannelType.GuildText, ChannelType.GuildForum].includes(channelToMove.type)
			? ['Text', 'Forum']
			: ['Voice'];

		// Get a fresh, correctly sorted list of all relevant channels in the category
		const allRelevantChannels = await getChannelsForGame(interaction, gameSession, relevantTypes, false);

		// Create a mutable copy of the channel list, removing the channel we're about to place
		const newOrder = allRelevantChannels.filter(ch => ch.id !== channelToMoveId);

		if (destinationId === 'move_to_top') {
			// Place the channel at the very beginning of the array
			newOrder.unshift(channelToMove);
		}
		else {
			// Find the index where the destination channel is in our new list
			const destinationIndex = newOrder.findIndex(ch => ch.id === destinationId);
			if (destinationIndex === -1) {
				throw new Error('The destination channel could not be found in the sorted list.');
			}
			// Insert the channelToMove right after the destination channel
			newOrder.splice(destinationIndex + 1, 0, channelToMove);
		}

		// Convert our desired channel order into the format Discord's API needs:
		// An array of { channel: [ID], position: [INDEX] } objects.
		const finalPositions = newOrder.map((channel, index) => ({
			channel: channel.id,
			position: index,
		}));

		// Execute the reorder as a single, atomic bulk update
		await interaction.guild.channels.setPositions(finalPositions);

		await interaction.editReply({ content: `✅ Successfully moved **${channelToMove.name}** to its new position.`, components: [] });

	}
	catch (error) {
		console.error('[Reorder Execution Error]', error);
		await interaction.editReply({ content: `❌ An error occurred while reordering the channels. ${error.message}`, components: [] });
	}
}


// --- STEP 2 (Alternate): SELECT MENU HANDLER (Presents final modal) ---

async function handleChannelSelection(interaction, gameSession, action) {
	const channelId = interaction.values[0];
	const channel = await interaction.guild.channels.fetch(channelId);

	if (action === 'delete') {
		try {
			await channel.delete(`Deleted by DM ${interaction.user.tag}`);
			db.prepare('DELETE FROM game_channels WHERE channel_id = ?').run(channelId);
			return interaction.update({ content: `✅ Successfully deleted channel **${channel.name}**.`, components: [] });
		}
		catch (err) {
			console.error('Channel deletion failed:', err);
			return interaction.update({ content: '❌ Could not delete the channel (permissions or hierarchy).', components: [] });
		}
	}

	// For edit, the action in the customId is 'edit', but the modal needs to be 'edit_description'
	const modalAction = action === 'edit' ? 'edit_description' : `${action}_channel`;

	const modal = new ModalBuilder()
		.setCustomId(`gm_modal_${modalAction}_${gameSession.game_id}`)
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
		return interaction.reply({ content: '❌ "category-management" is a reserved name.', flags: MessageFlags.Ephemeral });
	}

	const finalName = type === 'voice' ? channelName : sanitizedName;
	if (!finalName || finalName.length < 1 || finalName.length > 100) {
		return interaction.reply({ content: '❌ Channel name must be between 1 and 100 characters after sanitization.', flags: MessageFlags.Ephemeral });
	}

	let newChannel;
	try {
		newChannel = await interaction.guild.channels.create({
			name: finalName,
			type: type === 'text' ? ChannelType.GuildText : type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildForum,
			parent: gameSession.category_id,
		});
	}
	catch (err) {
		console.error('Channel creation failed:', err);
		return interaction.reply({ content: '❌ Failed to create the channel (check permissions and category).', flags: MessageFlags.Ephemeral });
	}

	db.prepare('INSERT INTO game_channels (channel_id, game_id, channel_type) VALUES (?, ?, ?)')
		.run(newChannel.id, gameSession.game_id, type.charAt(0).toUpperCase() + type.slice(1));

	await interaction.reply({ content: `✅ Successfully created ${type} channel: ${newChannel}`, flags: MessageFlags.Ephemeral });
}

async function handleRenameCategorySubmit(interaction, gameSession) {
	const newName = interaction.fields.getTextInputValue('category_name');
	const category = await interaction.guild.channels.fetch(gameSession.category_id);
	const role = await interaction.guild.roles.fetch(gameSession.key_role_id);

	if (!category || !role) {
		return interaction.reply({ content: '❌ Could not find the category or the key role for this game.', flags: MessageFlags.Ephemeral });
	}
	try {
		await category.setName(newName);
		await role.setName(`Key: ${newName}`);
		db.prepare('UPDATE game_sessions SET game_name = ? WHERE game_id = ?').run(newName, gameSession.game_id);
	}
	catch (err) {
		console.error('Rename category/role failed:', err);
		return interaction.reply({ content: '❌ Failed to rename category or role. Check permissions and role hierarchy.', flags: MessageFlags.Ephemeral });
	}

	await interaction.reply({ content: `✅ Category and role successfully renamed to "${newName}".`, flags: MessageFlags.Ephemeral });
}

async function handleRenameChannelSubmit(interaction) {
	const textInput = interaction.fields.components[0].components[0];
	const channelId = textInput.customId.replace('new_name_', '');
	const newName = textInput.value;

	const channel = await interaction.guild.channels.fetch(channelId);
	const sanitizedName = newName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

	if (sanitizedName === 'category-management') {
		return interaction.reply({ content: '❌ You cannot rename a channel to "category-management".', flags: MessageFlags.Ephemeral });
	}

	const finalName = channel.type === ChannelType.GuildVoice ? newName : sanitizedName;
	await channel.setName(finalName);
	await interaction.reply({ content: `✅ Channel successfully renamed to **${finalName}**.`, flags: MessageFlags.Ephemeral });
}

async function handleEditDescriptionSubmit(interaction) {
	const textInput = interaction.fields.components[0].components[0];
	const channelId = textInput.customId.replace('new_description_', '');
	const newDescription = textInput.value;

	const channel = await interaction.guild.channels.fetch(channelId);
	if (![ChannelType.GuildText, ChannelType.GuildForum].includes(channel.type)) {
		return interaction.reply({
			content: '❌ This action is only supported for text and forum channels.',
			flags: MessageFlags.Ephemeral,
		});
	}
	await channel.setTopic(newDescription);

	await interaction.reply({ content: `✅ Successfully updated the description for ${channel}.`, flags: MessageFlags.Ephemeral });
}


// --- Player Management (No Modal Needed) ---
async function handleManagePlayers(interaction, gameSession) {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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