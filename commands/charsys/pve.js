// commands/charsys/pve.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database');
const { addXp } = require('../../utils/addXp');

// In-memory store for active combat sessions.
// Key: threadId, Value: { combat state object }
const activeCombats = new Map();

// Cleanup stale combats after 1 hour
setInterval(() => {
	const oneHourAgo = Date.now() - 60 * 60 * 1000;
	for (const [threadId, combat] of activeCombats.entries()) {
		if (combat.startTime < oneHourAgo) {
			activeCombats.delete(threadId);
			// Also update DB to set status to IDLE if still IN_COMBAT
			db.prepare('UPDATE characters SET character_status = \'IDLE\' WHERE user_id = ? AND character_status = \'IN_COMBAT\'')
				.run(combat.userId);
		}
	}
}, 5 * 60 * 1000);

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
	let rewards = {};
	if (rewardJson) {
		try {
			rewards = JSON.parse(rewardJson);
		}
		catch (error) {
			console.error(`Failed to parse reward JSON for node ${nodeData.node_id}:`, error);
			rewards = {};
		}
	}
	rewards.xp = Number(rewards.xp) || 0;
	rewards.crowns = Number(rewards.crowns) || 0;

	const rewardText = [];

	  const lootedItems = [];
	try {
		// XP (async)
		if (rewards.xp > 0) {
			try {
				await addXp(userId, rewards.xp, interaction);
				rewardText.push(`**${rewards.xp}** XP`);
			}
			catch (err) {
				console.error('Failed to grant XP:', err);
				victoryEmbed.addFields({ name: 'XP Grant Failed', value: 'XP could not be awarded due to an internal error.' });
			}
		}
		// Crowns (sync)
		if (rewards.crowns > 0) {
			rewardText.push(`**${rewards.crowns}** Crowns`);
		}
		if (rewardText.length > 0) {
			victoryEmbed.addFields({ name: 'Rewards Gained', value: rewardText.join('\n') });
		}
		// Loot
		const lootTransaction = db.transaction(() => {
			for (const monster of combatState.monsters) {
				if (!monster.loot_table_id) continue;
				const entries = db.prepare(`
          SELECT lte.*, i.name AS item_name, i.is_stackable AS is_stackable
          FROM loot_table_entries lte
          JOIN items i ON lte.item_id = i.item_id
          WHERE lte.loot_table_id = ?
        `).all(monster.loot_table_id);
				for (const entry of entries) {
					if (Math.random() < entry.drop_chance) {
						const quantity = Math.floor(Math.random() * (entry.max_quantity - entry.min_quantity + 1)) + entry.min_quantity;
						if (entry.is_stackable === 1) {
							const existing = db.prepare('SELECT inventory_id, quantity FROM user_inventory WHERE user_id = ? AND item_id = ? AND equipped_slot IS NULL')
								.get(userId, entry.item_id);
							if (existing) {
								db.prepare('UPDATE user_inventory SET quantity = quantity + ? WHERE inventory_id = ?').run(quantity, existing.inventory_id);
							}
							else {
								db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, ?)').run(userId, entry.item_id, quantity);
							}
						}
						else {
							for (let n = 0; n < quantity; n++) {
								db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)').run(userId, entry.item_id);
							}
						}
						lootedItems.push(`• ${entry.item_name} x${quantity}`);
					}
				}
			}
		});
		lootTransaction();
	}
	catch (error) {
		console.error('Victory processing failed:', error);
		victoryEmbed.addFields({ name: '⚠️ Warning', value: 'Some rewards could not be processed. Please contact an admin.' });
	}
	finally {
		// 3. Cleanup (always)
		db.transaction(() => {
			db.prepare(`
					INSERT INTO user_economy (user_id, crowns)
					VALUES (?, ?)
					ON CONFLICT(user_id) DO UPDATE SET crowns = user_economy.crowns + excluded.crowns
				`).run(userId, rewards.crowns);
			db.prepare('UPDATE characters SET character_status = \'IDLE\' WHERE user_id = ? AND character_status IN (\'IN_COMBAT\', \'VICTORY_PENDING\')').run(userId);
			db.prepare(`
        INSERT INTO character_pve_progress (user_id, node_id, times_cleared, last_cleared_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(user_id, node_id) DO UPDATE
          SET times_cleared = times_cleared + 1,
              last_cleared_at = excluded.last_cleared_at
      `).run(userId, nodeData.node_id, new Date().toISOString());
		})();
		activeCombats.delete(thread.id);
		if (lootedItems.length > 0) {
			victoryEmbed.addFields({ name: 'Loot Acquired', value: lootedItems.join('\n') });
		}
		try {
			await thread.send({ embeds: [victoryEmbed] });
			await thread.setLocked(true);
			await thread.setArchived(true);
		}
		catch (error) {
			console.error('Failed to cleanup thread after victory:', error);
		}
	}
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

	try {
		await thread.send({ embeds: [defeatEmbed] });
		await thread.setLocked(true);
		await thread.setArchived(true);
	}
	catch (error) {
		console.error('Failed to cleanup thread after defeat:', error);
	}
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


		const parent = interaction.channel;
		if (!parent?.isTextBased?.() || parent.type === ChannelType.DM || !parent.threads) {
			return interaction.editReply({ content: 'This command must be used in a server text channel that supports private threads.', flags: MessageFlags.Ephemeral });
		}
		const thread = await parent.threads.create({
			name: `[Adventure] ${character.character_name} vs. ${node.name}`,
			type: ChannelType.PrivateThread,
			reason: `PvE combat instance for ${interaction.user.tag}`,
		});

		// Set character status to 'IN_COMBAT'
		db.prepare('UPDATE characters SET character_status = ? WHERE user_id = ?').run('IN_COMBAT', userId);

		await thread.members.add(userId);

		const monsterComposition = db.prepare(`
            SELECT m.*, pnm.count 
            FROM pve_node_monsters pnm
            JOIN monsters m ON pnm.monster_id = m.monster_id
            WHERE pnm.node_id = ?
        `).all(nodeId);

		if (!monsterComposition || monsterComposition.length === 0) {
			await thread.setLocked(true);
			await thread.setArchived(true);
			db.prepare('UPDATE characters SET character_status = ? WHERE user_id = ? AND character_status = ?').run('IDLE', userId, 'IN_COMBAT');
			return interaction.editReply({ content: 'This adventure has no monsters configured. Please contact an admin.' });
		}

		const monsters = [];
		for (const monsterData of monsterComposition) {
			for (let i = 0; i < monsterData.count; i++) {
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
		const actionRows = [];
		const MAX_ROWS = 5;
		const MAX_PER_ROW = 5;

		let currentRow = new ActionRowBuilder();
		let rowCount = 0;
		let btnInRow = 0;

		for (let index = 0; index < combatState.monsters.length && rowCount < MAX_ROWS; index++) {
			const monster = combatState.monsters[index];
			if (btnInRow === MAX_PER_ROW) {
				actionRows.push(currentRow);
				currentRow = new ActionRowBuilder();
				btnInRow = 0;
				rowCount++;
				if (rowCount === MAX_ROWS) break;
			}
			currentRow.addComponents(
				new ButtonBuilder()
					.setCustomId(`pve_attack_${thread.id}_${index}`)
					.setLabel(`Attack ${monster.name} #${index + 1}`)
					.setStyle(ButtonStyle.Danger),
			);
			btnInRow++;
		}

		if (btnInRow > 0 && rowCount < MAX_ROWS) actionRows.push(currentRow);

		const truncated = combatState.monsters.length > MAX_ROWS * MAX_PER_ROW;
		const note = truncated ? `Note: showing first ${MAX_ROWS * MAX_PER_ROW} targets.\n` : '';

		await thread.send({ content: `${note}<@${userId}>`, embeds: [combatEmbed], components: actionRows });
		await interaction.editReply({ content: `Your adventure begins! Join the battle here: ${thread}` });

	}
	catch (error) {
		console.error('Failed to create PvE thread:', error);
		// Revert status if thread creation fails
		db.prepare('UPDATE characters SET character_status = ? WHERE user_id = ? AND character_status = ?').run('IDLE', userId, 'IN_COMBAT');
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

/**
* PvE buttons handler.
* Expected customId format: pve_attack_threadId_index
* @param {import('discord.js').ButtonInteraction} interaction
*/
module.exports.buttons = async (interaction) => {
	// eslint-disable-next-line no-unused-vars
	const [_, action, threadId, targetIndexStr] = interaction.customId.split('_');
	const targetIndex = Number.parseInt(targetIndexStr, 10);
	if (!Number.isInteger(targetIndex)) {
		return interaction.reply({ content: 'Invalid target.', flags: MessageFlags.Ephemeral });
	}

	const combatState = activeCombats.get(threadId);
	if (!combatState || combatState.userId !== interaction.user.id) {
		return interaction.reply({ content: 'This is not your combat instance or it has expired.', flags: MessageFlags.Ephemeral });
	}
	if (targetIndex < 0 || targetIndex >= combatState.monsters.length) {
		return interaction.reply({ content: 'That target is no longer valid.', flags: MessageFlags.Ephemeral });
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
			if (combatState.isProcessingVictory) return;
			combatState.isProcessingVictory = true;
			// Immediately mark the victory in the database to prevent loss
			let updated = 0;
			try {
				updated = db.transaction(() => {
					const res = db.prepare(
						'UPDATE characters SET character_status = \'VICTORY_PENDING\' WHERE user_id = ? AND character_status = \'IN_COMBAT\'',
					).run(combatState.userId);
					return res.changes || 0;
				})();
			}
			catch (error) {
				console.error('Failed to update character status to VICTORY_PENDING:', error);
			}
			if (updated === 1) {
				return handleVictory(interaction, combatState);
			}
			// Someone else already resolved victory; just no-op the UI update.
			return;
		}

		// Monsters' turn
		combatState.monsters.forEach((m, i) => {
			if (m.current_health > 0) {
				const monsterDamage = Math.max(1, m.base_damage);
				character.current_health = Math.max(0, character.current_health - monsterDamage);
				combatState.combatLog.push(`> **${m.name} #${i + 1}** attacks you for **${monsterDamage}** damage.`);
			}
		});

		// Check for defeat
		if (character.current_health === 0) {
			return handleDefeat(interaction, combatState);
		}

		// Update UI
		 const updatedEmbed = buildCombatEmbed(combatState, interaction.user);
		if (interaction.message) {
			await interaction.message.edit({ embeds: [updatedEmbed] });
		}
		else {
			await interaction.editReply({ embeds: [updatedEmbed] });
		}
	}
};