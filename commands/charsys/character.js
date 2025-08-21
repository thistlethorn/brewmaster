// commands/charsys/character.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const db = require('../../database');

// In-memory store for character creation sessions.
// Key: userId, Value: { step, name, originId, archetypeId, ... }
const creationSessions = new Map();

/**
 * Handles the initial /character create command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleCreate(interaction) {
	const userId = interaction.user.id;

	// Check if the user already has a character.
	const existingCharacter = db.prepare('SELECT 1 FROM characters WHERE user_id = ?').get(userId);
	if (existingCharacter) {
		return interaction.reply({
			content: 'You have already created a character. You can view them with `/character view`.',
			flags: MessageFlags.Ephemeral,
		});
	}

	// Start a new creation session.
	creationSessions.set(userId, { step: 'name' });

	// Show the first modal to get the character's name.
	const nameModal = new ModalBuilder()
		.setCustomId(`char_create_name_${userId}`)
		.setTitle('Character Creation: Name');

	const nameInput = new TextInputBuilder()
		.setCustomId('character_name')
		.setLabel('What is your character\'s name?')
		.setStyle(TextInputStyle.Short)
		.setMinLength(3)
		.setMaxLength(32)
		.setRequired(true);

	nameModal.addComponents(new ActionRowBuilder().addComponents(nameInput));
	await interaction.showModal(nameModal);
}

module.exports = {
	category: 'charsys',
	data: new SlashCommandBuilder()
		.setName('character')
		.setDescription('Create, view, and manage your character.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('create')
				.setDescription('Begin the character creation process.'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('view')
				.setDescription('View your character sheet.')
				.addUserOption(option =>
					option.setName('user')
						.setDescription('The user whose character sheet you want to view.')
						.setRequired(false)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('help')
				.setDescription('Get help and information about the character system.')),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();

		switch (subcommand) {
		case 'create':
			await handleCreate(interaction);
			break;
		case 'view':
			await interaction.reply({ content: 'Character sheet view is under construction!', ephemeral: true });
			break;
		case 'help':
			await interaction.reply({ content: 'Character system help guide is under construction!', ephemeral: true });
			break;
		default:
			await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
		}
	},

	/**
     * Handles modal submissions for the character creation process.
     * @param {import('discord.js').ModalSubmitInteraction} interaction
     */
	async modals(interaction) {
		const [,, action, userId] = interaction.customId.split('_');

		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This interaction is not for you.', flags: MessageFlags.Ephemeral });
		}

		const session = creationSessions.get(userId);
		if (!session) {
			return interaction.reply({ content: 'Your creation session has expired. Please start over with `/character create`.', flags: MessageFlags.Ephemeral });
		}

		await interaction.deferUpdate();

		if (action === 'name' && session.step === 'name') {
			const characterName = interaction.fields.getTextInputValue('character_name');
			session.name = characterName;
			session.step = 'origin';

			// --- Show Origin Selection ---
			const origins = db.prepare('SELECT * FROM origins').all();
			const embed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setTitle(`Step 2: Choose an Origin for ${characterName}`)
				.setDescription('Your Origin defines your background, granting you starting stat bonuses and a unique perk.');

			const rows = [];
			let currentRow = new ActionRowBuilder();
			origins.forEach(origin => {
				if (currentRow.components.length === 5) {
					rows.push(currentRow);
					currentRow = new ActionRowBuilder();
				}
				currentRow.addComponents(
					new ButtonBuilder()
						.setCustomId(`char_create_origin_${origin.id}_${userId}`)
						.setLabel(origin.name)
						.setStyle(ButtonStyle.Secondary),
				);
			});
			rows.push(currentRow);

			await interaction.editReply({ embeds: [embed], components: rows });
		}
		else if (action === 'rp' && session.step === 'rp') {
			// This will be implemented in a future step.
			// For now, we go to final confirmation.
			session.backstory = interaction.fields.getTextInputValue('rp_backstory');
			session.alignment = interaction.fields.getTextInputValue('rp_alignment');
			session.ideals = interaction.fields.getTextInputValue('rp_ideals');
			session.step = 'confirm';

			const origin = db.prepare('SELECT * FROM origins WHERE id = ?').get(session.originId);
			const archetype = db.prepare('SELECT * FROM archetypes WHERE id = ?').get(session.archetypeId);

			const confirmEmbed = new EmbedBuilder()
				.setColor(0xFEE75C)
				.setTitle(`Final Confirmation for ${session.name}`)
				.setDescription('Please review your choices. This is your last chance to turn back. Press "Confirm & Create" to bring your character to life!')
				.addFields(
					{ name: 'Character Name', value: session.name, inline: false },
					{ name: 'Chosen Origin', value: `**${origin.name}** (+1 ${origin.bonus_stat_1}, +1 ${origin.bonus_stat_2})`, inline: true },
					{ name: 'Chosen Archetype', value: `**${archetype.name}**`, inline: true },
					{ name: 'Alignment', value: session.alignment || '*Not provided.*', inline: false },
					{ name: 'Backstory', value: session.backstory.substring(0, 1020) || '*Not provided.*', inline: false },
				);

			const confirmRow = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(`char_create_confirm_final_${userId}`)
					.setLabel('Confirm & Create')
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(`char_create_cancel_${userId}`)
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Danger),
			);
			await interaction.editReply({ embeds: [confirmEmbed], components: [confirmRow] });
		}
	},

	/**
     * Handles button presses for the character creation process.
     * @param {import('discord.js').ButtonInteraction} interaction
     */
	async buttons(interaction) {
		const [,, action, id, userId] = interaction.customId.split('_');

		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This interaction is not for you.', flags: MessageFlags.Ephemeral });
		}

		const session = creationSessions.get(userId);
		if (!session) {
			return interaction.reply({ content: 'Your creation session has expired. Please start over with `/character create`.', flags: MessageFlags.Ephemeral });
		}

		await interaction.deferUpdate();

		if (action === 'origin' && session.step === 'origin') {
			session.originId = id;
			session.step = 'archetype';

			const origin = db.prepare('SELECT * FROM origins WHERE id = ?').get(id);
			const archetypes = db.prepare('SELECT * FROM archetypes').all();

			const embed = new EmbedBuilder()
				.setColor(0x1ABC9C)
				.setTitle('Step 3: Choose an Archetype')
				.setDescription(`You have chosen **${origin.name}**. Now, select your Archetype. This defines your class, abilities, and primary stats.`);

			const rows = [];
			let currentRow = new ActionRowBuilder();
			archetypes.forEach(arch => {
				if (currentRow.components.length === 5) {
					rows.push(currentRow);
					currentRow = new ActionRowBuilder();
				}
				currentRow.addComponents(
					new ButtonBuilder()
						.setCustomId(`char_create_archetype_${arch.id}_${userId}`)
						.setLabel(arch.name)
						.setStyle(ButtonStyle.Secondary),
				);
			});
			rows.push(currentRow);

			await interaction.editReply({ embeds: [embed], components: rows });
		}
		else if (action === 'archetype' && session.step === 'archetype') {
			session.archetypeId = id;
			session.step = 'rp';

			const rpModal = new ModalBuilder()
				.setCustomId(`char_create_rp_${userId}`)
				.setTitle('Character Creation: Role-Playing Details');

			rpModal.addComponents(
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('rp_alignment')
						.setLabel('Alignment (e.g., Chaotic Good)')
						.setStyle(TextInputStyle.Short)
						.setRequired(false)
						.setMaxLength(50),
				),
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('rp_ideals')
						.setLabel('What are your character\'s ideals?')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(false)
						.setMaxLength(500),
				),
				new ActionRowBuilder().addComponents(
					new TextInputBuilder()
						.setCustomId('rp_backstory')
						.setLabel('Character Backstory (Optional)')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(false)
						.setMaxLength(2000),
				),
			);
			// deferUpdate was already called, so we can't show a modal directly.
			// This is a known limitation. We will send the modal from the interaction a different way.
			await interaction.showModal(rpModal);
		}
		else if (action === 'confirm' && session.step === 'confirm') {
			try {
				const origin = db.prepare('SELECT bonus_stat_1, bonus_stat_2 FROM origins WHERE id = ?').get(session.originId);

				const createCharacterTx = db.transaction(() => {
					// Base stats
					const stats = {
						might: 5, finesse: 5, wits: 5, grit: 5, charm: 5, fortune: 5,
					};
					// Apply origin bonuses
					stats[origin.bonus_stat_1]++;
					stats[origin.bonus_stat_2]++;

					db.prepare(`
                        INSERT INTO characters (
                            user_id, character_name, origin_id, archetype_id,
                            character_backstory, character_alignment, character_ideals,
                            stat_might, stat_finesse, stat_wits, stat_grit, stat_charm, stat_fortune
                        ) VALUES (
                            @user_id, @character_name, @origin_id, @archetype_id,
                            @character_backstory, @character_alignment, @character_ideals,
                            @stat_might, @stat_finesse, @stat_wits, @stat_grit, @stat_charm, @stat_fortune
                        )
                    `).run({
						user_id: userId,
						character_name: session.name,
						origin_id: session.originId,
						archetype_id: session.archetypeId,
						character_backstory: session.backstory || '',
						character_alignment: session.alignment || '',
						character_ideals: session.ideals || '',
						stat_might: stats.might,
						stat_finesse: stats.finesse,
						stat_wits: stats.wits,
						stat_grit: stats.grit,
						stat_charm: stats.charm,
						stat_fortune: stats.fortune,
					});
				});

				createCharacterTx();
				creationSessions.delete(userId);

				const successEmbed = new EmbedBuilder()
					.setColor(0x2ECC71)
					.setTitle('🎉 Character Created! 🎉')
					.setDescription(`**${session.name}** has been born! Welcome to a new world of adventure. You can view your new character sheet at any time with \`/character view\`.`);

				await interaction.editReply({ embeds: [successEmbed], components: [] });

			}
			catch (error) {
				console.error('Character creation DB error:', error);
				await interaction.editReply({ content: 'A critical error occurred while saving your character. Please try again later.', components: [], embeds: [] });
				creationSessions.delete(userId);
			}
		}
		else if (action === 'cancel') {
			creationSessions.delete(userId);
			await interaction.editReply({ content: 'Character creation has been cancelled.', embeds: [], components: [] });
		}
	},
};