const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTierBenefits } = require('../../utils/getTierBenefits');

const { arrayTierEmoji, textTierEmoji } = require('../../utils/emoji');

const tierEmojis = arrayTierEmoji();
const lineTierEmoji = textTierEmoji();

module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('Get information about Brewmaster commands')
		.addStringOption(option =>
			option.setName('category')
				.setDescription('Specific help category')
				.addChoices(
					{ name: 'All Commands', value: 'all' },
					{ name: '🏰 Guilds', value: 'guilds' },
					{ name: '⚔️ Raiding & Warfare', value: 'raiding' },
					{ name: '💰 Economy', value: 'econ' },
					{ name: '🔼 Bumping', value: 'bumping' },
					{ name: '🔁 Multipliers', value: 'multi' },
					{ name: '🗓️ Daily & Weekly Events', value: 'events' },
					{ name: '🔧 Utility', value: 'utility' },
				)),

	async execute(interaction) {
		const category = interaction.options.getString('category') || 'all';

		switch (category) {
		case 'guilds':
			return showGuildHelp(interaction);
		case 'raiding':
			return showRaidHelp(interaction);
		case 'econ':
			return showEconHelp(interaction);
		case 'bumping':
			return showBumpHelp(interaction);
		case 'multi':
			return showMultiHelp(interaction);
		case 'events':
			return showEventsHelp(interaction);
		case 'utility':
			return showUtilityHelp(interaction);
		default:
			return showMainHelp(interaction);
		}
	},
};

async function showMainHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle('🍺 Brewmaster Help Directory')
		.setDescription('Welcome to the Westwind Tavern! I\'m Brewmaster, your friendly tavern-keeper bot. Here\'s a guide to what I can do. Use `/help` with a category for more details!')
		.setThumbnail('https://i.ibb.co/mrqV1v4B/Untitled-design-2.png')
		.addFields(
			{
				name: '🏰 Guild System',
				value: 'Create, manage, and grow your own guild. Recruit members, customize your space, and build a community.\n`/help category:Guilds`',
				inline: false,
			},
			{
				name: '⚔️ Raiding & Warfare',
				value: 'Lead your guild into battle! Raid other guilds for loot, upgrade your defenses, and climb the leaderboards.\n`/help category:Raiding & Warfare`',
				inline: false,
			},
			{
				name: '💰 Economy System',
				value: 'Earn Crowns, our server currency, by participating in server activities. Use them to fund your guild, buy perks, and more.\n`/help category:Economy`',
				inline: false,
			},
			{
				name: '🔼 Bumping System',
				value: 'Help the server grow by using `/bump`! Earn rewards, build streaks, and compete on the weekly leaderboard.\n`/help category:Bumping`',
				inline: false,
			},
			{
				name: '🗓️ Daily & Weekly Events',
				value: 'Learn about the automated events that keep the server economy dynamic, like daily role resets and weekly reward payouts.\n`/help category:Daily & Weekly Events`',
				inline: false,
			},
			{
				name: '🔁 Multiplier System',
				value: 'Boost your Crown earnings! See what different multiplier tiers we have and how you can get them.\n`/help category:Multipliers`',
				inline: false,
			},
			{
				name: '🔧 Utility Commands',
				value: 'Extra tools to help manage the server.\n`/help category:Utility`',
				inline: false,
			},
		)
		.setFooter({ text: 'Use /help [category] for more specific information' });

	await interaction.reply({ embeds: [embed] });
}

