const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../../database');
const sendMessageToChannel = require('../../utils/sendMessageToChannel');

const SUBMISSION_COST = 200;
const MAX_USER_QUOTES = 20;
const MAX_QUOTE_LENGTH = 200;
const QUOTES_PER_PAGE = 5;
const APPROVAL_CHANNEL_ID = '1403817767081082960';

async function handleView(interaction, pageArg) {
	const userId = interaction.user.id;
	// Use the page argument if it exists, otherwise get it from the interaction options, or default to 1.
	const page = pageArg ?? interaction.options.getInteger('page') ?? 1;

	const quotes = db.prepare(`
        SELECT trigger_word, quote_text, times_triggered
        FROM tony_quotes_active
        WHERE user_id = ?
        ORDER BY trigger_word ASC
    `).all(userId);

	if (quotes.length === 0) {
		const embed = new EmbedBuilder()
			.setColor(0x3498DB)
			.setTitle('📜 Your Submitted Quotes')
			.setDescription('*You haven\'t submitted any approved quotes yet. Use `/tonyquote submit` to add one!*');
		// For an empty list, a simple reply is fine, even on a button click.
		return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
	}

	const totalPages = Math.ceil(quotes.length / QUOTES_PER_PAGE);
	const start = (page - 1) * QUOTES_PER_PAGE;
	const end = start + QUOTES_PER_PAGE;
	const pageContent = quotes.slice(start, end);

	const embed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle(`📜 Your Submitted Quotes (Page ${page}/${totalPages})`)
		.setDescription('Here are your active quotes currently in circulation.');

	pageContent.forEach(quote => {
		embed.addFields({
			name: `Trigger: "${quote.trigger_word}"`,
			value: `> *"${quote.quote_text}"*\n> Triggered **${quote.times_triggered} / 20** times.`,
			inline: false,
		});
	});

	const components = [];
	if (totalPages > 1) {
		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`tonyquote_view_${userId}_${page - 1}`)
				.setLabel('◀️ Previous')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page === 1),
			new ButtonBuilder()
				.setCustomId(`tonyquote_view_${userId}_${page + 1}`)
				.setLabel('Next ▶️')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page === totalPages),
		);
		components.push(row);
	}

	// --- FIX: Use interaction.update() for buttons, interaction.reply() for commands ---
	if (interaction.isButton()) {
		// If the interaction is a button click, update the original message.
		await interaction.update({ embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
	}
	else {
		// Otherwise, it's a slash command, so send a new reply.
		await interaction.reply({ embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
	}
}


async function handleSubmit(interaction) {
	const triggerWord = interaction.options.getString('trigger').toLowerCase();
	const quoteText = interaction.options.getString('quote');
	const userId = interaction.user.id;

	const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Submission Failed');

	// --- Validation ---
	if (quoteText.length > MAX_QUOTE_LENGTH) {
		errorEmbed.setDescription(`Your quote is too long! Please keep it under ${MAX_QUOTE_LENGTH} characters.`);
		return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
	}
	if (!/^[a-zA-Z0-9&]+$/.test(triggerWord) || triggerWord.split(' ').length > 1) {
		errorEmbed.setDescription('The trigger word must be a single word containing only letters, numbers, or an ampersand (&).');
		return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
	}

	// --- FIX: Check for duplicate trigger/quote combination before proceeding ---
	const existingQuote = db.prepare(`
        SELECT 1 FROM tony_quotes_active WHERE trigger_word = ? AND quote_text = ?
        UNION ALL
        SELECT 1 FROM tony_quotes_pending WHERE trigger_word = ? AND quote_text = ?
        LIMIT 1
    `).get(triggerWord, quoteText, triggerWord, quoteText);

	if (existingQuote) {
		errorEmbed.setDescription('This exact trigger and quote combination already exists (either active or pending approval). Please submit something new!');
		return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
	}

	// Check if user has too many quotes
	const userQuoteCount = db.prepare('SELECT COUNT(*) as count FROM tony_quotes_active WHERE user_id = ?').get(userId).count;
	if (userQuoteCount >= MAX_USER_QUOTES) {
		errorEmbed.setDescription(`You already have ${MAX_USER_QUOTES} active quotes, which is the maximum allowed.`);
		return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
	}

	// Check user balance
	const userBalance = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId)?.crowns || 0;
	if (userBalance < SUBMISSION_COST) {
		errorEmbed.setDescription(`You don't have enough Crowns! This costs **${SUBMISSION_COST} Crowns**, but you only have **${userBalance}**.`);
		return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
	}

	try {
		// --- Process Submission ---
		db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(SUBMISSION_COST, userId);

		const approvalEmbed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setTitle('📝 New Tony Quote for Approval')
			.addFields(
				{ name: 'Submitted By', value: `${interaction.user} (\`${userId}\`)`, inline: false },
				{ name: 'Trigger Word', value: `\`${triggerWord}\``, inline: true },
				{ name: 'Cost', value: `👑 ${SUBMISSION_COST}`, inline: true },
				{ name: 'Quote', value: `>>> "${quoteText}"`, inline: false },
			)
			.setFooter({ text: 'Please review this submission carefully.' })
			.setTimestamp();

		const approvalMessage = await sendMessageToChannel(interaction.client, APPROVAL_CHANNEL_ID, approvalEmbed);

		const result = db.prepare(`
            INSERT INTO tony_quotes_pending (trigger_word, quote_text, user_id, approval_message_id)
            VALUES (?, ?, ?, ?)
        `).run(triggerWord, quoteText, userId, approvalMessage.id);
		const pendingId = result.lastInsertRowid;

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`tony_quote_approve_${pendingId}`)
				.setLabel('Approve')
				.setStyle(ButtonStyle.Success)
				.setEmoji('✅'),
			new ButtonBuilder()
				.setCustomId(`tony_quote_reject_${pendingId}`)
				.setLabel('Reject')
				.setStyle(ButtonStyle.Danger)
				.setEmoji('❌'),
		);

		await approvalMessage.edit({ components: [row] });

		const successEmbed = new EmbedBuilder()
			.setColor(0x2ECC71)
			.setTitle('✅ Quote Submitted!')
			.setDescription(`Thanks, pal. Your quote has been sent to the Innkeepers for review. **${SUBMISSION_COST} Crowns** have been deducted from your account.\nIf it's rejected, you'll get a full refund.`)
			.addFields(
				{ name: 'Your Trigger', value: `\`${triggerWord}\`` },
				{ name: 'Your Quote', value: `"${quoteText}"` },
			);

		await interaction.reply({ embeds: [successEmbed], flags: [MessageFlags.Ephemeral] });

	}
	catch (error) {
		console.error('Tony Quote submission error:', error);
		// Attempt to refund if something went wrong after payment
		db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(SUBMISSION_COST, userId);
		errorEmbed.setTitle('❌ System Error').setDescription('Something went wrong on my end. Your Crowns have not been spent. Please try again later.');
		await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
	}
}

