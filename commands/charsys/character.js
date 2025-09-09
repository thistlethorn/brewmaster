// commands/charsys/character.js

const path = require('path');
const { checkBetatestLock } = require(`${global.__utils}/betaLock.js`);
const commandFilename = path.basename(__filename);
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../database');
const { recalculateStats } = require('../../utils/recalculateStats');
// In-memory store for character creation sessions.
// Key: userId, Value: { step, name, originId, archetypeId, ... }
const creationSessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

// In-memory store for spend points sessions.
const spendPointsSessions = new Map();

const alignmentExplanation = `
\`\`\`
LAWFUL GOOD     |   TRUE GOOD      | CHAOTIC GOOD
LAWFUL NEUTRAL  |   TRUE NEUTRAL   | CHAOTIC NEUTRAL
LAWFUL EVIL     |   TRUE EVIL      | CHAOTIC EVIL
\`\`\`
**LAWFUL GOOD:** Acting for the laws, to benefit good.
**TRUE GOOD:** Acting for good, to be as good as possible.
**CHAOTIC GOOD:** Acting in any way, to benefit good.

**LAWFUL NEUTRAL:** Acting for the laws, for no particular side.
**TRUE NEUTRAL:** Acting for anything, for no particular side.
**CHAOTIC NEUTRAL:** Acting in any way, for no particular side.

**LAWFUL EVIL:** Acting for the laws, to benefit evil.
**TRUE EVIL:** Acting for evil, to be as evil as possible.
**CHAOTIC EVIL:** Acting in any way, to benefit evil.
`;

/**
 * Calculates the correct stat modifier for an attack based on its damage type.
 * @param {string} damageType The type of damage (e.g., 'Slashing', 'Bludgeoning').
 * @param {object} stats The character's full stat block.
 * @returns {number} The calculated integer modifier for the damage roll.
 */
function getDamageModifier(damageType, stats) {
	const mightMod = Math.floor((stats.stat_might - 5) / 2);
	const finesseMod = Math.floor((stats.stat_finesse - 5) / 2);
	const witsMod = Math.floor((stats.stat_wits - 5) / 2);

	switch (damageType) {
	case 'Slashing':
		return Math.max(mightMod, finesseMod);
	case 'Piercing':
		return finesseMod;
	case 'Arcane':
		return witsMod;
	case 'Bludgeoning':
	default:
		return mightMod;
	}
}

const sessionCleanupInterval = setInterval(() => {
	const now = Date.now();
	for (const [userId, session] of creationSessions.entries()) {
		if (now - session.timestamp > SESSION_TIMEOUT) {
			creationSessions.delete(userId);
		}
	}
	// NEW: Cleanup for spend points sessions
	for (const [userId, session] of spendPointsSessions.entries()) {
		if (now - session.timestamp > SESSION_TIMEOUT) {
			spendPointsSessions.delete(userId);
		}
	}
}, SESSION_TIMEOUT);

/**
 * Clears the character creation session timer and in-memory state.
 * Call on bot shutdown to avoid dangling intervals and memory.
 */
function charSessionCleanup() {
	if (sessionCleanupInterval) {
		clearInterval(sessionCleanupInterval);
	}
	creationSessions.clear();
	spendPointsSessions.clear();
}

/**
 * Handles the initial /character create command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleCreate(interaction) {
	const userId = interaction.user.id;

	// Check if the user already has a character.
	const existingCharacter = db.prepare('SELECT 1 FROM characters WHERE user_id = ?').get(userId);
	if (existingCharacter) {
		return interaction.reply({
			content: 'You have already created a character. You can view them with `/character view`.',
			flags: MessageFlags.Ephemeral,
		});
	}

	// Start a new creation session.
	creationSessions.set(userId, { step: 'name', timestamp: Date.now() });

	// Show the first modal to get the character's name.
	const nameModal = new ModalBuilder()
		.setCustomId(`char_create_name_${userId}`)
		.setTitle('Character Creation: Name');

	const nameInput = new TextInputBuilder()
		.setCustomId('character_name')
		.setLabel('What is your character\'s name?')
		.setStyle(TextInputStyle.Short)
		.setMinLength(3)
		.setMaxLength(32)
		.setRequired(true);

	nameModal.addComponents(new ActionRowBuilder().addComponents(nameInput));
	await interaction.showModal(nameModal);
}
/**
 * Generates a text-based progress bar for XP.
 * @param {number} currentXp The character's current XP.
 * @param {number} requiredXp The XP needed for the next level.
 * @returns {string} The formatted XP bar string.
 */
function generateXpBar(currentXp, requiredXp) {
	const totalBars = 10;
	const ratio = requiredXp > 0 ? Math.min(1, Math.max(0, currentXp / requiredXp)) : 0;
	const progress = Math.round(ratio * totalBars);
	const filledBars = '🟦'.repeat(progress);
	const emptyBars = '⬜'.repeat(totalBars - progress);
	return `\`[${filledBars}${emptyBars}]\` **${currentXp} / ${requiredXp}** XP`;
}

