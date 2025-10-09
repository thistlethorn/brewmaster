// core_brewmaster/commands/utility/role.js
const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
} = require('discord.js');
const db = require('@database/database.js');

const TIER1_SELL_REFUND_RATIO = 0.5;
const TIER2_BASE_PRICE = 25000;
const TIER2_PRICE_INCREMENT = 500;
const TIER3_COLOR_PRICE = 15000;
const TIER3_HOIST_PRICE = 75000;

const TIER2_NAME_PREFIX = '[✓] ';
const RESERVED_WORDS = ['admin', 'mod', 'staff', 'bot', 'everyone', 'here', 'discord', 'system', 'owner'];
const ROLES_PER_PAGE = 5;

// Helper to check user balance
function getUserBalance(userId) {
	return db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId)?.crowns || 0;
}

// Tier 1: View available pre-made roles (NOW WITH PAGINATION LMAO)
async function handleView(interaction, pageArg = 1) {
	const isUpdate = interaction.isButton();
	const basicRoles = db.prepare('SELECT * FROM basic_vanity_roles ORDER BY price ASC').all();

	if (basicRoles.length === 0) {
		const replyOptions = { content: 'The Weaver\'s Boutique currently has no roles in stock. Check back later!', flags: MessageFlags.Ephemeral, embeds: [], components: [] };
		return isUpdate ? interaction.update(replyOptions) : interaction.reply(replyOptions);
	}

	// --- PAGINATION LOGIC ---
	const totalPages = Math.max(1, Math.ceil(basicRoles.length / ROLES_PER_PAGE));
	const page = Math.min(pageArg, totalPages);
	const start = (page - 1) * ROLES_PER_PAGE;
	const end = start + ROLES_PER_PAGE;
	const rolesOnPage = basicRoles.slice(start, end);

	const embed = new EmbedBuilder()
		.setColor(0x9B59B6)
		.setTitle('🧵 The Weaver\'s Boutique - Tavern Collection 🧵')
		.setDescription('Welcome! Here you can purchase pre-made vanity roles to express your status in the Tavern. Click a button to purchase a role.')
		.setFooter({ text: `Page ${page} / ${totalPages}` });

	const components = [];

	let currentRow = new ActionRowBuilder();
	for (const role of rolesOnPage) {
		const roleColor = role.color_hex || '#95a5a6';
		embed.addFields({
			name: `${role.name} - 👑 ${role.price.toLocaleString()}`,
			value: `> Color: \`${roleColor}\`\n> ${role.description}`,
			inline: false,
		});

		// If the current row is full, push it and start a new one.
		if (currentRow.components.length === 5) {
			components.push(currentRow);
			currentRow = new ActionRowBuilder();
		}

		currentRow.addComponents(
			new ButtonBuilder()
				.setCustomId(`role_buy_${role.role_id}`)
				.setLabel(`Buy "${role.name}"`)
				.setStyle(ButtonStyle.Success),
		);
	}
	// Push the last row if it has any buttons.
	if (currentRow.components.length > 0) {
		components.push(currentRow);
	}

	// Add navigation buttons if there's more than one page
	if (totalPages > 1) {
		const navRow = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`role_view_prev_${interaction.user.id}_${page}`)
				.setLabel('◀️ Previous')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page === 1),
			new ButtonBuilder()
				.setCustomId(`role_view_next_${interaction.user.id}_${page}`)
				.setLabel('Next ▶️')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page === totalPages),
		);
		components.push(navRow);
	}

	const replyOptions = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
	if (isUpdate) {
		await interaction.update(replyOptions);
	}
	else {
		await interaction.reply(replyOptions);
	}
}

