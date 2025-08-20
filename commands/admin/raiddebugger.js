// commands/admin/raiddebugger.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { calculateCataclysmicFailureChance } = require('../utility/guild.js');

module.exports = {
	category: 'admin',
	data: new SlashCommandBuilder()
		.setName('raiddebugger')
		.setDescription('[DEV] Test the cataclysmic failure chance for defensive guilds.')
		.addIntegerOption(option =>
			option.setName('defender_tier')
				.setDescription('The tier of the primary defending guild (1-15).')
				.setRequired(true)
				.setMinValue(1)
				.setMaxValue(15))
	// ----- NEW OPTION ADDED HERE -----
		.addBooleanOption(option =>
			option.setName('primary_is_defensive')
				.setDescription('Is the primary defender using the "Defensive" attitude? Defaults to True.'))
	// ---------------------------------
		.addStringOption(option =>
			option.setName('ally_tiers')
				.setDescription('Comma-separated list of defensive ally tiers (e.g., "5,12,8").')),

	async execute(interaction) {
		const defenderTier = interaction.options.getInteger('defender_tier');
		// ----- GET THE VALUE OF THE NEW OPTION -----
		// The `?? true` part makes it default to true if you don't provide it, so your old tests still work.
		const primaryIsDefensive = interaction.options.getBoolean('primary_is_defensive') ?? true;
		// -----------------------------------------
		const allyTiersStr = interaction.options.getString('ally_tiers');

		// Mock a primary defender object, now with a dynamic attitude
		const primaryDefender = {
			// ----- ATTITUDE IS NOW DYNAMIC -----
			attitude: primaryIsDefensive ? 'Defensive' : 'Neutral',
			// ---------------------------------
			tier: defenderTier,
			guild_name: 'Primary Defender',
		};

		// Mock a list of ally objects from the user's input
		const defendingAllies = [];
		if (allyTiersStr) {
			const tiers = allyTiersStr.split(',').map(t => parseInt(t.trim()));
			tiers.forEach((tier, index) => {
				if (!isNaN(tier) && tier >= 1 && tier <= 15) {
					defendingAllies.push({
						attitude: 'Defensive',
						// Allies in the list are always assumed to be defensive for this test
						tier: tier,
						guild_name: `Ally #${index + 1}`,
					});
				}
			});
		}

		// Run the calculation using our clean, separated function
		const result = calculateCataclysmicFailureChance(primaryDefender, defendingAllies);

		const embed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setTitle('🛡️ Defensive Attitude - Raid Failure Test')
			.addFields(
				{ name: 'Input: Primary Defender Tier', value: `\`${defenderTier}\``, inline: true },
				// ----- ADDED A NEW FIELD TO THE OUTPUT EMBED FOR CLARITY -----
				{ name: 'Input: Primary Attitude', value: primaryIsDefensive ? '`Defensive`' : '`Neutral`', inline: true },
				// ----------------------------------------------------------------
				{ name: 'Input: Ally Tiers', value: allyTiersStr ? `\`${allyTiersStr}\`` : 'None', inline: true },
				{ name: '---', value: '---' },
				{ name: 'Triggering Guild', value: result.triggeredBy ? `**${result.triggeredBy}**` : 'None (0% Chance)', inline: true },
				{ name: 'Calculated Chance', value: `**${(result.chance * 100).toFixed(2)}%**`, inline: true },
			)
			.setFooter({ text: 'This chance is rolled once at the start of battle.' });

		await interaction.reply({ embeds: [embed] });
	},
};