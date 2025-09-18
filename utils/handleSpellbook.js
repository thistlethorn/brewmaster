// utils/handleSpellbook.js

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../database');

const SPELLS_PER_PAGE = 5;

/**
 * Builds the UI for viewing the spellbook.
 * @param {string} userId - The user's ID.
 * @param {number} page - The current page number.
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function buildViewUI(userId, page = 1) {
	const knownSpells = db.prepare(`
        SELECT s.* FROM character_spells cs
        JOIN spells s ON cs.spell_id = s.spell_id
        WHERE cs.user_id = ?
        ORDER BY s.required_level ASC, s.name ASC
    `).all(userId);

	const totalPages = Math.max(1, Math.ceil(knownSpells.length / SPELLS_PER_PAGE));
	page = Math.min(page, totalPages);
	const start = (page - 1) * SPELLS_PER_PAGE;
	const spellsOnPage = knownSpells.slice(start, start + SPELLS_PER_PAGE);

	const embed = new EmbedBuilder()
		.setColor(0x9B59B6)
		.setTitle('📖 Your Spellbook')
		.setFooter({ text: `Page ${page}/${totalPages}` });

	if (spellsOnPage.length === 0) {
		embed.setDescription('Your spellbook is empty. Use the "Learn Spells" button to discover new spells.');
	}
	else {
		spellsOnPage.forEach(spell => {
			embed.addFields({
				name: `✨ ${spell.name} (Lvl ${spell.required_level})`,
				value: `*${spell.spell_school}* | **Cost:** ${spell.mana_cost} Mana\n${spell.description}`,
				inline: false,
			});
		});
	}

	const components = [];
	const row = new ActionRowBuilder();

	if (totalPages > 1) {
		row.addComponents(
			new ButtonBuilder().setCustomId(`char_spellbook_view_prev_${userId}_${page}`).setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
			new ButtonBuilder().setCustomId(`char_spellbook_view_next_${userId}_${page}`).setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
		);
	}

	row.addComponents(
		new ButtonBuilder().setCustomId(`char_spellbook_learn_${userId}`).setLabel('Learn Spells').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`char_spellbook_back_${userId}`).setLabel('Back to Sheet').setStyle(ButtonStyle.Primary),
	);

	components.push(row);

	return { embeds: [embed], components };
}

async function handleSpellbookInteraction(interaction) {
	const [, , action, ...rest] = interaction.customId.split('_');
	const userId = interaction.user.id;

	// Double-check the button is for the right user
	const intendedUserId = rest[0];
	if (action !== 'back' && action !== 'learn' && userId !== intendedUserId) {
		return interaction.reply({ content: 'This is not for you.', flags: MessageFlags.Ephemeral });
	}


	if (interaction.isButton()) {
		await interaction.deferUpdate();
		if (action === 'view') {
			const pageStr = rest[1];
			let page = parseInt(pageStr, 10);
			if (rest[0] === 'prev') page--;
			if (rest[0] === 'next') page++;
			const ui = buildViewUI(userId, page);
			await interaction.editReply(ui);
		}
		else if (action === 'learn') {
			const character = db.prepare('SELECT level, stat_wits FROM characters WHERE user_id = ?').get(userId);
			const learnableSpells = db.prepare(`
                SELECT * FROM spells
                WHERE required_level <= ? AND required_wits <= ?
                AND spell_id NOT IN (SELECT spell_id FROM character_spells WHERE user_id = ?)
                ORDER BY required_level ASC, name ASC
            `).all(character.level, character.stat_wits, userId);

			if (learnableSpells.length === 0) {
				return interaction.followUp({ content: 'There are no new spells for you to learn at this time.', flags: MessageFlags.Ephemeral });
			}

			const embed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setTitle('📜 Available Spells to Learn')
				.setDescription('Select a spell from the dropdown menu to learn it and add it to your spellbook permanently.');

			const menu = new StringSelectMenuBuilder()
				.setCustomId(`char_spellbook_learnselect_${userId}`)
				.setPlaceholder('Choose a spell to learn...')
				.addOptions(learnableSpells.slice(0, 25).map(spell => ({
					label: `${spell.name} (Lvl ${spell.required_level})`,
					description: `Cost: ${spell.mana_cost} Mana`,
					value: spell.spell_id.toString(),
				})));

			const backButton = new ButtonBuilder().setCustomId(`char_spellbook_open_${userId}`).setLabel('Back to Spellbook').setStyle(ButtonStyle.Secondary);

			await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
		}
		else if (action === 'back') {
			// This will be handled in character.js to re-render the character sheet
		}
		else if (action === 'open') {
			const ui = buildViewUI(userId, 1);
			await interaction.editReply(ui);
		}

	}
	else if (interaction.isStringSelectMenu()) {
		if (action === 'learnselect') {
			const spellId = parseInt(interaction.values[0], 10);
			const spell = db.prepare('SELECT name FROM spells WHERE spell_id = ?').get(spellId);

			try {
				db.prepare('INSERT INTO character_spells (user_id, spell_id) VALUES (?, ?)').run(userId, spellId);
				await interaction.update({
					content: `✅ You have successfully learned **${spell.name}**! It has been added to your spellbook.`,
					embeds: [],
					components: [],
				});
				// After a short delay, show the spellbook again
				setTimeout(async () => {
					const ui = buildViewUI(userId, 1);
					await interaction.editReply(ui);
				}, 2000);
			}
			catch (error) {
				if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
					await interaction.update({ content: 'You already know this spell.', embeds: [], components: [] });
				}
				else {
					console.error('[Spellbook Learn] DB Error:', error);
					await interaction.update({ content: 'An error occurred while learning this spell.', embeds: [], components: [] });
				}
			}
		}
	}
}


module.exports = { buildViewUI, handleSpellbookInteraction };