// Tier 1: Sell a pre-made role
async function handleSell(interaction) {
	const roleIdToSell = interaction.options.getString('role');
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Sale Failed');

	if (!interaction.member.roles.cache.has(roleIdToSell)) {
		errorEmbed.setDescription('You do not own this role.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const roleData = db.prepare('SELECT name, price FROM basic_vanity_roles WHERE role_id = ?').get(roleIdToSell);
	if (!roleData) {
		errorEmbed.setDescription('This role is not a purchasable role from the boutique.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const refundAmount = Math.floor(roleData.price * TIER1_SELL_REFUND_RATIO);

	try {
		db.transaction(() => {
			db.prepare('INSERT INTO user_economy (user_id, crowns) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?')
				.run(userId, refundAmount, refundAmount);
		})();

		await interaction.member.roles.remove(roleIdToSell);

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle('✅ Role Sold!')
			.setDescription(`You have sold the **${roleData.name}** role and received a refund of **👑 ${refundAmount.toLocaleString()}** Crowns.`);
		await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
	}
	catch (error) {
		console.error('Tier 1 role sell error:', error);
		errorEmbed.setDescription('An error occurred. The bot may lack permissions to remove your role.');
		await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
}

// Tier 2: Create a custom named role
async function handleCreate(interaction) {
	const newName = interaction.options.getString('name');
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Role Creation Failed');

	// --- Validation ---
	if (newName.length < 2 || newName.length > 50) {
		errorEmbed.setDescription('Role name must be between 2 and 50 characters.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
	if (RESERVED_WORDS.some(word => newName.toLowerCase().includes(word)) || /[@#:]/.test(newName)) {
		errorEmbed.setDescription('Role name contains reserved words or invalid characters (@, #, :).');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
	const existingName = db.prepare('SELECT 1 FROM blacklisted_role_names WHERE role_name_normalized = ?').get(newName.toLowerCase());
	if (existingName) {
		errorEmbed.setDescription('This role name has already been taken globally and is unique forever. Please choose another.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
	const userHasCustomRole = db.prepare('SELECT 1 FROM custom_vanity_roles WHERE owner_id = ?').get(userId);
	if (userHasCustomRole) {
		errorEmbed.setDescription('You already own a custom role. You can only own one at a time. Use `/role delete` to remove your current one first.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	// Calculate dynamic price
	const createdCount = db.prepare('SELECT COUNT(*) as count FROM blacklisted_role_names WHERE server_id_created_on = ?').get(interaction.guildId).count;
	const price = TIER2_BASE_PRICE + (createdCount * TIER2_PRICE_INCREMENT);
	const balance = getUserBalance(userId);

	if (balance < price) {
		errorEmbed.setDescription(`You don't have enough Crowns! This role costs **👑 ${price.toLocaleString()}**, but you only have **👑 ${balance.toLocaleString()}**.`);
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	// --- Creation Logic ---
	try {
		const newRole = await interaction.guild.roles.create({
			name: `${TIER2_NAME_PREFIX}${newName}`,
			permissions: [],
			reason: `Custom vanity role purchased by ${interaction.user.tag}`,
		});

		const createTx = db.transaction(() => {
			db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(price, userId);
			db.prepare('INSERT INTO custom_vanity_roles (role_id, owner_id, server_id, name) VALUES (?, ?, ?, ?)')
				.run(newRole.id, userId, interaction.guildId, newName);
			db.prepare('INSERT INTO blacklisted_role_names (role_name_normalized, original_casing, server_id_created_on, original_creator_id) VALUES (?, ?, ?, ?)')
				.run(newName.toLowerCase(), newName, interaction.guildId, userId);
		});

		createTx();

		await interaction.member.roles.add(newRole);

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle('✨ Bespoke Role Created! ✨')
			.setDescription(`Congratulations! You are now the proud owner of the globally unique role **${newName}**. It has been assigned to you.`)
			.addFields({ name: 'Cost', value: `👑 ${price.toLocaleString()} has been deducted from your account.` });

		await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
	}
	catch (error) {
		console.error('Custom role creation error:', error);
		errorEmbed.setDescription('A server-side error occurred. The bot may lack permissions, or the server may be full of roles. Your Crowns have not been spent.');
		await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
}

// Tier 2: Delete a custom role
async function handleDelete(interaction) {
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Deletion Failed');

	const customRole = db.prepare('SELECT role_id, name FROM custom_vanity_roles WHERE owner_id = ?').get(userId);
	if (!customRole) {
		errorEmbed.setDescription('You do not own a custom role to delete.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const roleOnServer = await interaction.guild.roles.fetch(customRole.role_id).catch(() => null);
	if (!roleOnServer) {
		errorEmbed.setDescription('Your custom role could not be found on the server. It may have been deleted already.');
		// Clean up the database entry
		db.prepare('DELETE FROM custom_vanity_roles WHERE role_id = ?').run(customRole.role_id);
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	try {
		await roleOnServer.delete(`Custom role deleted by owner ${interaction.user.tag}.`);
		db.prepare('DELETE FROM custom_vanity_roles WHERE role_id = ?').run(customRole.role_id);

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle('🗑️ Role Deleted')
			.setDescription(`Your custom role **${customRole.name}** has been permanently deleted. The name remains blacklisted globally.\n_There is no refund for deleting a custom role._`);
		await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
	}
	catch (error) {
		console.error('Custom role deletion error:', error);
		errorEmbed.setDescription('An error occurred while deleting the role. The bot may lack permissions.');
		await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}
}

// Tier 2: Offer a custom role to another user
async function handleOffer(interaction) {
	const sellerId = interaction.user.id;
	const buyer = interaction.options.getUser('user');
	const price = interaction.options.getInteger('crowns');
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Offer Failed');

	if (buyer.bot || buyer.id === sellerId) {
		errorEmbed.setDescription('You cannot offer a role to a bot or to yourself.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const customRole = db.prepare('SELECT role_id, name FROM custom_vanity_roles WHERE owner_id = ?').get(sellerId);
	if (!customRole) {
		errorEmbed.setDescription('You do not own a custom role to offer.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const buyerHasCustomRole = db.prepare('SELECT 1 FROM custom_vanity_roles WHERE owner_id = ?').get(buyer.id);
	if (buyerHasCustomRole) {
		errorEmbed.setDescription(`${buyer.username} already owns a custom role and cannot accept another.`);
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const offerEmbed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle('👑 Custom Role Offer')
		.setDescription(`${interaction.user} is offering to transfer ownership of their unique role to you!`)
		.addFields(
			{ name: 'Role', value: `**${customRole.name}**` },
			{ name: 'Price', value: `👑 ${price.toLocaleString()}` },
		)
		.setFooter({ text: 'This offer is valid for 5 minutes.' });

	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`role_offer_accept_${sellerId}_${buyer.id}_${customRole.role_id}_${price}`)
			.setLabel('Accept Offer')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(`role_offer_decline_${sellerId}_${buyer.id}`)
			.setLabel('Decline')
			.setStyle(ButtonStyle.Danger),
	);

	await interaction.reply({ content: `${buyer}, you have a new offer!`, embeds: [offerEmbed], components: [row] });
}


// Tier 3: Modify a custom role
async function handleModify(interaction) {
	const subcommand = interaction.options.getSubcommand();
	const userId = interaction.user.id;
	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Modification Failed');

	const customRole = db.prepare('SELECT * FROM custom_vanity_roles WHERE owner_id = ?').get(userId);
	if (!customRole) {
		errorEmbed.setDescription('You do not own a custom Bespoke role to modify.');
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	const balance = getUserBalance(userId);
	const roleOnServer = await interaction.guild.roles.fetch(customRole.role_id).catch(() => null);
	if (!roleOnServer) {
		errorEmbed.setDescription('Your custom role could not be found on the server. It may have been deleted. Please contact an admin.');
		db.prepare('DELETE FROM custom_vanity_roles WHERE role_id = ?').run(customRole.role_id);
		return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
	}

	if (subcommand === 'color') {
		const price = TIER3_COLOR_PRICE;
		const hexCode = interaction.options.getString('hex_code');
		if (!/^#[0-9A-F]{6}$/i.test(hexCode)) {
			errorEmbed.setDescription('Invalid hex code. Please provide a valid 6-digit hex code (e.g., `#3498DB`).');
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
		if (balance < price) {
			errorEmbed.setDescription(`You need **👑 ${price.toLocaleString()}** to change your role color. You only have **👑 ${balance.toLocaleString()}**.`);
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}

		try {
			db.transaction(() => {
				db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(price, userId);
				db.prepare('UPDATE custom_vanity_roles SET color_hex = ? WHERE role_id = ?').run(hexCode, customRole.role_id);
			})();
			await roleOnServer.edit({ color: hexCode, reason: 'Artisan\'s Dye service purchased.' });

			const successEmbed = new EmbedBuilder()
				.setColor(hexCode)
				.setTitle('🎨 Role Recolor Successful!')
				.setDescription(`Your role **${customRole.name}** has been recolored to \`${hexCode}\`.\n**👑 ${price.toLocaleString()}** Crowns have been deducted.`);
			return interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
		}
		catch (e) {
			// refund logic could be added here if needed
			console.error(e);
			errorEmbed.setDescription('An error occurred. The bot may lack permissions.');
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
	}
	else if (subcommand === 'hoist') {
		const price = TIER3_HOIST_PRICE;
		if (balance < price) {
			errorEmbed.setDescription(`You need **👑 ${price.toLocaleString()}** to change your role's hoist status. You only have **👑 ${balance.toLocaleString()}**.`);
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
		const newHoistStatus = !customRole.is_hoisted;

		try {
			db.transaction(() => {
				db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(price, userId);
				db.prepare('UPDATE custom_vanity_roles SET is_hoisted = ? WHERE role_id = ?').run(newHoistStatus ? 1 : 0, customRole.role_id);
			})();
			await roleOnServer.edit({ hoist: newHoistStatus, reason: 'Artisan\'s Weave service purchased.' });

			const successEmbed = new EmbedBuilder()
				.setColor(0x2ECC71)
				.setTitle('🌟 Role Hoist Status Updated!')
				.setDescription(`Your role **${customRole.name}** is now **${newHoistStatus ? 'displayed separately' : 'no longer displayed separately'}**.\n**👑 ${price.toLocaleString()}** Crowns have been deducted.`);
			return interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
		}
		catch (e) {
			console.error(e);
			errorEmbed.setDescription('An error occurred. The bot may lack permissions.');
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
	}
}

module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('role')
		.setDescription('Buy and manage vanity roles at The Weaver\'s Boutique.')
		.addSubcommand(sub => sub.setName('view').setDescription('View the collection of pre-made vanity roles available for purchase.'))
		.addSubcommand(sub => sub.setName('sell').setDescription('Sell a pre-made vanity role you own for a partial refund.').addStringOption(opt => opt.setName('role').setDescription('The role you wish to sell.').setRequired(true).setAutocomplete(true)))
		.addSubcommand(sub => sub.setName('create').setDescription('Create your own custom-named vanity role for a price.').addStringOption(opt => opt.setName('name').setDescription('The name of your new custom role.').setRequired(true)))
		.addSubcommand(sub => sub.setName('delete').setDescription('Permanently delete your custom-named vanity role (no refund).'))
		.addSubcommand(sub => sub.setName('offer').setDescription('Offer to sell your custom role to another user.').addUserOption(opt => opt.setName('user').setDescription('The user you want to sell the role to.').setRequired(true)).addIntegerOption(opt => opt.setName('crowns').setDescription('The price in Crowns (can be 0 for a gift).').setRequired(true).setMinValue(0)))
		.addSubcommandGroup(group => group.setName('modify').setDescription('Modify your custom-named role with premium services.')
			.addSubcommand(sub => sub.setName('color').setDescription(`Change the color of your custom role (Cost: ${TIER3_COLOR_PRICE.toLocaleString()} Crowns).`).addStringOption(opt => opt.setName('hex_code').setDescription('The 6-digit hex color code (e.g., #3498DB).').setRequired(true)))
			.addSubcommand(sub => sub.setName('hoist').setDescription(`Toggle whether your role is displayed separately (Cost: ${TIER3_HOIST_PRICE.toLocaleString()} Crowns).`))),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const group = interaction.options.getSubcommandGroup(false);

		if (group === 'modify') {
			await handleModify(interaction);
		}
		else {
			switch (subcommand) {
			case 'view':
				await handleView(interaction);
				break;
			case 'sell':
				await handleSell(interaction);
				break;
			case 'create':
				await handleCreate(interaction);
				break;
			case 'delete':
				await handleDelete(interaction);
				break;
			case 'offer':
				await handleOffer(interaction);
				break;
			default:
				await interaction.reply({ content: 'This command is under construction.', flags: MessageFlags.Ephemeral });
			}
		}
	},
	async autocomplete(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const focusedValue = interaction.options.getFocused();

		if (subcommand === 'sell') {
			const memberRoles = interaction.member.roles.cache.map(r => r.id);
			if (memberRoles.length === 0) return interaction.respond([]);

			const ownedTier1Roles = db.prepare(`
                SELECT name, role_id FROM basic_vanity_roles 
                WHERE role_id IN (${memberRoles.map(() => '?').join(',')}) AND name LIKE ?
            `).all(...memberRoles, `%${focusedValue}%`);

			await interaction.respond(
				ownedTier1Roles.map(role => ({ name: role.name, value: role.role_id })),
			);
		}
	},

	async buttons(interaction) {
		const parts = interaction.customId.split('_');
		const [command, action] = parts;

		if (command !== 'role') return;
		const userId = interaction.user.id;
		const errorEmbed = new EmbedBuilder().setColor(0xE74C3C);

		// pagination handler
		if (action === 'view') {
			const subAction = parts[2];
			const targetUserId = parts[3];
			const currentPage = parseInt(parts[4], 10);

			if (userId !== targetUserId) {
				return interaction.reply({ content: 'This is not your menu.', flags: MessageFlags.Ephemeral });
			}

			const newPage = subAction === 'next' ? currentPage + 1 : currentPage - 1;
			await handleView(interaction, newPage);
			return;
		}

		if (action === 'buy') {
			const roleId = parts[2];
			if (interaction.member.roles.cache.has(roleId)) {
				errorEmbed.setTitle('❌ Already Owned').setDescription('You already own this role!');
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}

			const roleData = db.prepare('SELECT name, price FROM basic_vanity_roles WHERE role_id = ?').get(roleId);
			if (!roleData) {
				errorEmbed.setTitle('❌ Role Not Found').setDescription('This role is no longer available for purchase.');
				return interaction.update({ embeds: [errorEmbed], components: [] });
			}

			const balance = getUserBalance(userId);
			if (balance < roleData.price) {
				errorEmbed.setTitle('❌ Insufficient Funds').setDescription(`You need **👑 ${roleData.price.toLocaleString()}** to buy this role, but you only have **👑 ${balance.toLocaleString()}**.`);
				return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}

			try {
				db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(roleData.price, userId);
				await interaction.member.roles.add(roleId);

				const successEmbed = new EmbedBuilder()
					.setColor(0x2ECC71)
					.setTitle('✅ Purchase Successful!')
					.setDescription(`The **${roleData.name}** role has been added to your profile!\n**👑 ${roleData.price.toLocaleString()}** Crowns have been deducted from your account.`);
				await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
			}
			catch (error) {
				console.error('Tier 1 role purchase error:', error);
				errorEmbed.setTitle('❌ Purchase Failed').setDescription('An error occurred. The bot may not have permission to assign roles.');
				await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
			}
		}
		else if (action === 'offer') {
			const [, , response, sellerId, buyerId, roleId, priceStr] = parts;
			const price = parseInt(priceStr, 10);

			if (userId !== buyerId) {
				return interaction.reply({ content: 'This offer is not for you.', flags: MessageFlags.Ephemeral });
			}

			const originalEmbed = new EmbedBuilder(interaction.message.embeds[0].data);
			const disabledComponents = interaction.message.components.map(row =>
				new ActionRowBuilder().addComponents(row.components.map(button =>
					ButtonBuilder.from(button).setDisabled(true),
				)),
			);

			if (response === 'decline') {
				originalEmbed.setFooter({ text: `Offer declined by ${interaction.user.username}.` }).setColor(0x95A5A6);
				return interaction.update({ embeds: [originalEmbed], components: disabledComponents });
			}

			if (response === 'accept') {
				const buyerBalance = getUserBalance(buyerId);
				if (buyerBalance < price) {
					originalEmbed.setFooter({ text: 'Offer failed: Buyer has insufficient funds.' }).setColor(0xE74C3C);
					await interaction.update({ embeds: [originalEmbed], components: disabledComponents });
					return interaction.followUp({ content: 'You don\'t have enough Crowns to accept this offer!', flags: MessageFlags.Ephemeral });
				}

				try {
					const sellerMember = await interaction.guild.members.fetch(sellerId);
					const buyerMember = interaction.member;
					const role = await interaction.guild.roles.fetch(roleId);

					// Transfer role in Discord
					await sellerMember.roles.remove(role);
					await buyerMember.roles.add(role);

					db.transaction(() => {
						// ...THEN Transfer Crowns
						if (price > 0) {
							db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(price, buyerId);
							db.prepare('INSERT INTO user_economy (user_id, crowns) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET crowns = crowns + ?')
								.run(sellerId, price, price);
						}
						// Update role ownership in DB
						db.prepare('UPDATE custom_vanity_roles SET owner_id = ? WHERE role_id = ? AND owner_id = ?').run(buyerId, roleId, sellerId);
					})();


					originalEmbed.setFooter({ text: `Offer accepted by ${interaction.user.username}! Ownership transferred.` }).setColor(0x2ECC71);
					await interaction.update({ embeds: [originalEmbed], components: disabledComponents });
				}
				catch (error) {
					console.error('Role offer acceptance error:', error);
					originalEmbed.setFooter({ text: 'Offer failed due to a server error.' }).setColor(0xE74C3C);
					await interaction.update({ embeds: [originalEmbed], components: disabledComponents });
				}
			}
		}
	},
};