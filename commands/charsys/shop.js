const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../database');

const activeShopSessions = new Map();
const SHOP_SESSION_TIMEOUT = 15 * 60 * 1000;

// This function remains the same
setInterval(() => {
	const now = Date.now();
	for (const [userId, session] of activeShopSessions.entries()) {
		if (now - session.timestamp > SHOP_SESSION_TIMEOUT) {
			activeShopSessions.delete(userId);
		}
	}
}, SHOP_SESSION_TIMEOUT);


/**
 * Builds the main UI for a specific shop.
 * @param {object} vendor The vendor data from the database.
 * @param {object} character The player's character data.
 * @param {object} interactionData The player's interaction data with this vendor.
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function buildShopUI(vendor, character, interactionData) {
	// This function remains the same.
	const embed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle(`Welcome to ${vendor.name}`)
		.setDescription(vendor.description || 'A mysterious vendor with little to say.')
		.setFooter({ text: `Your Rapport: ${interactionData.rapport}` });

	if (interactionData.discount_modifier !== 1.0 && new Date(interactionData.discount_expires_at) > new Date()) {
		const isDiscount = interactionData.discount_modifier < 1.0;
		const percent = Math.abs(1 - interactionData.discount_modifier) * 100;
		const expiryTimestamp = Math.floor(new Date(interactionData.discount_expires_at).getTime() / 1000);
		embed.addFields({
			name: isDiscount ? '✨ Active Discount!' : '😠 Price Increase!',
			value: `All prices are adjusted by **${percent.toFixed(0)}%** for you. This effect expires <t:${expiryTimestamp}:R>.`,
			inline: false,
		});
	}

	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`shop_buy_${vendor.vendor_id}_${character.user_id}`).setLabel('Buy').setStyle(ButtonStyle.Success).setEmoji('🛒'),
		new ButtonBuilder().setCustomId(`shop_sell_${vendor.vendor_id}_${character.user_id}`).setLabel('Sell').setStyle(ButtonStyle.Primary).setEmoji('💰'),
		new ButtonBuilder().setCustomId(`shop_talk_${vendor.vendor_id}_${character.user_id}`).setLabel('Talk').setStyle(ButtonStyle.Secondary).setEmoji('💬'),
		new ButtonBuilder().setCustomId(`shop_leave_${vendor.vendor_id}_${character.user_id}`).setLabel('Leave').setStyle(ButtonStyle.Danger).setEmoji('🚪'),
	);

	return { embeds: [embed], components: [row] };
}

/**
 * Starts a new shop session for a user and displays the initial UI.
 * @param {import('discord.js').Interaction} interaction The interaction to reply to.
 * @param {boolean} [isUpdate=false] Whether to use .update() instead of .reply().
 */
async function startNewShopSession(interaction, isUpdate = false) {
	const userId = interaction.user.id;
	activeShopSessions.set(userId, { timestamp: Date.now() });

	const vendors = db.prepare('SELECT vendor_id, name, description FROM npc_vendors ORDER BY name ASC').all();
	const ui = buildVendorSelectionUI(vendors, userId);

	const replyOptions = { ...ui, flags: MessageFlags.Ephemeral, content: '' };

	if (isUpdate) {
		await interaction.update(replyOptions);
	}
	else {
		await interaction.reply(replyOptions);
	}
}

