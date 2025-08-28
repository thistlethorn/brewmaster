// commands/admin/addStarterItems.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../database');
const { recalculateStats } = require('../../utils/recalculateStats');

// These lists should be an exact copy of the ones used in your character creation logic
// to ensure consistency.
const standardItems = [
	'Simple Dagger', 'Worn Buckler', 'Traveler\'s Hood', 'Traveler\'s Tunic',
	'Traveler\'s Trousers', 'Worn Leather Boots', 'Simple Iron Band', 'Frayed Rope Amulet',
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


module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('addstarteritems')
		.setDescription('[ADMIN] Back-fills starter items and equips the standard set for a character.')
		.addUserOption(option =>
			option.setName('user')
				.setDescription('The user whose character needs their starter items.')
				.setRequired(true))
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

	async execute(interaction) {
		const targetUser = interaction.options.getUser('user');
		const userId = targetUser.id;

		if (targetUser.bot) {
			return interaction.reply({ content: 'You cannot run this command on a bot.', flags: MessageFlags.Ephemeral });
		}

		await interaction.deferReply({ ephemeral: true });

		const characterInfo = db.prepare(`
            SELECT a.name as archetype_name
            FROM characters c
            JOIN archetypes a ON c.archetype_id = a.id
            WHERE c.user_id = ?
        `).get(userId);

		if (!characterInfo) {
			return interaction.editReply({ content: `${targetUser.username} does not have a character.` });
		}

		const archetypeSpecificItems = archetypeItems[characterInfo.archetype_name] || [];
		const itemsToGrant = [...standardItems, ...archetypeSpecificItems];

		if (itemsToGrant.length === 0) {
			return interaction.editReply({ content: `Could not determine the item list for archetype "${characterInfo.archetype_name}".` });
		}

		try {
			const grantedItemsList = [];
			const equippedItemsList = [];

			// --- Grant Missing Items ---
			const grantTx = db.transaction(() => {
				const getItemId = db.prepare('SELECT item_id FROM items WHERE name = ?');
				const checkIfExists = db.prepare('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?');
				const insertItem = db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)');

				for (const itemName of itemsToGrant) {
					const item = getItemId.get(itemName);
					if (!item) {
						console.warn(`[addstarteritems] Could not find item "${itemName}" in the database. Skipping.`);
						continue;
					}
					const alreadyHasItem = checkIfExists.get(userId, item.item_id);
					if (!alreadyHasItem) {
						insertItem.run(userId, item.item_id);
						grantedItemsList.push(itemName);
					}
				}
			});

			grantTx();

			// --- Equip Standard Items into Empty Slots ---
			const equipTx = db.transaction(() => {
				const userStandardItems = db.prepare(`
                    SELECT ui.inventory_id, i.name, i.effects_json
                    FROM user_inventory ui
                    JOIN items i ON ui.item_id = i.item_id
                    WHERE ui.user_id = ? AND i.name IN (${standardItems.map(() => '?').join(',')}) AND ui.equipped_slot IS NULL
                `).all(userId, ...standardItems);

				const occupiedSlotsResult = db.prepare('SELECT equipped_slot FROM user_inventory WHERE user_id = ? AND equipped_slot IS NOT NULL').all(userId);
				const occupiedSlots = new Set(occupiedSlotsResult.map(row => row.equipped_slot));
				const equipStmt = db.prepare('UPDATE user_inventory SET equipped_slot = ? WHERE inventory_id = ?');

				for (const item of userStandardItems) {
					try {
						const effects = JSON.parse(item.effects_json);
						let slotToEquip = effects?.slot;

						if (slotToEquip) {
							if (slotToEquip === 'ring') {
								if (!occupiedSlots.has('ring1')) slotToEquip = 'ring1';
								else if (!occupiedSlots.has('ring2')) slotToEquip = 'ring2';
								else slotToEquip = null;
							}

							if (slotToEquip && !occupiedSlots.has(slotToEquip)) {
								equipStmt.run(slotToEquip, item.inventory_id);
								occupiedSlots.add(slotToEquip);
								equippedItemsList.push(item.name);
							}
						}
					}
					catch (e) {
						console.error(`[addstarteritems] Failed to parse/equip ${item.name}: ${e.message}`);
					}
				}
			});

			equipTx();

			// --- Recalculate stats and reply ---
			if (equippedItemsList.length > 0) {
				recalculateStats(userId);
			}

			if (grantedItemsList.length === 0 && equippedItemsList.length === 0) {
				return interaction.editReply({ content: `${targetUser.username} already possessed all of their starter items and relevant gear was equipped. No changes made.` });
			}

			const successEmbed = new EmbedBuilder()
				.setColor(0x2ECC71)
				.setTitle('✅ Starter Kit Processed')
				.setDescription(`Items have been granted and/or equipped for ${targetUser.username}.`)
				.setFooter({ text: `Archetype: ${characterInfo.archetype_name}` });

			if (grantedItemsList.length > 0) {
				successEmbed.addFields({ name: '+ New Items Granted', value: grantedItemsList.map(name => `• ${name}`).join('\n') });
			}
			if (equippedItemsList.length > 0) {
				successEmbed.addFields({ name: '🛡️ Standard Items Equipped', value: equippedItemsList.map(name => `• ${name}`).join('\n') });
			}

			await interaction.editReply({ embeds: [successEmbed] });

		}
		catch (error) {
			console.error('[addstarteritems] A database error occurred:', error);
			await interaction.editReply({ content: 'A critical database error occurred while trying to process items. The operation has been rolled back.' });
		}
	},
};