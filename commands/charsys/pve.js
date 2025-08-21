// commands/charsys/pve.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database');
const { addXp } = require('../../utils/addXp');

// In-memory store for active combat sessions.
// Key: threadId, Value: { combat state object }
const activeCombats = new Map();

/**
 * Creates the main combat UI embed.
 * @param {object} combatState The current state of the combat encounter.
 * @param {import('discord.js').User} user The user object for the player.
 * @returns {EmbedBuilder} The generated embed.
 */
function buildCombatEmbed(combatState, user) {
	const embed = new EmbedBuilder()
		.setColor(0xC0392B)
		.setTitle(`⚔️ Combat: ${combatState.nodeData.name} ⚔️`)
		.setAuthor({ name: user.username, iconURL: user.displayAvatarURL() });

	const playerStatus = `❤️ **HP:** \`${combatState.character.current_health} / ${combatState.character.max_health}\`\n` +
	                     `💙 **Mana:** \`${combatState.character.current_mana} / ${combatState.character.max_mana}\``;
	embed.addFields({ name: 'Your Status', value: playerStatus, inline: false });

	const monsterStatus = combatState.monsters.map((monster, index) => {
		const healthBar = monster.current_health > 0 ? '❤️' : '💀';
		return `**${monster.name} #${index + 1}**: ${healthBar} \`${monster.current_health} / ${monster.max_health}\` HP`;
	}).join('\n');
	embed.addFields({ name: 'Enemies', value: monsterStatus, inline: false });

	if (combatState.combatLog.length > 0) {
		embed.addFields({ name: 'Combat Log', value: combatState.combatLog.slice(-5).join('\n'), inline: false });
	}

	return embed;
}

/**
 * Handles the final victory sequence, distributing rewards and loot.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} combatState The final state of the combat encounter.
 */
async function handleVictory(interaction, combatState) {
	const { userId, nodeData, thread } = combatState;
	const victoryEmbed = new EmbedBuilder()
		.setColor(0x2ECC71)
		.setTitle(`🎉 Victory at ${nodeData.name}! 🎉`)
		.setDescription('You have emerged victorious from battle!');

	// 1. Grant Rewards (XP & Crowns)
	const progress = db.prepare('SELECT times_cleared FROM character_pve_progress WHERE user_id = ? AND node_id = ?').get(userId, nodeData.node_id);
	const isFirstClear = !progress || progress.times_cleared === 0;
	const rewardJson = isFirstClear ? nodeData.first_completion_reward_json : nodeData.repeatable_reward_json;
	const rewards = JSON.parse(rewardJson);

	const rewardText = [];
	if (rewards.xp > 0) {
		await addXp(userId, rewards.xp, interaction);
		rewardText.push(`**${rewards.xp}** XP`);
	}
	if (rewards.crowns > 0) {
		db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(rewards.crowns, userId);
		rewardText.push(`**${rewards.crowns}** Crowns`);
	}
	victoryEmbed.addFields({ name: 'Rewards Gained', value: rewardText.join('\n') });

	// 2. Distribute Loot
	const lootedItems = [];
	const lootTransaction = db.transaction(() => {
		for (const monster of combatState.monsters) {
			if (!monster.loot_table_id) continue;
			const entries = db.prepare(`
				SELECT lte.*, i.name as item_name 
				FROM loot_table_entries lte 
				JOIN items i ON lte.item_id = i.item_id 
				WHERE lte.loot_table_id = ?
			`).all(monster.loot_table_id);

			for (const entry of entries) {
				if (Math.random() < entry.drop_chance) {
					const quantity = Math.floor(Math.random() * (entry.max_quantity - entry.min_quantity + 1)) + entry.min_quantity;
					db.prepare(
					  'INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, ?) ' +
					  'ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity',
					).run(userId, entry.item_id, quantity);
					lootedItems.push(`• ${entry.item_name} x${quantity}`);
				}
			}
		}
	});

	lootTransaction();
	if (lootedItems.length > 0) {
		victoryEmbed.addFields({ name: 'Loot Acquired', value: lootedItems.join('\n') });
	}

	// 3. Cleanup
	db.prepare('UPDATE characters SET character_status = \'IDLE\' WHERE user_id = ?').run(userId);
	db.prepare('INSERT INTO character_pve_progress (user_id, node_id, times_cleared, last_cleared_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, node_id) DO UPDATE SET times_cleared = times_cleared + 1, last_cleared_at = excluded.last_cleared_at')
		.run(userId, nodeData.node_id, new Date().toISOString());
	activeCombats.delete(thread.id);

	await thread.send({ embeds: [victoryEmbed] });
	await thread.setLocked(true);
	await thread.setArchived(true);
}