/**
 * Handles the /character view command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleView(interaction) {
	const targetUser = interaction.options.getUser('user') || interaction.user;
	const isSelfView = targetUser.id === interaction.user.id;

	// Fetch all data in parallel
	const [characterData, economyData, guildData, pveHistory] = await Promise.all([
		db.prepare(`
            SELECT c.*, o.name as origin_name, a.name as archetype_name
            FROM characters c
            JOIN origins o ON c.origin_id = o.id
            JOIN archetypes a ON c.archetype_id = a.id
            WHERE c.user_id = ?
        `).get(targetUser.id),
		db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(targetUser.id),
		db.prepare(`
            SELECT gmt.owner, gmt.vice_gm, gl.guild_name, gl.guild_tag, gl.guildmember_title, gl.attitude
            FROM guildmember_tracking gmt
            JOIN guild_list gl ON gmt.guild_tag = gl.guild_tag
            WHERE gmt.user_id = ?
        `).get(targetUser.id),
		db.prepare(`
            SELECT cpp.times_cleared, cpp.attempts, cpp.fastest_clear_turns, pn.name
            FROM character_pve_progress cpp
            JOIN pve_nodes pn ON cpp.node_id = pn.node_id
            WHERE cpp.user_id = ?
            ORDER BY cpp.last_cleared_at DESC
            LIMIT 5
        `).all(targetUser.id),
	]);

	if (!characterData) {
		const content = isSelfView ? 'You have not created a character yet. Use `/character create` to begin!' : `${targetUser.username} has not created a character yet.`;
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}

	recalculateStats(targetUser.id);
	// Re-fetch character data after recalculation for the most up-to-date stats
	const freshCharacterData = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(targetUser.id);
	const finalCharacterData = { ...characterData, ...freshCharacterData };

	// --- Build Embed ---
	const sheetEmbed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle(`${finalCharacterData.character_name} - Level ${finalCharacterData.level} ${finalCharacterData.archetype_name}`)
		.setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
		.setThumbnail(finalCharacterData.character_image || null)
		.setFooter({ text: `${finalCharacterData.character_title || 'Adventurer'} | ${finalCharacterData.character_alignment || 'Unaligned'}` })
		.setTimestamp();

	// --- Resource Pools & Crowns ---
	const isAscetic = finalCharacterData.archetype_name === 'Ascetic';
	const resourceFields = [
		{ name: '❤️ Health', value: `\`${finalCharacterData.current_health} / ${finalCharacterData.max_health}\``, inline: true },
		{ name: '💙 Mana', value: `\`${finalCharacterData.current_mana} / ${finalCharacterData.max_mana}\``, inline: true },
	];
	if (isAscetic) {
		resourceFields.push({ name: '🔥 Ki', value: `\`${finalCharacterData.current_ki} / ${finalCharacterData.max_ki}\``, inline: true });
	}
	resourceFields.push({ name: '👑 Crowns', value: `\`${(economyData?.crowns || 0).toLocaleString()}\``, inline: true });
	sheetEmbed.addFields(resourceFields);

	// --- Level Progression (XP Bar) ---
	const MAX_LEVEL = 100;
	const level = Math.min(finalCharacterData.level, MAX_LEVEL);
	const xpIntoLevel = finalCharacterData.xp;
	const xpRequiredForNext = Math.floor(100 * (level ** 1.5));
	sheetEmbed.addFields({ name: '📈 Level Progression', value: generateXpBar(xpIntoLevel, xpRequiredForNext), inline: false });


	// --- Affiliation ---
	let affiliationString = '**Affiliation:** Guildless';
	let roleString = '**Role:** Lone Wolf';
	if (guildData) {
		affiliationString = `**Affiliation:** ${guildData.guild_name} [${guildData.guild_tag}] (${guildData.attitude})`;
		if (guildData.owner) roleString = '**Role:** Guildmaster';
		else if (guildData.vice_gm) roleString = '**Role:** Vice-GM';
		else roleString = `**Role:** ${guildData.guildmember_title}`;
	}
	sheetEmbed.addFields({ name: '📜 Character Info', value: `**Origin:** ${finalCharacterData.origin_name}\n${affiliationString}\n${roleString}`, inline: false });

	// --- Base Stats ---
	const equippedItemsEffects = db.prepare(`
		SELECT i.effects_json 
		FROM user_inventory ui
		JOIN items i ON ui.item_id = i.item_id
		WHERE ui.user_id = ? AND ui.equipped_slot IS NOT NULL
	`).all(targetUser.id);

	const statBonuses = { might: 0, finesse: 0, wits: 0, grit: 0, charm: 0, fortune: 0 };
	for (const row of equippedItemsEffects) {
		if (!row.effects_json) continue;
		try {
			const effects = JSON.parse(row.effects_json);
			if (effects.base_stats) {
				for (const stat in effects.base_stats) {
					if (Object.prototype.hasOwnProperty.call(statBonuses, stat)) {
						statBonuses[stat] += Number(effects.base_stats[stat]) || 0;
					}
				}
			}
		}
		catch (e) {
			console.error(e);
		}
	}

	const statsDisplay = ['might', 'finesse', 'wits', 'grit', 'charm', 'fortune'].map(stat => {
		const base = finalCharacterData[`stat_${stat}`];
		const bonus = statBonuses[stat];
		const total = base + bonus;
		let display = `**${stat.charAt(0).toUpperCase() + stat.slice(1)}:** ${total}`;
		if (bonus !== 0) {
			const sign = bonus > 0 ? '+' : '';
			// e.g., "Grit: 11 (10+1)"
			display += ` _(${base}${sign}${bonus})_`;
		}
		return display;
	}).join(' | ');

	const unspentPoints = finalCharacterData.stat_points_unspent > 0 ? `\n**Unspent Stat Points:** 🌟 \`${finalCharacterData.stat_points_unspent}\`` : '';

	sheetEmbed.addFields({
		name: '📊 Total Stats (Base + Gear)',
		// Replacing for the newline
		value: statsDisplay.replace(' | wits', '\n**Wits**') + unspentPoints,
		inline: false,
	});

	// --- Combat Stats ---
	const equipmentSlots = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring1', 'ring2', 'amulet'];
	const equippedItems = db.prepare('SELECT i.name, i.damage_dice, i.damage_type, ui.equipped_slot FROM user_inventory ui JOIN items i ON ui.item_id = i.item_id WHERE ui.user_id = ? AND ui.equipped_slot IS NOT NULL').all(targetUser.id);
	const equippedMap = new Map(equippedItems.map(item => [item.equipped_slot, item]));
	const weapon = equippedMap.get('weapon');
	const damageType = weapon?.damage_type || 'Bludgeoning';
	const statModifier = getDamageModifier(damageType, finalCharacterData);
	const statSign = statModifier >= 0 ? '+' : '';
	const damageString = `**Damage:** \`${weapon?.damage_dice || '1d4'}${statSign}${statModifier}\` ${damageType}`;
	sheetEmbed.addFields({
		name: '⚔️ Combat Stats',
		value: `${damageString}\n**Armor Class:** ${finalCharacterData.armor_class}\n` +
               `**Crit Chance:** ${(finalCharacterData.crit_chance * 100).toFixed(2)}% | **Crit Damage:** ${finalCharacterData.crit_damage_modifier.toFixed(2)}x`,
		inline: false,
	});

	// --- Combat Feats ---
	const featsString = `**Highest Damage Dealt:** ${finalCharacterData.highest_damage_dealt}\n` +
	                    `**Largest Hit Survived:** ${finalCharacterData.largest_hit_survived}\n` +
	                    `**Monsters Slain:** ${finalCharacterData.monsters_slain}\n` +
	                    `**Critical Hits Landed:** ${finalCharacterData.critical_hits_landed}\n` +
	                    `**Times Fallen:** ${finalCharacterData.times_fallen}`;
	sheetEmbed.addFields({ name: '🏆 Combat Feats', value: featsString, inline: false });

	// --- Dungeon History ---
	if (pveHistory.length > 0) {
		const historyString = pveHistory.map(entry => {
			const clearRate = entry.attempts > 0 ? Math.round((entry.times_cleared / entry.attempts) * 100) : 0;
			const bestTime = entry.fastest_clear_turns ? `${entry.fastest_clear_turns} turns` : 'N/A';
			return `- **${entry.name}:** ${entry.attempts} Attempts (${clearRate}% Clear) | Best: ${bestTime}`;
		}).join('\n');
		sheetEmbed.addFields({ name: '🗺️ Dungeon History', value: historyString, inline: false });
	}

	// --- Equipment ---
	const equipmentDisplay = equipmentSlots.map(slot => {
		const item = equippedMap.get(slot);
		const itemName = item ? item.name : '[Empty]';
		const slotName = slot.charAt(0).toUpperCase() + slot.slice(1).replace(/(\d+)/, ' $1');
		return `**${slotName}:** ${itemName}`;
	});
	sheetEmbed.addFields({ name: '🛡️ Equipment', value: equipmentDisplay.join('\n'), inline: false });


	// --- Add edit buttons only if viewing your own character ---
	const components = [];
	if (isSelfView) {
		const editRow1 = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`char_edit_name_${targetUser.id}`).setLabel('Edit Name').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
			new ButtonBuilder().setCustomId(`char_edit_image_${targetUser.id}`).setLabel('Set Image').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
			new ButtonBuilder().setCustomId(`char_edit_alignment_${targetUser.id}`).setLabel('Set Alignment').setStyle(ButtonStyle.Secondary).setEmoji('🧭'),
		);
		const editRow2 = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`char_edit_backstory_${targetUser.id}`).setLabel('Edit Backstory').setStyle(ButtonStyle.Secondary).setEmoji('📖'),
			new ButtonBuilder().setCustomId(`char_edit_personality_${targetUser.id}`).setLabel('Edit Personality').setStyle(ButtonStyle.Secondary).setEmoji('🎭'),
		);
		components.push(editRow1, editRow2);
	}

	await interaction.reply({ embeds: [sheetEmbed], components: components });
}

/**
 * Handles the /character equip command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleEquip(interaction) {
	const userId = interaction.user.id;
	const inventoryId = interaction.options.getInteger('item');
	const intendedSlot = interaction.options.getString('slot');

	// Fetch the character's full data, including their archetype name, in one go.
	const character = db.prepare(`
        SELECT c.*, a.name as archetype_name
        FROM characters c
        JOIN archetypes a ON c.archetype_id = a.id
        WHERE c.user_id = ?
    `).get(userId);

	if (!character) {
		return interaction.reply({ content: 'You must create a character first with `/character create`.', flags: MessageFlags.Ephemeral });
	}

	const validEquipTargetSlots = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring1', 'ring2', 'amulet'];
	if (!validEquipTargetSlots.includes(intendedSlot)) {
		return interaction.reply({ content: 'Invalid equipment slot specified.', flags: MessageFlags.Ephemeral });
	}

	const itemSlotType = intendedSlot.startsWith('ring') ? 'ring' : intendedSlot;
	const itemToEquip = db.prepare(`	
        SELECT i.name, i.handedness, i.effects_json
        FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.inventory_id = ? AND ui.user_id = ? AND json_extract(i.effects_json, '$.slot') = ?
    `).get(inventoryId, userId, itemSlotType);

	if (!itemToEquip) {
		return interaction.reply({ content: 'The selected item is not valid for that slot or was not found in your inventory.', flags: MessageFlags.Ephemeral });
	}

	let effects;
	try {
		effects = itemToEquip.effects_json ? JSON.parse(itemToEquip.effects_json) : {};
	}
	catch (e) {
		console.error(`[Equip Error] Failed to parse effects_json for inventory_id ${inventoryId}:`, e);
		return interaction.reply({ content: 'This item has corrupted data and cannot be equipped. Please contact an admin.', flags: MessageFlags.Ephemeral });
	}

	const requirements = effects.requirements;
	if (requirements) {
		const failedRequirements = [];

		// Check for stat requirements
		const statsToCheck = ['might', 'finesse', 'wits', 'grit', 'charm', 'fortune'];
		for (const stat of statsToCheck) {
			if (requirements[stat] && character[`stat_${stat}`] < requirements[stat]) {
				const statName = stat.charAt(0).toUpperCase() + stat.slice(1);
				failedRequirements.push(`Requires **${requirements[stat]} ${statName}** (You have ${character[`stat_${stat}`]})`);
			}
		}

		// Check for archetype requirement
		if (requirements.archetype && character.archetype_name !== requirements.archetype) {
			failedRequirements.push(`Requires **${requirements.archetype}** Archetype`);
		}

		// Check for alignment requirement
		if (requirements.alignment) {
			const charAlignment = character.character_alignment || 'Unaligned';
			// This check works for both general ("Good", "Evil") and specific ("Lawful Good") requirements.
			if (!charAlignment.includes(requirements.alignment)) {
				failedRequirements.push(`Requires a **${requirements.alignment}** Alignment`);
			}
		}

		// If any checks failed, build and send an informative error message.
		if (failedRequirements.length > 0) {
			const errorEmbed = new EmbedBuilder()
				.setColor(0xE74C3C)
				.setTitle(`❌ Cannot Equip ${itemToEquip.name}`)
				.setDescription('You do not meet the requirements for this item:\n' + failedRequirements.map(reason => `• ${reason}`).join('\n'));
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
	}

	// If all checks passed, proceed with the transaction to equip the item.
	try {
		const equipTx = db.transaction(() => {
			const isTwoHanded = itemToEquip.handedness === 'two-handed';
			// Unequip any item currently in the target slot
			db.prepare(`
                UPDATE user_inventory
                SET equipped_slot = NULL
                WHERE user_id = ? AND equipped_slot = ?
            `).run(userId, intendedSlot);

			// If equipping a two-handed weapon, also unequip the offhand item
			if (isTwoHanded && intendedSlot === 'weapon') {
				db.prepare(`
                    UPDATE user_inventory
                    SET equipped_slot = NULL
                    WHERE user_id = ? AND equipped_slot = 'offhand'
                `).run(userId);
			}
			// If equipping an offhand, check if a two-handed weapon is equipped
			else if (intendedSlot === 'offhand') {
				const mainWeapon = db.prepare(`
                    SELECT i.handedness FROM user_inventory ui
                    JOIN items i ON ui.item_id = i.item_id
                    WHERE ui.user_id = ? AND ui.equipped_slot = 'weapon'
                `).get(userId);
				if (mainWeapon?.handedness === 'two-handed') {
					throw new Error('Cannot equip an offhand item while a two-handed weapon is equipped.');
				}
			}

			// Finally, equip the new item
			db.prepare(`
                UPDATE user_inventory
                SET equipped_slot = ?
                WHERE inventory_id = ? AND user_id = ?
            `).run(intendedSlot, inventoryId, userId);
		});

		equipTx();
		recalculateStats(userId);
		await interaction.reply({ content: `✅ Successfully equipped **${itemToEquip.name}**. Your stats have been updated.`, flags: MessageFlags.Ephemeral });

	}
	catch (error) {
		console.error('Equip item error:', error);
		if (error.message.includes('two-handed weapon')) {
			return interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
		}
		await interaction.reply({ content: 'An error occurred while trying to equip this item.', flags: MessageFlags.Ephemeral });
	}
}

/**
 * Handles the /character unequip command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleUnequip(interaction) {
	const userId = interaction.user.id;
	const slotToUnequip = interaction.options.getString('slot');
	const validEquipTargetSlots = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring1', 'ring2', 'amulet'];
	if (!validEquipTargetSlots.includes(slotToUnequip)) {
		return interaction.reply({ content: 'Invalid equipment slot specified.', flags: MessageFlags.Ephemeral });
	}
	const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
	if (!character) {
		return interaction.reply({ content: 'You must create a character first with `/character create`.', flags: MessageFlags.Ephemeral });
	}
	const itemInfo = db.prepare(`
        SELECT i.name FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.user_id = ? AND ui.equipped_slot = ?
    `).get(userId, slotToUnequip);

	if (!itemInfo) {
		return interaction.reply({ content: 'You have nothing equipped in that slot.', flags: MessageFlags.Ephemeral });
	}

	try {
		db.prepare(`
            UPDATE user_inventory
            SET equipped_slot = NULL
            WHERE user_id = ? AND equipped_slot = ?
        `).run(userId, slotToUnequip);
		recalculateStats(userId);
		const itemName = itemInfo ? `**${itemInfo.name}**` : 'the item';
		await interaction.reply({ content: `✅ Successfully unequipped ${itemName} from your ${slotToUnequip} slot.`, flags: MessageFlags.Ephemeral });
	}
	catch (error) {
		console.error('Unequip item error:', error);
		await interaction.reply({ content: 'An error occurred while trying to unequip this item.', flags: MessageFlags.Ephemeral });
	}
}
const statProficiencies = {
	might: {
		emoji: '⚔️',
		immediateBenefits: '- **+UP** `Bludgeoning Damage`\n- **+UP** `Slashing Damage` *(from Might-based attacks)*\n- **+UP** `Critical Hit DAMAGE`',
		milestones: {
			10: { name: 'Staggering Blows', desc: 'Your BLUDGEONING attacks gain a chance to daze an enemy, forcing them to miss their next turn.' },
			15: { name: 'Heavy Handed', desc: 'Your two-handed weapons gain an additional small damage bonus.' },
			20: { name: 'Armor Penetration', desc: 'Your physical attacks ignore a percentage of the target\'s Armor Class.' },
			25: { name: 'Executioner', desc: 'You deal bonus damage to enemies below 20% health.' },
			30: { name: 'Shield Breaker', desc: 'Your attacks deal ramping bonus damage to enemies with active defensive buffs.' },
		},
	},
	finesse: {
		emoji: '🏹',
		immediateBenefits: '- **+UP** `Piercing Damage`\n- **+UP** `Slashing Damage` *(from Finesse based attack)*\n- **+UP** `Critical Hit Chance`',
		milestones: {
			10: { name: 'Hemorrhage', desc: 'Your PIERCING attacks gain a chance to inflict a Bleed status effect (damage over time).' },
			15: { name: 'Blades Akimbo', desc: 'Grants a damage bonus when dual-wielding one-handed weapons.' },
			20: { name: 'Precision Strikes', desc: 'Provides a bonus to your attack rolls, making you less likely to miss.' },
			25: { name: 'Flurry of Blows', desc: 'Grants a chance for your standard attacks to strike a second time for reduced damage.' },
			30: { name: 'Quick Reflexes', desc: 'Grants a chance to get a surprise extra attack at the start of combat.' },
			35: { name: 'Evasion', desc: 'Grants a chance to completely dodge an incoming physical attack.' },
			40: { name: 'Riposte', desc: 'After dodging, you have a chance to automatically counter-attack.' },
		},
	},
	wits: {
		emoji: '🧠',
		immediateBenefits: '- **+UP** `Basic Arcane Damage`\n- **+UP** `Spell Attack Hit Chance`\n- **+UP** `Max Mana`',
		milestones: {
			10: { name: 'Spellbook', desc: 'Unlocks a basic spellbook, allowing you to cast spells in combat.' },
			15: { name: 'Magic Resistance', desc: 'Reduces incoming damage from basic magical attacks.' },
			20: { name: 'Identify Weakness', desc: 'In PvE, reveals enemy vulnerabilities, granting a party-wide damage bonus.' },
			25: { name: 'Erudite', desc: 'Increases success chance for crafting higher-quality items and deciphering puzzles.' },
			30: { name: 'Mana Regeneration', desc: 'You now recover a small amount of Mana each turn in combat.' },
			35: { name: 'Elemental Attunement', desc: 'Attune to an element, granting resistance to it and a damage boost when using it.' },
		},
	},
	grit: {
		emoji: '💪',
		immediateBenefits: '- **+UP** `Max Health`\n- **+UP** `Physical Damage Reduction`\n- **+UP** `Max Ki` *(if Ascetic Archetype)*',
		milestones: {
			10: { name: 'Tenacity', desc: 'Grants a chance to resist crowd control effects like stuns or fears.' },
			15: { name: 'Protector\'s Aura', desc: 'In a party, you absorb a small percentage of damage directed at weaker allies.' },
			20: { name: 'Defy Death', desc: 'When struck by a lethal blow above 50% HP, you have a chance to survive with 1 HP (has a cooldown).' },
			25: { name: 'Unflinching', desc: 'You become immune to the "Stagger" effect from high-Might enemies.' },
			30: { name: 'Second Wind', desc: 'Once per battle, instantly recover 25% of your max HP when you fall below 50% health.' },
		},
	},
	charm: {
		emoji: '😊',
		immediateBenefits: '- **+UP** `Critical Hit Chance`\n- **+UP** `Enemy Attack Weaken Chance`\n- **+UP** `Threat Level Reduction`',
		milestones: {
			10: { name: 'Improved Vendor Prices', desc: 'Grants a discount when buying from and a bonus when selling to NPC vendors.' },
			15: { name: 'Skilled Negotiator', desc: 'Grants a chance to receive bonus Crowns or an extra item from quest rewards.' },
			20: { name: 'Smoothtalking Ambassador', desc: 'Successful /guild dues investments may be fully refunded by the impressed NPC.' },
			25: { name: 'Charismatic Leader', desc: 'In a party, your presence grants a passive bonus to XP and Crown gain for all members.' },
			30: { name: 'Unrelenting Persuasion', desc: 'Automatically succeed on low-difficulty NPC persuasion checks.' },
			35: { name: 'Inspiring Revolutionist', desc: 'Unlock the ability (in PvE) to attempt to charm non-boss monsters, causing them to turn against their allies for some time.' },
		},
	},
	fortune: {
		emoji: '🍀',
		immediateBenefits: '- **+UP** `Critical Hit Chance` *(Major)*\n- **+UP** `Basic Attack Dodge Chance`\n- **+UP** `Bonus Victory Crowns Looted`',
		milestones: {
			10: { name: 'Lucky Find', desc: 'Grants a 50% chance to find a bonus reward when claiming /econ daily.' },
			15: { name: 'Resourceful', desc: 'Your basic consumables have a 25% chance to not be consumed on use.' },
			20: { name: 'Gambler\'s Intuition', desc: 'Slightly improves your odds in all /gamble commands (e.g., +5% win chance).' },
			25: { name: 'Stumble', desc: 'Enemies attacking you have a chance to "stumble," reducing their physical damage by 50%.' },
			30: { name: 'Defensive Luck', desc: 'Grants a 50% chance to turn a critical hit against you into a normal hit (has a cooldown).' },
			35: { name: 'Treasure Hunter', desc: 'Looted items have a 25% chance to be one rarity tier higher than normal.' },
			40: { name: 'Miracle', desc: 'Your healing abilities and items have a 25% chance to "crit," healing for 3x the normal amount.' },
		},
	},
};
/**
 * REFACTORED: Builds the embed for the spend points UI.
 * @param {object} session - The in-memory session object.
 * @returns {EmbedBuilder}
 */
