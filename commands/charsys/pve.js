// commands/charsys/pve.js

const path = require('path');
const { checkBetatestLock } = require(`${global.__utils}/betaLock.js`);
const commandFilename = path.basename(__filename);
const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../database');
const { addXp } = require('../../utils/addXp');

// In-memory store for active combat sessions.
// Key: threadId, Value: { combat state object }
const activeCombats = new Map();

// Cleanup stale combats every hour
const CLEANUP_INTERVAL = 60 * 60 * 1000;
const COMBAT_TIMEOUT = 60 * 60 * 1000;

const cleanupIntervalId = setInterval(() => {
	const oneHourAgo = Date.now() - COMBAT_TIMEOUT;
	for (const [threadId, combat] of activeCombats.entries()) {
		if (!combat.startTime || combat.startTime < oneHourAgo) {
			activeCombats.delete(threadId);
			// Also update DB to set status to IDLE if still IN_COMBAT
			db.prepare(`
				UPDATE characters SET character_status = 'IDLE' WHERE user_id = ? AND character_status = 'IN_COMBAT'
			`).run(combat.userId);
		}
	}
}, CLEANUP_INTERVAL);
/**
 * Parses a dice/value string (e.g., '2d6+3', '1d8', '10') and returns a numeric result.
 * @param {string} valueString The dice notation or flat number string.
 * @returns {number} The result of the roll or the parsed number.
 */
