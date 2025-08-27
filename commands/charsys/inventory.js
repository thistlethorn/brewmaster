// commands/charsys/inventory.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../../database');

const ITEMS_PER_PAGE = 10;

/**
 * Handles the /inventory view command, displaying a paginated list of items.
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ButtonInteraction} interaction
 * @param {number} [pageArg] - The page number to display, used for button pagination.
 */
async function handleView(interaction, pageArg) {
	const userId = interaction.user.id;
	const rawPage = pageArg ?? interaction.options?.getInteger('page') ?? 1;
	const page = Number.isFinite(Number(rawPage)) ? Math.max(1, Math.floor(rawPage)) : 1;

	// First, ensure the user has a character.
	const character = db.prepare('SELECT user_id FROM characters WHERE user_id = ?').get(userId);
	if (!character) {
		const replyOptions = { content: 'You need to create a character first with `/character create`.', flags: MessageFlags.Ephemeral };
		return interaction.isButton() ? interaction.update(replyOptions) : interaction.reply(replyOptions);
	}

	// Get all inventory items for the user, joined with item details.
	const inventoryItems = db.prepare(`
        SELECT
            ui.inventory_id,
            ui.quantity,
            i.name
        FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.user_id = ?
        ORDER BY i.name ASC
    `).all(userId);

	if (inventoryItems.length === 0) {
		const embed = new EmbedBuilder()
			.setColor(0x95A5A6)
			.setTitle(`${interaction.user.username}'s Inventory`)
			.setDescription('*Your pockets are empty.*');
		const replyOptions = { embeds: [embed], flags: MessageFlags.Ephemeral };
		return interaction.isButton() ? interaction.update(replyOptions) : interaction.reply(replyOptions);
	}

	const equippedItems = db.prepare(`
        SELECT inventory_id FROM user_inventory
        WHERE user_id = ? AND equipped_slot IS NOT NULL
    `).all(userId);
	const equippedIds = new Set(equippedItems.map(item => item.inventory_id));


	// Pagination logic
	const totalPages = Math.max(1, Math.ceil(inventoryItems.length / ITEMS_PER_PAGE));
	const safePage = Math.min(page, totalPages);
	const start = (safePage - 1) * ITEMS_PER_PAGE;
	const end = start + ITEMS_PER_PAGE;
	const pageContent = inventoryItems.slice(start, end);

	const embed = new EmbedBuilder()
		.setColor(0x95A5A6)
		.setTitle(`${interaction.user.username}'s Inventory (Page ${safePage}/${totalPages})`)
		.setFooter({ text: 'Use /character equip to manage your gear.' });

	const descriptionLines = pageContent.map(item => {
		const isEquipped = equippedIds.has(item.inventory_id) ? '`(Equipped)`' : '';
		const quantity = item.quantity > 1 ? `x${item.quantity}` : '';
		return `• **${item.name}** ${quantity} ${isEquipped}`;
	});
	embed.setDescription(descriptionLines.join('\n'));

	const components = [];
	if (totalPages > 1) {
		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`inventory_view_${userId}_${safePage - 1}`)
				.setLabel('◀️ Previous')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safePage === 1),
			new ButtonBuilder()
				.setCustomId(`inventory_view_${userId}_${safePage + 1}`)
				.setLabel('Next ▶️')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(safePage === totalPages),
		);
		components.push(row);
	}

	if (interaction.isButton()) {
		await interaction.update({ embeds: [embed], components });
	}
	else {
		await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
	}
}

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('inventory')
		.setDescription('Manage your character\'s inventory.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('view')
				.setDescription('View your character\'s inventory.')
				.addIntegerOption(option =>
					option.setName('page')
						.setDescription('The page number to view.')
						.setRequired(false))),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'view') {
			await handleView(interaction);
		}
		else {
			await interaction.reply({ content: 'This inventory command is not yet implemented.', flags: MessageFlags.Ephemeral });
		}
	},

	/**
     * Handles button presses for inventory pagination.
     * @param {import('discord.js').ButtonInteraction} interaction
     */
	async buttons(interaction) {
		const parts = interaction.customId.split('_');
		if (parts.length !== 4 || parts[0] !== 'inventory' || parts[1] !== 'view') {
			return interaction.reply({ content: 'Invalid button interaction.', flags: MessageFlags.Ephemeral });
		}
		const [,, targetUserId, page] = parts;

		if (interaction.user.id !== targetUserId) {
			return interaction.reply({ content: 'This is not your inventory menu.', flags: MessageFlags.Ephemeral });
		}

		await handleView(interaction, parseInt(page));
	},
};