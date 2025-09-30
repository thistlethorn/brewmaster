const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('@database/database.js');
const { scrambleMessage } = require('@core_tavernborne/utils/translateText.js');
const { splitMessage } = require('@utils/messageUtils.js');


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
				// Delete the original message immediately to provide a seamless RP experience
				await message.delete();

				const language = db.prepare('SELECT name, scramble_type FROM languages WHERE language_id = ?').get(languageId);

				const contentToSend = language.name === 'Axal (Common)'
					? messageContent
					: scrambleMessage(messageContent, language.scramble_type);

				// Use our new utility to split the message into safe chunks
				const chunks = splitMessage(contentToSend, 1950);

				const webhook = await interaction.channel.createWebhook({
					name: 'Tavernborne Messenger',
					reason: 'For character language system.',
				}).catch(async () => {
					const webhooks = await interaction.channel.fetchWebhooks();
					return webhooks.find(wh => wh.owner.id === interaction.client.user.id && wh.name === 'Tavernborne Messenger') || await interaction.channel.createWebhook({ name: 'Tavernborne Messenger' });
				});

				let primaryMessage;

				for (let i = 0; i < chunks.length; i++) {
					let chunk = chunks[i];
					// Add a page indicator if the message is split
					if (chunks.length > 1) {
						chunk = `*( ${i + 1} / ${chunks.length} )*\n\n` + chunk;
					}

					const sentMessage = await webhook.send({
						content: chunk,
						username: character.character_name,
						avatarURL: character.character_image || interaction.user.displayAvatarURL(),
						threadId: interaction.channel.isThread() ? interaction.channel.id : null,
					});

					if (i === 0) {
						primaryMessage = sentMessage;
					}
				}

				// If a message was successfully sent, log it and add the translate button if needed
				if (primaryMessage) {
					// IMPORTANT: Store the FULL original content with the ID of the FIRST message chunk
					db.prepare(`
						INSERT INTO spoken_messages (message_id, original_content, language_id, speaker_user_id)
						VALUES (?, ?, ?, ?)
					`).run(primaryMessage.id, messageContent, languageId, userId);

					if (language.name !== 'Axal (Common)') {
						const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
						const row = new ActionRowBuilder().addComponents(
							new ButtonBuilder()
								// The button always references the ID of the first chunk
								.setCustomId(`speak_translate_init_${primaryMessage.id}`)
								.setLabel('Translate Message')
								.setStyle(ButtonStyle.Secondary)
								.setEmoji('📜'),
						);
						// Send the button as a separate message after all chunks have been sent
						await interaction.channel.send({ components: [row] });
					}
				}

			}
			catch (error) {
				console.error('[Speak Collector Error]', error);
				// Check for the specific error to provide a better message
				if (error.code === 50035 && error.message.includes('2000 or fewer')) {
					await interaction.followUp({ content: 'An error occurred. It seems one of the message chunks was still too long after splitting. Please try shortening your paragraphs.', flags: MessageFlags.Ephemeral });
				}
				else {
					await interaction.followUp({ content: 'An unexpected error occurred while sending your message.', flags: MessageFlags.Ephemeral });
				}
			}
		});

		collector.on('end', async (collected, reason) => {
			if (reason === 'time') {
				await interaction.editReply({ content: 'You did not send a message in time. Your speak command has expired.' });
			}
			// This will catch our custom 'toolong' reason and prevent the timeout message from appearing
			else if (reason === 'toolong') {
				await interaction.editReply({ content: 'Your speak command has been cancelled as the translated message was too long.' });
			}
		});
	},
};