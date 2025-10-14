// commands/charsys/unseal.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('@database/database.js');
const { rollVoucher, givePrize } = require('@core_tavernborne/utils/getVoucherLoot.js');
const { rarityColors, rarityEmojis } = require('@core_tavernborne/data/constants.js');

const redeemableTypes = ['VOUCHER', 'LOOTCRATE'];

/**
 * Present an ephemeral selection UI allowing a user to choose a voucher or chest to unseal.
 *
 * Queries the invoking user's redeemable inventory and replies (or updates the original interaction)
 * with an ephemeral embed and a dropdown listing available vouchers/lootcrates. If the user has no
 * redeemable items, an ephemeral notice is sent instead.
 *
 * @param {import('discord.js').Interaction} interaction - The interaction that triggered the command; used to reply or update the interaction with the selection UI.
 * @returns {any} The result of replying to or updating the interaction. 
 */
async function executeUnseal(interaction) {
	const userId = interaction.user.id;
	const isUpdate = interaction.isButton();

	const redeemableItems = db.prepare(`
        SELECT ui.inventory_id, i.name, i.description, ui.quantity
        FROM user_inventory ui
        JOIN items i ON ui.item_id = i.item_id
        WHERE ui.user_id = ? AND i.item_type IN (${redeemableTypes.map(() => '?').join(',')})
        ORDER BY i.name ASC
    `).all(userId, ...redeemableTypes);

	if (redeemableItems.length === 0) {
		const reply = { content: 'You have no vouchers or chests to unseal.', embeds: [], components: [], flags: MessageFlags.Ephemeral };
		return isUpdate ? interaction.update(reply) : interaction.reply(reply);
	}

	const embed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle('🔓 Unseal Your Treasures')
		.setDescription('Select an item from the dropdown menu to see what\'s inside!');

	const menu = new StringSelectMenuBuilder()
		.setCustomId(`unseal_select_${userId}`)
		.setPlaceholder('Choose an item to open...')
		.addOptions(redeemableItems.slice(0, 25).map(item => ({
			label: `${item.name} (x${item.quantity})`,
			description: item.description.substring(0, 100),
			value: item.inventory_id.toString(),
		})));

	const reply = { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral };
	return isUpdate ? interaction.update(reply) : interaction.reply(reply);
}

module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('unseal')
		.setDescription('Open vouchers, chests, and other sealed items to reveal your prize!'),

	async execute(interaction) {
		await executeUnseal(interaction);
	},

	async menus(interaction) {
		const [, action, userId] = interaction.customId.split('_');

		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This is not your menu.', flags: MessageFlags.Ephemeral });
		}
		if (action !== 'select') return;

		await interaction.deferUpdate();

		const inventoryId = parseInt(interaction.values[0], 10);
		const itemToOpen = db.prepare(`
            SELECT i.name, i.item_id FROM user_inventory ui
            JOIN items i ON ui.item_id = i.item_id
            WHERE ui.inventory_id = ? AND ui.user_id = ?
        `).get(inventoryId, userId);

		if (!itemToOpen) {
			return interaction.editReply({ content: 'You no longer have that item.', embeds: [], components: [] });
		}

		// Animation simulation
		const possiblePrizes = Array.from({ length: 5 }, () => rollVoucher(itemToOpen.name));
		const prizePromises = await Promise.all(possiblePrizes);
		const finalPrize = await rollVoucher(itemToOpen.name);

		let animationMsg = 'Unsealing...';
		const embed = new EmbedBuilder()
			.setTitle(`Unsealing ${itemToOpen.name}...`)
			.setColor(0xFEE75C)
			.setDescription(animationMsg);

		await interaction.editReply({ embeds: [embed], components: [] });

		for (let i = 0; i < 3; i++) {
			await new Promise(resolve => setTimeout(resolve, 800));
			animationMsg += `\n${prizePromises[i].name}...`;
			embed.setDescription(animationMsg);
			await interaction.editReply({ embeds: [embed] });
		}

		// Consume the item
		try {
			const consumeTx = db.transaction(() => {
				const itemStack = db.prepare('SELECT quantity FROM user_inventory WHERE inventory_id = ?').get(inventoryId);

				if (!itemStack) {
					// Item was somehow removed between selection and now.
					throw new Error('Item not found in inventory.');
				}

				if (itemStack.quantity > 1) {
					db.prepare('UPDATE user_inventory SET quantity = quantity - 1 WHERE inventory_id = ?').run(inventoryId);
				}
				else {
					db.prepare('DELETE FROM user_inventory WHERE inventory_id = ?').run(inventoryId);
				}
			});

			consumeTx();
		}
		catch (error) {
			console.error('Failed to consume voucher:', error);
			return interaction.editReply({ content: 'An error occurred while trying to use your item. It may have been removed from your inventory.', embeds: [], components: [] });
		}
		// Give the prize
		await givePrize(userId, finalPrize, interaction);

		// Final Result
		const prizeItemInfo = finalPrize.type === 'item' ? db.prepare('SELECT rarity FROM items WHERE item_id = ?').get(finalPrize.value) : null;
		const rarity = prizeItemInfo?.rarity || 'COMMON';
		const finalEmbed = new EmbedBuilder()
			.setTitle(`Unsealed: ${itemToOpen.name}!`)
			.setColor(rarityColors[rarity.toUpperCase()] || 0x95A5A6)
			.setDescription('You open the container and find...')
			.addFields({ name: 'Prize Found!', value: `${rarityEmojis[rarity.toUpperCase()] || '❓'} **${finalPrize.name}**` })
			.setFooter({ text: 'The item has been added to your inventory or balance.' });

		await interaction.editReply({ embeds: [finalEmbed] });
	},

	// We export this so the button on /character view can call it
	executeUnseal,
};