// commands/charsys/character.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../database');
const { recalculateStats } = require('../../utils/recalculateStats');
// In-memory store for character creation sessions.
// Key: userId, Value: { step, name, originId, archetypeId, ... }
const creationSessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

// NEW: In-memory store for spend points sessions.
const spendPointsSessions = new Map();

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

	// Fetch all character data in one go, joining with origins and archetypes.
	const characterData = db.prepare(`
        SELECT
            c.*,
            o.name as origin_name,
            a.name as archetype_name
        FROM characters c
        JOIN origins o ON c.origin_id = o.id
        JOIN archetypes a ON c.archetype_id = a.id
        WHERE c.user_id = ?
    `).get(targetUser.id);

	if (!characterData) {
		const content = isSelfView
			? 'You have not created a character yet. Use `/character create` to begin!'
			: `${targetUser.username} has not created a character yet.`;
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}
	recalculateStats(targetUser.id);

	const MAX_LEVEL = 100;
	const level = Math.min(characterData.level, MAX_LEVEL);
	const xpIntoLevel = characterData.xp;
	const xpRequiredForNext = Math.floor(100 * (level ** 1.5));

	const equipmentSlots = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring1', 'ring2', 'amulet'];
	const equippedItems = db.prepare(`
        SELECT i.name, i.damage_dice, i.damage_type, ui.equipped_slot
        FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.user_id = ? AND ui.equipped_slot IS NOT NULL
    `).all(targetUser.id);

	const equippedMap = new Map(equippedItems.map(item => [item.equipped_slot, item]));

	let damageString = '';
	const weapon = equippedMap.get('weapon');
	if (weapon) {
		const damageType = weapon.damage_type;
		const statModifier = getDamageModifier(damageType, characterData);
		const statSign = statModifier >= 0 ? '+' : '';
		let statPulledFrom = '';

		switch (damageType) {
		case 'Bludgeoning':
			statPulledFrom = 'Might';
			break;
		case 'Arcane':
			statPulledFrom = 'Wits';
			break;
		case 'Piercing':
			statPulledFrom = 'Finesse';
			break;
		case 'Slashing':
			statPulledFrom = characterData.stat_finesse > characterData.stat_might ? 'Finesse' : 'Might';
			break;
		default:
			statPulledFrom = 'Might*';
			break;
		}

		damageString = `**Damage:** \`${weapon.damage_dice}${statSign}${statModifier}\` ${damageType} [${statPulledFrom} Based]`;
	}
	else {
		const damageType = 'Bludgeoning';
		const statModifier = getDamageModifier(damageType, characterData);
		const statSign = statModifier >= 0 ? '+' : '';

		damageString = `**Damage:** \`1d4${statSign}${statModifier}\` ${damageType} [Might Based] (Unarmed)`;
	}

	const equipmentDisplay = equipmentSlots.map(slot => {
		const item = equippedMap.get(slot);
		const itemName = item ? item.name : '[Empty]';
		const slotName = slot.charAt(0).toUpperCase() + slot.slice(1).replace(/(\d+)/, ' $1');
		return `**${slotName}:** ${itemName}`;
	});
	const isAscetic = characterData.archetype_name === 'Ascetic';

	const unspentPoints = characterData.stat_points_unspent > 0
		? `\n**Unspent Stat Points:** 🌟 \`${characterData.stat_points_unspent}\``
		: '';

	const sheetEmbed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle(`${characterData.character_name} - Level ${characterData.level} ${characterData.archetype_name}`)
		.setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
		.setThumbnail(characterData.character_image || null)
		.addFields(
			{ name: '📜 Character Info', value: `**Origin:** ${characterData.origin_name}\n**Title:** ${characterData.character_title || 'None'}\n**Alignment:** ${characterData.character_alignment || 'Unaligned'}`, inline: false },
			{ name: '📈 Level Progression', value: generateXpBar(xpIntoLevel, xpRequiredForNext), inline: false },
			{ name: '❤️ Health', value: `\`${characterData.current_health} / ${characterData.max_health}\``, inline: true },
			{ name: '💙 Mana', value: `\`${characterData.current_mana} / ${characterData.max_mana}\``, inline: true },
			...(isAscetic ? [{
				name: '🔥 Ki',
				value: `\`${characterData.current_ki} / ${characterData.max_ki}\``,
				inline: true,
			}] : []),
			{
				name: '📊 Base Stats',
				value: `**Might:** ${characterData.stat_might} | **Finesse:** ${characterData.stat_finesse} | **Wits:** ${characterData.stat_wits}\n` +
                       `**Grit:** ${characterData.stat_grit} | **Charm:** ${characterData.stat_charm} | **Fortune:** ${characterData.stat_fortune}${unspentPoints}`,
				inline: false,
			},
			{
				name: '⚔️ Combat Stats',
				value: `${damageString}\n` +
						`**Armor Class:** ${characterData.armor_class}\n` +
                       `**Crit Chance:** ${Math.round(characterData.crit_chance * 100)}%\n` +
                       `**Crit Damage:** ${(Math.round(characterData.crit_damage_modifier * 100) / 100).toFixed(2)}x`,
				inline: false,
			},
			{
				name: '🛡️ Equipment',
				value: equipmentDisplay.join('\n'),
				inline: false,
			},
		)
		.setFooter({ text: 'Use /character equip to manage your gear.' })
		.setTimestamp();

	// --- NEW: Add edit buttons only if viewing your own character ---
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

	const character = db.prepare('SELECT user_id FROM characters WHERE user_id = ?').get(userId);
	if (!character) {
		return interaction.reply({ content: 'You must create a character first with `/character create`.', flags: MessageFlags.Ephemeral });
	}
	const validEquipTargetSlots = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring1', 'ring2', 'amulet'];
	if (!validEquipTargetSlots.includes(intendedSlot)) {
		return interaction.reply({ content: 'Invalid equipment slot specified.', flags: MessageFlags.Ephemeral });
	}
	const validItemSlotTypes = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring', 'amulet'];
	const itemSlotType = intendedSlot.startsWith('ring') ? 'ring' : intendedSlot;
	if (!validItemSlotTypes.includes(itemSlotType)) {
		return interaction.reply({ content: 'Invalid equipment slot specified.', flags: MessageFlags.Ephemeral });
	}

	const itemToEquip = db.prepare(`
        SELECT i.name, i.handedness, i.effects_json FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.inventory_id = ? AND ui.user_id = ? AND json_extract(i.effects_json, '$.slot') = ?
    `).get(inventoryId, userId, itemSlotType);

	if (!itemToEquip) {
		return interaction.reply({ content: 'The selected item is not valid for that slot or was not found in your inventory.', flags: MessageFlags.Ephemeral });
	}

	try {

		const equipTx = db.transaction(() => {
			const isTwoHanded = itemToEquip.handedness === 'two-handed';
			db.prepare(`
                UPDATE user_inventory
                SET equipped_slot = NULL
                WHERE user_id = ? AND equipped_slot = ?
            `).run(userId, intendedSlot);

			if (isTwoHanded && intendedSlot === 'weapon') {
				db.prepare(`
                    UPDATE user_inventory
                    SET equipped_slot = NULL
                    WHERE user_id = ? AND equipped_slot = 'offhand'
                `).run(userId);
			}
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
		immediateBenefits: '• +UP `Bludgeoning Damage`\n• +UP `Slashing Damage` (from Might-based attacks)\n• +UP `Critical Hit DAMAGE`',
		milestones: {
			10: { name: 'Staggering Blows', desc: 'Your **BLUDGEONING** attacks gain a chance to daze an enemy, forcing them to miss their next turn.' },
			15: { name: 'Heavy Handed', desc: 'Your two-handed weapons gain an additional small damage bonus.' },
			20: { name: 'Armor Penetration', desc: 'Your physical attacks ignore a percentage of the target\'s Armor Class.' },
			25: { name: 'Executioner', desc: 'You deal bonus damage to enemies below 20% health.' },
			30: { name: 'Shield Breaker', desc: 'Your attacks deal ramping bonus damage to enemies with active defensive buffs.' },
		},
	},
	finesse: {
		emoji: '🏹',
		immediateBenefits: '• +UP `Piercing Damage`\n• +UP `Slashing Damage` (if Finesse based attack)\n• +UP `Critical Hit Chance`',
		milestones: {
			10: { name: 'Hemorrhage', desc: 'Your **PIERCING** attacks gain a chance to inflict a Bleed status effect (damage over time).' },
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
		immediateBenefits: '• +UP `Basic Arcane Damage`\n• +UP `Spell Attack Hit Chance`\n• +UP `Max Mana`',
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
		immediateBenefits: '• +UP `Max Health`\n• +UP `Physical Damage Reduction`\n• +UP `Max Ki` (if Ascetic Archetype)',
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
		immediateBenefits: '• +UP Critical Hit Chance\n• +UP Enemy Attack Weaken Chance\n• +UP Threat Level Reduction',
		milestones: {
			10: { name: 'Improved Vendor Prices', desc: 'Grants a discount when buying from and a bonus when selling to NPC vendors.' },
			15: { name: 'Skilled Negotiator', desc: 'Grants a chance to receive bonus Crowns or an extra item from quest rewards.' },
			20: { name: 'Smoothtalking Ambassador', desc: 'Successful `/guild dues` investments may be fully refunded by the impressed NPC.' },
			25: { name: 'Charismatic Leader', desc: 'In a party, your presence grants a passive bonus to XP and Crown gain for all members.' },
			30: { name: 'Unrelenting Persuasion', desc: 'Automatically succeed on low-difficulty NPC persuasion checks.' },
			35: { name: 'Inspiring Revolutionist', desc: 'Unlock the ability (in PvE) to attempt to charm non-boss monsters, causing them to turn against their allies for some time.' },
		},
	},
	fortune: {
		emoji: '🍀',
		immediateBenefits: '• Increases **Critical Hit Chance** (Major)\n• Increases **Basic Attack Dodge Chance**',
		milestones: {
			10: { name: 'Lucky Find', desc: 'Grants a 50% chance to find a bonus reward when claiming `/econ daily`.' },
			15: { name: 'Resourceful', desc: 'Your basic consumables have a 25% chance to not be consumed on use.' },
			20: { name: 'Gambler\'s Intuition', desc: 'Slightly improves your odds in all `/gamble` commands (e.g., +5% win chance).' },
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
		.setTitle(`🌟 Allocate Stat Points | ${unspentPoints} Available`)
		.setDescription('Review the benefits and upcoming milestones for each stat below. Use the buttons to assign your points.');

	const statOrder = ['might', 'finesse', 'wits', 'grit', 'charm', 'fortune'];

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
				upcomingMilestones += `**${level} - ${milestone.name}:** ${milestone.desc}\n`;
			}
		}
		if (!upcomingMilestones) {
			upcomingMilestones = '*You have learned all available proficiencies for this stat!*';
		}

		const fieldValue = `*${proficiency.immediateBenefits}*\n\n**Upcoming Proficiencies:**\n${upcomingMilestones}`;

		embed.addFields({
			name: `${proficiency.emoji} ${stat.charAt(0).toUpperCase() + stat.slice(1)}`,
			value: fieldValue,
			inline: false,
		});
	}

	// --- Separator ---
	embed.addFields({ name: '\u200B', value: '--- **Your Allocation** ---' });


	// --- Interactive Bottom Half ---
	for (const stat of statOrder) {
		const baseValue = initialStats[`stat_${stat}`];
		const addedValue = pointsToAdd[stat];
		let valueString = `**${baseValue}**`;
		if (addedValue > 0) {
			valueString = `${baseValue} ➔ **${baseValue + addedValue} (+${addedValue})**`;
		}
		embed.addFields({ name: stat.charAt(0).toUpperCase() + stat.slice(1), value: valueString, inline: true });
	}

	return embed;
}


/**
 * REFACTORED: Handles the /character spendpoints command using an interactive embed.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSpendPoints(interaction) {
	const userId = interaction.user.id;
	if (spendPointsSessions.has(userId)) {
		return interaction.reply({ content: 'You already have an active stat allocation session. Please complete or cancel it first.', flags: MessageFlags.Ephemeral });
	}

	const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);

	if (!character) {
		return interaction.reply({ content: 'You must create a character first.', flags: MessageFlags.Ephemeral });
	}

	if (!character.stat_points_unspent || character.stat_points_unspent <= 0) {
		return interaction.reply({ content: 'You have no unspent stat points to allocate.', flags: MessageFlags.Ephemeral });
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

	await interaction.reply({ embeds: [embed], components: [row1, row2, row3], flags: MessageFlags.Ephemeral });
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


		// Existing handler for character creation modals
		const session = creationSessions.get(userId);
		if (!session) {
			return interaction.reply({ content: 'Your creation session has expired. Please start over with `/character create`.', flags: MessageFlags.Ephemeral });
		}
		session.timestamp = Date.now();
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (action === 'name' && session.step === 'name') {
			const characterName = interaction.fields.getTextInputValue('character_name');
			session.name = characterName;
			session.step = 'origin';

			const origins = db.prepare('SELECT * FROM origins').all();
			const embed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setTitle(`Step 2: Choose an Origin for ${characterName}`)
				.setDescription('Your Origin defines your background, granting you starting stat bonuses and a unique perk.');
			const rows = createButtonRows(origins, 'char_create_origin', userId);
			await interaction.editReply({ embeds: [embed], components: rows });
		}
		else if (action === 'rp' && session.step === 'rp') {
			session.backstory = interaction.fields.getTextInputValue('rp_backstory');
			session.alignment = interaction.fields.getTextInputValue('rp_alignment');
			session.ideals = interaction.fields.getTextInputValue('rp_ideals');
			session.step = 'confirm';

			const origin = db.prepare('SELECT * FROM origins WHERE id = ?').get(session.originId);
			const archetype = db.prepare('SELECT * FROM archetypes WHERE id = ?').get(session.archetypeId);

			if (!origin || !archetype) {
				creationSessions.delete(userId);
				return interaction.editReply({ content: 'Your creation data is invalid or has expired. Please restart with `/character create`.', components: [], embeds: [] });
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
				new ButtonBuilder()
					.setCustomId(`char_create_confirm_final_${userId}`)
					.setLabel('Confirm & Create')
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(`char_create_cancel_${userId}`)
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Danger),
			);
			await interaction.editReply({ embeds: [confirmEmbed], components: [confirmRow] });
		}
	},
	// --- NEW: Select Menu handler for alignment ---
	async menus(interaction) {
		const parts = interaction.customId.split('_');
		const [, command, action, userId] = parts;
		if (interaction.user.id !== userId || command !== 'edit' || action !== 'alignment') return;

		try {
			const newAlignment = interaction.values[0];
			db.prepare('UPDATE characters SET character_alignment = ? WHERE user_id = ?').run(newAlignment, userId);
			await interaction.update({ content: `✅ Your character's alignment has been set to **${newAlignment}**.`, components: [], embeds: [] });
		}
		catch (error) {
			console.error('Alignment update error:', error);
			await interaction.update({ content: 'There was an error updating your alignment.', components: [], embeds: [] });
		}
	},

	async buttons(interaction) {
		const parts = interaction.customId.split('_');
		const command = parts[1];
		const action = parts[2];
		const userId = parts[parts.length - 1];

		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This interaction is not for you.', flags: MessageFlags.Ephemeral });
		}
		// REFACTORED: New handler for spend points buttons
		if (command === 'spendpoints') {
			const session = spendPointsSessions.get(userId);
			if (!session) {
				await interaction.update({ content: 'This stat allocation session has expired. Please start a new one.', components: [], embeds: [] });
				return;
			}
			session.timestamp = Date.now();
			const subAction = parts[3];
			const stat = parts[4];

			switch (subAction) {
			case 'add':
				if (session.unspentPoints > 0) {
					session.unspentPoints--;
					session.pointsToAdd[stat]++;
					session.undoStack.push(stat);
				}
				break;
			case 'undo':
				if (session.undoStack.length > 0) {
					const lastStat = session.undoStack.pop();
					session.unspentPoints++;
					session.pointsToAdd[lastStat]--;
				}
				break;
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
			case 'cancel':
				spendPointsSessions.delete(userId);
				await interaction.update({ content: 'Stat point allocation has been cancelled. No changes were made.', components: [], embeds: [] });
				return;
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
				const menu = new StringSelectMenuBuilder()
					.setCustomId(`char_edit_alignment_${userId}`)
					.setPlaceholder('Select your character\'s alignment')
					.addOptions([
						{ label: 'Lawful Good', value: 'Lawful Good' }, { label: 'Neutral Good', value: 'Neutral Good' }, { label: 'Chaotic Good', value: 'Chaotic Good' },
						{ label: 'Lawful Neutral', value: 'Lawful Neutral' }, { label: 'True Neutral', value: 'True Neutral' }, { label: 'Chaotic Neutral', value: 'Chaotic Neutral' },
						{ label: 'Lawful Evil', value: 'Lawful Evil' }, { label: 'Neutral Evil', value: 'Neutral Evil' }, { label: 'Chaotic Evil', value: 'Chaotic Evil' },
						{ label: 'Unaligned', value: 'Unaligned' },
					]);
				return interaction.reply({ content: 'Please choose an alignment from the menu below.', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
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
		const id = (action === 'origin' || action === 'archetype') ? parts[3] : undefined;

		if (action === 'origin' && session.step === 'origin') {
			await interaction.deferUpdate();
			session.originId = id;
			session.step = 'archetype';

			const origin = db.prepare('SELECT * FROM origins WHERE id = ?').get(id);
			const archetypes = db.prepare('SELECT * FROM archetypes').all();

			const embed = new EmbedBuilder()
				.setColor(0x1ABC9C)
				.setTitle('Step 3: Choose an Archetype')
				.setDescription(`You have chosen **${origin.name}**. Now, select your Archetype. This defines your class, abilities, and primary stats.`);
			const rows = createButtonRows(archetypes, 'char_create_archetype', userId);
			await interaction.editReply({ embeds: [embed], components: rows });
		}
		else if (action === 'archetype' && session.step === 'archetype') {
			session.archetypeId = id;
			session.step = 'rp';

			const rpModal = new ModalBuilder()
				.setCustomId(`char_create_rp_${userId}`)
				.setTitle('Character Creation: Role-Playing Details');
			rpModal.addComponents(
				new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rp_alignment').setLabel('Alignment (e.g., Chaotic Good)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50)),
				new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rp_ideals').setLabel('What are your character\'s ideals?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
				new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rp_backstory').setLabel('Character Backstory (Optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000)),
			);
			await interaction.showModal(rpModal);
		}
		else if (action === 'confirm' && session.step === 'confirm') {
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
						character_backstory: session.backstory || '', character_alignment: session.alignment || '',
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

module.exports.charSessionCleanup = charSessionCleanup;