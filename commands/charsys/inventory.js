// commands/charsys/inventory.js

const path = require('path');
const { checkBetatestLock } = require(`${global.__utils}/betaLock.js`);
const commandFilename = path.basename(__filename);
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../database');
const { rarityEmojis, rarityColors } = require('../../utils/constants.js');

const ITEMS_PER_PAGE = 10;

// Defines the order in which categories will appear in the UI.
const CATEGORY_ORDER = ['equipped', 'weapons', 'armor', 'consumables', 'materials', 'miscellaneous'];
const CATEGORY_NAMES = {
	equipped: 'Equipped Gear',
	weapons: 'Weapons',
	armor: 'Armor',
	consumables: 'Consumables',
	materials: 'Materials',
	miscellaneous: 'Miscellaneous',
};


/**
 * Handles the /inventory item_info command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleItemInfo(interaction) {
	const userId = interaction.user.id;
	const inventoryId = interaction.options.getInteger('item');

	const item = db.prepare(`
        SELECT
            i.*, ui.quantity, ui.equipped_slot
        FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.user_id = ? AND ui.inventory_id = ?
    `).get(userId, inventoryId);

	if (!item) {
		return interaction.reply({ content: 'Could not find that item in your inventory.', flags: MessageFlags.Ephemeral });
	}

	const emoji = rarityEmojis[item.rarity.toUpperCase()] ?? '❓';
	const color = rarityColors[item.rarity.toUpperCase()] ?? 0x836953;
	const isWeapon = item.item_type === 'WEAPON';

	const embed = new EmbedBuilder()
		.setTitle(item.name)
		.setColor(color)
		.setDescription(item.description || 'An item of curious origin.');

	const status = item.equipped_slot
		? `Equipped (${item.equipped_slot.charAt(0).toUpperCase() + item.equipped_slot.slice(1)})`
		: 'In Inventory';


	embed.addFields({ name: 'Status', value: status, inline: false });


	const details = [
		`**Type:** ${item.item_type.charAt(0).toUpperCase() + item.item_type.slice(1).toLowerCase()}`,
		`**Rarity:** ${emoji} ${item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1).toLowerCase()}`,
		`**Base Value:** ${item.crown_value} Crowns`,
		`**Tradeable:** ${item.is_tradeable ? 'Yes' : 'No'}`,
		`**Stackable:** ${item.is_stackable ? 'Yes' : 'No'}`,
		`${item.quantity > 0 ? `**Quantity Owned:** ${item.quantity}` : ''}`,
		`${isWeapon ? `**Damage Dice:** ${item.damage_dice}` : ''}`,
		`${isWeapon ? `**Handedness:** ${item.handedness === 'one-handed' ? 'Single Handed' : 'Two Handed'}` : ''}`,
		`${isWeapon ? `**Damage Type:** ${item.damage_type}` : ''}`,
	];

	embed.addFields({ name: 'Item Basics', value: details.join('\n'), inline: false });

	// Effects from JSON
	if (item.effects_json) {
		try {
			const effects = JSON.parse(item.effects_json);
			const effectLines = [];
			if (effects.slot) {
				effectLines.push(`**Slot:** ${effects.slot.charAt(0).toUpperCase() + effects.slot.slice(1)}`);
			}
			if (effects.stats) {
				for (const [stat, value] of Object.entries(effects.stats)) {
					const sign = value > 0 ? '+' : '';
					effectLines.push(`**${stat.charAt(0).toUpperCase() + stat.slice(1)}:** ${sign}${value}`);
				}
			}

			if (effectLines.length > 0) {
				embed.addFields({ name: 'Effects', value: effectLines.join('\n'), inline: true });
			}

		}
		catch (error) {
			console.error(`Failed to parse effects_json for item info (inv_id: ${inventoryId}):`, error);
		}
	}


	await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * REFACTORED: Handles viewing the inventory by category and page.
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ButtonInteraction | import('discord.js').StringSelectMenuInteraction} interaction
 * @param {string} [categoryArg] - The category to display.
 * @param {number} [pageArg] - The page number within the category.
 */