function parseEffectValue(valueString) {
	if (!valueString) return 0;
	const value = String(valueString);

	// If it's just a number
	if (/^\d+$/.test(value)) {
		return parseInt(value, 10);
	}

	// If it's dice notation (e.g., 1d6, 2d8+4)
	const diceRegex = /(\d+)d(\d+)(?:\s*\+\s*(\d+))?/;
	const match = value.match(diceRegex);

	if (match) {
		const numDice = parseInt(match[1], 10);
		const numSides = parseInt(match[2], 10);
		const modifier = match[3] ? parseInt(match[3], 10) : 0;

		let total = 0;
		for (let i = 0; i < numDice; i++) {
			total += Math.floor(Math.random() * numSides) + 1;
		}
		return total + modifier;
	}

	// Fallback for invalid strings
	return 0;
}
/**
 * Creates the main combat UI embed and components based on the player's current action state.
 * @param {object} combatState The current state of the combat encounter.
 * @param {import('discord.js').User} user The user object for the player.
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function buildCombatUI(combatState, user) {
	const embed = new EmbedBuilder()
		.setColor(0xC0392B)
		.setTitle(`⚔️ Combat: ${combatState.nodeData.name} - Turn ${combatState.turn} ⚔️`)
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
		embed.addFields({ name: '📜 Combat Log', value: combatState.combatLog.slice(-10).join('\n'), inline: false });
	}

	const components = [];
	const threadId = combatState.thread.id;

	switch (combatState.playerState) {
	case 'SELECTING_TARGET': {
		embed.setFooter({ text: 'Select a target to attack.' });
		let currentRow = new ActionRowBuilder();
		for (let i = 0; i < combatState.monsters.length; i++) {
			if (currentRow.components.length === 5) {
				components.push(currentRow);
				currentRow = new ActionRowBuilder();
			}
			const monster = combatState.monsters[i];
			const isDefeated = monster.current_health <= 0;
			currentRow.addComponents(
				new ButtonBuilder()
					.setCustomId(`pve_target_attack_${threadId}_${i}`)
					.setLabel(isDefeated ? `💀 ${monster.name} #${i + 1}` : `Attack ${monster.name} #${i + 1}`)
					.setStyle(isDefeated ? ButtonStyle.Secondary : ButtonStyle.Danger)
					.setDisabled(isDefeated),
			);
		}
		if (currentRow.components.length > 0) components.push(currentRow);
		components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pve_back_main_${threadId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)));
		break;
	}
	case 'SELECTING_SPELL_TARGET': {
		const spellId = combatState.selectedSpellId;
		const spell = db.prepare('SELECT name FROM spells WHERE spell_id = ?').get(spellId);
		embed.setFooter({ text: `Select a target for ${spell.name}.` });
		let currentRow = new ActionRowBuilder();
		for (let i = 0; i < combatState.monsters.length; i++) {
			if (currentRow.components.length === 5) {
				components.push(currentRow);
				currentRow = new ActionRowBuilder();
			}
			const monster = combatState.monsters[i];
			const isDefeated = monster.current_health <= 0;
			currentRow.addComponents(
				new ButtonBuilder()
					.setCustomId(`pve_target_spell_${threadId}_${spellId}_${i}`)
					.setLabel(isDefeated ? `💀 ${monster.name} #${i + 1}` : `Cast on ${monster.name} #${i + 1}`)
					.setStyle(isDefeated ? ButtonStyle.Secondary : ButtonStyle.Primary)
					.setDisabled(isDefeated),
			);
		}
		if (currentRow.components.length > 0) components.push(currentRow);
		components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pve_back_main_${threadId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)));
		break;
	}
	case 'SELECTING_SPELL': {
		embed.setFooter({ text: 'Select a spell to cast from your spellbook.' });
		const knownSpells = db.prepare(`
            SELECT s.* FROM character_spells cs
            JOIN spells s ON cs.spell_id = s.spell_id
            WHERE cs.user_id = ?
            ORDER BY s.name ASC
        `).all(combatState.userId);

		const castableSpells = knownSpells.filter(s => s.mana_cost <= combatState.character.current_mana);

		if (castableSpells.length > 0) {
			const spellMenu = new StringSelectMenuBuilder()
				.setCustomId(`pve_menu_spell_${threadId}`)
				.setPlaceholder('Choose a spell...')
				.addOptions(castableSpells.map(spell => ({
					label: `${spell.name} (${spell.mana_cost} Mana)`,
					description: spell.description.substring(0, 100),
					value: spell.spell_id.toString(),
				})));
			components.push(new ActionRowBuilder().addComponents(spellMenu));
		}
		else {
			embed.setDescription((embed.data.description || '') + '\n\n*You don\'t have enough mana or don\'t know any spells.*');
		}
		components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pve_back_main_${threadId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)));
		break;
	}
	case 'SELECTING_ITEM': {
		embed.setFooter({ text: 'Select an item to use from your inventory.' });
		const consumableItems = db.prepare(`
            SELECT ui.inventory_id, i.name, i.description, ui.quantity
            FROM user_inventory ui
            JOIN items i ON ui.item_id = i.item_id
            WHERE ui.user_id = ? AND i.item_type = 'CONSUMABLE' AND ui.quantity > 0
            ORDER BY i.name ASC
            LIMIT 25
        `).all(combatState.userId);

		if (consumableItems.length > 0) {
			const itemMenu = new StringSelectMenuBuilder()
				.setCustomId(`pve_menu_item_${threadId}`)
				.setPlaceholder('Choose an item...')
				.addOptions(consumableItems.map(item => ({
					label: `${item.name} (x${item.quantity})`,
					description: item.description.substring(0, 100),
					value: item.inventory_id.toString(),
				})));
			components.push(new ActionRowBuilder().addComponents(itemMenu));
		}
		else {
			embed.setDescription((embed.data.description || '') + '\n\n*You have no consumable items to use.*');
		}

		components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pve_back_main_${threadId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)));
		break;
	}
	default: {
		// 'MAIN' state
		embed.setFooter({ text: 'Your turn to act!' });
		const character = combatState.character;
		const mainRow = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`pve_main_fight_${threadId}`).setLabel('Fight').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
			new ButtonBuilder().setCustomId(`pve_main_magic_${threadId}`).setLabel('Magic').setStyle(ButtonStyle.Primary).setEmoji('✨').setDisabled(character.stat_wits < 10),
			new ButtonBuilder().setCustomId(`pve_main_items_${threadId}`).setLabel('Items').setStyle(ButtonStyle.Success).setEmoji('🎒'),
			new ButtonBuilder().setCustomId(`pve_main_flee_${threadId}`).setLabel('Flee').setStyle(ButtonStyle.Secondary).setEmoji('🏃'),
		);
		components.push(mainRow);
		break;
	}
	}

	return { embeds: [embed], components };
}

/**
 * Handles the final victory sequence, distributing rewards and loot.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} combatState The final state of the combat encounter.
 */