function buildSpendPointsEmbed(session) {
	const { initialStats, pointsToAdd, unspentPoints } = session;
	const embed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle('🌟 Allocate Stat Points')
		.setDescription('Review the benefits and upcoming milestones for each stat below. Use the buttons to assign your points.');

	const statOrder = ['might', 'finesse', 'wits', 'grit', 'charm', 'fortune'];
	const statEmoji = ['⚔️ ', '🏹 ', '🧠 ', '💪 ', '😊 ', '🍀 '];

	let everyTwoFieldsSplitCounter = 0;
	// --- Informational Top Half ---
	for (const stat of statOrder) {
		const proficiency = statProficiencies[stat];
		const currentValue = initialStats[`stat_${stat}`] + pointsToAdd[stat];

		// Calculate the next milestone level
		const nextMilestoneLevel = Math.floor(currentValue / 5) * 5 + 5;

		let upcomingMilestones = '';
		for (let i = 0; i < 3; i++) {
			const level = nextMilestoneLevel + (i * 5);
			const milestone = proficiency.milestones[level];
			if (milestone) {
				upcomingMilestones += `${level} - ${milestone.name.toUpperCase()}:\n${milestone.desc}\n\n`;
			}
		}
		if (!upcomingMilestones) {
			upcomingMilestones = '*You have learned all available proficiencies for this stat!*';
		}

		const fieldValue = `${proficiency.immediateBenefits}\n\n**Upcoming Stat Proficiencies:**\n\`\`\`\n${upcomingMilestones}\n\`\`\``;

		embed.addFields({
			name: `${proficiency.emoji} ${stat.charAt(0).toUpperCase() + stat.slice(1)}`,
			value: fieldValue,
			inline: true,
		});
		everyTwoFieldsSplitCounter++;

		if (everyTwoFieldsSplitCounter >= 2) {
			embed.addFields({ name: '\u200B', value: '\u200B', inline: false });
			everyTwoFieldsSplitCounter = 0;
		}

	}

	// --- Separator ---
	embed.addFields({ name: '\u200B', value: `--- **Your Allocation**  --- \`${unspentPoints}\` More Point${unspentPoints > 1 ? 's' : ''} Available To Spend`, inline: false });

	let emojiTracker = 0;
	// --- Interactive Bottom Half ---
	for (const stat of statOrder) {
		currentEmoji = statEmoji[emojiTracker];
		emojiTracker++;
		const baseValue = initialStats[`stat_${stat}`];
		const addedValue = pointsToAdd[stat];
		let valueString = `**${baseValue}**`;
		if (addedValue > 0) {
			valueString = `${baseValue} ➔ **${baseValue + addedValue} (+${addedValue})**`;
		}
		embed.addFields({ name: currentEmoji + stat.charAt(0).toUpperCase() + stat.slice(1), value: valueString, inline: true });
	}

	return embed;
}