async function showGuildHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x3498db)
		.setTitle('🏰 Guild System Help')
		.setDescription('Commands for creating and managing the social aspects of your guild. For combat, see `/help category:Raiding & Warfare`.')
		.addFields(
			{
				name: '▶️ Getting Started',
				value: '• `/guild create <name> <tag>`: Start your own guild.\n• `/guild list`: Browse all existing guilds.\n• `/guild info <tag>`: View detailed information about a specific guild.\n• `/guild join <tag>`: Join a guild that is open to the public.',
				inline: false,
			},
			{
				name: '👥 Guildmember Commands',
				value: '• `/guild invite <user>`: Invite a user to your guild.\n• `/guild leave`: Leave your current guild.\n• `/guild fund <guild_tag> <amount>`: Contribute your personal Crowns to the guild vault (for upgrades, compound interest, items, etc.).\n',
				inline: false,
			},
			{
				name: '👑 Guild Leader Commands',
				value: '• `/guild settings`: Configure your guild (name, tag, visibility, etc.).\n• `/guild bequeath <user>`: Transfer ownership to another member.\n• `/guild delete`: Permanently disband your guild, deleting its channel and role.\n• `/guild fundraise <amount>`: Start a fundraiser for a specific Crown goal.\n• `/guild payout member <user> <amount>`: Pay a member from the guild vault.\n• `/guild payout all <amount>`: Pay all guild members an equal amount from the vault.',
				inline: false,
			},			{
				name: '⚔️ Guild Defenses & Raiding (Use `/help raiding` for more information!)',
				value: '• `/guild raid <TAG>`: Steal from other guilds treasury & personal balances!\n• `/guild upgrade`: Level up your guild\'s rank and increase your defenses.\n• `/guild shield`: Purchase a anti-raid shield, preventing any attacks.',
				inline: false,
			},
			{
				name: '🛡️ Guild Tiers & Stats',
				value: '',
				inline: false,
			},			{
				name: tierEmojis[0] + ' __Tier 1:__',
				value: getTierBenefits(1),
				inline: true,
			},			{
				name: tierEmojis[3] + ' __Tier 4:__',
				value: getTierBenefits(4),
				inline: true,
			},			{
				name: tierEmojis[6] + ' __Tier 7:__',
				value: getTierBenefits(7),
				inline: true,
			},			{
				name: tierEmojis[9] + ' __Tier 10:__',
				value: getTierBenefits(10),
				inline: true,
			},			{
				name: tierEmojis[12] + ' __Tier 13:__',
				value: getTierBenefits(13),
				inline: true,
			},
			{
				name: lineTierEmoji,
				value: '',
				inline: false,
			},
		)
		.setFooter({ text: 'Create your own guild with friends, manage your finances, and have fun battling!' });

	await interaction.reply({ embeds: [embed] });
}

async function showRaidHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0xE67E22)
		.setTitle('⚔️ Guild Raiding & Warfare Help')
		.setDescription('Lead your guild to glory! Attack other guilds to steal their Crowns and prove your might.')
		.addFields(
			{
				name: '▶️ How to Raid (`/guild raid`)',
				value: '• **Cost**: Raiding costs `200 Crowns * Defender\'s Guild Tier`, paid from your guild vault.\n• **Target**: You can raid any guild except your own that is not under protection.\n• **Cooldown**: Your guild can only initiate one raid every **24 hours**.',
			},
			{
				name: '🎯 Success & Failure',
				value: '• A dice roll determines the outcome: `d20 + Modifier` vs the defender\'s Armour Class (based on their tier).\n• **Kingslayer Bonus**: Attack a higher-tier guild for a `+3` bonus to your roll.\n• **Bully Penalty**: Attack a lower-tier guild for a `-4` penalty to your roll.\n• **Vulnerable Targets**: Guilds with less than 200 Crowns in their vault are marked with 🚨 in `/guild info` and have weaker protections:\n  - Steal **25% from each member** (uncapped) instead of 5% (capped at 100)\n  - Steal **a flat 25% from vault** (ignoring tier protections)\n  - If their vault hits 0, the guild is **DESTROYED**.\n• **On Success**: You steal loot! But lose a `2d10%` portion during escape.\n• **On Failure**: You get a small refund, and the defenders gain `50%` of the raid cost.',
			},
			{
				name: '💰 The Loot',
				value: 'Successful raids steal a percentage of the defender\'s **Guild Vault** and a small, capped amount from each of their **Member\'s Pockets**. Higher-tier guilds are better protected and lose a smaller percentage of their vault.',
			},
			{
				name: '📊 Statistics (`/guild raidstats`)',
				value: 'View the Top Raiders leaderboard and a log of the most recent raids across the server.',
			},
			{
				name: '🛡️ Defense & Upgrades',
				value: '• `/guild upgrade`: Spend Crowns from the vault to increase your guild\'s Tier. Higher tiers provide better defense, reduce the percentage of loot stolen from you, and increase your weekly compound interest.\n• `/guild shield`: Purchase temporary raid immunity for your guild. The cost and duration depend on your guild\'s tier.\n• **New Guild Protection**: All new guilds are immune to raids for their first **7 days**.',
			},
			{
				name: tierEmojis[0] + ' __Tier 1:__',
				value: getTierBenefits(1),
				inline: true,
			},
			{
				name: tierEmojis[3] + ' __Tier 4:__',
				value: getTierBenefits(4),
				inline: true,
			},
			{
				name: tierEmojis[6] + ' __Tier 7:__',
				value: getTierBenefits(7),
				inline: true,
			},
			{
				name: tierEmojis[9] + ' __Tier 10:__',
				value: getTierBenefits(10),
				inline: true,
			},
			{
				name: tierEmojis[12] + ' __Tier 13:__',
				value: getTierBenefits(13),
				inline: true,
			},
		)
		.setFooter({ text: 'Fortune favors the bold. Strike swift, and good luck, commander!' });
	await interaction.reply({ embeds: [embed] });
}

