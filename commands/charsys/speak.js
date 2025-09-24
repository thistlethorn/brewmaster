const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../database');

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('speak')
		.setDescription('Speak as your character in a specific language.')
		.addStringOption(option =>
			option.setName('language')
				.setDescription('The language you want to speak in.')
				.setRequired(true)
				.setAutocomplete(true)),

	async autocomplete(interaction) {
		const userId = interaction.user.id;
		const fluentLanguages = db.prepare(`
            SELECT l.name, l.language_id
            FROM character_languages cl
            JOIN languages l ON cl.language_id = l.language_id
            WHERE cl.user_id = ? AND cl.fluency_points = 100
        `).all(userId);

		await interaction.respond(
			fluentLanguages.map(lang => ({ name: lang.name, value: lang.language_id.toString() })),
		);
	},

	async execute(interaction) {
		const userId = interaction.user.id;
		const languageId = parseInt(interaction.options.getString('language'), 10);

		const character = db.prepare('SELECT character_name, character_image FROM characters WHERE user_id = ?').get(userId);
		if (!character) {
			return interaction.reply({ content: 'You must create a character first.', flags: MessageFlags.Ephemeral });
		}

		const fluency = db.prepare('SELECT fluency_points FROM character_languages WHERE user_id = ? AND language_id = ?').get(userId, languageId);
		if (!fluency || fluency.fluency_points < 100) {
			return interaction.reply({ content: 'You are not fluent enough to speak in that language.', flags: MessageFlags.Ephemeral });
		}

		await interaction.reply({
			content: 'You have **10 minutes** to send your message in this channel. I will be listening...',
			flags: MessageFlags.Ephemeral,
		});

		const filter = m => m.author.id === userId;
		const collector = interaction.channel.createMessageCollector({ filter, max: 1, time: 600000 });

		collector.on('collect', async message => {
			try {
				const messageContent = message.content;
				await message.delete();

				const language = db.prepare('SELECT name FROM languages WHERE language_id = ?').get(languageId);

				const webhook = await interaction.channel.createWebhook({
					name: 'Tavernborne Messenger',
					reason: 'For character language system.',
				}).catch(async () => {
					const webhooks = await interaction.channel.fetchWebhooks();
					return webhooks.find(wh => wh.owner.id === interaction.client.user.id && wh.name === 'Tavernborne Messenger') || await interaction.channel.createWebhook({ name: 'Tavernborne Messenger' });
				});

				const webhookMessage = await webhook.send({
					content: messageContent,
					username: character.character_name,
					avatarURL: character.character_image || interaction.user.displayAvatarURL(),
					threadId: interaction.channel.isThread() ? interaction.channel.id : null,
				});

				db.prepare(`
					INSERT INTO spoken_messages (message_id, original_content, language_id, speaker_user_id)
					VALUES (?, ?, ?, ?)
				`).run(webhookMessage.id, messageContent, languageId, userId);

				// Only add the translate button if not speaking the common tongue
				if (language.name !== 'Axal (Common)') {
					const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
					const row = new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId(`speak_translate_init_${webhookMessage.id}`)
							.setLabel('Translate Message')
							.setStyle(ButtonStyle.Secondary)
							.setEmoji('📜'),
					);
					await interaction.channel.send({ components: [row] });
				}

			}
			catch (error) {
				console.error('[Speak Collector Error]', error);
				await interaction.followUp({ content: 'An error occurred while sending your message.', flags: MessageFlags.Ephemeral });
			}
		});

		collector.on('end', async (collected, reason) => {
			if (reason === 'time') {
				await interaction.editReply({ content: 'You did not send a message in time. Your speak command has expired.' });
			}
		});
	},
};