/**
 * Helper function to create and send the spend points UI.
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ButtonInteraction} interaction
 * @param {boolean} isUpdate - Whether to use interaction.update() instead of interaction.reply().
 */
async function startNewSpendPointsSession(interaction, isUpdate = false) {
	const userId = interaction.user.id;
	const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);

	if (!character) {
		const replyOptions = { content: 'You must create a character first.', flags: MessageFlags.Ephemeral, embeds: [], components: [] };
		return isUpdate ? interaction.update(replyOptions) : interaction.reply(replyOptions);
	}

	if (!character.stat_points_unspent || character.stat_points_unspent <= 0) {
		const replyOptions = { content: 'You have no unspent stat points to allocate.', flags: MessageFlags.Ephemeral, embeds: [], components: [] };
		return isUpdate ? interaction.update(replyOptions) : interaction.reply(replyOptions);
	}

	const session = {
		userId,
		initialStats: { ...character },
		pointsToAdd: { might: 0, finesse: 0, wits: 0, grit: 0, charm: 0, fortune: 0 },
		unspentPoints: character.stat_points_unspent,
		undoStack: [],
		timestamp: Date.now(),
	};
	spendPointsSessions.set(userId, session);

	const embed = buildSpendPointsEmbed(session);
	const row1 = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`char_spendpoints_add_might_${userId}`).setLabel('+1 Might').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`char_spendpoints_add_finesse_${userId}`).setLabel('+1 Finesse').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`char_spendpoints_add_wits_${userId}`).setLabel('+1 Wits').setStyle(ButtonStyle.Secondary),
	);
	const row2 = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`char_spendpoints_add_grit_${userId}`).setLabel('+1 Grit').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`char_spendpoints_add_charm_${userId}`).setLabel('+1 Charm').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`char_spendpoints_add_fortune_${userId}`).setLabel('+1 Fortune').setStyle(ButtonStyle.Secondary),
	);
	const row3 = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`char_spendpoints_undo_${userId}`).setLabel('Undo').setStyle(ButtonStyle.Primary).setEmoji('↩️'),
		new ButtonBuilder().setCustomId(`char_spendpoints_confirm_${userId}`).setLabel('Confirm').setStyle(ButtonStyle.Success).setEmoji('✅'),
		new ButtonBuilder().setCustomId(`char_spendpoints_cancel_${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('❌'),
	);

	const replyOptions = { embeds: [embed], components: [row1, row2, row3], flags: MessageFlags.Ephemeral };
	if (isUpdate) {
		await interaction.update(replyOptions);
	}
	else {
		await interaction.reply(replyOptions);
	}
}


/**
 * Handles the /character spendpoints command, now with session checking.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSpendPoints(interaction) {
	const userId = interaction.user.id;
	if (spendPointsSessions.has(userId)) {
		const embed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setTitle('⚠️ Active Session Found')
			.setDescription('You already have an active stat allocation session. This can happen if you dismissed the previous message without confirming or cancelling.\n\nWould you like to start a new session? This will discard any progress from the old one.');

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`char_spendpoints_restart_${userId}`)
				.setLabel('Start New Session')
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId(`char_spendpoints_closeprompt_${userId}`)
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Secondary),
		);

		await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
		return;
	}

	await startNewSpendPointsSession(interaction);
}


module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('character')
		.setDescription('Create, view, and manage your character.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('create')
				.setDescription('Begin the character creation process.'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('view')
				.setDescription('View your character sheet.')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('The user whose character sheet you want to view.')
						.setRequired(false)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('equip')
				.setDescription('Equip an item from your inventory.')
				.addStringOption(option =>
					option.setName('slot')
						.setDescription('The equipment slot you want to fill.')
						.setRequired(true)
						.addChoices(
							{ name: 'Weapon', value: 'weapon' },
							{ name: 'Offhand', value: 'offhand' },
							{ name: 'Helmet', value: 'helmet' },
							{ name: 'Chestplate', value: 'chestplate' },
							{ name: 'Leggings', value: 'leggings' },
							{ name: 'Boots', value: 'boots' },
							{ name: 'Ring 1', value: 'ring1' },
							{ name: 'Ring 2', value: 'ring2' },
							{ name: 'Amulet', value: 'amulet' },
						))
				.addIntegerOption(option =>
					option.setName('item')
						.setDescription('The inventory item to equip.')
						.setRequired(true)
						.setAutocomplete(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('unequip')
				.setDescription('Unequip an item from an equipment slot.')
				.addStringOption(option =>
					option.setName('slot')
						.setDescription('The equipment slot to clear.')
						.setRequired(true)
						.setAutocomplete(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('spendpoints')
				.setDescription('Allocate your unspent stat points from leveling up.'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('help')
				.setDescription('Get help and information about the character system.')),

	async autocomplete(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		const userId = interaction.user.id;

		if (subcommand === 'equip') {
			if (focusedOption.name === 'item') {
				const slot = interaction.options.getString('slot');
				if (!slot) return interaction.respond([]);

				const validSlotTypes = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring', 'amulet'];
				const itemSlotType = slot.startsWith('ring') ? 'ring' : slot;
				if (!validSlotTypes.includes(itemSlotType)) return interaction.respond([]);

				const focusedValue = focusedOption.value.toLowerCase();
				const equippableItems = db.prepare(`
                    SELECT ui.inventory_id, i.name
                    FROM user_inventory ui
                    JOIN items i ON ui.item_id = i.item_id
                    WHERE ui.user_id = ? AND json_extract(i.effects_json, '$.slot') = ?
                `).all(userId, itemSlotType);

				const filtered = equippableItems
					.filter(item => item.name.toLowerCase().includes(focusedValue))
					.map(item => ({
						name: item.name,
						value: item.inventory_id,
					}));

				await interaction.respond(filtered.slice(0, 25));
			}
		}
		else if (subcommand === 'unequip') {
			if (focusedOption.name === 'slot') {
				const equippedItems = db.prepare(`
					SELECT ui.equipped_slot, i.name
					FROM user_inventory ui
					JOIN items i ON ui.item_id = i.item_id
					WHERE ui.user_id = ? AND ui.equipped_slot IS NOT NULL
				`).all(userId);

				const equippedSlots = equippedItems.map(item => {
					const slotName = item.equipped_slot.charAt(0).toUpperCase() + item.equipped_slot.slice(1);
					return {
						name: `${slotName}: ${item.name}`,
						value: item.equipped_slot,
					};
				});
				await interaction.respond(equippedSlots.slice(0, 25));
			}
		}
	},

	async execute(interaction) {
		if (checkBetatestLock(commandFilename, interaction)) {
			return interaction.reply({
				content: '🍻 Apologies! This feature is currently under lock and key for some super-secret beta testing. Keep an eye on <#1385675092591378452> and <#1414069644410748938> for the full release!',
				flags: MessageFlags.Ephemeral,
			});
		}
		const subcommand = interaction.options.getSubcommand();

		switch (subcommand) {
		case 'create':
			await handleCreate(interaction);
			break;
		case 'view':
			await handleView(interaction);
			break;
		case 'equip':
			await handleEquip(interaction);
			break;
		case 'unequip':
			await handleUnequip(interaction);
			break;
		case 'spendpoints':
			await handleSpendPoints(interaction);
			break;
		case 'help':
			await interaction.reply({ content: 'Character system help guide is under construction!', flags: MessageFlags.Ephemeral });
			break;
		default:
			await interaction.reply({ content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
		}
	},

	async modals(interaction) {
		const parts = interaction.customId.split('_');
		const command = parts[1];
		const action = parts[2];
		const userId = parts[parts.length - 1];

		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This interaction is not for you.', flags: MessageFlags.Ephemeral });
		}

		if (command === 'edit') {
			try {
				let successMessage = 'Your character has been updated!';
				if (action === 'name') {
					const newName = interaction.fields.getTextInputValue('char_name');
					db.prepare('UPDATE characters SET character_name = ? WHERE user_id = ?').run(newName, userId);
					successMessage = `Your character's name has been changed to **${newName}**.`;
				}
				else if (action === 'image') {
					const imageUrl = interaction.fields.getTextInputValue('char_image');
					const urlRegex = /\.(jpeg|jpg|gif|png)$/;
					if (imageUrl && !urlRegex.test(imageUrl)) {
						return interaction.reply({ content: 'Please provide a valid direct image URL (ending in .png, .jpg, .jpeg, or .gif).', flags: MessageFlags.Ephemeral });
					}
					db.prepare('UPDATE characters SET character_image = ? WHERE user_id = ?').run(imageUrl, userId);
					successMessage = 'Your character\'s image has been updated.';
				}
				else if (action === 'backstory') {
					const newBackstory = interaction.fields.getTextInputValue('char_backstory');
					db.prepare('UPDATE characters SET character_backstory = ? WHERE user_id = ?').run(newBackstory, userId);
					successMessage = 'Your character\'s backstory has been updated.';
				}
				else if (action === 'personality') {
					const ideals = interaction.fields.getTextInputValue('char_ideals');
					const bonds = interaction.fields.getTextInputValue('char_bonds');
					const flaws = interaction.fields.getTextInputValue('char_flaws');
					const traits = interaction.fields.getTextInputValue('char_traits');
					db.prepare('UPDATE characters SET character_ideals = ?, character_bonds = ?, character_flaws = ?, character_traits = ? WHERE user_id = ?')
						.run(ideals, bonds, flaws, traits, userId);
					successMessage = 'Your character\'s personality details have been updated.';
				}
				await interaction.reply({ content: `✅ ${successMessage}`, flags: MessageFlags.Ephemeral });
			}
			catch (error) {
				console.error(`Error updating character for user ${userId}:`, error);
				await interaction.reply({ content: 'There was an error updating your character. Please try again.', flags: MessageFlags.Ephemeral });
			}
			return;
		}


		// Handler for character creation modals
		const session = creationSessions.get(userId);
		if (!session) {
			return interaction.reply({ content: 'Your creation session has expired. Please start over with `/character create`.', flags: MessageFlags.Ephemeral });
		}
		session.timestamp = Date.now();
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (action === 'name' && session.step === 'name') {
			session.name = interaction.fields.getTextInputValue('character_name');
			session.userId = userId;
			await showOriginSelection({ update: interaction.editReply.bind(interaction) }, session);
		}
		else if (action === 'rp' && session.step === 'rp') {
			session.backstory = interaction.fields.getTextInputValue('rp_backstory');
			session.ideals = interaction.fields.getTextInputValue('rp_ideals');
			session.step = 'alignment';

			const alignmentEmbed = new EmbedBuilder()
				.setColor(0x9B59B6)
				.setTitle('Step 4: Choose an Alignment')
				.setDescription(alignmentExplanation);

			const menu = new StringSelectMenuBuilder()
				.setCustomId(`char_create_alignment_${userId}`)
				.setPlaceholder('Select your character\'s alignment')
				.addOptions(
					// UPDATED OPTIONS
					{ label: 'Lawful Good', value: 'Lawful Good' },
					{ label: 'True Good', value: 'True Good' },
					{ label: 'Chaotic Good', value: 'Chaotic Good' },
					{ label: 'Lawful Neutral', value: 'Lawful Neutral' },
					{ label: 'True Neutral', value: 'True Neutral' },
					{ label: 'Chaotic Neutral', value: 'Chaotic Neutral' },
					{ label: 'Lawful Evil', value: 'Lawful Evil' },
					{ label: 'True Evil', value: 'True Evil' },
					{ label: 'Chaotic Evil', value: 'Chaotic Evil' },
				);

			const row = new ActionRowBuilder().addComponents(menu);
			await interaction.editReply({ embeds: [alignmentEmbed], components: [row] });
		}
	},

	async menus(interaction) {
		const parts = interaction.customId.split('_');
		const [, command, action, userId] = parts;

		if (interaction.user.id !== userId) return;

		// Handler for editing alignment on an existing character
		if (command === 'edit' && action === 'alignment') {
			try {
				const newAlignment = interaction.values[0];
				db.prepare('UPDATE characters SET character_alignment = ? WHERE user_id = ?').run(newAlignment, userId);
				await interaction.update({ content: `✅ Your character's alignment has been set to **${newAlignment}**.`, components: [], embeds: [] });
			}
			catch (error) {
				console.error('Alignment update error:', error);
				await interaction.update({ content: 'There was an error updating your alignment.', components: [], embeds: [] });
			}
			return;
		}

		// Handler for selecting alignment during character creation
		if (command === 'create' && action === 'alignment') {
			const session = creationSessions.get(userId);
			if (!session || session.step !== 'alignment') {
				return interaction.update({ content: 'Your creation session is out of sync. Please start over.', components: [], embeds: [] });
			}

			session.alignment = interaction.values[0];
			session.step = 'confirm';
			await showFinalConfirmation(interaction, session);
		}
	},

	async buttons(interaction) {
		const parts = interaction.customId.split('_');
		const command = parts[1];
		const action = parts[2];
		const subject = parts[3];
		const userId = parts[parts.length - 1];

		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This interaction is not for you.', flags: MessageFlags.Ephemeral });
		}
		// REFACTORED: New handler for spend points buttons
		if (command === 'spendpoints') {
			// Handle the new "start new session" prompt
			if (action === 'restart') {
				spendPointsSessions.delete(userId);
				await startNewSpendPointsSession(interaction, true);
				return;
			}
			if (action === 'closeprompt') {
				await interaction.update({ content: 'Action cancelled.', embeds: [], components: [] });
				return;
			}

			const session = spendPointsSessions.get(userId);
			if (!session) {
				await interaction.update({ content: 'This stat allocation session has expired. Please start a new one.', components: [], embeds: [] });
				return;
			}
			session.timestamp = Date.now();
			switch (action) {
			case 'add': {
				const stat = parts[3];
				if (session.unspentPoints > 0) {
					session.unspentPoints--;
					session.pointsToAdd[stat]++;
					session.undoStack.push(stat);
				}
				break;
			}
			case 'undo': {
				if (session.undoStack.length > 0) {
					const lastStat = session.undoStack.pop();
					session.unspentPoints++;
					session.pointsToAdd[lastStat]--;
				}
				break;
			}
			case 'confirm': {
				const totalSpent = Object.values(session.pointsToAdd).reduce((sum, val) => sum + val, 0);
				if (totalSpent > 0) {
					try {
						const spendTx = db.transaction(() => {
							db.prepare(`
                                UPDATE characters SET
                                    stat_might = stat_might + ?, stat_finesse = stat_finesse + ?,
                                    stat_wits = stat_wits + ?, stat_grit = stat_grit + ?,
                                    stat_charm = stat_charm + ?, stat_fortune = stat_fortune + ?,
                                    stat_points_unspent = stat_points_unspent - ?
                                WHERE user_id = ?
                            `).run(
								session.pointsToAdd.might, session.pointsToAdd.finesse, session.pointsToAdd.wits,
								session.pointsToAdd.grit, session.pointsToAdd.charm, session.pointsToAdd.fortune,
								totalSpent, userId,
							);
						});
						spendTx();
						recalculateStats(userId);

						const allocatedPoints = Object.entries(session.pointsToAdd)
							.filter(([, val]) => val > 0)
							.map(([key, val]) => `• **${key.charAt(0).toUpperCase() + key.slice(1)}:** +${val}`)
							.join('\n');

						const successEmbed = new EmbedBuilder()
							.setColor(0x2ECC71).setTitle('✅ Stats Increased!')
							.setDescription(`You successfully allocated **${totalSpent}** stat points. Your stats have been permanently updated.`)
							.addFields({ name: 'Points Allocated', value: allocatedPoints });

						await interaction.update({ embeds: [successEmbed], components: [] });
					}
					catch (err) {
						console.error('Error confirming stat points:', err);
						await interaction.update({ content: 'An error occurred while saving your stats. Please try again.', components: [], embeds: [] });
					}
				}
				else {
					await interaction.update({ content: 'Allocation cancelled. No points were spent.', components: [], embeds: [] });
				}
				spendPointsSessions.delete(userId);
				return;
			}
			case 'cancel': {
				spendPointsSessions.delete(userId);
				await interaction.update({ content: 'Stat point allocation has been cancelled. No changes were made.', components: [], embeds: [] });
				return;
			}
			}

			const updatedEmbed = buildSpendPointsEmbed(session);
			await interaction.update({ embeds: [updatedEmbed] });
			return;
		}

		if (command === 'edit') {
			const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
			if (!character) return interaction.reply({ content: 'Could not find your character data.', flags: MessageFlags.Ephemeral });

			switch (action) {
			case 'name': {
				const modal = new ModalBuilder().setCustomId(`char_edit_name_${userId}`).setTitle('Edit Character Name');
				modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('char_name').setLabel('New Name').setStyle(TextInputStyle.Short).setValue(character.character_name).setRequired(true)));
				return interaction.showModal(modal);
			}
			case 'image': {
				const modal = new ModalBuilder().setCustomId(`char_edit_image_${userId}`).setTitle('Set Character Image');
				modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('char_image').setLabel('Image URL').setStyle(TextInputStyle.Short).setValue(character.character_image || '').setPlaceholder('https://example.com/image.png').setRequired(false)));
				return interaction.showModal(modal);
			}
			case 'alignment': {
				const alignmentEmbed = new EmbedBuilder()
					.setColor(0x9B59B6)
					.setTitle('Character Alignment Editor')
					.setDescription(alignmentExplanation);
				const menu = new StringSelectMenuBuilder()
					.setCustomId(`char_edit_alignment_${userId}`)
					.setPlaceholder('Select your character\'s alignment')
					.addOptions(
						// UPDATED OPTIONS
						{ label: 'Lawful Good', value: 'Lawful Good' },
						{ label: 'True Good', value: 'True Good' },
						{ label: 'Chaotic Good', value: 'Chaotic Good' },
						{ label: 'Lawful Neutral', value: 'Lawful Neutral' },
						{ label: 'True Neutral', value: 'True Neutral' },
						{ label: 'Chaotic Neutral', value: 'Chaotic Neutral' },
						{ label: 'Lawful Evil', value: 'Lawful Evil' },
						{ label: 'True Evil', value: 'True Evil' },
						{ label: 'Chaotic Evil', value: 'Chaotic Evil' },
					);
				return interaction.reply({ embeds: [alignmentEmbed], components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
			}
			case 'backstory': {
				const modal = new ModalBuilder().setCustomId(`char_edit_backstory_${userId}`).setTitle('Edit Character Backstory');
				modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('char_backstory').setLabel('Your Story').setStyle(TextInputStyle.Paragraph).setValue(character.character_backstory || '').setRequired(false)));
				return interaction.showModal(modal);
			}
			case 'personality': {
				const modal = new ModalBuilder().setCustomId(`char_edit_personality_${userId}`).setTitle('Edit Personality Details');
				modal.addComponents(
					new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('char_ideals').setLabel('Ideals').setStyle(TextInputStyle.Paragraph).setValue(character.character_ideals || '').setRequired(false)),
					new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('char_bonds').setLabel('Bonds').setStyle(TextInputStyle.Paragraph).setValue(character.character_bonds || '').setRequired(false)),
					new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('char_flaws').setLabel('Flaws').setStyle(TextInputStyle.Paragraph).setValue(character.character_flaws || '').setRequired(false)),
					new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('char_traits').setLabel('Traits').setStyle(TextInputStyle.Paragraph).setValue(character.character_traits || '').setRequired(false)),
				);
				return interaction.showModal(modal);
			}
			}
			return;
		}

		// Existing handlers for Character Creation
		const session = creationSessions.get(userId);
		if (!session) {
			return interaction.reply({ content: 'Your creation session has expired. Please start over with `/character create`.', flags: MessageFlags.Ephemeral });
		}
		session.timestamp = Date.now();

		if (command === 'create') {
			// --- Origin Flow ---
			if (action === 'select' && subject === 'origin') {
				const originId = parts[4];
				await showOriginInfo(interaction, session, originId);
			}
			else if (action === 'back' && subject === 'origin') {
				await showOriginSelection(interaction, session);
			}
			else if (action === 'confirm' && subject === 'origin') {
				session.originId = session.tempOriginId;
				delete session.tempOriginId;
				await showArchetypeSelection(interaction, session);
			}
			// --- Archetype Flow ---
			else if (action === 'select' && subject === 'archetype') {
				const archetypeId = parts[4];
				await showArchetypeInfo(interaction, session, archetypeId);
			}
			else if (action === 'back' && subject === 'archetype') {
				await showArchetypeSelection(interaction, session);
			}
			else if (action === 'confirm' && subject === 'archetype') {
				session.archetypeId = session.tempArchetypeId;
				delete session.tempArchetypeId;
				session.step = 'rp';

				const rpModal = new ModalBuilder()
					.setCustomId(`char_create_rp_${userId}`)
					.setTitle('Character Creation: Role-Playing Details');
				rpModal.addComponents(
					new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rp_ideals').setLabel('What are your character\'s ideals?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
					new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rp_backstory').setLabel('Character Backstory').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000)),
				);
				await interaction.showModal(rpModal);
			}
			// --- Final Actions ---
			else if (action === 'confirm' && subject === 'final') {
				await interaction.deferUpdate();
				try {
					const origin = db.prepare('SELECT bonus_stat_1, bonus_stat_2 FROM origins WHERE id = ?').get(session.originId);
					const archetype = db.prepare('SELECT name FROM archetypes WHERE id = ?').get(session.archetypeId);

					const createCharacterTx = db.transaction(() => {
						const stats = { might: 5, finesse: 5, wits: 5, grit: 5, charm: 5, fortune: 5 };
						const validStats = ['might', 'finesse', 'wits', 'grit', 'charm', 'fortune'];
						if (validStats.includes(origin.bonus_stat_1)) stats[origin.bonus_stat_1]++;
						if (validStats.includes(origin.bonus_stat_2)) stats[origin.bonus_stat_2]++;

						db.prepare(`
							INSERT INTO characters (
								user_id, character_name, origin_id, archetype_id, character_backstory,
								character_alignment, character_ideals, stat_might, stat_finesse,
								stat_wits, stat_grit, stat_charm, stat_fortune
							) VALUES (
								@user_id, @character_name, @origin_id, @archetype_id, @character_backstory,
								@character_alignment, @character_ideals, @stat_might, @stat_finesse,
								@stat_wits, @stat_grit, @stat_charm, @stat_fortune
							)
						`).run({
							user_id: userId, character_name: session.name, origin_id: session.originId, archetype_id: session.archetypeId,
							character_backstory: session.backstory || '', character_alignment: session.alignment || 'Unaligned',
							character_ideals: session.ideals || '', stat_might: stats.might, stat_finesse: stats.finesse,
							stat_wits: stats.wits, stat_grit: stats.grit, stat_charm: stats.charm, stat_fortune: stats.fortune,
						});
						const standardItems = ['Simple Dagger', 'Worn Buckler', 'Traveler\'s Hood', 'Traveler\'s Tunic', 'Traveler\'s Trousers', 'Worn Leather Boots', 'Simple Iron Band', 'Frayed Rope Amulet'];
						const archetypeItems = {
							'Channeler': ['Channeler\'s Focus', 'Acolyte\'s Robes'], 'Golemancer': ['Tinkerer\'s Hammer', 'Reinforced Apron'], 'Justicar': ['Candor\'s Mace', 'Vow Keeper\'s Sigil'],
							'Slayer': ['Slayer\'s Hunting Brand', 'Stalker\'s Mantle'], 'Shifter': ['Unstable Effigy', 'Fey-Touched Tunic'], 'Reaper': ['Ritualist\'s Dagger', 'Siphoning Charm'],
							'Ascetic': ['Weighted Knuckle Wraps', 'Ring of Inner Focus'], 'Saboteur': ['Saboteur\'s Stiletto', 'Infiltrator\'s Charm'], 'Scholar': ['Tome of Beginnings', 'Amulet of Keen Insight'],
							'Artisan': ['Artisan\'s Hammer', 'Guildsman\'s Ring'], 'Zealot': ['Zealot\'s Banner', 'Devotee\'s Pauldrons'], 'Warden': ['Warden\'s Shield', 'Enforcer\'s Cudgel'],
						};
						const itemsToGrant = [...standardItems, ...(archetypeItems[archetype.name] || [])];
						if (itemsToGrant.length === 0) return;

						const getItemData = db.prepare('SELECT item_id, effects_json FROM items WHERE name = ?');
						const insertInventoryItem = db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)');
						const equipItem = db.prepare('UPDATE user_inventory SET equipped_slot = ? WHERE inventory_id = ?');
						let ringSlotCounter = 1;

						for (const itemName of itemsToGrant) {
							const item = getItemData.get(itemName);
							if (item) {
								const result = insertInventoryItem.run(userId, item.item_id);
								const newInventoryId = result.lastInsertRowid;
								if (standardItems.includes(itemName)) {
									try {
										const effects = JSON.parse(item.effects_json);
										let slotToEquip = effects?.slot;
										if (slotToEquip) {
											if (slotToEquip === 'ring') {
												if (ringSlotCounter <= 2) {
													slotToEquip = `ring${ringSlotCounter}`;
													ringSlotCounter++;
												}
												else { slotToEquip = null; }
											}
											if (slotToEquip) { equipItem.run(slotToEquip, newInventoryId); }
										}
									}
									catch (e) { console.error(`[Auto-Equip] Failed to parse effects_json for ${itemName}: ${e.message}`); }
								}
							}
							else { console.error(`[Character Creation] Could not find item "${itemName}" to grant to new character.`); }
						}
					});
					createCharacterTx();
					creationSessions.delete(userId);
					const successEmbed = new EmbedBuilder()
						.setColor(0x2ECC71).setTitle('🎉 Character Created! 🎉')
						.setDescription(`**${session.name}** has been born! Welcome to a new world of adventure.\n\nYour standard gear has been automatically equipped to get you started. You'll find archetype-specific items in your inventory—use \`/character equip\` to try them on!\n\nYou can view your new character sheet at any time with \`/character view\`.`);
					await interaction.editReply({ embeds: [successEmbed], components: [] });
				}
				catch (error) {
					console.error('Character creation DB error:', error);
					await interaction.editReply({ content: 'A critical error occurred while saving your character. Please try again later.', components: [], embeds: [] });
					creationSessions.delete(userId);
				}
			}
			else if (action === 'cancel') {
				creationSessions.delete(userId);
				await interaction.deferUpdate();
				await interaction.editReply({ content: 'Character creation has been cancelled.', embeds: [], components: [] });
			}
		}
	},
};