async function showEconHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0xF1C40F)
		.setTitle('💰 Economy System Help')
		.setDescription('Everything about earning and managing Crowns (👑)!')
		.addFields(
			{
				name: '💸 How to Earn Crowns',
				value: '• __**Daily Claim**:__ Use `/econ daily` to collect 👑 **20 Crowns** once every 24 hours, starting from when you last claimed it.\n• __**Bumping**:__ Use `/bump` and receive rewards based on your streak. Breaking streaks gives a bonus! (Use `/help bumping` to find out more!)\n• __**Active Chatter**:__ Send 15+ messages in a day (outside gamerooms) to get the `Active Chatter` role, a [`2X`] multiplier, and a 👑 **20 Crown bonus**.\n• __**Welcoming**:__ Be the first to send a quality welcome message to a new member in `#welcome` for a 👑 **25 Crown bonus**!\n• __**Weekly Bumping**:__ Place in the top 3 on the weekly bump leaderboard and win prizes! (👑 1st place: 300 Crowns & Top Bumper role, 2nd: 150 Crowns, 3rd: 100 Crowns).',
				inline: false,
			},
			{
				name: '🤝 Transactions',
				value: '• `/econ pay <user> <amount>`: Send Crowns to another player.\n• `/guild fund <guild_tag> <amount>`: Contribute Crowns to your guild\'s treasury.',
				inline: false,
			},
			{
				name: '📊 Balance & Leaderboard',
				value: '• `/econ balance self`: Check your personal Crown balance and current multiplier.\n• `/econ balance leaderboard`: View the wealthiest players and guilds.',
				inline: false,
			},
		)
		.setFooter({ text: 'Crowns are used for guild upgrades, shields, and more features to come!' });

	await interaction.reply({ embeds: [embed] });
}

async function showBumpHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x2ECC71)
		.setTitle('🔼 Bump System Help')
		.setDescription('Keep the server active and earn rewards!')
		.addFields(
			{
				name: 'How Bumping Works',
				value: '1. Use `/bump` in <#1354187940246327316> every 2 hours.\n2. Earn Crowns and build a streak for bigger, ramped up rewards.\n3. Compete on the weekly leaderboard (<#1373185410779578439>) for the top spot!\n4. Get the `@Bump Notification` role from <#1353631851734106165> to be pinged when you can bump!',
				inline: false,
			},
			{
				name: '🔥 Streaks & Rewards',
				value: 'Bumping consecutively with no one in between builds a streak. Higher streaks yield more Crowns!\nMake sure to utilize your bonus Multipliers to help earn even more!\nUse `/econ balance self` to see what multiplier you currently have, and use `/help multipliers` for information on how to get them!\n• **Normal Streak** (1-2 bumps) 👑 5 Crowns\n• **Blazing Streak** (3-6 bumps) 👑 20 Crowns\n• **Unstoppable Streak** (7-11 bumps) 👑 80 Crowns\n• **Legendary Streak** (12+ bumps) 👑 320 Crowns\n• You also get a large bonus (double) for breaking another user\'s high-tier streak!\n(E.G. If you break someone\'s legendary streak, you\'d get the legendary base rate of 320 * 2 = 👑 640 Crowns)',
				inline: false,
			},
			{
				name: '🏆 Weekly Leaderboard',
				value: 'The leaderboard tracks bumps on the server, reseting sundays, at midnight UTC-0.\nThe #1 bumper gets the exclusive `Top Bumper of the Week` role, a `2.5x` multiplier for the next week, and the top 3 bumpers each receive a large Crown prize (1st: 300, 2nd: 150, 3rd: 100)!',
				inline: false,
			},
		)
		.setFooter({ text: 'Bumping helps the server grow and get more members!' });

	await interaction.reply({ embeds: [embed] });
}

