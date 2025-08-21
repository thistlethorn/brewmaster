// commands/charsys/pve.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } = require('discord.js');
const db = require('../../database');

/**
 * Handles the /pve list subcommand.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleList(interaction) {
	const userId = interaction.user.id;
	const character = db.prepare('SELECT level FROM characters WHERE user_id = ?').get(userId);

	if (!character) {
		return interaction.reply({ content: 'You must create a character first with `/character create`.', flags: MessageFlags.Ephemeral });
	}

	const nodes = db.prepare('SELECT * FROM pve_nodes ORDER BY required_level ASC').all();

	const embed = new EmbedBuilder()
		.setColor(0xE67E22)
		.setTitle('🗺️ Available Adventures')
		.setDescription('Here are the locations you can explore. Use `/pve engage` to start a battle.');

	if (nodes.length === 0) {
		embed.setDescription('There are no adventures available at this time.');
	}
	else {
		nodes.forEach(node => {
			const canEnter = character.level >= node.required_level;
			const statusEmoji = canEnter ? '✅' : '❌';
			embed.addFields({
				name: `${statusEmoji} ${node.name} (Lvl. ${node.required_level} Required)`,
				value: `*${node.description}*`,
				inline: false,
			});
		});
	}

	await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * Handles the /pve engage subcommand.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleEngage(interaction) {
	const userId = interaction.user.id;
	const nodeId = interaction.options.getInteger('adventure');

	const character = db.prepare('SELECT character_name, level, character_status FROM characters WHERE user_id = ?').get(userId);
	if (!character) {
		return interaction.reply({ content: 'You must create a character first with `/character create`.', flags: MessageFlags.Ephemeral });
	}
	if (character.character_status !== 'IDLE') {
		return interaction.reply({ content: `You cannot start a new battle while your status is "${character.character_status}".`, flags: MessageFlags.Ephemeral });
	}

	const node = db.prepare('SELECT * FROM pve_nodes WHERE node_id = ?').get(nodeId);
	if (!node) {
		return interaction.reply({ content: 'That adventure could not be found.', flags: MessageFlags.Ephemeral });
	}
	if (character.level < node.required_level) {
		return interaction.reply({ content: `You are not a high enough level for this adventure. You need to be Level ${node.required_level}.`, flags: MessageFlags.Ephemeral });
	}

	try {
		await interaction.reply({ content: 'Creating your battle instance...', flags: MessageFlags.Ephemeral });

		// Set character status to 'IN_COMBAT'
		db.prepare('UPDATE characters SET character_status = ? WHERE user_id = ?').run('IN_COMBAT', userId);

		const thread = await interaction.channel.threads.create({
			name: `[Adventure] ${character.character_name} vs. ${node.name}`,
			type: ChannelType.PrivateThread,
			reason: `PvE combat instance for ${interaction.user.tag}`,
		});

		await thread.members.add(userId);

		// Placeholder for initial combat embed - this will be expanded in the next chunk.
		const combatEmbed = new EmbedBuilder()
			.setColor(0xC0392B)
			.setTitle(`⚔️ Adventure Started: ${node.name} ⚔️`)
			.setDescription('The battle is about to begin! Prepare yourself.')
			.setFooter({ text: 'Combat system coming in the next update!' });

		await thread.send({ content: `<@${userId}>`, embeds: [combatEmbed] });
		await interaction.editReply({ content: `Your adventure begins! Join the battle here: ${thread}` });

	}
	catch (error) {
		console.error('Failed to create PvE thread:', error);
		// Revert status if thread creation fails
		db.prepare('UPDATE characters SET character_status = ? WHERE user_id = ?').run('IDLE', userId);
		await interaction.editReply({ content: 'Failed to create your private battle instance. Please try again.' });
	}
}

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('pve')
		.setDescription('Engage in combat and explore available adventures.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('list')
				.setDescription('List all available adventures.'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('engage')
				.setDescription('Start an adventure.')
				.addIntegerOption(option =>
					option.setName('adventure')
						.setDescription('The adventure you want to start.')
						.setRequired(true)
						.setAutocomplete(true))),

	async autocomplete(interaction) {
		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'engage') {
			const userId = interaction.user.id;
			const character = db.prepare('SELECT level FROM characters WHERE user_id = ?').get(userId);
			const userLevel = character ? character.level : 0;

			const nodes = db.prepare('SELECT node_id, name, required_level FROM pve_nodes WHERE required_level <= ? ORDER BY required_level ASC')
				.all(userLevel);

			await interaction.respond(
				nodes.map(node => ({
					name: `${node.name} (Lvl. ${node.required_level})`,
					value: node.node_id,
				})),
			);
		}
	},

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();

		switch (subcommand) {
		case 'list':
			await handleList(interaction);
			break;
		case 'engage':
			await handleEngage(interaction);
			break;
		default:
			await interaction.reply({ content: 'Unknown PvE command.', flags: MessageFlags.Ephemeral });
		}
	},
};