/**
* Builds up to maxRows of 5-button rows for selection UIs.
* @param {Array<{id:number|string,name:string}>} items
* @param {string} customIdPrefix e.g., 'char_create_origin'
* @param {string} userId appended as the last segment in customIds
* @param {number} [maxRows=5] hard cap of rows to render (buttons capped at maxRows*5)
* @returns {import('discord.js').ActionRowBuilder[]}
*/
function createButtonRows(items, customIdPrefix, userId, maxRows = 5) {
	const rows = [];
	let currentRow = new ActionRowBuilder();

	for (const item of items.slice(0, maxRows * 5)) {
		if (currentRow.components.length === 5) {
			rows.push(currentRow);
			if (rows.length >= maxRows) break;
			currentRow = new ActionRowBuilder();
		}
		currentRow.addComponents(
			new ButtonBuilder()
				.setCustomId(`${customIdPrefix}_${item.id}_${userId}`)
				.setLabel(item.name)
				.setStyle(ButtonStyle.Secondary),
		);
	}
	if (currentRow.components.length > 0) {
		rows.push(currentRow);
	}
	return rows;
}
/**
 * Displays the list of all available Origins for selection.
 * @param {import('discord.js').Interaction} interaction The interaction object.
 * @param {object} session The user's creation session object.
 */
