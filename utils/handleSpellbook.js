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
		embed.setDescription('Your spellbook is empty. Find or purchase Spell Scrolls to learn new spells.');
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
		new ButtonBuilder().setCustomId(`char_spellbook_usescroll_${userId}`).setLabel('Use Spell Scroll').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`char_spellbook_back_${userId}`).setLabel('Back to Sheet').setStyle(ButtonStyle.Primary),
	);

	components.push(row);

	return { embeds: [embed], components };
}

async function handleSpellbookInteraction(interaction) {
	const [, , action, ...rest] = interaction.customId.split('_');
	const userId = interaction.user.id;

	const intendedUserId = rest[0];
	if (action !== 'back' && action !== 'open' && userId !== intendedUserId) {
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
		else if (action === 'usescroll') {
			const usableScrolls = db.prepare(`
                SELECT ui.inventory_id, i.name, i.effects_json
                FROM user_inventory ui JOIN items i ON ui.item_id = i.item_id
                WHERE ui.user_id = ? AND i.item_type = 'SPELL_SCROLL'
            `).all(userId);

			if (usableScrolls.length === 0) {
				return interaction.followUp({ content: 'You do not have any Spell Scrolls in your inventory.', flags: MessageFlags.Ephemeral });
			}

			const embed = new EmbedBuilder()
				.setColor(0x3498DB)
				.setTitle('📜 Use a Spell Scroll')
				.setDescription('Select a scroll from your inventory to permanently learn the spell it contains. The scroll will be consumed in the process.');

			const menu = new StringSelectMenuBuilder()
				.setCustomId(`char_spellbook_scrollselect_${userId}`)
				.setPlaceholder('Choose a scroll to read...')
				.addOptions(usableScrolls.slice(0, 25).map(scroll => ({
					label: scroll.name,
					value: scroll.inventory_id.toString(),
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
		if (action === 'scrollselect') {
			const inventoryId = parseInt(interaction.values[0], 10);

			try {
				let spellName;
				const learnTx = db.transaction(() => {
					const scroll = db.prepare(`
                SELECT i.name, i.effects_json
                FROM user_inventory ui JOIN items i ON ui.item_id = i.item_id
                WHERE ui.inventory_id = ? AND ui.user_id = ?
            `).get(inventoryId, userId);

					if (!scroll) throw new Error('NOT_FOUND');

					const effects = JSON.parse(scroll.effects_json);
					const spellToLearnName = effects.teaches_spell_name;
					if (!spellToLearnName) throw new Error('INVALID_SCROLL');

					const spell = db.prepare('SELECT spell_id, name, required_wits FROM spells WHERE name = ?').get(spellToLearnName);
					if (!spell) throw new Error('SPELL_NOT_FOUND');

					const character = db.prepare('SELECT stat_wits FROM characters WHERE user_id = ?').get(userId);
					if (character.stat_wits < spell.required_wits) throw new Error('LOW_WITS');

					const alreadyKnown = db.prepare('SELECT 1 FROM character_spells WHERE user_id = ? AND spell_id = ?').get(userId, spell.spell_id);
					if (alreadyKnown) throw new Error('ALREADY_KNOWN');

					db.prepare('DELETE FROM user_inventory WHERE inventory_id = ?').run(inventoryId);
					db.prepare('INSERT INTO character_spells (user_id, spell_id) VALUES (?, ?)').run(userId, spell.spell_id);
					spellName = spell.name;
				});

				learnTx();

				await interaction.update({
					content: `✅ You study the **${spellName}** scroll and commit its secrets to memory! It has been added to your spellbook.`,
					embeds: [],
					components: [],
				});

				setTimeout(async () => {
					const ui = buildViewUI(userId, 1);
					await interaction.editReply(ui);
				}, 2000);

			}
			catch (error) {
				let message = 'An error occurred while learning this spell.';
				if (error.message === 'NOT_FOUND') message = 'You no longer have that scroll.';
				if (error.message === 'INVALID_SCROLL') message = 'This scroll is corrupted and teaches nothing.';
				if (error.message === 'SPELL_NOT_FOUND') message = 'The spell this scroll teaches is unknown to the world.';
				if (error.message === 'LOW_WITS') message = 'Your Wits are not high enough to comprehend this scroll.';
				if (error.message === 'ALREADY_KNOWN') message = 'You already know this spell.';
				await interaction.update({ content: `❌ ${message}`, embeds: [], components: [] });
			}
		}
	}
}

module.exports = { buildViewUI, handleSpellbookInteraction };