async function handleVictory(interaction, combatState) {
	const { userId, nodeData, thread, turn, character, critsThisFight } = combatState;
	// Final DB updates in a transaction
	try {
		const victoryTransaction = db.transaction(() => {

			// Update core character stats and PERSIST HEALTH/MANA
			db.prepare(`
                UPDATE characters
                SET
                    character_status = 'IDLE',
                    current_health = ?,
                    current_mana = ?,
                    monsters_slain = monsters_slain + ?,
                    critical_hits_landed = critical_hits_landed + ?,
                    character_status_expiry_time = NULL
                WHERE user_id = ?
            `).run(character.current_health, character.current_mana, combatState.monsters.length, critsThisFight, userId);

			// Update progress and check for fastest clear
			const progress = db.prepare('SELECT fastest_clear_turns FROM character_pve_progress WHERE user_id = ? AND node_id = ?').get(userId, nodeData.node_id);
			const newBestTime = !progress || !progress.fastest_clear_turns || turn < progress.fastest_clear_turns;
			db.prepare(`
                INSERT INTO character_pve_progress (user_id, node_id, attempts, times_cleared, last_cleared_at, fastest_clear_turns)
                VALUES (?, ?, 1, 1, ?, ?)
                ON CONFLICT(user_id, node_id) DO UPDATE SET
                    attempts = attempts + 1,
                    times_cleared = times_cleared + 1,
                    last_cleared_at = excluded.last_cleared_at,
                    fastest_clear_turns = CASE
                        WHEN excluded.fastest_clear_turns < character_pve_progress.fastest_clear_turns OR character_pve_progress.fastest_clear_turns IS NULL
                        THEN excluded.fastest_clear_turns
                        ELSE character_pve_progress.fastest_clear_turns
                    END
            `).run(userId, nodeData.node_id, new Date().toISOString(), turn);

			return { newBestTime };
		});

		const { newBestTime } = victoryTransaction();

		// Now handle rewards and embed creation
		const isFirstClear = !db.prepare('SELECT 1 FROM character_pve_progress WHERE user_id = ? AND node_id = ? AND times_cleared > 1').get(userId, nodeData.node_id);
		const rewardJson = isFirstClear ? nodeData.first_completion_reward_json : nodeData.repeatable_reward_json;
		let rewards = { xp: 0, crowns: 0 };
		if (rewardJson) rewards = JSON.parse(rewardJson);

		db.prepare('INSERT INTO user_economy (user_id, crowns) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + excluded.crowns').run(userId, rewards.crowns || 0);

		const reason = `__${character.character_name}__ beat ${nodeData.name}${isFirstClear ? ' for the **first time**' : newBestTime ? ' and set a **new best time** clearing the dungeon' : ''} in ${turn} turns!`;
		const title = `Victory at \`${nodeData.name}\`${isFirstClear ? ' / 🥇`First Clear!`' : newBestTime ? ' / 🆕`New Best Time!`' : ''}`;
		if (rewards.xp > 0) await addXp(userId, rewards.xp, interaction, reason, title);

		const victoryEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle(`🎉 Victory at ${nodeData.name}! 🎉`)
			.setDescription(`You emerged victorious in **${turn}** turns! Your final health is ${character.current_health} / ${character.max_health}.`);
		if (newBestTime) {
			victoryEmbed.setFooter({ text: '⭐ New Personal Best Time!' });
		}

		victoryEmbed.addFields({ name: 'Rewards', value: `\`${rewards.xp || 0}\` XP\n\`${rewards.crowns || 0}\` Crowns`, inline: true });

		await thread.send({ embeds: [victoryEmbed] });
		await thread.setLocked(true).catch((e) => {console.error(e);});
		await thread.setArchived(true).catch((e) => {console.error(e);});

	}
	catch (error) {
		console.error('Victory processing error:', error);
		await thread.send({ content: 'A critical error occurred while processing your victory rewards. Please contact an admin.' });
	}
	finally {
		activeCombats.delete(thread.id);
	}
}

/**
 * Handles the defeat sequence.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} combatState The final state of the combat encounter.
 */
async function handleDefeat(interaction, combatState) {
	const { userId, nodeData, thread, character, turn } = combatState;

	// 15 minutes
	const DEFEAT_COOLDOWN_MS = 15 * 60 * 1000;
	// 10%
	const CROWN_LOSS_PERCENT = 0.10;

	const economy = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId) || { crowns: 0 };
	const crownsLost = Math.floor(economy.crowns * CROWN_LOSS_PERCENT);

	// Calculate mandatory "Rest Up" duration after defeat cooldown
	const levelTier = Math.floor((character.level - 1) / 5) + 1;
	const longRestHours = 2 * levelTier;
	const recoveryDurationMs = longRestHours * 60 * 60 * 1000;
	const finalRecoveryTime = new Date(Date.now() + DEFEAT_COOLDOWN_MS + recoveryDurationMs).toISOString();


	let consolationXp = 0;
	if (nodeData.repeatable_reward_json) {
		try {
			const rewards = JSON.parse(nodeData.repeatable_reward_json);
			if (rewards.xp) {
				consolationXp = Math.floor(rewards.xp * 0.25);
			}
		}
		catch (e) {
			console.error('Failed to parse repeatable rewards for consolation XP:', e);
		}
	}
	const defeatEmbed = new EmbedBuilder()
		.setColor(0x992D22)
		.setTitle(`Defeated at ${nodeData.name}...`)
		.setDescription(`You have fallen in battle. You awaken back at the Tavern, having lost your way.\n\nYou earned **${consolationXp} XP** for the attempt.\n\n**Penalties:**\n• You lost **${crownsLost.toLocaleString()}** Crowns.\n• You cannot start another adventure for **15 minutes**.\n• After this, you must **Rest Up for ${longRestHours} hours** before you can fight again.`);

	// Cleanup and log the failed attempt
	db.transaction(() => {
		// Set status to DEFEATED with a 15 min expiry.
		// After this, another command will trigger the transition to RECOVERING_LONG.
		// For simplicity now, let's just set the final recovery time.
		db.prepare(`
			UPDATE characters 
			SET 
				character_status = 'RECOVERING_LONG', 
				times_fallen = times_fallen + 1,
				current_health = 1, -- Set to 1HP, not max
				current_mana = 0,
				character_status_expiry_time = ?
			WHERE user_id = ?
		`).run(finalRecoveryTime, userId);
		db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(crownsLost, userId);
		// Log the attempt without a clear
		db.prepare(`
            INSERT INTO character_pve_progress (user_id, node_id, attempts, times_cleared)
            VALUES (?, ?, 1, 0)
            ON CONFLICT(user_id, node_id) DO UPDATE SET
                attempts = attempts + 1
        `).run(userId, nodeData.node_id);
	})();

	const reason = `__${character.character_name}__ failed to beat ${nodeData.name}, but managed to outlast death for ${turn} turns!`;
	const title = `Defeat at \`${nodeData.name}\``;

	if (consolationXp > 0) {
		await addXp(userId, consolationXp, interaction, reason, title);
	}

	activeCombats.delete(thread.id);

	try {
		await thread.send({ embeds: [defeatEmbed] });
		await thread.setLocked(true).catch((e) => {console.error(e);});
		await thread.setArchived(true).catch((e) => {console.error(e);});
	}
	catch (error) {
		console.error('Failed to cleanup thread after defeat:', error);
	}
}
/**
 * Handles the successful flee sequence.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} combatState The final state of the combat encounter.
 */