async function showOriginSelection(interaction, session) {
	session.step = 'origin';
	const origins = db.prepare('SELECT * FROM origins ORDER BY name ASC').all();
	const embed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle(`Step 2: Choose an Origin for ${session.name}`)
		.setDescription('Your Origin defines your background, granting you starting stat bonuses and a unique perk. **Click a button to learn more about it.**');

	const rows = createButtonRows(origins, 'char_create_select_origin', session.userId);
	await interaction.update({ embeds: [embed], components: rows });
}

/**
 * Displays detailed information about a single, selected Origin.
 * @param {import('discord.js').Interaction} interaction The interaction object.
 * @param {object} session The user's creation session object.
 * @param {string} originId The ID of the origin to display.
 */
async function showOriginInfo(interaction, session, originId) {
	session.step = 'origin_info';
	session.tempOriginId = originId;
	const origin = db.prepare('SELECT * FROM origins WHERE id = ?').get(originId);

	const embed = new EmbedBuilder()
		.setColor(0x1ABC9C)
		.setTitle(`Origin: ${origin.name}`)
		.setDescription(origin.description)
		.addFields(
			{ name: 'Stat Bonuses', value: `\`+1 ${origin.bonus_stat_1}\` & \`+1 ${origin.bonus_stat_2}\``, inline: false },
			{ name: `Perk: ${origin.base_perk_name}`, value: origin.base_perk_description, inline: false },
		);

	const actionRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`char_create_confirm_origin_${session.userId}`).setLabel('Confirm Origin').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`char_create_back_origin_${session.userId}`).setLabel('Go Back').setStyle(ButtonStyle.Secondary),
	);

	await interaction.update({ embeds: [embed], components: [actionRow] });
}