/**
 * Builds the UI for confirming the purchase of an item.
 * @param {object} vendor The vendor data.
 * @param {object} item The item data.
 * @param {number} price The final price of the item after modifiers.
 * @param {object} economy The user's economy data.
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function buildBuyConfirmationUI(vendor, item, price, economy) {
	const embed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle(`Buy: ${item.name}`)
		.setDescription(item.description || 'An item of curious origin.')
		.addFields(
			{ name: '💰 Price', value: `${price} Crowns`, inline: true },
			{ name: '👑 Your Balance', value: `${economy.crowns.toLocaleString()} Crowns`, inline: true },
		);

	const canAfford = economy.crowns >= price;
	const isStackable = item.is_stackable === 1;

	const row1 = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`shop_buyone_${vendor.vendor_id}_${item.item_id}`)
			.setLabel('Buy 1')
			.setStyle(ButtonStyle.Success)
			.setDisabled(!canAfford),
		new ButtonBuilder()
			.setCustomId(`shop_buyten_${vendor.vendor_id}_${item.item_id}`)
			.setLabel('Buy 10')
			.setStyle(ButtonStyle.Success)
			.setDisabled(!canAfford || !isStackable || economy.crowns < price * 10),
		new ButtonBuilder()
			.setCustomId(`shop_buycustom_${vendor.vendor_id}_${item.item_id}`)
			.setLabel('Buy Custom...')
			.setStyle(ButtonStyle.Primary)
			.setDisabled(!canAfford),
	);

	const row2 = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`shop_buyback_${vendor.vendor_id}_${vendor.user_id}`)
			.setLabel('Back to Item List')
			.setStyle(ButtonStyle.Secondary),
	);

	return { embeds: [embed], components: [row1, row2] };
}

/**
 * Builds the UI for the item buying list.
 * @param {object} vendor The vendor data.
 * @param {object} character The character data.
 * @param {Array<object>} itemsForSale The items the vendor is selling.
 * @param {object} economy The player's economy data.
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[], content: string}}
 */
function buildBuyListUI(vendor, character, itemsForSale, economy) {
	const interactionData = db.prepare('SELECT discount_modifier FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(character.user_id, vendor.vendor_id);
	const modifier = interactionData?.discount_modifier || 1.0;
	const finalBuyPrice = (price) => Math.floor(price * modifier);

	const embed = new EmbedBuilder()
		.setColor(0x2ECC71)
		.setTitle(`Buying from ${vendor.name}`)
		.setDescription('Select an item from the list below to purchase it.')
		.setFooter({ text: `Your Balance: ${economy.crowns.toLocaleString()} Crowns` });

	if (itemsForSale.length === 0) {
		const backButton = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`shop_back_${vendor.vendor_id}_${character.user_id}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
		);
		embed.setDescription(`It doesn't look like ${vendor.name} has anything for sale right now.`);
		return { content: '', embeds: [embed], components: [backButton] };
	}

	const menu = new StringSelectMenuBuilder()
		.setCustomId(`shop_menu_buyitem_${vendor.vendor_id}_${character.user_id}`)
		.setPlaceholder('Select an item to purchase...')
		.addOptions(itemsForSale.slice(0, 25).map(item => ({
			label: `${item.name}`,
			description: `Cost: ${finalBuyPrice(item.buy_price)} Crowns`,
			value: item.item_id.toString(),
		})));

	const row1 = new ActionRowBuilder().addComponents(menu);
	const row2 = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`shop_back_${vendor.vendor_id}_${character.user_id}`).setLabel('Back to Main Menu').setStyle(ButtonStyle.Secondary),
	);

	return { content: '', embeds: [embed], components: [row1, row2] };
}