/**
 * Handles the defeat sequence.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} combatState The final state of the combat encounter.
 */
async function handleDefeat(interaction, combatState) {
	const { userId, nodeData, thread } = combatState;
	const defeatEmbed = new EmbedBuilder()
		.setColor(0x992D22)
		.setTitle(`Defeated at ${nodeData.name}...`)
		.setDescription('You have fallen in battle. You awaken back at the Tavern, having lost your way.');

	// Cleanup
	db.prepare('UPDATE characters SET character_status = \'IDLE\' WHERE user_id = ?').run(userId);
	activeCombats.delete(thread.id);

	await thread.send({ embeds: [defeatEmbed] });
	await thread.setLocked(true);
	await thread.setArchived(true);
}

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

	const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
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

		const monsterComposition = JSON.parse(node.monster_composition_json);
		const monsters = [];
		for (const comp of monsterComposition) {
			const monsterData = db.prepare('SELECT * FROM monsters WHERE name = ?').get(comp.name);
			if (!monsterData) {
				throw new Error(`Monster "${comp.name}" not found in database`);
			}
			for (let i = 0; i < comp.count; i++) {
				monsters.push({ ...monsterData, current_health: monsterData.max_health });
			}
		}
		const combatState = {
			userId,
			thread,
			nodeData: node,
			character: { ...character },
			monsters,
			combatLog: ['The battle begins!'],
		};
		activeCombats.set(thread.id, combatState);

		const combatEmbed = buildCombatEmbed(combatState, interaction.user);
		const actionButtons = new ActionRowBuilder();
		combatState.monsters.forEach((monster, index) => {
			actionButtons.addComponents(
				new ButtonBuilder()
					.setCustomId(`pve_attack_${thread.id}_${index}`)
					.setLabel(`Attack ${monster.name} #${index + 1}`)
					.setStyle(ButtonStyle.Danger),
			);
		});

		await thread.send({ content: `<@${userId}>`, embeds: [combatEmbed], components: [actionButtons] });
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

module.exports.buttons = async (interaction) => {
	// eslint-disable-next-line no-unused-vars
	const [_, action, threadId, targetIndexStr] = interaction.customId.split('_');
	const targetIndex = parseInt(targetIndexStr);

	const combatState = activeCombats.get(threadId);
	if (!combatState || combatState.userId !== interaction.user.id) {
		return interaction.reply({ content: 'This is not your combat instance or it has expired.', flags: MessageFlags.Ephemeral });
	}

	await interaction.deferUpdate();

	if (action === 'attack') {
		const character = combatState.character;
		const monster = combatState.monsters[targetIndex];

		if (monster.current_health <= 0) return;

		// Player's turn
		const playerDamage = Math.max(1, character.stat_might);
		monster.current_health = Math.max(0, monster.current_health - playerDamage);
		combatState.combatLog.push(`> You attack **${monster.name} #${targetIndex + 1}** for **${playerDamage}** damage.`);
		if (monster.current_health === 0) {
			combatState.combatLog.push(`> **${monster.name} #${targetIndex + 1}** has been defeated!`);
		}

		// Check for victory
		const allMonstersDefeated = combatState.monsters.every(m => m.current_health <= 0);
		if (allMonstersDefeated) {
			return handleVictory(interaction, combatState);
		}

		// Monsters' turn
		combatState.monsters.forEach((m, i) => {
			if (m.current_health > 0) {
				const monsterDamage = Math.max(1, m.base_damage);
				character.current_health = Math.max(0, character.current_health - monsterDamage);
				combatState.combatLog.push(`< **${m.name} #${i + 1}** attacks you for **${monsterDamage}** damage.`);
			}
		});

		// Check for defeat
		if (character.current_health === 0) {
			return handleDefeat(interaction, combatState);
		}

		// Update UI
		const updatedEmbed = buildCombatEmbed(combatState, interaction.user);
		await interaction.editReply({ embeds: [updatedEmbed] });
	}
};