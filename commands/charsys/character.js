// commands/charsys/character.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const db = require('../../database');
const { recalculateStats } = require('../../utils/recalculateStats');
// In-memory store for character creation sessions.
// Key: userId, Value: { step, name, originId, archetypeId, ... }
const creationSessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

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
}, SESSION_TIMEOUT);

/**
 * Clears the character creation session timer and in-memory state.
 * Call on bot shutdown to avoid dangling intervals and memory.
 */
function charCreateSessionCleanup() {
	if (sessionCleanupInterval) {
		clearInterval(sessionCleanupInterval);
	}
	creationSessions.clear();
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
		const content = targetUser.id === interaction.user.id
			? 'You have not created a character yet. Use `/character create` to begin!'
			: `${targetUser.username} has not created a character yet.`;
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}
	recalculateStats(targetUser.id);

	// Calculate XP required for the next level.
	// TODO: Move the max level to config.json.
	const MAX_LEVEL = 100;

	const level = Math.min(characterData.level, MAX_LEVEL);

	// This is the XP the character has accumulated for their CURRENT level.
	// It's read directly from the database because addXp.js stores it this way.
	const xpIntoLevel = characterData.xp;

	// This is the total amount of XP needed to complete the CURRENT level.
	const xpRequiredForNext = Math.floor(100 * (level ** 1.5));

	// Fetch equipped items

	const equipmentSlots = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring1', 'ring2', 'amulet'];
	const equippedItems = db.prepare(`
        SELECT i.name, i.damage_dice, i.damage_type, ui.equipped_slot
        FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.user_id = ? AND ui.equipped_slot IS NOT NULL
    `).all(targetUser.id);

	// Create a map for easy lookup: { helmet: 'Iron Helm', weapon: 'Rusty Sword' }
	const equippedMap = new Map(equippedItems.map(item => [item.equipped_slot, item]));

	let damageString = '';
	const weapon = equippedMap.get('weapon');
	if (weapon) {
		// --- This block only runs if a weapon IS equipped ---
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
		// --- This block only runs if a weapon is NOT equipped ---
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
                       `**Grit:** ${characterData.stat_grit} | **Charm:** ${characterData.stat_charm} | **Fortune:** ${characterData.stat_fortune}`,
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

	await interaction.reply({ embeds: [sheetEmbed] });
}