/**
 * Builds the initial vendor selection UI.
 * @param {Array<object>} vendors - List of vendor data from the database.
 * @param {string} userId - The ID of the user interacting with the shop.
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function buildVendorSelectionUI(vendors, userId) {
	const embed = new EmbedBuilder()
		.setColor(0xA9A9A9)
		.setTitle('Welcome to the Town Square')
		.setDescription('The bustling square is filled with merchants hawking their wares. Who would you like to visit?');

	const menu = new StringSelectMenuBuilder()
		.setCustomId(`shop_menu_select_${userId}`)
		.setPlaceholder('Choose a vendor to visit...')
		.addOptions(vendors.map(v => {
			const shopType = v.name.includes('Blacksmith') ? 'Weapons & Armor' :
				v.name.includes('Hunter') ? 'Trophies & Parts' :
					v.name.includes('Alchemist') ? 'Potions & Reagents' :
						'Oddities & Curios';
			return {
				label: `${v.name}`,
				description: `Specializes in: ${shopType}`,
				value: v.vendor_id.toString(),
			};
		}));

	const row1 = new ActionRowBuilder().addComponents(menu);
	const row2 = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`shop_close_${userId}`)
			.setLabel('Close')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🚪'),
	);

	return { embeds: [embed], components: [row1, row2] };
}

/**
 * Builds the UI for selling a specific item.
 * @param {object} vendor The vendor data.
 * @param {object} item The item data (with name, description, etc.).
 * @param {number} availableQuantity The quantity the user can sell.
 * @param {number} price The price per item.
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function buildSellConfirmationUI(vendor, item, availableQuantity, price) {
	const embed = new EmbedBuilder()
		.setColor(0xF1C40F)
		.setTitle(`Sell: ${item.name}`)
		.setDescription(item.description || 'An item of curious origin.')
		.addFields(
			{ name: '💰 Price Per Item', value: `${price} Crowns`, inline: true },
			{ name: '📦 You Have', value: `**${availableQuantity}** available to sell`, inline: true },
		);

	const row1 = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`shop_sellone_${vendor.vendor_id}_${item.item_id}`)
			.setLabel('Sell 1')
			.setStyle(ButtonStyle.Success)
			.setDisabled(availableQuantity < 1),
		new ButtonBuilder()
			.setCustomId(`shop_sellten_${vendor.vendor_id}_${item.item_id}`)
			.setLabel('Sell 10')
			.setStyle(ButtonStyle.Success)
			.setDisabled(availableQuantity < 10),
		new ButtonBuilder()
			.setCustomId(`shop_sellcustom_${vendor.vendor_id}_${item.item_id}`)
			.setLabel('Sell Custom Amount...')
			.setStyle(ButtonStyle.Primary)
			.setDisabled(availableQuantity < 1),
	);

	const row2 = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`shop_sellback_${vendor.vendor_id}_${vendor.user_id}`)
			.setLabel('Back to Item List')
			.setStyle(ButtonStyle.Secondary),
	);

	return { embeds: [embed], components: [row1, row2] };
}

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('shop')
		.setDescription('Visit the town square and interact with local vendors.'),

	async execute(interaction) {
		const userId = interaction.user.id;
		const character = db.prepare('SELECT user_id FROM characters WHERE user_id = ?').get(userId);

		if (!character) {
			return interaction.reply({ content: 'You must create a character with `/character create` before you can visit the shops.', flags: MessageFlags.Ephemeral });
		}

		if (activeShopSessions.has(userId)) {
		// The session exists, so show the confirmation prompt.
			const embed = new EmbedBuilder()
				.setColor(0xFEE75C)
				.setTitle('⚠️ Active Session Found')
				.setDescription('You already have an active shop session. This can happen if you dismissed the previous message without finishing.\n\nWould you like to end the old session and start a new one?');

			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(`shop_restart_session_${userId}`)
					.setLabel('Yes, Start New Session')
					.setStyle(ButtonStyle.Success)
					.setEmoji('✅'),
				new ButtonBuilder()
					.setCustomId(`shop_cancel_restart_${userId}`)
					.setLabel('No, Cancel')
					.setStyle(ButtonStyle.Danger)
					.setEmoji('❌'),
			);

			return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
		}

		// No active session, so start a new one normally.
		await startNewShopSession(interaction, false);
	},

	async menus(interaction) {
		await interaction.deferUpdate();
		const [,, action, ...rest] = interaction.customId.split('_');
		const userId = interaction.user.id;

		try {
		// Initial vendor selection
			if (action === 'select') {
				const expectedUserId = rest[0];
				if (userId !== expectedUserId) return interaction.editReply({ content: 'This is not for you.' });

				const vendorId = interaction.values[0];
				const vendor = db.prepare('SELECT * FROM npc_vendors WHERE vendor_id = ?').get(vendorId);
				const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);

				if (!vendor || !character) {
					return interaction.editReply({ content: 'An error occurred. Please try again.', components: [] });
				}

				db.prepare('INSERT INTO character_npc_interactions (user_id, vendor_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(userId, vendorId);
				const interactionData = db.prepare('SELECT * FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);

				const ui = buildShopUI(vendor, character, interactionData);
				await interaction.editReply({ embeds: ui.embeds, components: ui.components });
			}
			// Item selection from the sell dropdown
			else if (action === 'sellitem') {
				const [vendorId, expectedUserId] = rest;
				if (userId !== expectedUserId) return interaction.editReply({ content: 'This is not for you.' });

				const itemId = interaction.values[0];
				const vendor = db.prepare('SELECT * FROM npc_vendors WHERE vendor_id = ?').get(vendorId);
				// Tack on the user ID for the back button builder
				vendor.user_id = userId;

				// Get full item details and the specific price from this vendor
				const itemToSell = db.prepare(`
				SELECT i.*, vs.sell_price
				FROM items i
				JOIN vendor_stock vs ON i.item_id = vs.item_id
				WHERE i.item_id = ? AND vs.vendor_id = ?
			`).get(itemId, vendorId);

				if (!itemToSell) {
					return interaction.editReply({ content: 'This item cannot be sold here or no longer exists.', components: [] });
				}

				const availableQuantity = db.prepare('SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND item_id = ? AND equipped_slot IS NULL').get(userId, itemId).count;
				const interactionData = db.prepare('SELECT discount_modifier FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const modifier = interactionData?.discount_modifier || 1.0;
				const finalSellPrice = Math.floor(itemToSell.sell_price * modifier);

				const ui = buildSellConfirmationUI(vendor, itemToSell, availableQuantity, finalSellPrice);
				await interaction.editReply({ content: '', embeds: ui.embeds, components: ui.components });
			}
			// NEW: Item selection from the buy dropdown
			else if (action === 'buyitem') {
				const [vendorId, expectedUserId] = rest;
				if (userId !== expectedUserId) return interaction.editReply({ content: 'This is not for you.' });

				const itemId = interaction.values[0];
				const vendor = db.prepare('SELECT * FROM npc_vendors WHERE vendor_id = ?').get(vendorId);
				vendor.user_id = userId;

				const itemToBuy = db.prepare(`
				SELECT i.*, vs.buy_price FROM items i
				JOIN vendor_stock vs ON i.item_id = vs.item_id
				WHERE i.item_id = ? AND vs.vendor_id = ?
			`).get(itemId, vendorId);

				if (!itemToBuy) {
					return interaction.editReply({ content: 'This item is no longer for sale.', components: [] });
				}

				const economy = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId) || { crowns: 0 };
				const interactionData = db.prepare('SELECT discount_modifier FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const modifier = interactionData?.discount_modifier || 1.0;
				const finalBuyPrice = Math.floor(itemToBuy.buy_price * modifier);

				const ui = buildBuyConfirmationUI(vendor, itemToBuy, finalBuyPrice, economy);
				await interaction.editReply({ content: '', embeds: ui.embeds, components: ui.components });
			}
		}
		catch (error) {
			console.error(`[Shop Menu] A critical error occurred during menu processing for user ${userId}:`, error);
			await interaction.editReply({ content: 'A critical server error occurred.', components: [], embeds: [] });
		}
	},

	async modals(interaction) {
		await interaction.deferUpdate();
		const [,, action, vendorId, itemId] = interaction.customId.split('_');
		const userId = interaction.user.id;

		try {
			if (action === 'customamount') {
				const amountToSell = parseInt(interaction.fields.getTextInputValue('sell_custom_input'), 10);

				if (isNaN(amountToSell) || amountToSell <= 0) {
					return interaction.editReply({ content: 'Invalid amount entered.', embeds: [], components: [] });
				}

				// Re-run all checks before processing the sale
				const vendor = db.prepare('SELECT * FROM npc_vendors WHERE vendor_id = ?').get(vendorId);
				vendor.user_id = userId;
				const item = db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
				const availableQuantity = db.prepare('SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND item_id = ? AND equipped_slot IS NULL').get(userId, itemId).count;

				if (amountToSell > availableQuantity) {
					return interaction.editReply({ content: `You only have ${availableQuantity} to sell.`, embeds: [], components: [] });
				}

				const interactionData = db.prepare('SELECT discount_modifier FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const modifier = interactionData?.discount_modifier || 1.0;
				const sellPrice = db.prepare('SELECT sell_price FROM vendor_stock WHERE vendor_id = ? AND item_id = ?').get(vendorId, itemId).sell_price;
				const finalSinglePrice = Math.floor(sellPrice * modifier);
				const totalCrowns = finalSinglePrice * amountToSell;

				// Transaction to ensure atomicity
				const sellTransaction = db.transaction(() => {
					const itemsToRemove = db.prepare('SELECT inventory_id FROM user_inventory WHERE user_id = ? AND item_id = ? AND equipped_slot IS NULL LIMIT ?').all(userId, itemId, amountToSell);
					const ids = itemsToRemove.map(i => i.inventory_id);
					if (ids.length < amountToSell) throw new Error('Not enough items found to delete, something went wrong.');
					db.prepare(`DELETE FROM user_inventory WHERE inventory_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
					db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(totalCrowns, userId);
				});

				sellTransaction();

				const newQuantity = availableQuantity - amountToSell;
				const ui = buildSellConfirmationUI(vendor, item, newQuantity, finalSinglePrice);
				await interaction.editReply({
					content: `✅ You sold **${amountToSell}x ${item.name}** for **${totalCrowns}** Crowns.`,
					embeds: ui.embeds,
					components: ui.components,
				});
			}
			// NEW: Custom Buy Amount
			else if (action === 'custombuy') {
				const amountToBuy = parseInt(interaction.fields.getTextInputValue('buy_custom_input'), 10);
				if (isNaN(amountToBuy) || amountToBuy <= 0) {
					return interaction.editReply({ content: 'Invalid amount entered.', embeds: [], components: [] });
				}

				const vendor = db.prepare('SELECT * FROM npc_vendors WHERE vendor_id = ?').get(vendorId);
				vendor.user_id = userId;
				const item = db.prepare('SELECT i.*, vs.buy_price FROM items i JOIN vendor_stock vs ON i.item_id = vs.item_id WHERE i.item_id = ? AND vs.vendor_id = ?').get(itemId, vendorId);
				if (!item || !item.buy_price) return interaction.editReply({ content: 'This item cannot be purchased.', embeds: [], components: [] });

				const economy = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId) || { crowns: 0 };
				const interactionData = db.prepare('SELECT discount_modifier FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const modifier = interactionData?.discount_modifier || 1.0;
				const finalSinglePrice = Math.floor(item.buy_price * modifier);
				const totalCost = finalSinglePrice * amountToBuy;

				if (totalCost > economy.crowns) {
					return interaction.editReply({ content: `You cannot afford that. You need ${totalCost.toLocaleString()} Crowns, but you only have ${economy.crowns.toLocaleString()}.`, embeds: [], components: [] });
				}
				// Transaction for buying
				db.transaction(() => {
					db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(totalCost, userId);
					if (item.is_stackable) {
						db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity').run(userId, itemId, amountToBuy);
					}
					else {
						const stmt = db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)');
						for (let i = 0; i < amountToBuy; i++) {
							stmt.run(userId, itemId);
						}
					}
				})();

				const newEconomy = { crowns: economy.crowns - totalCost };
				const ui = buildBuyConfirmationUI(vendor, item, finalSinglePrice, newEconomy);
				await interaction.editReply({
					content: `✅ You purchased **${amountToBuy}x ${item.name}** for **${totalCost.toLocaleString()}** Crowns.`,
					embeds: ui.embeds,
					components: ui.components,
				});
			}
		}
		catch (error) {
			console.error(`[Shop Modal] A critical error occurred for user ${userId}:`, error);
			await interaction.editReply({ content: 'A critical server error occurred during the transaction.', components: [], embeds: [] });
		}
	},

	async buttons(interaction) {
		const parts = interaction.customId.split('_');
		const command = parts[0];
		const action = parts[1];
		const userId = interaction.user.id;

		if (command !== 'shop') return;

		// Handle top-level close button which has no vendorId
		if (action === 'close') {
			const expectedUserId = parts[2];
			if (userId === expectedUserId) {
				activeShopSessions.delete(userId);
				await interaction.update({ content: 'You have left the Town Square.', components: [], embeds: [] });
				setTimeout(() => interaction.deleteReply().catch(e => console.error('Error deleting shop reply:', e)), 2000);
			}
			return;
		}

		// Defer immediately for all other actions
		await interaction.deferUpdate();

		try {
			if (action === 'restart' && parts[2] === 'session') {
				const expectedUserId = parts[3];
				if (userId === expectedUserId) {
					activeShopSessions.delete(userId);
					await startNewShopSession(interaction, true);
				}
				return;
			}

			if (action === 'cancel' && parts[2] === 'restart') {
				const expectedUserId = parts[3];
				if (userId === expectedUserId) {
					await interaction.deleteReply().catch(e => console.error('Error deleting restart prompt reply:', e));
				}
				return;
			}

			// Standard variables for vendor-specific actions
			const vendorId = parts[2];
			const itemId = parts[3];
			const expectedUserId = parts[3];

			if (['buy', 'sell', 'talk', 'leave', 'back', 'buyback', 'sellback'].includes(action)) {
				if (userId !== expectedUserId) {
					return interaction.editReply({ content: 'This is not for you.' });
				}
			}

			activeShopSessions.set(userId, { timestamp: Date.now() });

			const vendor = db.prepare('SELECT * FROM npc_vendors WHERE vendor_id = ?').get(vendorId);
			if (!vendor) return interaction.editReply({ content: 'Error: This vendor seems to have vanished.', components: [] });
			vendor.user_id = userId;

			const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
			if (!character) return interaction.editReply({ content: 'Error: Could not find your character data.', components: [] });

			const getFreshUI = () => {
				const interactionData = db.prepare('SELECT * FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				return buildShopUI(vendor, character, interactionData);
			};

			const isBuyAction = action.startsWith('buy') && ['buyone', 'buyten', 'buycustom'].includes(action);
			const isSellAction = action.startsWith('sell') && ['sellone', 'sellten', 'sellcustom'].includes(action);

			if (isBuyAction || isSellAction) {
				const item = db.prepare('SELECT i.*, vs.buy_price, vs.sell_price FROM items i JOIN vendor_stock vs ON i.item_id = vs.item_id WHERE i.item_id = ? AND vs.vendor_id = ?').get(itemId, vendorId);
				if (!item) return interaction.editReply({ content: 'That item could not be found.', components: [] });

				if (action === 'sellcustom') {
					const availableQuantity = db.prepare('SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND item_id = ? AND equipped_slot IS NULL').get(userId, itemId).count;
					const modal = new ModalBuilder().setCustomId(`shop_modal_customamount_${vendorId}_${itemId}`).setTitle(`Sell ${item.name}`);
					const amountInput = new TextInputBuilder().setCustomId('sell_custom_input').setLabel(`How many? (You have ${availableQuantity})`).setStyle(TextInputStyle.Short).setPlaceholder(`1-${availableQuantity}`).setRequired(true);
					modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
					return await interaction.showModal(modal);
				}
				if (action === 'buycustom') {
					const economy = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId) || { crowns: 0 };
					const modal = new ModalBuilder().setCustomId(`shop_modal_custombuy_${vendorId}_${itemId}`).setTitle(`Buy ${item.name}`);
					const amountInput = new TextInputBuilder().setCustomId('buy_custom_input').setLabel(`How many? (You have ${economy.crowns} Crowns)`).setStyle(TextInputStyle.Short).setPlaceholder('Enter amount').setRequired(true);
					modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
					return await interaction.showModal(modal);
				}

				const interactionData = db.prepare('SELECT discount_modifier FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const modifier = interactionData?.discount_modifier || 1.0;

				if (isSellAction) {
					const amountToSell = action === 'sellone' ? 1 : 10;
					const finalSinglePrice = Math.floor(item.sell_price * modifier);
					const totalCrowns = finalSinglePrice * amountToSell;

					try {
						db.transaction(() => {
							const itemsToRemove = db.prepare('SELECT inventory_id FROM user_inventory WHERE user_id = ? AND item_id = ? AND equipped_slot IS NULL LIMIT ?').all(userId, itemId, amountToSell);
							if (itemsToRemove.length < amountToSell) throw new Error('INSUFFICIENT_ITEMS');
							const ids = itemsToRemove.map(i => i.inventory_id);
							db.prepare(`DELETE FROM user_inventory WHERE inventory_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
							db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(totalCrowns, userId);
						})();
						const newQuantity = db.prepare('SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND item_id = ? AND equipped_slot IS NULL').get(userId, itemId).count;
						const ui = buildSellConfirmationUI(vendor, item, newQuantity, finalSinglePrice);
						await interaction.editReply({ content: `✅ You sold **${amountToSell}x ${item.name}** for **${totalCrowns}** Crowns.`, embeds: ui.embeds, components: ui.components });
					}
					catch (e) {
						if (e.message !== 'INSUFFICIENT_ITEMS') throw e;
						const currentQty = db.prepare('SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND item_id = ? AND equipped_slot IS NULL').get(userId, itemId).count;
						const ui = buildSellConfirmationUI(vendor, item, currentQty, finalSinglePrice);
						await interaction.editReply({ content: '❌ You don\'t have enough of that item to sell.', embeds: ui.embeds, components: ui.components });
					}
				}
				else if (isBuyAction) {
					const amountToBuy = action === 'buyone' ? 1 : 10;
					const finalSinglePrice = Math.floor(item.buy_price * modifier);
					const totalCost = finalSinglePrice * amountToBuy;
					const economy = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId) || { crowns: 0 };

					if (totalCost > economy.crowns) {
						const ui = buildBuyConfirmationUI(vendor, item, finalSinglePrice, economy);
						return interaction.editReply({ content: '❌ You cannot afford that.', embeds: ui.embeds, components: ui.components });
					}

					db.transaction(() => {
						db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(totalCost, userId);
						if (item.is_stackable) {
							db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity').run(userId, itemId, amountToBuy);
						}
						else {
							const stmt = db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)');
							for (let i = 0; i < amountToBuy; i++) stmt.run(userId, itemId);
						}
					})();
					const newEconomy = { crowns: economy.crowns - totalCost };
					const ui = buildBuyConfirmationUI(vendor, item, finalSinglePrice, newEconomy);
					await interaction.editReply({ content: `✅ You purchased **${amountToBuy}x ${item.name}** for **${totalCost}** Crowns.`, embeds: ui.embeds, components: ui.components });
				}
				return;
			}

			switch (action) {
			case 'leave': {
				const vendors = db.prepare('SELECT vendor_id, name, description FROM npc_vendors ORDER BY name ASC').all();
				const ui = buildVendorSelectionUI(vendors, userId);
				await interaction.editReply({ ...ui, content: '' });
				break;
			}
			case 'back': {
				const ui = getFreshUI();
				await interaction.editReply({ ...ui, content: '' });
				break;
			}
			case 'buy':
			case 'buyback': {
				const itemsForSale = db.prepare(`
    				SELECT i.item_id, i.name, vs.buy_price FROM items i
    				JOIN vendor_stock vs ON i.item_id = vs.item_id
    				WHERE vs.vendor_id = ? AND vs.buy_price IS NOT NULL
    				ORDER BY i.name ASC
    			`).all(vendorId);
				const economy = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId) || { crowns: 0 };
				const ui = buildBuyListUI(vendor, character, itemsForSale, economy);
				await interaction.editReply(ui);
				break;
			}
			case 'sell':
			case 'sellback': {
				const sellableItems = db.prepare(`
    					SELECT i.item_id, i.name, vs.sell_price, COUNT(ui.inventory_id) as quantity
    					FROM user_inventory ui
    					JOIN items i ON ui.item_id = i.item_id
    					JOIN vendor_stock vs ON i.item_id = vs.item_id AND vs.vendor_id = ?
    					WHERE ui.user_id = ? AND vs.sell_price IS NOT NULL AND ui.equipped_slot IS NULL
    					GROUP BY i.item_id, i.name, vs.sell_price
    					ORDER BY i.name ASC
    				`).all(vendorId, userId);

				if (sellableItems.length === 0) {
					const ui = getFreshUI();
					await interaction.editReply({ content: `You have no unequipped items that ${vendor.name} is interested in.`, ...ui });
					return;
				}

				const interactionData = db.prepare('SELECT discount_modifier FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const modifier = interactionData?.discount_modifier || 1.0;
				const finalSellPrice = (price) => Math.floor(price * modifier);

				const menu = new StringSelectMenuBuilder()
					.setCustomId(`shop_menu_sellitem_${vendorId}_${userId}`)
					.setPlaceholder('Select an item to sell...')
					.addOptions(sellableItems.slice(0, 25).map(item => ({
						label: `${item.name} (x${item.quantity})`,
						description: `Sell for ${finalSellPrice(item.sell_price)} Crowns each`,
						value: item.item_id.toString(),
					})));

				const backButton = new ButtonBuilder().setCustomId(`shop_back_${vendorId}_${userId}`).setLabel('Back to Main Menu').setStyle(ButtonStyle.Secondary);
				const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`Selling Items to ${vendor.name}`).setDescription('Select an item from the dropdown list below to begin selling.');

				await interaction.editReply({ content: '', embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
				break;
			}
			case 'talk': {
				const interactionData = db.prepare('SELECT * FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const hasActiveEffect = interactionData.discount_modifier !== 1.0 && new Date(interactionData.discount_expires_at) > new Date();
				const talkEmbed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`Speaking with ${vendor.name}`).setDescription(`Rapport: ${interactionData.rapport}\n\n"Well, hello there, adventurer. What can I do for you?"`);
				const row = new ActionRowBuilder().addComponents(
					new ButtonBuilder().setCustomId(`shop_charm_${vendorId}_${userId}`).setLabel(`Use your charm (Req: ${vendor.charm_requirement} Charm)`).setStyle(ButtonStyle.Success).setDisabled(character.stat_charm < vendor.charm_requirement || hasActiveEffect),
					new ButtonBuilder().setCustomId(`shop_gamble_${vendorId}_${userId}`).setLabel('Try your luck... (50% Chance)').setStyle(ButtonStyle.Primary).setDisabled(hasActiveEffect),
					new ButtonBuilder().setCustomId(`shop_back_${vendorId}_${userId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
				);
				await interaction.editReply({ embeds: [talkEmbed], components: [row] });
				break;
			}
			case 'charm':
			case 'gamble': {
				let message = '';
				const expiry = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
				let modifier = 1.0;
				let rapportChange = 0;
				const rapportBonus = Math.floor(db.prepare('SELECT rapport FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId).rapport / 10);
				const successChance = 0.5 + (rapportBonus * 0.01);

				if (action === 'charm') {
					modifier = 0.8;
					rapportChange = 1;
					message = `Your silver tongue works wonders! ${vendor.name} offers you a **20% discount** on all purchases for the next 8 hours. Your rapport has increased.`;
				}
				else if (action === 'gamble') {
					if (Math.random() < successChance) {
						modifier = 0.8;
						rapportChange = 1;
						message = `Your risky compliment paid off! ${vendor.name} chuckles and offers you a **20% discount** for 8 hours. Your rapport has increased. (Success Chance: ${Math.round(successChance * 100)}%)`;
					}
					else {
						modifier = 1.2;
						rapportChange = -1;
						message = `You fumbled your words and insulted ${vendor.name}! Prices are **increased by 20%** for you for the next 8 hours. Your rapport has decreased. (Success Chance: ${Math.round(successChance * 100)}%)`;
					}
				}

				db.prepare(`
    					UPDATE character_npc_interactions
    					SET discount_modifier = ?, discount_expires_at = ?, rapport = rapport + ?
    					WHERE user_id = ? AND vendor_id = ?
    				`).run(modifier, expiry, rapportChange, userId, vendorId);

				const ui = getFreshUI();
				await interaction.editReply({ content: message, embeds: ui.embeds, components: ui.components });
				break;
			}
			}
		}
		catch (error) {
			console.error(`[Shop Button] A critical error occurred for user ${userId} (Action: ${action}):`, error);
			await interaction.editReply({ content: 'A critical server error occurred. Please try again.', embeds: [], components: [] }).catch(e => console.error('Failed to send error message to user:', e));
		}
	},
};