module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('tonyquote')
		.setDescription('Manage your Tony Quotes for the server!')
		.addSubcommand(subcommand =>
			subcommand
				.setName('submit')
				.setDescription('Submit a new trigger word and quote for Tony to say! (Cost: 200 Crowns)')
				.addStringOption(option =>
					option.setName('trigger')
						.setDescription('A single word that will trigger your quote.')
						.setRequired(true))
				.addStringOption(option =>
					option.setName('quote')
						.setDescription('The quote Tony will say (max 200 chars).')
						.setRequired(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('view')
				.setDescription('View your active and submitted Tony Quotes.')
				.addIntegerOption(option =>
					option.setName('page')
						.setDescription('The page number to view.')
						.setRequired(false))),

	async execute(interaction) {
		if (interaction.isButton() && interaction.customId.startsWith('tonyquote_view_')) {
			const parts = interaction.customId.split('_');
			const targetUserId = parts[2];
			const page = parseInt(parts[3], 10);

			if (interaction.user.id !== targetUserId) {
				return interaction.reply({ content: 'Hey, that ain\'t for you!', flags: [MessageFlags.Ephemeral] });
			}

			// Call handleView directly with the page number as an argument
			await handleView(interaction, page);
			return;
		}

		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'submit') {
			await handleSubmit(interaction);
		}
		else if (subcommand === 'view') {
			await handleView(interaction);
		}
	},
};