async function handleFlee(interaction, combatState) {
	const { userId, nodeData, thread, character, turn, monsters } = combatState;
	const monstersSlain = monsters.filter(m => m.current_health <= 0).length;

	try {
		const fleeTransaction = db.transaction(() => {
			// Update character status back to IDLE and persist current health/mana
			db.prepare(`
                UPDATE characters
                SET
                    character_status = 'IDLE',
                    current_health = ?,
                    current_mana = ?,
                    monsters_slain = monsters_slain + ?,
                    character_status_expiry_time = NULL
                WHERE user_id = ?
            `).run(character.current_health, character.current_mana, monstersSlain, userId);

			// Log the attempt without a clear
			db.prepare(`
                INSERT INTO character_pve_progress (user_id, node_id, attempts)
                VALUES (?, ?, 1)
                ON CONFLICT(user_id, node_id) DO UPDATE SET
                    attempts = attempts + 1
            `).run(userId, nodeData.node_id);
		});

		fleeTransaction();

		// Give a small consolation XP prize for monsters defeated before fleeing
		let consolationXp = 0;
		if (monstersSlain > 0 && nodeData.repeatable_reward_json) {
			const rewards = JSON.parse(nodeData.repeatable_reward_json);
			if (rewards.xp) {
				// 15% XP per monster slain
				consolationXp = Math.floor(rewards.xp * 0.15 * monstersSlain);
			}
		}

		if (consolationXp > 0) {
			const reason = `Successfully fled from ${nodeData.name} after defeating ${monstersSlain} monster(s).`;
			const title = `Escape from \`${nodeData.name}\``;
			await addXp(userId, consolationXp, interaction, reason, title);
		}


		const fleeEmbed = new EmbedBuilder()
			.setColor(0xFFA500)
			.setTitle(`🏃 You Escaped from ${nodeData.name}!`)
			.setDescription(`You successfully fled the battle after **${turn}** turns. You catch your breath, but live to fight another day.`);

		await thread.send({ embeds: [fleeEmbed] });
		await thread.setLocked(true).catch(console.error);
		await thread.setArchived(true).catch(console.error);

	}
	catch (error) {
		console.error('Flee processing error:', error);
		await thread.send({ content: 'A critical error occurred while processing your escape. Please contact an admin.' });
	}
	finally {
		activeCombats.delete(thread.id);
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

	// Fetch fresh character data
	const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
	if (!character) {
		return interaction.reply({ content: 'You must create a character first with `/character create`.', flags: MessageFlags.Ephemeral });
	}

	// Defeat status check
	if (['DEFEATED', 'RECOVERING_SHORT', 'RECOVERING_LONG'].includes(character.character_status)) {
		const expiryTime = new Date(character.character_status_expiry_time);
		const now = new Date();
		if (now < expiryTime) {
			const expiryTimestamp = Math.floor(expiryTime.getTime() / 1000);
			return interaction.reply({ content: `You are still recovering. You can start a new adventure <t:${expiryTimestamp}:R>.`, flags: MessageFlags.Ephemeral });
		}
		else {
			// Recovery has finished! Update status and let them proceed.
			db.prepare('UPDATE characters SET character_status = \'IDLE\', character_status_expiry_time = NULL WHERE user_id = ?').run(userId);
			// Update the in-memory object so the rest of the function works correctly
			character.character_status = 'IDLE';
			await interaction.channel.send({ content: 'Your recovery is complete! You feel refreshed and ready for a new adventure.' });
		}
	}

	if (character.character_status === 'IN_COMBAT') {
		return interaction.reply({ content: `You cannot start a new battle while your status is "${character.character_status}".`, flags: MessageFlags.Ephemeral });
	}
	if (character.current_health <= 1) {
		return interaction.reply({ content: 'You are too injured to start a new adventure. You must heal first!', flags: MessageFlags.Ephemeral });
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
		if (!parent?.isTextBased?.() || parent.type === ChannelType.DM || !parent.threads || ![ChannelType.GuildText, ChannelType.GuildForum].includes(parent.type)) {
			return interaction.editReply({ content: 'This command must be used in a server text channel that supports private threads.', flags: MessageFlags.Ephemeral });
		}
		const thread = await parent.threads.create({
			name: `[Adventure] ${character.character_name} vs. ${node.name}`,
			type: ChannelType.PrivateThread,
			reason: `PvE combat instance for ${interaction.user.tag}`,
		});

		// Set character status to 'IN_COMBAT' - NO attempt logging here anymore.
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
			// Use a copy to modify during combat
			character: { ...character },
			monsters,
			combatLog: ['The battle begins!'],
			startTime: Date.now(),
			turn: 1,
			critsThisFight: 0,
			// Player's current UI state
			playerState: 'MAIN',
		};
		activeCombats.set(thread.id, combatState);

		const { embeds, components } = buildCombatUI(combatState, interaction.user);

		await thread.send({ content: `<@${userId}>`, embeds, components });
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
		if (await checkBetatestLock(interaction, commandFilename)) {
			return interaction.reply({
				content: '🍻 Apologies! This feature is currently under lock and key for some super-secret beta testing. Keep an eye on <#1385675092591378452> and <#1414069644410748938> for the full release!',
				flags: MessageFlags.Ephemeral,
			});
		}
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
	async menus(interaction) {
		const parts = interaction.customId.split('_');
		const [, category, action, threadId] = parts;

		const combatState = activeCombats.get(threadId);
		if (!combatState || combatState.userId !== interaction.user.id) {
			return interaction.reply({
				content: 'This combat instance has expired or is invalid.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await interaction.deferUpdate();

		if (category === 'menu' && action === 'item') {
			const inventoryId = parseInt(interaction.values[0], 10);
			if (isNaN(inventoryId)) return;

			await executePlayerTurn(interaction, combatState, { type: 'item', inventoryId });
			combatState.playerState = 'MAIN';
		}
		else if (category === 'menu' && action === 'spell') {
			const spellId = parseInt(interaction.values[0], 10);
			if (isNaN(spellId)) return;

			const spell = db.prepare('SELECT effects_json FROM spells WHERE spell_id = ?').get(spellId);
			const effects = JSON.parse(spell.effects_json);

			if (effects.target === 'single') {
				combatState.playerState = 'SELECTING_SPELL_TARGET';
				combatState.selectedSpellId = spellId;
			}
			else {
				await executePlayerTurn(interaction, combatState, { type: 'spell', spellId });
				combatState.playerState = 'MAIN';
			}
		}

		// --- VICTORY/DEFEAT CHECKS ---
		const allMonstersDefeated = combatState.monsters.every(m => m.current_health <= 0);
		if (allMonstersDefeated) {
			const finalUI = buildCombatUI(combatState, interaction.user);
			await interaction.message.edit({ embeds: finalUI.embeds, components: [] });
			return handleVictory(interaction, combatState);
		}

		if (combatState.character.current_health <= 0) {
			combatState.combatLog.push('> You have been defeated!');
			const finalUI = buildCombatUI(combatState, interaction.user);
			await interaction.message.edit({ embeds: finalUI.embeds, components: [] });
			return handleDefeat(interaction, combatState);
		}

		// --- UI UPDATE ---
		const ui = buildCombatUI(combatState, interaction.user);
		await interaction.message.edit({ embeds: ui.embeds, components: ui.components });
	},
};
/**
 * Executes a full combat turn (player action, then monster actions).
 * @param {import('discord.js').Interaction} interaction
 * @param {object} combatState
 * @param {object} playerAction - The action the player took.
 */
async function executePlayerTurn(interaction, combatState, playerAction) {
	const character = combatState.character;
	combatState.combatLog.push(`> ~ **Turn** \`${combatState.turn}\` ~`);

	// --- Player's Action ---
	if (playerAction.type === 'attack') {
		const monster = combatState.monsters[playerAction.targetIndex];
		const weapon = db.prepare(`
            SELECT i.damage_dice, i.damage_type
            FROM user_inventory ui
            JOIN items i ON ui.item_id = i.item_id
            WHERE ui.user_id = ? AND ui.equipped_slot = 'weapon'
        `).get(character.user_id);

		const damageType = weapon?.damage_type || 'Bludgeoning';
		const damageDice = weapon?.damage_dice || '1d4';
		const diceRoll = rollDice(damageDice);
		const [qtyDice, diceSides] = damageDice.split('d').map(Number);
		const statModifier = getDamageModifier(damageType, character);

		let playerDamage = Math.max(1, diceRoll + statModifier);

		const isCrit = Math.random() < character.crit_chance;
		if (isCrit) {
			playerDamage = Math.max(1, Math.round(((qtyDice * diceSides) + statModifier) * character.crit_damage_modifier));
			combatState.critsThisFight++;
			combatState.combatLog.push(`🗡️💥 **CRITICAL HIT!** You attack **${monster.name} #${playerAction.targetIndex + 1}** for **${playerDamage}** damage.`);
		}
		else {
			combatState.combatLog.push(`🗡️ You attack **${monster.name} #${playerAction.targetIndex + 1}** for **${playerDamage}** damage.`);
		}

		monster.current_health = Math.max(0, monster.current_health - playerDamage);
		if (monster.current_health === 0) {
			combatState.combatLog.push(`> **${monster.name} #${playerAction.targetIndex + 1}** has been defeated!`);
		}

		const maxIntCheck = db.prepare('SELECT highest_damage_dealt FROM characters WHERE user_id = ?').get(character.user_id);
		if (maxIntCheck.highest_damage_dealt < playerDamage) {
			db.prepare('UPDATE characters SET highest_damage_dealt = ? WHERE user_id = ?').run(playerDamage, character.user_id);
			combatState.combatLog.push(`> You've set a new best for damage done in a single hit: **${playerDamage}**!`);
		}
	}
	else if (playerAction.type === 'spell') {
		const spell = db.prepare('SELECT * FROM spells WHERE spell_id = ?').get(playerAction.spellId);
		if (!spell || character.current_mana < spell.mana_cost) {
			combatState.combatLog.push('❌ Your spell fizzles! (Not enough mana or invalid spell)');
		}
		else {
			character.current_mana -= spell.mana_cost;
			const effects = JSON.parse(spell.effects_json);
			combatState.combatLog.push(`✨ You cast **${spell.name}**!`);

			const weapon = db.prepare(`
				SELECT i.effects_json
				FROM user_inventory ui JOIN items i ON ui.item_id = i.item_id
				WHERE ui.user_id = ? AND ui.equipped_slot IN ('weapon', 'offhand')
			`).all(character.user_id);

			let spellPowerBonus = 0;
			weapon.forEach(w => {
				if (w.effects_json) {
					try {
						const weaponEffects = JSON.parse(w.effects_json);
						spellPowerBonus += weaponEffects.spell_damage_bonus || 0;
					}
					catch (e) {console.error(e); }
				}
			});
			if (effects.damage) {
				const monster = combatState.monsters[playerAction.targetIndex];
				const baseDamage = parseEffectValue(effects.damage);
				const totalDamage = baseDamage + spellPowerBonus;
				monster.current_health = Math.max(0, monster.current_health - totalDamage);

				let damageLog = `> It hits **${monster.name} #${playerAction.targetIndex + 1}** for **${totalDamage}** ${effects.damage_type || 'Arcane'} damage.`;
				if (spellPowerBonus > 0) {
					damageLog += ` (${baseDamage} + ${spellPowerBonus})`;
				}
				combatState.combatLog.push(damageLog);

				if (monster.current_health === 0) {
					combatState.combatLog.push(`> **${monster.name} #${playerAction.targetIndex + 1}** has been defeated!`);
				}
			}

			if (effects.heal) {
				const baseHeal = parseEffectValue(effects.heal);
				const totalHeal = baseHeal + spellPowerBonus;
				const oldHealth = character.current_health;
				character.current_health = Math.min(character.max_health, character.current_health + totalHeal);
				let healLog = `> A warm light restores **${character.current_health - oldHealth}** of your health!`;
				if (spellPowerBonus > 0) {
					healLog += ` (${baseHeal} + ${spellPowerBonus})`;
				}
				combatState.combatLog.push(healLog);
			}
		}
	}
	else if (playerAction.type === 'flee_fail') {
		combatState.combatLog.push('❌ Your attempt to flee failed! The enemies press their advantage.');
	}
	else if (playerAction.type === 'item') {
		try {
			const useItemTx = db.transaction(() => {
				const itemData = db.prepare(`
                    SELECT i.name, i.effects_json, ui.quantity
                    FROM user_inventory ui
                    JOIN items i ON ui.item_id = i.item_id
                    WHERE ui.inventory_id = ? AND ui.user_id = ? AND i.item_type = 'CONSUMABLE' AND ui.quantity > 0
                `).get(playerAction.inventoryId, character.user_id);

				if (!itemData) {
					throw new Error('Item not found or not usable.');
				}

				if (itemData.quantity > 1) {
					db.prepare('UPDATE user_inventory SET quantity = quantity - 1 WHERE inventory_id = ?').run(playerAction.inventoryId);
				}
				else {
					db.prepare('DELETE FROM user_inventory WHERE inventory_id = ?').run(playerAction.inventoryId);
				}

				const effects = JSON.parse(itemData.effects_json || '{}');
				if (effects.heal) {
					const amountHealed = parseEffectValue(effects.heal);
					const oldHealth = character.current_health;
					character.current_health = Math.min(character.max_health, character.current_health + amountHealed);
					combatState.combatLog.push(`🧪 You use **${itemData.name}** and restore **${character.current_health - oldHealth}** health!`);
				}

				else if (effects.buff) {
					const { stat, value, duration_seconds } = effects.buff;
					const expiresDate = new Date(Date.now() + duration_seconds * 1000);
					const unixTimestamp = Math.floor(expiresDate.getTime() / 1000);
    				const expiresAt = expiresDate.toISOString();
					const buffJson = JSON.stringify({ stat_change: { [stat]: value } });

					db.prepare(`
                        INSERT INTO character_status_effects (target_user_id, effect_name, effects_json, expires_at)
                        VALUES (?, ?, ?, ?)
                    `).run(character.user_id, itemData.name, buffJson, expiresAt);

					combatState.combatLog.push(`🧪 You use **${itemData.name}** and feel your **${stat}** increase by ${value}! (Expires <t:${unixTimestamp}:R>)`);
				}
				else {
					combatState.combatLog.push(`🧪 You use **${itemData.name}**, but it has no discernible effect in combat.`);
				}
			});

			useItemTx();

		}
		catch (error) {
			console.error('[PvE Item Use] Transaction failed:', error);
			combatState.combatLog.push('> Your attempt to use an item failed.');
		}
	}

	const allMonstersDefeated = combatState.monsters.every(m => m.current_health <= 0);
	if (allMonstersDefeated) {
		combatState.turn++;
		return;
	}

	let totalDamageTakenThisTurn = 0;
	let highestDamageSurvivedThisTurn = 0;
	const healthBeforeDamage = character.current_health;

	combatState.monsters.forEach((m, i) => {
		if (m.current_health > 0) {
			const monsterDamageRoll = Math.floor(Math.random() * (m.base_damage * 2)) + 1;
			const monsterDamage = Math.max(1, monsterDamageRoll);
			character.current_health = Math.max(0, character.current_health - monsterDamage);
			totalDamageTakenThisTurn += monsterDamage;
			if (monsterDamage > highestDamageSurvivedThisTurn) {
				highestDamageSurvivedThisTurn = monsterDamage;
			}
			combatState.combatLog.push(`👹 **${m.name} #${i + 1}** attacks you for **${monsterDamage}** damage.`);
		}
	});

	if (highestDamageSurvivedThisTurn > 0) {
		const maxIntCheck = db.prepare('SELECT largest_hit_survived FROM characters WHERE user_id = ?').get(character.user_id);
		if (maxIntCheck.largest_hit_survived < highestDamageSurvivedThisTurn) {
			db.prepare('UPDATE characters SET largest_hit_survived = ? WHERE user_id = ?').run(highestDamageSurvivedThisTurn, character.user_id);
			combatState.combatLog.push(`> You've set a personal record for highest single damage survived: **${highestDamageSurvivedThisTurn}!**`);
		}
	}

	if (character.current_health < healthBeforeDamage) {
		combatState.combatLog.push(`> Total damage taken this turn: \`${totalDamageTakenThisTurn}\` (${healthBeforeDamage} HP -> ${character.current_health} HP)`);
	}

	combatState.turn++;
}
/**
 * Parses a dice string (e.g., '2d6') and returns a random roll.
 * @param {string} diceString The dice notation string.
 * @returns {number} The result of the roll.
 */
function rollDice(diceString) {
	if (!diceString || !/^\d+d\d+$/.test(diceString)) {
		return 1;
		// Default to 1 damage if notation is invalid
	}
	const [numDice, numSides] = diceString.split('d').map(Number);
	let total = 0;
	for (let i = 0; i < numDice; i++) {
		total += Math.floor(Math.random() * numSides) + 1;
	}
	return total;
}

/**
 * Calculates the correct stat modifier for an attack based on its damage type.
 * @param {string} damageType The type of damage (e.g., 'Slashing', 'Bludgeoning').
 * @param {object} stats The character's full stat block.
 * @returns {number} The calculated integer modifier for the damage roll.
 */
function getDamageModifier(damageType, stats) {
	// Standard D&D-style modifier calculation: (Stat - 10) / 2
	// Your system uses a base of 5, so we'll adapt: (Stat - 5) / 2
	const mightMod = Math.floor((stats.stat_might - 5) / 2);
	const finesseMod = Math.floor((stats.stat_finesse - 5) / 2);
	const witsMod = Math.floor((stats.stat_wits - 5) / 2);

	switch (damageType) {
	case 'Slashing':
		// Use whichever is higher between Might and Finesse
		return Math.max(mightMod, finesseMod);
	case 'Piercing':
		// Defaults to Finesse
		return finesseMod;
	case 'Arcane':
		// Defaults to Wits
		return witsMod;
	case 'Bludgeoning':
	default:
		// Defaults to Might (this also covers unarmed strikes)
		return mightMod;
	}
}

/**
* PvE buttons handler.
* @param {import('discord.js').ButtonInteraction} interaction
*/
module.exports.buttons = async (interaction) => {
	const parts = interaction.customId.split('_');
	const [, category, action, threadId, ...rest] = parts;

	const combatState = activeCombats.get(threadId);
	if (!combatState || combatState.userId !== interaction.user.id) {
		return interaction.reply({
			content: 'This combat instance has expired or is invalid. Your status has been reset, so you can now start a new adventure with `/pve engage`.',
			flags: MessageFlags.Ephemeral,
		});
	}

	await interaction.deferUpdate();

	switch (category) {
	case 'main': {
		switch (action) {
		case 'fight':
			combatState.playerState = 'SELECTING_TARGET';
			break;
		case 'magic':
			combatState.playerState = 'SELECTING_SPELL';
			break;
		case 'items':
			combatState.playerState = 'SELECTING_ITEM';
			break;
		case 'flee': {
			const nodeLevel = combatState.nodeData.required_level;
			const playerFinesse = combatState.character.stat_finesse;

			const baseChance = 0.50;
			const finesseAdvantage = (playerFinesse - (nodeLevel * 2)) * 0.02;
			const fleeChance = Math.max(0.05, Math.min(0.95, baseChance + finesseAdvantage));

			if (Math.random() < fleeChance) {
				combatState.combatLog.push(`> You successfully fled the battle! (Chance: ${Math.round(fleeChance * 100)}%)`);
				const finalUI = buildCombatUI(combatState, interaction.user);
				await interaction.message.edit({ embeds: finalUI.embeds, components: [] });
				return handleFlee(interaction, combatState);
			}
			else {
				await executePlayerTurn(interaction, combatState, { type: 'flee_fail' });
			}
			break;
		}
		}
		break;
	}
	case 'target': {
		if (action === 'attack') {
			const targetIndex = parseInt(rest[0], 10);
			if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= combatState.monsters.length) return;
			const monster = combatState.monsters[targetIndex];
			if (monster.current_health <= 0) return;

			await executePlayerTurn(interaction, combatState, { type: 'attack', targetIndex });
			combatState.playerState = 'MAIN';
		}
		else if (action === 'spell') {
			const spellId = parseInt(rest[0], 10);
			const targetIndex = parseInt(rest[1], 10);
			if (isNaN(spellId) || isNaN(targetIndex) || targetIndex < 0 || targetIndex >= combatState.monsters.length) return;
			const monster = combatState.monsters[targetIndex];
			if (monster.current_health <= 0) return;

			await executePlayerTurn(interaction, combatState, { type: 'spell', spellId, targetIndex });
			combatState.playerState = 'MAIN';
		}
		break;
	}
	case 'back': {
		if (action === 'main') {
			combatState.playerState = 'MAIN';
		}
		break;
	}
	}

	const allMonstersDefeated = combatState.monsters.every(m => m.current_health <= 0);
	if (allMonstersDefeated) {
		const finalUI = buildCombatUI(combatState, interaction.user);
		await interaction.message.edit({ embeds: finalUI.embeds, components: [] });
		return handleVictory(interaction, combatState);
	}

	if (combatState.character.current_health <= 0) {
		combatState.combatLog.push('> You have been defeated!');
		const finalUI = buildCombatUI(combatState, interaction.user);
		await interaction.message.edit({ embeds: finalUI.embeds, components: [] });
		return handleDefeat(interaction, combatState);
	}

	const ui = buildCombatUI(combatState, interaction.user);
	await interaction.message.edit({ embeds: ui.embeds, components: ui.components });
};

module.exports.cleanup = () => {
	clearInterval(cleanupIntervalId);
};