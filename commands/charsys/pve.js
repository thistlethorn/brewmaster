// commands/charsys/pve.js

const path = require('path');
const { checkBetatestLock } = require(`${global.__utils}/betaLock.js`);
const commandFilename = path.basename(__filename);
const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
	// Add other states (SELECTING_SPELL, SELECTING_ITEM) here later
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
	const expiryTime = new Date(Date.now() + DEFEAT_COOLDOWN_MS).toISOString();

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
		.setDescription(`You have fallen in battle. You awaken back at the Tavern, having lost your way.\n\nYou earned **${consolationXp} XP** for the attempt.\n\n**Penalties:**\n• You lost **${crownsLost.toLocaleString()}** Crowns.\n• You cannot start another adventure for **15 minutes**.`);

	// Cleanup and log the failed attempt
	db.transaction(() => {
		db.prepare(`
			UPDATE characters 
			SET 
				character_status = 'DEFEATED', 
				times_fallen = times_fallen + 1,
				current_health = 1, -- Set to 1HP, not max
				current_mana = 0,
				character_status_expiry_time = ?
			WHERE user_id = ?
		`).run(expiryTime, userId);
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

	// NEW: Defeat status check
	if (character.character_status === 'DEFEATED') {
		const expiryTime = new Date(character.character_status_expiry_time);
		const now = new Date();
		if (now < expiryTime) {
			const expiryTimestamp = Math.floor(expiryTime.getTime() / 1000);
			return interaction.reply({ content: `You are still recovering from your last battle. You can start a new adventure <t:${expiryTimestamp}:R>.`, flags: MessageFlags.Ephemeral });
		}
		else {
			// Cooldown has expired, reset status to IDLE and continue.
			db.prepare('UPDATE characters SET character_status = \'IDLE\', character_status_expiry_time = NULL WHERE user_id = ?').run(userId);
			// Update in-memory object
			character.character_status = 'IDLE';
		}
	}

	if (character.character_status !== 'IDLE') {
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
		// Stub for future spell/item selection logic
		await interaction.reply({ content: 'Menu interaction received! (Not yet implemented)', flags: MessageFlags.Ephemeral });
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

		// Update highest damage dealt stat
		const maxIntCheck = db.prepare('SELECT highest_damage_dealt FROM characters WHERE user_id = ?').get(character.user_id);
		if (maxIntCheck.highest_damage_dealt < playerDamage) {
			db.prepare('UPDATE characters SET highest_damage_dealt = ? WHERE user_id = ?').run(playerDamage, character.user_id);
			combatState.combatLog.push(`> You've set a new best for damage done in a single hit: **${playerDamage}**!`);
		}
	}
	// Add logic for 'magic' and 'item' actions here later

	// --- Check for Victory before Monsters Attack ---
	const allMonstersDefeated = combatState.monsters.every(m => m.current_health <= 0);
	if (allMonstersDefeated) {
		combatState.turn++;
		return;
		// Exit early, the main button handler will catch this victory state.
	}

	// --- Monsters' Turn ---
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

	// Update largest hit survived stat
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


	// --- End of Turn ---
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
		// This handles expired/invalid combat sessions.
		return interaction.reply({
			content: 'This combat instance has expired or is invalid. Your status has been reset, so you can now start a new adventure with `/pve engage`.',
			flags: MessageFlags.Ephemeral,
		});
	}

	await interaction.deferUpdate();

	// --- Action Router ---
	switch (category) {
	case 'main': {
		switch (action) {
		case 'fight':
			combatState.playerState = 'SELECTING_TARGET';
			break;
		// Stubs for future implementation
		case 'magic':
			combatState.combatLog.push('> You focus your mind... (Magic system coming soon!)');
			break;
		case 'items':
			combatState.combatLog.push('> You rummage through your bag... (Item usage coming soon!)');
			break;
		case 'flee':
			// handleFlee will be a new function to implement flee logic
			// For now, let's just log it and do nothing.
			combatState.combatLog.push('> You attempt to flee... (Flee system coming soon!)');
			break;
		}
		break;
	}
	case 'target': {
		if (action === 'attack') {
			const targetIndex = parseInt(rest[0], 10);
			if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= combatState.monsters.length) {
				return;
			}
			const monster = combatState.monsters[targetIndex];
			if (monster.current_health <= 0) return;

			// This is where the main combat turn logic now lives
			await executePlayerTurn(interaction, combatState, { type: 'attack', targetIndex });
			// After the turn, return player to the main menu
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

	// --- VICTORY/DEFEAT CHECKS ---
	// These checks are now separate from the action logic.
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
	// If combat is ongoing, just update the UI with the new state.
	const ui = buildCombatUI(combatState, interaction.user);
	await interaction.message.edit({ embeds: ui.embeds, components: ui.components });
};
module.exports.cleanup = () => {
	clearInterval(cleanupIntervalId);
};