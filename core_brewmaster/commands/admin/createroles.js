// core_brewmaster/commands/admin/createroles.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('@root/config.json');

// The list of roles you provided
const rolesToSeed = [
	{ name: 'Seasoned Adventurer', color_hex: '#A97142' },
	{ name: 'Disboard Duelist', color_hex: '#E67E22' },
	{ name: 'Greg\'s Nemesis', color_hex: '#7F8C8D' },
	{ name: 'Lorekeeper', color_hex: '#F1C40F' },
	{ name: 'Shadow Lurker', color_hex: '#2C3E50' },
	{ name: 'Hearth Warmer', color_hex: '#C0392B' },
	{ name: 'Cheapskate', color_hex: '#95A5A6' },
	{ name: 'Dice Goblin', color_hex: '#8E44AD' },
	{ name: 'Rules Lawyer', color_hex: '#16A085' },
	{ name: 'Edgelord', color_hex: '#34495E' },
	{ name: 'Min-Maxer', color_hex: '#D35400' },
	{ name: 'Forever DM', color_hex: '#2980B9' },
	{ name: 'Wild Magic Survivor', color_hex: '#9B59B6' },
	{ name: 'Critical Failure', color_hex: '#E74C3C' },
	{ name: 'Loot Gremlin', color_hex: '#27AE60' },
	{ name: 'Planeswalker', color_hex: '#1ABC9C' },
	{ name: 'Mimic', color_hex: '#6C3483' },
	{ name: 'Dragonkin', color_hex: '#D4AF37' },
	{ name: 'Bardic Inspiration', color_hex: '#E84393' },
	{ name: 'Tabletop Tactician', color_hex: '#1F618D' },
	{ name: 'Beholder of Chaos', color_hex: '#884EA0' },
	{ name: 'Mythic Hero', color_hex: '#E5E500' },
	{ name: 'Tavern Ghost', color_hex: '#BDC3C7' },
	{ name: 'Crit Fisher', color_hex: '#E67E22' },
	{ name: 'Voidtouched', color_hex: '#1B2631' },
	{ name: 'Dungeon Delver', color_hex: '#633D2E' },
	{ name: 'Chronomancer', color_hex: '#3498DB' },
	{ name: 'Archivist of Realms', color_hex: '#BB8FCE' },
	{ name: 'Celestial Patron', color_hex: '#F7DC6F' },
	{ name: 'The Last Reroll', color_hex: '#C0392B' },
	{ name: 'Astral Cartographer', color_hex: '#5DADE2' },
	{ name: 'Whisper in the Weave', color_hex: '#76448A' },
	{ name: 'Dream Eater', color_hex: '#2E4053' },
	{ name: 'Moonbound Warden', color_hex: '#AED6F1' },
	{ name: 'Titanborn', color_hex: '#AAB7B8' },
	{ name: 'Nameless Myth', color_hex: '#FDFEFE' },
];

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('createroles')
		.setDescription('[ADMIN] Creates all Tier 1 vanity roles for the boutique.')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

	async execute(interaction) {
		// Extra security check for the developer ID
		if (interaction.user.id !== config.developerId) {
			return interaction.reply({ content: 'This is a developer-only command.', flags: MessageFlags.Ephemeral });
		}

		await interaction.deferReply({ ephemeral: true });

		const createdRoles = [];
		const failedRoles = [];

		console.log('\n--- Starting Vanity Role Creation ---');
		console.log('// Copy the following lines into your database.js seeder:\n');

		for (const role of rolesToSeed) {
			try {
				const existingRole = interaction.guild.roles.cache.find(r => r.name === role.name);
				if (existingRole) {
					console.log(`role_id: '${existingRole.id}', // ${role.name} (Already Existed)`);
					createdRoles.push(`- ${role.name} (already existed)`);
					continue;
				}

				const newRole = await interaction.guild.roles.create({
					name: role.name,
					color: role.color_hex,
					hoist: true,
					permissions: [],
					reason: 'Seeding vanity roles for The Weaver\'s Boutique',
				});

				// Log the output in the desired format for easy copy-pasting
				console.log(`role_id: '${newRole.id}',`);
				createdRoles.push(`- ${newRole.name}`);

				// Add a small delay to avoid hitting Discord API rate limits
				await new Promise(res => setTimeout(res, 500));
			}
			catch (error) {
				console.error(`Failed to create role "${role.name}":`, error.message);
				failedRoles.push(`- ${role.name} (${error.message})`);
			}
		}

		console.log('\n--- Vanity Role Creation Complete ---\n');

		const summaryEmbed = new EmbedBuilder()
			.setColor(failedRoles.length > 0 ? 0xE74C3C : 0x2ECC71)
			.setTitle('Vanity Role Creation Summary')
			.setDescription('Check the bot\'s console for the generated role IDs to add to your database seeder.');

		if (createdRoles.length > 0) {
			summaryEmbed.addFields({ name: '✅ Created / Found', value: createdRoles.join('\n') });
		}
		if (failedRoles.length > 0) {
			summaryEmbed.addFields({ name: '❌ Failed', value: failedRoles.join('\n') });
		}

		await interaction.editReply({ embeds: [summaryEmbed] });
	},
};