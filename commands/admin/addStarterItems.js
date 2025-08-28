const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../database');

// These lists should be an exact copy of the ones used in your character creation logic
// to ensure consistency. I've taken them from your `character.js` file.
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
		.setDescription('[ADMIN] Back-fills starter items for a character who was created before the system was added.')
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

		// 1. Verify the user has a character and get their archetype
		const characterInfo = db.prepare(`
            SELECT a.name as archetype_name
            FROM characters c
            JOIN archetypes a ON c.archetype_id = a.id
            WHERE c.user_id = ?
        `).get(userId);

		if (!characterInfo) {
			return interaction.editReply({ content: `${targetUser.username} does not have a character.` });
		}

		// 2. Construct the full list of items they *should* have
		const archetypeSpecificItems = archetypeItems[characterInfo.archetype_name] || [];
		const itemsToGrant = [...standardItems, ...archetypeSpecificItems];

		if (itemsToGrant.length === 0) {
			return interaction.editReply({ content: `Could not determine the item list for archetype "${characterInfo.archetype_name}".` });
		}

		try {
			const grantedItemsList = [];

			// 3. Use a transaction for safety. This ensures all items are added or none are.
			const grantTx = db.transaction(() => {
				// Prepare statements for efficiency inside the loop
				const getItemId = db.prepare('SELECT item_id FROM items WHERE name = ?');
				const checkIfExists = db.prepare('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?');
				const insertItem = db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)');

				for (const itemName of itemsToGrant) {
					const item = getItemId.get(itemName);

					if (!item) {
						console.warn(`[addstarteritems] Could not find item "${itemName}" in the database. Skipping.`);
						continue;
					}

					// Check if the user already has this specific item
					const alreadyHasItem = checkIfExists.get(userId, item.item_id);

					if (!alreadyHasItem) {
						// If they don't have it, grant it
						insertItem.run(userId, item.item_id);
						grantedItemsList.push(itemName);
					}
				}
			});

			// Execute the transaction
			grantTx();

			// 4. Provide clear feedback to the admin
			if (grantedItemsList.length > 0) {
				const successEmbed = new EmbedBuilder()
					.setColor(0x2ECC71)
					.setTitle('✅ Items Granted Successfully')
					.setDescription(`The following starter items have been added to ${targetUser.username}'s inventory:`)
					.addFields({
						name: 'Granted Items',
						value: grantedItemsList.map(name => `• ${name}`).join('\n'),
					})
					.setFooter({ text: `Archetype: ${characterInfo.archetype_name}` });

				await interaction.editReply({ embeds: [successEmbed] });
			}
			else {
				await interaction.editReply({ content: `${targetUser.username} already possessed all of their starter items. No items were added.` });
			}

		}
		catch (error) {
			console.error('[addstarteritems] A database error occurred:', error);
			await interaction.editReply({ content: 'A critical database error occurred while trying to grant items. The operation has been rolled back.' });
		}
	},
};