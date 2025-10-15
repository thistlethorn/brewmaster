// core_brewmaster/commands/utility/shout.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('@database/database.js');
const sendMessageToChannel = require('@utils/sendMessageToChannel.js');

const SHOUT_COST = 500;
const SHOUT_CHANNEL_ID = '1353623582411984931';
const MAX_LENGTH = 500;

module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('shout')
		.setDescription(`Pay Tony ${SHOUT_COST} Crowns to shout a message for you in #the-tavern!`)
		.addStringOption(option =>
			option.setName('message')
				.setDescription(`Your short message (max ${MAX_LENGTH} characters, no pings/links).`)
				.setRequired(true)
				.setMaxLength(MAX_LENGTH)),

	async execute(interaction) {
		const userId = interaction.user.id;
		const messageContent = interaction.options.getString('message');
		const errorEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Can\'t Shout That, Pal');

		// 1. Validate Message Content
		if (/<@|@everyone|@here>/i.test(messageContent) || /https?:\/\/|discord\.gg/i.test(messageContent)) {
			errorEmbed.setDescription('*Whoa there, I ain\'t your personal army or billboard. No pings or links, capisce?*');
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
		if (messageContent.includes('\n')) {
			errorEmbed.setDescription('*Keep it short and sweet. No funny business with multiple lines.*');
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}

		// 2. Validate User's Balance
		const userBalance = db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId)?.crowns || 0;
		if (userBalance < SHOUT_COST) {
			errorEmbed.setTitle('❌ Short on Coin, Friend')
				.setDescription(`*This service ain't free. You need **${SHOUT_COST} Crowns** for a shout, but you only got **${userBalance}**. Come back when you got the coin.*`);
			return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}

		// 3. Process Transaction and Send Shout
		try {
			// Use a transaction to ensure the payment is atomic.
			const shoutTx = db.transaction(() => {
				const result = db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ? AND crowns >= ?')
					.run(SHOUT_COST, userId, SHOUT_COST);

				if (result.changes !== 1) {
					// This will catch a race condition if the user spends crowns elsewhere simultaneously.
					throw new Error('Insufficient funds at time of transaction.');
				}
			});

			shoutTx();

			// 4. Build and send the announcement embed
			const shoutEmbed = new EmbedBuilder()
				.setColor(0xF1C40F)
				.setTitle('🍻 A Message from the Floor! 🍻')
				.setDescription(`${interaction.user} paid me a pretty penny to tell you all:\n\n> "${messageContent}"`);

			await sendMessageToChannel(interaction.client, SHOUT_CHANNEL_ID, shoutEmbed);

			// 5. Confirm with the user
			const successEmbed = new EmbedBuilder()
				.setColor(0x2ECC71)
				.setTitle('✅ Message Shouted!')
				.setDescription(`*Alright, I yelled it out for ya in <#${SHOUT_CHANNEL_ID}>. Cost you **${SHOUT_COST} Crowns**.*`);

			await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });

		}
		catch (error) {
			console.error('[Shout Command] Error processing shout:', error);
			errorEmbed.setTitle('❌ Something Went Sideways')
				.setDescription('*The ledger got jammed or somethin\'. Your Crowns haven\'t been spent. Try again in a bit.*');
			await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
		}
	},
};