// core_brewmaster/commands/admin/reorderroles.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('@root/config.json');
const db = require('@database/database.js');

// ID for "Tavern Regular"
const ANCHOR_ROLE_ID = '1400643742456873022';

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('reorderroles')
		.setDescription('[ADMIN] One-time script to reorder the vanity roles under the anchor role.')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

	async execute(interaction) {
		if (interaction.user.id !== config.developerId) {
			return interaction.reply({ content: 'This is a developer-only command.', flags: MessageFlags.Ephemeral });
		}

		await interaction.deferReply({ ephemeral: true });

		try {
			// 1. Fetch all roles from the server and sort them by their current position (highest first)
			await interaction.guild.roles.fetch();
			const allRoles = interaction.guild.roles.cache.sort((a, b) => b.position - a.position);

			// 2. Fetch the vanity roles from the database and sort them by price (descending)
			const vanityRolesData = db.prepare('SELECT role_id, name, price FROM basic_vanity_roles ORDER BY price DESC').all();
			const vanityRoleIds = new Set(vanityRolesData.map(r => r.role_id));

			// 3. Find the anchor role ("Tavern Regular")
			const anchorRole = allRoles.get(ANCHOR_ROLE_ID);
			if (!anchorRole) {
				return interaction.editReply({ content: `Error: The anchor role "Tavern Regular" (ID: ${ANCHOR_ROLE_ID}) could not be found.` });
			}

			// 4. Separate all server roles into three groups: above, below, and the vanity roles themselves
			const rolesAboveAnchor = [];
			const rolesBelowAnchor = [];

			for (const role of allRoles.values()) {
				// Ignore @everyone role
				if (role.id === interaction.guild.id) continue;

				// Skip the vanity roles; we will place them manually
				if (vanityRoleIds.has(role.id)) continue;

				if (role.position > anchorRole.position) {
					rolesAboveAnchor.push(role);
				}
				else if (role.id !== anchorRole.id) {
					rolesBelowAnchor.push(role);
				}
			}

			// 5. Build the final, desired role order from top to bottom
			const finalOrder = [
				...rolesAboveAnchor,
				anchorRole,
				// Add the vanity roles (sorted by price) by fetching their objects from the cache
				...vanityRolesData.map(vr => allRoles.get(vr.role_id)).filter(Boolean),
				...rolesBelowAnchor,
			];

			// 6. Convert this top-to-bottom order into the bottom-to-top format Discord's API requires
			const positionsPayload = finalOrder
			// Reverse the array to be bottom-to-top
				.reverse()
				.map((role, index) => ({
					role: role.id,
					// Position 0 is reserved for @everyone, so we start at 1
					position: index + 1,
				}));

			// 7. Execute the reordering
			await interaction.guild.roles.setPositions(positionsPayload);

			const successEmbed = new EmbedBuilder()
				.setColor(0x2ECC71)
				.setTitle('✅ Vanity Roles Reordered Successfully!')
				.setDescription(`All ${vanityRolesData.length} vanity roles have been moved below **${anchorRole.name}** and sorted by price (descending).`)
				.addFields({
					name: 'New Order (Top to Bottom)',
					value: vanityRolesData.map(r => `• ${r.name} (👑 ${r.price.toLocaleString()})`).join('\n').slice(0, 1024),
				});

			await interaction.editReply({ embeds: [successEmbed] });

		}
		catch (error) {
			console.error('[reorderroles] An error occurred:', error);
			const errorEmbed = new EmbedBuilder()
				.setColor(0xE74C3C)
				.setTitle('❌ Operation Failed')
				.setDescription('A critical error occurred. This could be due to missing roles or incorrect permissions. Please check the console logs.');
			await interaction.editReply({ embeds: [errorEmbed] });
		}
	},
};