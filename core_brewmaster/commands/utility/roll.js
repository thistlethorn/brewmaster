// /commands/utility/roll.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Constants for validation to prevent abuse
const MAX_DICE_QUANTITY = 100;
const MAX_DICE_SIDES = 10000;

/**
 * Handles the logic for both standard and custom rolls and sends the reply.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} quantity - The number of dice to roll.
 * @param {number} sides - The number of sides on each die.
 * @param {number} modifier - The modifier to add or subtract from the total.
 * @param {string|null} reason - Optional flavor text for the roll.
 */
async function executeRoll(interaction, quantity, sides, modifier, reason) {
	// --- Input Validation ---
	if (quantity > MAX_DICE_QUANTITY) {
		return interaction.reply({
			content: `❌ You can't roll more than ${MAX_DICE_QUANTITY} dice at once, pal. Let's not crash the table.`,
			ephemeral: true,
		});
	}
	if (sides > MAX_DICE_SIDES) {
		return interaction.reply({
			content: `❌ A die with over ${MAX_DICE_SIDES} sides? That's more like a sphere. Keep it reasonable.`,
			ephemeral: true,
		});
	}

	// --- Rolling Logic ---
	const rolls = [];
	let sum = 0;
	for (let i = 0; i < quantity; i++) {
		const roll = Math.floor(Math.random() * sides) + 1;
		rolls.push(roll);
		sum += roll;
	}

	const total = sum + modifier;

	// --- Formatting the Output ---
	const modifierString = modifier > 0 ? ` + ${modifier}` : (modifier < 0 ? ` - ${Math.abs(modifier)}` : '');
	const description = `Rolling **${quantity}d${sides}${modifierString}**` + (reason ? ` for *${reason}*` : '.');

	let rollsDisplay;
	if (rolls.length > 20) {
		// Truncate the display for a large number of rolls to keep the embed clean
		rollsDisplay = `[${rolls.slice(0, 20).join(', ')}, ... (${rolls.length - 20} more)]`;
	}
	else {
		rollsDisplay = `[${rolls.join(', ')}]`;
	}

	const resultEmbed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setAuthor({ name: `${interaction.user.displayName}'s Roll`, iconURL: interaction.user.displayAvatarURL() })
		.setTitle('🎲 Dice Roll Results 🎲')
		.setDescription(description)
		.addFields(
			{ name: 'Individual Rolls', value: `\`\`\`${rollsDisplay}\`\`\``, inline: false },
			{ name: 'Total', value: `\`\`\`${sum}${modifierString} = ${total.toLocaleString()}\`\`\``, inline: false },
		)
		.setTimestamp();

	await interaction.reply({ embeds: [resultEmbed] });
}

module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('roll')
		.setDescription('Rolls one or more dice with an optional modifier.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('standard')
				.setDescription('Roll a standard D&D die (d4, d6, d20, etc.).')
				.addIntegerOption(option =>
					option.setName('quantity')
						.setDescription('The number of dice to roll.')
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(MAX_DICE_QUANTITY))
				.addStringOption(option =>
					option.setName('sides')
						.setDescription('The type of die to roll.')
						.setRequired(true)
						.addChoices(
							{ name: 'd4', value: '4' },
							{ name: 'd6', value: '6' },
							{ name: 'd8', value: '8' },
							{ name: 'd10', value: '10' },
							{ name: 'd12', value: '12' },
							{ name: 'd20', value: '20' },
							{ name: 'd100', value: '100' },
						))
				.addIntegerOption(option =>
					option.setName('modifier')
						.setDescription('A number to add to (or subtract from) the final result.'))
				.addStringOption(option =>
					option.setName('reason')
						.setDescription('Optional flavor text for why you are rolling.')))
		.addSubcommand(subcommand =>
			subcommand
				.setName('custom')
				.setDescription('Roll a die with any number of sides.')
				.addIntegerOption(option =>
					option.setName('quantity')
						.setDescription('The number of dice to roll.')
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(MAX_DICE_QUANTITY))
				.addIntegerOption(option =>
					option.setName('sides')
						.setDescription('The number of sides on each die.')
						.setRequired(true)
						.setMinValue(2)
						.setMaxValue(MAX_DICE_SIDES))
				.addIntegerOption(option =>
					option.setName('modifier')
						.setDescription('A number to add to (or subtract from) the final result.'))
				.addStringOption(option =>
					option.setName('reason')
						.setDescription('Optional flavor text for why you are rolling.'))),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const quantity = interaction.options.getInteger('quantity');
		const modifier = interaction.options.getInteger('modifier') ?? 0;
		const reason = interaction.options.getString('reason');
		let sides;

		if (subcommand === 'standard') {
			sides = parseInt(interaction.options.getString('sides'));
		}
		else {
			sides = interaction.options.getInteger('sides');
		}

		await executeRoll(interaction, quantity, sides, modifier, reason);
	},
};