/**
 * Handles the /character equip command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleEquip(interaction) {
	const userId = interaction.user.id;
	const inventoryId = interaction.options.getInteger('item');
	// The `slot` option is primarily for filtering the autocomplete, but we can use it for validation.
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
	// Verify the item exists in the user's inventory and is equippable in the intended slot.
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
			// 1. Unequip any item currently in the target slot to avoid unique constraint errors.
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
			// NEW: Prevent equipping an offhand item if a two-handed weapon is equipped.
			else if (intendedSlot === 'offhand') {
				const mainWeapon = db.prepare(`
                    SELECT i.handedness FROM user_inventory ui
                    JOIN items i ON ui.item_id = i.item_id
                    WHERE ui.user_id = ? AND ui.equipped_slot = 'weapon'
                `).get(userId);
				if (mainWeapon?.handedness === 'two-handed') {
					// This creates a controlled failure that the try-catch will handle.
					throw new Error('Cannot equip an offhand item while a two-handed weapon is equipped.');
				}
			}

			// 2. Equip the new item.
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

	// Find the item name *before* unequipping it for the reply message.
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
				.setName('help')
				.setDescription('Get help and information about the character system.')),

	/**
	* Autocomplete handler for /character subcommands.
	* - equip/item: filters inventory items for the selected slot
	* - unequip/slot: lists currently equipped slots
	* @param {import('discord.js').AutocompleteInteraction} interaction
	*/
	async autocomplete(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		const userId = interaction.user.id;

		if (subcommand === 'equip') {
			if (focusedOption.name === 'item') {
				// Get the value of the *other*, already-filled-in option.
				const slot = interaction.options.getString('slot');
				if (!slot) {
					// If the user hasn't chosen a slot yet, show no items.
					return interaction.respond([]);
				}
				const validSlotTypes = ['weapon', 'offhand', 'helmet', 'chestplate', 'leggings', 'boots', 'ring', 'amulet'];
				const itemSlotType = slot.startsWith('ring') ? 'ring' : slot;
				if (!validSlotTypes.includes(itemSlotType)) {
					return interaction.respond([]);
				}
				const focusedValue = focusedOption.value.toLowerCase();
				// Find items in inventory that match the chosen slot.
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

	/**
	* Executes the /character command by dispatching to subcommand handlers.
	* @param {import('discord.js').ChatInputCommandInteraction} interaction
	*/
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
		case 'help':
			await interaction.reply({ content: 'Character system help guide is under construction!', flags: MessageFlags.Ephemeral });
			break;
		default:
			await interaction.reply({ content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
		}
	},

	/**
     * Handles modal submissions for the character creation process.
     * @param {import('discord.js').ModalSubmitInteraction} interaction
     */
	async modals(interaction) {
		const parts = interaction.customId.split('_');
		const action = parts[2];
		const userId = parts[parts.length - 1];

		if (!userId || !action) {
			return interaction.reply({ content: 'Invalid interaction format.', flags: MessageFlags.Ephemeral });
		}

		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This interaction is not for you.', flags: MessageFlags.Ephemeral });
		}

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

			// --- Show Origin Selection ---
			const origins = db.prepare('SELECT * FROM origins').all();
			const embed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setTitle(`Step 2: Choose an Origin for ${characterName}`)
				.setDescription('Your Origin defines your background, granting you starting stat bonuses and a unique perk.');

			const rows = createButtonRows(origins, 'char_create_origin', userId);

			await interaction.editReply({ embeds: [embed], components: rows });
		}
		else if (action === 'rp' && session.step === 'rp') {
			// This will be implemented in a future step.
			// For now, we go to final confirmation.
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

	/**
     * Handles button presses for the character creation process.
     * @param {import('discord.js').ButtonInteraction} interaction
     */
	async buttons(interaction) {
		const parts = interaction.customId.split('_');
		const action = parts[2];
		const userId = parts[parts.length - 1];
		const id = (action === 'origin' || action === 'archetype') ? parts[3] : undefined;

		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This interaction is not for you.', flags: MessageFlags.Ephemeral });
		}

		const session = creationSessions.get(userId);
		if (!session) {
			return interaction.reply({ content: 'Your creation session has expired. Please start over with `/character create`.', flags: MessageFlags.Ephemeral });
		}

		session.timestamp = Date.now();

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
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('rp_alignment')
						.setLabel('Alignment (e.g., Chaotic Good)')
						.setStyle(TextInputStyle.Short)
						.setRequired(false)
						.setMaxLength(50),
				),
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('rp_ideals')
						.setLabel('What are your character\'s ideals?')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(false)
						.setMaxLength(500),
				),
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('rp_backstory')
						.setLabel('Character Backstory (Optional)')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(false)
						.setMaxLength(2000),
				),
			);
			await interaction.showModal(rpModal);
		}
		else if (action === 'confirm' && session.step === 'confirm') {
			await interaction.deferUpdate();
			try {
				const origin = db.prepare('SELECT bonus_stat_1, bonus_stat_2 FROM origins WHERE id = ?').get(session.originId);
				const archetype = db.prepare('SELECT name FROM archetypes WHERE id = ?').get(session.archetypeId);

				const createCharacterTx = db.transaction(() => {
					// Base stats
					const stats = {
						might: 5, finesse: 5, wits: 5, grit: 5, charm: 5, fortune: 5,
					};
					// Apply origin bonuses
					const validStats = ['might', 'finesse', 'wits', 'grit', 'charm', 'fortune'];
					if (validStats.includes(origin.bonus_stat_1)) {
						stats[origin.bonus_stat_1]++;
					}
					if (validStats.includes(origin.bonus_stat_2)) {
						stats[origin.bonus_stat_2]++;
					}

					db.prepare(`
                        INSERT INTO characters (
                            user_id, character_name, origin_id, archetype_id,
                            character_backstory, character_alignment, character_ideals,
                            stat_might, stat_finesse, stat_wits, stat_grit, stat_charm, stat_fortune
                        ) VALUES (
                            @user_id, @character_name, @origin_id, @archetype_id,
                            @character_backstory, @character_alignment, @character_ideals,
                            @stat_might, @stat_finesse, @stat_wits, @stat_grit, @stat_charm, @stat_fortune
                        )
                    `).run({
						user_id: userId,
						character_name: session.name,
						origin_id: session.originId,
						archetype_id: session.archetypeId,
						character_backstory: session.backstory || '',
						character_alignment: session.alignment || '',
						character_ideals: session.ideals || '',
						stat_might: stats.might,
						stat_finesse: stats.finesse,
						stat_wits: stats.wits,
						stat_grit: stats.grit,
						stat_charm: stats.charm,
						stat_fortune: stats.fortune,
					});

					// --- GRANT STARTING EQUIPMENT ---

					// 1. Define the item names for standard and archetype-specific gear
					const standardItems = [
						'Simple Dagger',
						'Worn Buckler',
						'Traveler\'s Hood',
						'Traveler\'s Tunic',
						'Traveler\'s Trousers',
						'Worn Leather Boots',
						'Simple Iron Band',
						'Frayed Rope Amulet',
					];
					const archetypeItems = {
						'Channeler': ['Channeler\'s Focus', 'Acolyte\'s Robes'],
						'Golemancer': ['Tinkerer\'s Hammer', 'Reinforced Apron'],
						'Justicar': ['Candor\'s Mace', 'Vow Keeper\'s Sigil'],
						'Slayer': ['Slayer\'s Hunting Brand', 'Stalker\'s Mantle'],
						'Shifter': ['Unstable Effigy', 'Fey-Touched Tunic'],
						'Reaper': ['Ritualist\'s Dagger', 'Siphoning Charm'],
						'Ascetic': ['Weighted Knuckle Wraps', 'Ring of Inner Focus'],
						'Saboteur': ['Saboteur\'s Stiletto', 'Infiltrator\'s Charm'],
						'Scholar': ['Tome of Beginnings', 'Amulet of Keen Insight'],
						'Artisan': ['Artisan\'s Hammer', 'Guildsman\'s Ring'],
						'Zealot': ['Zealot\'s Banner', 'Devotee\'s Pauldrons'],
						'Warden': ['Warden\'s Shield', 'Enforcer\'s Cudgel'],
					};

					const itemsToGrant = [...standardItems, ...(archetypeItems[archetype.name] || [])];
					if (itemsToGrant.length === 0) return;

					// 2. Prepare a statement to get item IDs from their names
					const getItemData = db.prepare('SELECT item_id, effects_json FROM items WHERE name = ?');
					const insertInventoryItem = db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)');
					const equipItem = db.prepare('UPDATE user_inventory SET equipped_slot = ? WHERE inventory_id = ?');

					let ringSlotCounter = 1;

					for (const itemName of itemsToGrant) {
						const item = getItemData.get(itemName);
						if (item) {
							// Always insert the item into inventory first
							const result = insertInventoryItem.run(userId, item.item_id);
							const newInventoryId = result.lastInsertRowid;

							// If it's a standard item, try to equip it
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
											else {
												slotToEquip = null;
											}
										}
										if (slotToEquip) {
											equipItem.run(slotToEquip, newInventoryId);
										}
									}
								}
								catch (e) {
									console.error(`[Auto-Equip] Failed to parse effects_json for ${itemName}: ${e.message}`);
								}
							}
						}
						else {
							console.error(`[Character Creation] Could not find item "${itemName}" to grant to new character.`);
						}
					}
				});

				createCharacterTx();
				creationSessions.delete(userId);

				const successEmbed = new EmbedBuilder()
					.setColor(0x2ECC71)
					.setTitle('🎉 Character Created! 🎉')
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

module.exports.charCreateSessionCleanup = charCreateSessionCleanup;