async function showMultiHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x9B59B6)
		.setTitle('🔁 Multiplier System Help')
		.setDescription('Boost your Crown earnings! Your highest eligible multiplier is always active.')
		.addFields(
			{
				name: 'How do I Check My Current Multiplier?',
				value: 'Use `/econ balance self`. Your active multiplier is shown in the top right.',
				inline: false,
			},
			{
				name: 'Multiplier Tiers (Highest to Lowest)',
				value: '1. | `4.0X` | **Successful Guild Raid Defender**\n__**How to get:**__ You get <@&1387473320093548724> for 24 hours when your guild manages to fend off attacking raiders (launched with `/guild raid [TAG].)`\n2. | `3.0X` | **Member of the Week**\n__**How to get:**__\n3. | `2.5X` | **Top Bumper of the Week**\n4. | `2.0X` | **Active Chatter**\n5. | `1.5X` | **Server Booster, Staff, or Partner**\n6. | `1.0X` | **Default Rate**',
				inline: false,
			},
			{
				name: 'Do multipliers stack?',
				value: 'No, they do not stack. The system automatically applies your highest qualifying multiplier. For example, if you are a Server Booster (`1.5x`) and also become an Active Chatter (`2.0x`), your multiplier would be (`2.0x`).',
				inline: false,
			},
		)
		.setFooter({ text: 'Now get out there and get those numbers up!' });

	await interaction.reply({ embeds: [embed] });
}

async function showEventsHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x34495E)
		.setTitle('🗓️ Daily & Weekly Events')
		.setDescription('The server has automated events to keep things fresh and rewarding!')
		.addFields(
			{
				name: '☀️ Daily Reset (Midnight UTC)',
				value: '• The daily message count for all users is reset to zero.\n• The `Active Chatter` role is removed from everyone who earned it the previous day. You\'ll need to earn it again by being active!',
				inline: false,
			},
			{
				name: '🌙 Weekly Reset (Sunday at Midnight UTC)',
				value: '• The **Bump Leaderboard** is reset for a new week of competition.\n• The previous `Top Bumper of the Week` loses their role.\n• Crowns are awarded to the top 3 bumpers: `300` for 1st, `150` for 2nd, and `100` for 3rd.\n• The new #1 bumper receives the `Top Bumper of the Week` role and its `2.5x` multiplier.\n• 👑 **Guilds receive __compound interest__!** 👑 A percentage of their vault balance is added as a bonus. The bonus rate increases with the guild\'s tier, so check your current stats with `/guild info`.',
				inline: false,
			},
		)
		.setFooter({ text: 'Stay active to make the most of these events!' });

	await interaction.reply({ embeds: [embed] });
}

async function showUtilityHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x95A5A6)
		.setTitle('🔧 Utility Commands Help')
		.setDescription('General purpose commands for server management and convenience.')
		.addFields(
			{
				name: '📌 Pinning (`/pin`)',
				value: '• **Usage**: Allows users with a "Section DM" role to pin important messages.\n• **Location**: This command can only be used within channels designated as "gamerooms".\n• **How it works**: Run the command, then reply to the message you want to pin within 60 seconds.',
				inline: false,
			},
		)
		.setFooter({ text: 'More utility commands may be added in the future.' });

	await interaction.reply({ embeds: [embed] });
}