async function handleView(interaction, categoryArg, pageArg) {
	const userId = interaction.user.id;
	const isUpdate = interaction.isButton() || interaction.isStringSelectMenu();

	const character = db.prepare('SELECT user_id FROM characters WHERE user_id = ?').get(userId);
	if (!character) {
		const replyOptions = { content: 'You need to create a character first with `/character create`.', flags: MessageFlags.Ephemeral, embeds: [], components: [] };
		return isUpdate ? interaction.update(replyOptions) : interaction.reply(replyOptions);
	}

	const allItems = db.prepare(`
        SELECT ui.inventory_id, ui.quantity, ui.equipped_slot, i.name, i.item_type
        FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.user_id = ?
        ORDER BY i.name ASC
    `).all(userId);

	if (allItems.length === 0) {
		const embed = new EmbedBuilder()
			.setColor(0x95A5A6)
			.setTitle(`${interaction.user.username}'s Inventory`)
			.setDescription('*Your pockets are empty.*');
		const replyOptions = { embeds: [embed], components: [], flags: MessageFlags.Ephemeral };
		return isUpdate ? interaction.update(replyOptions) : interaction.reply(replyOptions);
	}

	const unequippedItems = allItems.filter(item => !item.equipped_slot);
	const categories = {
		equipped: allItems.filter(item => item.equipped_slot),
		weapons: unequippedItems.filter(i => i.item_type === 'WEAPON'),
		armor: unequippedItems.filter(i => i.item_type === 'ARMOR'),
		consumables: unequippedItems.filter(i => i.item_type === 'CONSUMABLE'),
		materials: unequippedItems.filter(i => i.item_type === 'MATERIAL'),
		miscellaneous: unequippedItems.filter(i => !['WEAPON', 'ARMOR', 'CONSUMABLE', 'MATERIAL'].includes(i.item_type)),
	};

	const availableCategories = CATEGORY_ORDER.filter(c => categories[c].length > 0);
	const currentCategory = categoryArg && availableCategories.includes(categoryArg) ? categoryArg : availableCategories[0] || 'equipped';
	const itemsToList = categories[currentCategory];

	const totalPages = Math.max(1, Math.ceil(itemsToList.length / ITEMS_PER_PAGE));
	const page = Math.min(pageArg || 1, totalPages);
	const start = (page - 1) * ITEMS_PER_PAGE;
	const end = start + ITEMS_PER_PAGE;
	const pageContent = itemsToList.slice(start, end);

	const embed = new EmbedBuilder()
		.setColor(0x95A5A6)
		.setTitle(`${interaction.user.username}'s Inventory - ${CATEGORY_NAMES[currentCategory]}`)
		.setFooter({ text: `Page ${page}/${totalPages} | Use /character equip to manage gear.` });

	const descriptionLines = pageContent.map(item => {
		const slot = item.equipped_slot ? `\`(${item.equipped_slot.charAt(0).toUpperCase() + item.equipped_slot.slice(1)})\`` : '';
		const quantity = item.quantity > 1 ? `x${item.quantity}` : '';
		return `• **${item.name}** ${quantity} ${slot}`;
	});
	embed.setDescription(descriptionLines.join('\n') || '*This category is empty.*');

	// --- Components ---
	const components = [];

	// Category Selector
	const categoryMenu = new StringSelectMenuBuilder()
		.setCustomId(`inventory_category_${userId}`)
		.setPlaceholder('View a different category...')
		.addOptions(availableCategories.map(cat => ({
			label: CATEGORY_NAMES[cat],
			value: cat,
			default: cat === currentCategory,
		})));
	components.push(new ActionRowBuilder().addComponents(categoryMenu));


	// Page Buttons
	if (totalPages > 1) {
		const pageRow = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`inventory_page_${userId}_${currentCategory}_${page - 1}`)
				.setLabel('◀️ Previous')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page === 1),
			new ButtonBuilder()
				.setCustomId(`inventory_page_${userId}_${currentCategory}_${page + 1}`)
				.setLabel('Next ▶️')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page === totalPages),
		);
		components.push(pageRow);
	}

	const replyOptions = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
	if (isUpdate) {
		await interaction.update(replyOptions);
	}
	else {
		await interaction.reply(replyOptions);
	}
}

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('inventory')
		.setDescription('Manage your character\'s inventory.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('item_info')
				.setDescription('Inspect a specific item in your inventory.')
				.addIntegerOption(option =>
					option.setName('item')
						.setDescription('The inventory item to inspect.')
						.setRequired(true)
						.setAutocomplete(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('view')
				.setDescription('View your character\'s inventory.')),

	async autocomplete(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		const userId = interaction.user.id;

		if (subcommand === 'item_info' && focusedOption.name === 'item') {
			const focusedValue = focusedOption.value.toLowerCase();
			const inventory = db.prepare(`
				SELECT ui.inventory_id, i.name
				FROM user_inventory ui
				JOIN items i ON ui.item_id = i.item_id
				WHERE ui.user_id = ?
				ORDER BY i.name ASC
			`).all(userId);

			const filtered = inventory
				.filter(item => item.name.toLowerCase().includes(focusedValue))
				.map(item => ({
					name: item.name,
					value: item.inventory_id,
				}));

			await interaction.respond(filtered.slice(0, 25));
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
		case 'view':
			await handleView(interaction);
			break;
		case 'item_info':
			await handleItemInfo(interaction);
			break;
		default:
			await interaction.reply({ content: 'This inventory command is not yet implemented.', flags: MessageFlags.Ephemeral });
		}
	},

	/**
     * Handles button presses for inventory pagination.
     * @param {import('discord.js').ButtonInteraction} interaction
     */
	async buttons(interaction) {
		const parts = interaction.customId.split('_');
		if (parts.length !== 5 || parts[0] !== 'inventory' || parts[1] !== 'page') {
			return;
		}
		const [,, targetUserId, category, page] = parts;

		if (interaction.user.id !== targetUserId) {
			return interaction.reply({ content: 'This is not your inventory menu.', flags: MessageFlags.Ephemeral });
		}

		await handleView(interaction, category, parseInt(page));
	},

	/**
     * Handles select menu for changing inventory category.
     * @param {import('discord.js').StringSelectMenuInteraction} interaction
     */
	async menus(interaction) {
		const parts = interaction.customId.split('_');
		if (parts.length !== 3 || parts[0] !== 'inventory' || parts[1] !== 'category') {
			return;
		}
		const [,, targetUserId] = parts;

		if (interaction.user.id !== targetUserId) {
			return interaction.reply({ content: 'This is not your inventory menu.', flags: MessageFlags.Ephemeral });
		}

		const selectedCategory = interaction.values[0];
		// Go to page 1 of the newly selected category
		await handleView(interaction, selectedCategory, 1);
	},
};