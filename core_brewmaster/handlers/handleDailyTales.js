// core_brewmaster/handlers/handleDailyTales.js
const { ModalBuilder, TextInputBuilder, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('@database/database.js');
const sendMessageToChannel = require('@utils/sendMessageToChannel.js');
const config = require('@root/config.json');

const { approvalChannelId, pingRoleId } = config.dailyTales;

/**
 * Main router for all /dailytales interactions.
 * @param {import('discord.js').Interaction} interaction
 */
async function handleDailyTalesInteraction(interaction) {
	if (interaction.isButton()) {
		await handleButton(interaction);
	}
	else if (interaction.isModalSubmit()) {
		await handleModal(interaction);
	}
}

async function handleButton(interaction) {
	const [, action, ...rest] = interaction.customId.split('_');
	const userId = interaction.user.id;

	if (action === 'submit') {
		const modal = new ModalBuilder()
			.setCustomId('dailytales_submit_modal')
			.setTitle('Submit a TTRPG Question');
		const questionInput = new TextInputBuilder()
			.setCustomId('question_text')
			.setLabel('Your TTRPG Question')
			.setStyle(1)
			.setRequired(true)
			.setMinLength(10)
			.setMaxLength(250)
			.setPlaceholder('e.g., What\'s the most creative use of a cantrip you\'ve ever seen?');
		modal.addComponents(new ActionRowBuilder().addComponents(questionInput));
		return interaction.showModal(modal);
	}

	if (action === 'toggle' && rest[0] === 'ping') {
		const member = interaction.member;
		if (member.roles.cache.has(pingRoleId)) {
			await member.roles.remove(pingRoleId);
			return interaction.reply({ content: 'You will no longer be pinged for Daily Tales.', ephemeral: true });
		}
		else {
			await member.roles.add(pingRoleId);
			return interaction.reply({ content: 'You will now be pinged for Daily Tales!', ephemeral: true });
		}
	}

	if (action === 'star' && rest[0] === 'question') {
		const submissionId = parseInt(rest[1], 10);
		const messageId = interaction.message.id;

		const hasStarred = db.prepare('SELECT 1 FROM daily_tales_question_stars WHERE message_id = ? AND user_id = ?').get(messageId, userId);
		if (hasStarred) {
			return interaction.reply({ content: 'You have already starred this question.', ephemeral: true });
		}

		const result = db.prepare('UPDATE daily_tales_submissions SET star_count = star_count + 1 WHERE submission_id = ? RETURNING star_count').get(submissionId);
		db.prepare('INSERT INTO daily_tales_question_stars (message_id, user_id) VALUES (?, ?)').run(messageId, userId);

		const embed = EmbedBuilder.from(interaction.message.embeds[0]);
		embed.setFooter({ text: `⭐ ${result.star_count} Stars | This question is active for the next ${config.dailyTales.activeDurationHours} hours.` });

		await interaction.message.edit({ embeds: [embed] });
		return interaction.reply({ content: 'Your star has been counted!', ephemeral: true });
	}

	// Approval Buttons
	if (action === 'approve' || action === 'reject') {
		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.reply({ content: 'You are not authorized for this action.', ephemeral: true });
		}
		const submissionId = parseInt(rest[0], 10);
		const newStatus = action === 'approve' ? 'approved' : 'rejected';
		const color = action === 'approve' ? 0x2ECC71 : 0xE74C3C;

		db.prepare('UPDATE daily_tales_submissions SET status = ? WHERE submission_id = ?').run(newStatus, submissionId);

		const embed = EmbedBuilder.from(interaction.message.embeds[0])
			.setColor(color)
			.setFooter({ text: `${action.charAt(0).toUpperCase() + action.slice(1)}d by ${interaction.user.username}` });
		const disabledRow = new ActionRowBuilder().addComponents(
			interaction.message.components[0].components.map(c => ButtonBuilder.from(c).setDisabled(true)),
		);

		await interaction.update({ embeds: [embed], components: [disabledRow] });
	}

	// Category Prompt Buttons
	if (action === 'prompt') {
		const targetId = rest[1];
		if (userId !== targetId) return interaction.reply({ content: 'This is not for you.', ephemeral: true });

		if (rest[0] === 'show') {
			// Logic to show category selection menu would go here. For now, we'll just acknowledge.
			await interaction.update({ content: 'Category selection coming soon!', components: [] });
		}
		else if (rest[0] === 'close') {
			await interaction.update({ content: 'Prompt closed.', components: [] });
		}
		else if (rest[0] === 'always') {
			db.prepare('INSERT INTO daily_tales_followup_opt (user_id, opted_in) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET opted_in = 1').run(userId);
			await interaction.update({ content: 'Preference saved! I will always show you the category options from now on.', components: [] });
		}
		else if (rest[0] === 'never') {
			db.prepare('INSERT INTO daily_tales_followup_opt (user_id, opted_in) VALUES (?, 0) ON CONFLICT(user_id) DO UPDATE SET opted_in = 0').run(userId);
			await interaction.update({ content: 'Preference saved! I will not show you the category options again unless you ask.', components: [] });
		}
	}
}

async function handleModal(interaction) {
	const [, action] = interaction.customId.split('_');
	const userId = interaction.user.id;

	if (action === 'submit') {
		const questionText = interaction.fields.getTextInputValue('question_text');
		const result = db.prepare('INSERT INTO daily_tales_submissions (question_text, submitter_id, timestamp) VALUES (?, ?, ?) RETURNING submission_id')
			.get(questionText, userId, Math.floor(Date.now() / 1000));

		const approvalEmbed = new EmbedBuilder()
			.setColor(0xFEE75C)
			.setTitle('New Daily Tale Submission')
			.setDescription(`>>> ${questionText}`)
			.addFields({ name: 'Submitted By', value: `${interaction.user} (\`${userId}\`)` })
			.setFooter({ text: `Submission ID: ${result.submission_id}` });

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`dailytales_approve_${result.submission_id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`dailytales_reject_${result.submission_id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
		);

		await sendMessageToChannel(interaction.client, approvalChannelId, { embeds: [approvalEmbed], components: [row] });
		await interaction.reply({ content: 'Your question has been submitted for approval. Thank you!', ephemeral: true });

		// Handle category prompt
		const optPreference = db.prepare('SELECT opted_in FROM daily_tales_followup_opt WHERE user_id = ?').get(userId);

		// Exit if opted out
		if (optPreference?.opted_in === 0) return;

		if (optPreference?.opted_in === 1) {
			// Logic to immediately show category selection would go here.
			await interaction.followUp({ content: 'Category selection coming soon!', ephemeral: true });
		}
		else {
			const promptEmbed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setDescription('Would you like to categorize your submission? This helps us find it later!');
			const promptRow = new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`dailytales_prompt_show_${userId}`).setLabel('Yes, Show Categories').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId(`dailytales_prompt_close_${userId}`).setLabel('No, Thanks').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId(`dailytales_prompt_always_${userId}`).setLabel('Always Show Me').setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(`dailytales_prompt_never_${userId}`).setLabel('Never Show Me').setStyle(ButtonStyle.Danger),
			);
			await interaction.followUp({ embeds: [promptEmbed], components: [promptRow], ephemeral: true });
		}
	}
}

module.exports = { handleDailyTalesInteraction };