/**
 * Displays the list of all available Archetypes for selection.
 * @param {import('discord.js').Interaction} interaction The interaction object.
 * @param {object} session The user's creation session object.
 */
async function showArchetypeSelection(interaction, session) {
	session.step = 'archetype';
	const archetypes = db.prepare('SELECT * FROM archetypes ORDER BY name ASC').all();
	const embed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle('Step 3: Choose an Archetype')
		.setDescription('Your Archetype is your class, defining your primary stats and future abilities. **Click a button to learn more about it.**');

	const rows = createButtonRows(archetypes, 'char_create_select_archetype', session.userId);
	await interaction.update({ embeds: [embed], components: rows });
}

/**
 * Displays detailed information about a single, selected Archetype.
 * @param {import('discord.js').Interaction} interaction The interaction object.
 * @param {object} session The user's creation session object.
 * @param {string} archetypeId The ID of the archetype to display.
 */
async function showArchetypeInfo(interaction, session, archetypeId) {
	session.step = 'archetype_info';
	session.tempArchetypeId = archetypeId;
	const archetype = db.prepare('SELECT * FROM archetypes WHERE id = ?').get(archetypeId);

	const embed = new EmbedBuilder()
		.setColor(0x1ABC9C)
		.setTitle(`Archetype: ${archetype.name}`)
		.setDescription(archetype.description)
		.addFields({ name: 'Primary Stats', value: `\`${archetype.primary_stat_1}\` & \`${archetype.primary_stat_2}\``, inline: false });

	const actionRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`char_create_confirm_archetype_${session.userId}`).setLabel('Confirm Archetype').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`char_create_back_archetype_${session.userId}`).setLabel('Go Back').setStyle(ButtonStyle.Secondary),
	);

	await interaction.update({ embeds: [embed], components: [actionRow] });
}

