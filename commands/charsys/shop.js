const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../../database');

const activeShopSessions = new Map();
const SHOP_SESSION_TIMEOUT = 15 * 60 * 1000;

// This function remains the same.
setInterval(() => {
	const now = Date.now();
	for (const [userId, session] of activeShopSessions.entries()) {
		if (now - session.timestamp > SHOP_SESSION_TIMEOUT) {
			console.log(`[Shop] Deleting expired shop session for User ID: ${userId}`);
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


module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('shop')
		.setDescription('Visit the town square and interact with local vendors.'),

	async execute(interaction) {
		const userId = interaction.user.id;
		console.log(`[Shop] /shop command initiated by User ID: ${userId}`);

		const character = db.prepare('SELECT user_id FROM characters WHERE user_id = ?').get(userId);
		if (!character) {
			console.log(`[Shop] User ${userId} attempted to use /shop without a character.`);
			return interaction.reply({ content: 'You must create a character with `/character create` before you can visit the shops.', flags: MessageFlags.Ephemeral });
		}
		if (activeShopSessions.has(userId)) {
			console.log(`[Shop] User ${userId} tried to open a new shop session while one was already active.`);
			return interaction.reply({ content: 'You are already in an active shop session. Please close it before starting a new one.', flags: MessageFlags.Ephemeral });
		}
		activeShopSessions.set(userId, { timestamp: Date.now() });
		console.log(`[Shop] Active session created for User ID: ${userId}`);

		const vendors = db.prepare('SELECT vendor_id, name, description FROM npc_vendors ORDER BY name ASC').all();

		if (!vendors || vendors.length === 0) {
			console.error('[Shop] CRITICAL: No vendors found in the database during /shop execute.');
			// Clean up session
			activeShopSessions.delete(userId);
			return interaction.reply({ content: 'There are no vendors to visit at this time. Please check back later.', flags: MessageFlags.Ephemeral });
		}

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

		const row = new ActionRowBuilder().addComponents(menu);
		await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
		console.log(`[Shop] Presented vendor selection menu to User ID: ${userId}`);
	},

	async menus(interaction) {
		// Acknowledge the interaction immediately to prevent timeout.
		await interaction.deferUpdate();

		const [,, action, userId] = interaction.customId.split('_');
		console.log(`[Shop Menu] Received menu interaction '${action}' for User ID: ${userId} from actual user ${interaction.user.id}`);

		if (interaction.user.id !== userId) {
			console.warn(`[Shop Menu] User mismatch. Requester: ${interaction.user.id}, Expected: ${userId}.`);
			return interaction.editReply({ content: 'This is not for you.', flags: MessageFlags.Ephemeral });
		}

		try {
			if (action === 'select') {
				const vendorId = interaction.values[0];
				console.log(`[Shop Menu] User ${userId} selected Vendor ID: ${vendorId}`);

				const vendor = db.prepare('SELECT * FROM npc_vendors WHERE vendor_id = ?').get(vendorId);
				const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);

				if (!vendor) {
					console.error(`[Shop Menu] FAILED TO FIND VENDOR. Vendor ID '${vendorId}' not in database.`);
					return interaction.editReply({ content: 'Error: The selected vendor could not be found. They may have packed up and left.', components: [] });
				}
				if (!character) {
					console.error(`[Shop Menu] FAILED TO FIND CHARACTER. User ID '${userId}' not in database.`);
					return interaction.editReply({ content: 'Error: Could not find your character data.', components: [] });
				}

				// Ensure an interaction record exists
				db.prepare(`
					INSERT INTO character_npc_interactions (user_id, vendor_id)
					VALUES (?, ?) ON CONFLICT DO NOTHING
				`).run(userId, vendorId);
				const interactionData = db.prepare('SELECT * FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				if (!interactionData) {
					console.error(`[Shop Menu] FAILED TO GET/CREATE interaction data for User ${userId} and Vendor ${vendorId}.`);
					return interaction.editReply({ content: 'An error occurred while trying to access your history with this vendor.', components: [] });
				}


				const ui = buildShopUI(vendor, character, interactionData);
				await interaction.editReply({ embeds: ui.embeds, components: ui.components });
				console.log(`[Shop Menu] Successfully displayed shop UI for ${vendor.name} to User ${userId}`);
			}
		}
		catch (error) {
			console.error(`[Shop Menu] A critical error occurred during menu processing for user ${userId}:`, error);
			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ content: 'A critical error occurred. Please try again later.', embeds:[], components: [] });
			}
		}
	},

	async buttons(interaction) {
		await interaction.deferUpdate();

		const parts = interaction.customId.split('_');
		const command = parts[0];
		const action = parts[1];
		const vendorId = parts[2];
		const userId = parts[3];

		console.log(`[Shop Button] Received button press '${action}' for User ID: ${userId} (Vendor: ${vendorId}) from actual user ${interaction.user.id}`);

		// Prevent weird shenanigains from cropping up
		if (command !== 'shop') return;

		if (interaction.user.id !== userId) {
			console.warn(`[Shop Button] User mismatch. Requester: ${interaction.user.id}, Expected: ${userId}.`);
			return interaction.editReply({ content: 'This is not for you.', flags: MessageFlags.Ephemeral });
		}

		try {
			// Refresh session timer
			activeShopSessions.set(userId, { timestamp: Date.now() });

			const vendor = db.prepare('SELECT * FROM npc_vendors WHERE vendor_id = ?').get(vendorId);
			const character = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);

			if (!vendor) {
				console.error(`[Shop Button] FAILED TO FIND VENDOR. Vendor ID '${vendorId}' not in database for action '${action}'.`);
				return interaction.editReply({ content: 'Error: The vendor could not be found.', components: [] });
			}
			if (!character) {
				console.error(`[Shop Button] FAILED TO FIND CHARACTER. User ID '${userId}' not in database for action '${action}'.`);
				return interaction.editReply({ content: 'Error: Could not find your character data.', components: [] });
			}

			// Centralized data for building UIs
			const getFreshUI = () => {
				const interactionData = db.prepare('SELECT * FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				if (!interactionData) {
					console.error(`[Shop Button] CRITICAL: Failed to get fresh interaction data in getFreshUI for user ${userId} and vendor ${vendorId}.`);
					// Return a dummy object to prevent a crash, the calling function should handle the error reply.
					return { embeds: [new EmbedBuilder().setTitle('Error').setDescription('Could not load interaction data.')], components: [] };
				}
				return buildShopUI(vendor, character, interactionData);
			};


			switch (action) {
			case 'leave': {
				console.log(`[Shop Button] User ${userId} is leaving the shop.`);
				activeShopSessions.delete(userId);
				await interaction.deleteReply().catch(e => console.error(`[Shop Button] Failed to delete reply for user ${userId}, it might have already been dismissed:`, e));
				break;
			}
			case 'back': {
				console.log(`[Shop Button] User ${userId} clicked 'back'. Rebuilding main shop UI.`);
				const ui = getFreshUI();
				await interaction.editReply({ ...ui, content: '', embeds: ui.embeds, components: ui.components });
				break;
			}
			case 'sell': {
				console.log(`[Shop Button] User ${userId} wants to sell items.`);
				const sellableItems = db.prepare(`
					SELECT ui.inventory_id, i.name, vs.sell_price
					FROM user_inventory ui
					JOIN items i ON ui.item_id = i.item_id
					JOIN vendor_stock vs ON i.item_id = vs.item_id AND vs.vendor_id = ?
					WHERE ui.user_id = ? AND vs.sell_price IS NOT NULL AND ui.equipped_slot IS NULL
				`).all(vendorId, userId);

				if (sellableItems.length === 0) {
					console.log(`[Shop Button] User ${userId} has no items to sell to vendor ${vendorId}.`);
					// Use editReply here since we deferred. We can't use .reply on a button interaction that's been deferred.
					// We'll send a temporary message and then revert to the main UI.
					const ui = getFreshUI();
					await interaction.editReply({ content: `You have no unequipped items that ${vendor.name} is interested in.`, ...ui });
					return;
				}

				const interactionData = db.prepare('SELECT discount_modifier FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const modifier = interactionData?.discount_modifier || 1.0;
				const finalSellPrice = (price) => Math.floor(price * modifier);

				const menu = new StringSelectMenuBuilder()
					.setCustomId(`shop_sellitem_${vendorId}_${userId}`)
					.setPlaceholder('Select an item to sell...')
					.addOptions(sellableItems.slice(0, 25).map(item => ({
						label: `${item.name} (Sell for: ${finalSellPrice(item.sell_price)} Crowns)`,
						value: item.inventory_id.toString(),
					})));
				const backButton = new ButtonBuilder().setCustomId(`shop_back_${vendorId}_${userId}`).setLabel('Back').setStyle(ButtonStyle.Secondary);
				await interaction.editReply({ content: 'What would you like to sell?', embeds: [], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
				console.log(`[Shop Button] Displayed sell menu to user ${userId}.`);
				break;
			}
			case 'talk': {
				console.log(`[Shop Button] User ${userId} wants to talk.`);
				const interactionData = db.prepare('SELECT * FROM character_npc_interactions WHERE user_id = ? AND vendor_id = ?').get(userId, vendorId);
				const hasActiveEffect = interactionData.discount_modifier !== 1.0 && new Date(interactionData.discount_expires_at) > new Date();

				const talkEmbed = new EmbedBuilder()
					.setColor(0x9B59B6)
					.setTitle(`Speaking with ${vendor.name}`)
					.setDescription(`Rapport: ${interactionData.rapport}\n\n"Well, hello there, adventurer. What can I do for you?"`);

				const row = new ActionRowBuilder().addComponents(
					new ButtonBuilder()
						.setCustomId(`shop_charm_${vendorId}_${userId}`)
						.setLabel(`Use your charm (Req: ${vendor.charm_requirement} Charm)`)
						.setStyle(ButtonStyle.Success)
						.setDisabled(character.stat_charm < vendor.charm_requirement || hasActiveEffect),
					new ButtonBuilder()
						.setCustomId(`shop_gamble_${vendorId}_${userId}`)
						.setLabel('Try your luck... (50% Chance)')
						.setStyle(ButtonStyle.Primary)
						.setDisabled(hasActiveEffect),
					new ButtonBuilder().setCustomId(`shop_back_${vendorId}_${userId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
				);
				await interaction.editReply({ embeds: [talkEmbed], components: [row] });
				break;
			}
			case 'charm':
			case 'gamble': {
				console.log(`[Shop Button] User ${userId} is attempting action: ${action}`);
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
					console.log(`[Shop Button] User ${userId} succeeded at 'charm'.`);
				}
				else if (action === 'gamble') {
					if (Math.random() < successChance) {
						modifier = 0.8;
						rapportChange = 1;
						message = `Your risky compliment paid off! ${vendor.name} chuckles and offers you a **20% discount** for 8 hours. Your rapport has increased. (Success Chance: ${Math.round(successChance * 100)}%)`;
						console.log(`[Shop Button] User ${userId} succeeded at 'gamble'. (Chance: ${successChance})`);
					}
					else {
						modifier = 1.2;
						rapportChange = -1;
						message = `You fumbled your words and insulted ${vendor.name}! Prices are **increased by 20%** for you for the next 8 hours. Your rapport has decreased. (Success Chance: ${Math.round(successChance * 100)}%)`;
						console.log(`[Shop Button] User ${userId} failed at 'gamble'. (Chance: ${successChance})`);
					}
				}

				db.prepare(`
					UPDATE character_npc_interactions
					SET discount_modifier = ?, discount_expires_at = ?, rapport = rapport + ?
					WHERE user_id = ? AND vendor_id = ?
				`).run(modifier, expiry, rapportChange, userId, vendorId);
				console.log(`[Shop Button] Updated DB for user ${userId} with modifier: ${modifier}, rapportChange: ${rapportChange}`);

				const ui = getFreshUI();
				await interaction.editReply({ content: message, embeds: ui.embeds, components: ui.components });
				break;
			}
			default:
			{ console.warn(`[Shop Button] Unhandled action '${action}' from customId '${interaction.customId}'.`);
				// Fallback to the main menu if something goes wrong.
				const ui = getFreshUI();
				await interaction.editReply({ content: 'An unknown action was performed. Returning to the main menu.', ...ui }); }
			}
		}
		catch (error) {
			console.error(`[Shop Button] A critical error occurred during button processing for user ${userId} (Action: ${action}):`, error);
			// Check if we can still respond to the user
			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ content: 'A critical error occurred while processing your request. Please try again.', embeds:[], components: [] }).catch(e => console.error('Failed to send error message to user:', e));
			}
		}
	},
};