/**
 * Displays the final character confirmation screen before creation.
 * @param {import('discord.js').Interaction} interaction The interaction object.
 * @param {object} session The user's creation session object.
 */
async function showFinalConfirmation(interaction, session) {
	const origin = db.prepare('SELECT * FROM origins WHERE id = ?').get(session.originId);
	const archetype = db.prepare('SELECT * FROM archetypes WHERE id = ?').get(session.archetypeId);

	if (!origin || !archetype) {
		creationSessions.delete(session.userId);
		return interaction.update({ content: 'Your creation data is invalid or has expired. Please restart with `/character create`.', components: [], embeds: [] });
	}

	const confirmEmbed = new EmbedBuilder()
		.setColor(0xFEE75C)
		.setTitle(`Final Confirmation for ${session.name}`)
		.setDescription('Please review your choices. This is your last chance to turn back. Press "Confirm & Create" to bring your character to life!')
		.addFields(
			{ name: 'Character Name', value: session.name, inline: false },
			{ name: 'Chosen Origin', value: `**${origin.name}** (+1 ${origin.bonus_stat_1}, +1 ${origin.bonus_stat_2})`, inline: true },
			{ name: 'Chosen Archetype', value: `**${archetype.name}**`, inline: true },
			{ name: 'Alignment', value: session.alignment || '*Not provided.*', inline: false },
			{ name: 'Backstory', value: session.backstory ? session.backstory.substring(0, 1020) : '*Not provided.*', inline: false },
		);

	const confirmRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`char_create_confirm_final_${session.userId}`).setLabel('Confirm & Create').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`char_create_cancel_${session.userId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
	);
	await interaction.update({ embeds: [confirmEmbed], components: [confirmRow] });
}

module.exports.handleCreate = handleCreate;
module.exports.charSessionCleanup = charSessionCleanup;