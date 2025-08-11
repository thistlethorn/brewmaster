const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTierBenefits } = require('../../utils/getTierBenefits');
const { arrayTierEmoji, textTierEmoji } = require('../../utils/emoji');

const tierEmojis = arrayTierEmoji();
const lineTierEmoji = textTierEmoji();

// Helper for Tony's voice
const tonyQuote = (text) => `*${text}*`;

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
					{ name: '🏰 Guilds & Crews', value: 'guilds' },
					{ name: '⚔️ Raiding & Warfare', value: 'raiding' },
					{ name: '💰 Crowns & Coin', value: 'econ' },
					{ name: '🔼 Bumping & Boasting', value: 'bumping' },
					{ name: '🔁 Multipliers & Perks', value: 'multi' },
					{ name: '🗓️ Tavern Events', value: 'events' },
					{ name: '🔧 Utility Tools', value: 'utility' },
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
		.setTitle('🍺 Tony\'s Help Directory 🍺')
		.setDescription(tonyQuote('Welcome to the Westwind Tavern! I\'m Tony, the Brewmaster. We got rules, we got games, and we got opportunities. Here\'s the rundown. Use `/help` with a category for the nitty-gritty, capisce?'))
		.setThumbnail('https://i.ibb.co/mrqV1v4B/Untitled-design-2.png')
		.addFields(
			{
				name: '🏰 Guilds & Crews',
				value: 'Start your own crew, make a name for yourselves, and manage your turf. Recruit your pals, customize your spot, and build a family.\n`/help category:Guilds & Crews`',
				inline: false,
			},
			{
				name: '⚔️ Raiding & Warfare',
				value: 'Lead your crew into battle! Hit other guilds for their loot, beef up your defenses, and climb the ladder to the top.\n`/help category:Raiding & Warfare`',
				inline: false,
			},
			{
				name: '💰 Crowns & Coin',
				value: 'Crowns make the world go \'round here. Earn \'em by being part of the Tavern. Use \'em to fund your crew, buy perks, and grease the right wheels.\n`/help category:Crowns & Coin`',
				inline: false,
			},
			{
				name: '🔼 Bumping & Boasting',
				value: 'Help the Tavern grow by using `/bump`! Earn rewards, build streaks, and get your name on the weekly board. Show \'em who\'s boss.\n`/help category:Bumping & Boasting`',
				inline: false,
			},
			{
				name: '🗓️ Tavern Events',
				value: 'The Tavern\'s always got somethin\' brewin\'. Learn about the automated events that keep the coin flowin\', like daily resets and weekly payouts.\n`/help category:Tavern Events`',
				inline: false,
			},
			{
				name: '🔁 Multipliers & Perks',
				value: 'Want a bigger cut? Learn how to boost your Crown earnings. See what different multiplier tiers we got and how you can get \'em.\n`/help category:Multipliers & Perks`',
				inline: false,
			},
			{
				name: '🔧 Utility Tools',
				value: 'A few extra tools to help you run your operations smoothly.\n`/help category:Utility Tools`',
				inline: false,
			},
		)
		.setFooter({ text: 'Use /help [category] for more specific information' });

	await interaction.reply({ embeds: [embed] });
}

async function showGuildHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x3498db)
		.setTitle('🏰 Guilds & Crews Help')
		.setDescription(tonyQuote('This is your family, your business. Here\'s how you run it. For the rough stuff, see `/help raiding`.'))
		.addFields(
			{
				name: '▶️ Gettin\' Started',
				value: '• `/guild create <name> <tag>`: Start your own crew. Make a name for yourselves.\n' +
                       '• `/guild list`: See all the crews currently operating.\n' +
                       '• `/guild info <tag>`: Get the lowdown on a specific guild with a slick interactive menu.\n' +
                       '• `/guild join <tag>`: Join a guild that\'s got its doors open.',
				inline: false,
			},
			{
				name: '👥 Managing Your Crew',
				value: '• `/guild invite <user>`: Send an invitation to bring someone into the fold.\n' +
                       '• `/guild leave`: Part ways with your current crew. No hard feelings, right?\n' +
                       '• `/guild fund <guild_tag> <amount>`: Contribute your personal Crowns to any guild\'s vault. Help your friends, or your future crew.',
				inline: false,
			},
			{
				name: '👑 Guild Leadership Commands (Guildmaster & Vice-GM)',
				value: '• `/guild settings`: A whole menu to customize your guild (name, tag, lore, emoji, etc.).\n' +
                       '• `/guild bequeath <user>`: **(GM Only)** Pass the crown to another member.\n' +
                       '• `/guild delete`: **(GM Only)** Permanently disband your guild. No goin\' back.\n' +
                       '• `/guild fundraise <amount>`: Start a fundraiser for a specific Crown goal.\n' +
                       '• `/guild payout member <user> <amount>`: Pay a member from the guild vault.\n' +
                       '• `/guild payout all <amount>`: Pay all guild members an equal amount from the vault.\n' +
                       '• `/guild dues`: Collect daily dues from all members, with a chance to invest for a bonus.',
				inline: false,
			},
			{
				name: '⚔️ War & Upgrades (Use `/help raiding` for the full story!)',
				value: '• `/guild raid <tag>`: Declare war on another guild and rally allies to steal from their treasury!\n' +
                       '• `/guild upgrade`: Level up your guild\'s Tier, making it tougher and more profitable.\n' +
                       '• `/guild shield`: Purchase a shield to protect your vault from raids.',
				inline: false,
			},
			{
				name: '🛡️ Guild Tiers & Stats',
				value: tonyQuote('A higher tier means more respect, better protection, and more coin. Keep investing in your operation.'),
				inline: false,
			},
			{ name: tierEmojis[0], value: getTierBenefits(1), inline: true },
			{ name: tierEmojis[3], value: getTierBenefits(4), inline: true },
			{ name: tierEmojis[6], value: getTierBenefits(7), inline: true },
			{ name: tierEmojis[9], value: getTierBenefits(10), inline: true },
			{ name: tierEmojis[12], value: getTierBenefits(13), inline: true },
			{ name: '\u200B', value: lineTierEmoji, inline: false },
		)
		.setFooter({ text: 'Build your crew, manage your finances, and show \'em who\'s boss.' });

	await interaction.reply({ embeds: [embed] });
}

async function showRaidHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0xE67E22)
		.setTitle('⚔️ Guild Raiding & Warfare Help')
		.setDescription(tonyQuote('Time to make some noise. Here\'s how you take what\'s yours and defend your turf.'))
		.addFields(
			{
				name: '▶️ How to Declare War (`/guild raid`)',
				value: '• **Cost**: Declaring war costs `200 Crowns * Your Guild\'s Tier`, paid from your vault.\n' +
                       '• **The Call to Arms**: When you declare war, a 10-minute window opens. Anyone can join the fight on either side for free!\n' +
                       '• **Cooldown**: Your guild can only start one war every **24 hours**.',
			},
			{
				name: '🎯 The Battle',
				value: '• **Power vs. Resistance**: The outcome is decided by a roll. Your alliance\'s total Power (`d20 + Tier Bonuses + Modifiers`) vs. the defenders\' total Resistance (`AC + Tier Bonuses`).\n' +
                       '• **Kingslayer Bonus**: Attacking a higher-tier guild gives a `+3` bonus. Big risk, big reward.\n' +
                       '• **Bully Penalty**: Hitting a lower-tier guild gives a `-4` penalty. Don\'t be a bully.\n' +
                       '• **On Success**: The primary attacker\'s guild takes the entire net plunder. Winner takes all.\n' +
                       '• **On Failure**: The primary defending guild gets `50%` of the war declaration cost as compensation.',
			},
			{
				name: '🚨 Vulnerable Targets 🚨',
				value: 'Guilds with less than **500 Crowns** in their vault are in a dangerous spot:\n' +
                       '• Raiders steal **25% from each member** (uncapped) and a flat **25% from the vault**, ignoring tier protections.\n' +
                       '• If their vault hits 0 after a successful raid, the guild is **DESTROYED**. Permanently.',
			},
			{
				name: '🛡️ Defense & Upgrades',
				value: '• `/guild upgrade`: Spend Crowns to raise your guild\'s Tier. Higher tiers give a better AC, reduce vault losses, and boost weekly interest.\n' +
                       '• `/guild shield`: Purchase temporary raid immunity. The cost and duration depend on your tier.\n' +
                       '• **Successful Defense**: If your coalition wins a defense, all members of the primary defending guild get the `Successful Raid Defender` role, granting a `4.0x` multiplier for 24 hours!\n' +
                       '• **New Guild Protection**: New guilds are immune to raids for their first **7 days**.',
			},
		)
		.setFooter({ text: 'Fortune favors the bold. Strike swift, and good luck, commander!' });
	await interaction.reply({ embeds: [embed] });
}

async function showEconHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0xF1C40F)
		.setTitle('💰 Crowns & Coin Help')
		.setDescription(tonyQuote('Here\'s the deal on Crowns (👑). Earn \'em, spend \'em, but don\'t be stupid with \'em.'))
		.addFields(
			{
				name: '💸 How to Earn Crowns',
				value: '• __**Daily Claim**:__ Use `/econ daily` once every 24 hours. Keep a streak going for bigger bonuses. After 21 days, you Prestige for a permanent bonus!\n' +
                       '• __**Bumping**:__ Use `/bump` and get rewarded based on your streak. Breaking someone else\'s big streak? That pays extra.\n' +
                       '• __**Active Chatter**:__ Send 15+ messages a day (no spammin\' in game rooms) to get the `Active Chatter` role, a `2.0x` multiplier, and a **20 Crown bonus**.\n' +
                       '• __**Welcoming**:__ Be one of the first to give a warm welcome to a new member in `#welcome` for a Crown bonus!\n' +
                       '• __**Weekly Bumping**:__ Land in the top 3 on the weekly bump leaderboard for a fat stack of Crowns.',
				inline: false,
			},
			{
				name: '🤝 Transactions & Management',
				value: '• `/econ pay <user> <amount>`: Send Crowns to another player.\n' +
                       '• `/guild fund <guild_tag> <amount>`: Contribute Crowns to any guild\'s treasury.\n' +
                       '• `/econ balance self`: Check your personal Crown balance, multiplier, and next daily claim.\n' +
                       '• `/econ balance user <user>`: Check someone else\'s balance.\n' +
                       '• `/econ balance leaderboard`: See the wealthiest players and top-ranked guilds.',
				inline: false,
			},
		)
		.setFooter({ text: 'Crowns are used for guild upgrades, shields, gambling, and more. Don\'t waste \'em.' });

	await interaction.reply({ embeds: [embed] });
}

async function showBumpHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x2ECC71)
		.setTitle('🔼 Bumping & Boasting Help')
		.setDescription(tonyQuote('Bumping helps the Tavern. Helping the Tavern is good for business. And what\'s good for business is good for you.'))
		.addFields(
			{
				name: 'How It Works',
				value: '1. Use `/bump` in <#1354187940246327316> every 2 hours.\n' +
                       '2. Earn Crowns and build a streak for bigger rewards.\n' +
                       '3. Compete on the weekly leaderboard in <#1373185410779578439>.\n' +
                       '4. Get the `@Bump Notification` role from <#1353631851734106165> so you know when it\'s time.',
				inline: false,
			},
			{
				name: '🔥 Streaks & Rewards',
				value: 'Bumping in a row builds a streak. Higher streaks mean more coin. Your multiplier makes it even better.\n' +
                       '• **Normal Streak** (1-2 bumps): `👑 5 Crowns`\n' +
                       '• **Blazing Streak** (3-6 bumps): `👑 20 Crowns`\n' +
                       '• **Unstoppable Streak** (7-11 bumps): `👑 80 Crowns`\n' +
                       '• **Legendary Streak** (12+ bumps): `👑 320 Crowns`\n' +
                       '• **Streak Breaking**: You get a fat bonus for breaking another user\'s high-tier streak. For example, breaking a Legendary streak nets you an extra `👑 640 Crowns` on top of your base reward!',
				inline: false,
			},
			{
				name: '🏆 Weekly Leaderboard',
				value: 'The board resets every Sunday at midnight UTC. The #1 bumper gets the exclusive `Top Bumper of the Week` role, a `2.5x` multiplier for the next week, and the top 3 get big Crown prizes (1st: 300, 2nd: 150, 3rd: 100).',
				inline: false,
			},
		)
		.setFooter({ text: 'Bumping helps us all. Do your part.' });

	await interaction.reply({ embeds: [embed] });
}

async function showMultiHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x9B59B6)
		.setTitle('🔁 Multipliers & Perks Help')
		.setDescription(tonyQuote('Want a bigger piece of the pie? Here\'s how. Your highest multiplier is always the one that counts. They don\'t stack, so aim high.'))
		.addFields(
			{
				name: 'How do I Check My Multiplier?',
				value: 'Use `/econ balance self`. It\'s in the top right. Easy.',
				inline: false,
			},
			{
				name: 'Multiplier Tiers (Highest to Lowest)',
				value: '1. | `4.0X` | **Successful Guild Raid Defender**: Your guild won a defensive war. Lasts 24 hours.\n' +
                       '2. | `3.0X` | **Member of the Week**: You won the weekly giveaway. Lasts for the week.\n' +
                       '3. | `2.5X` | **Top Bumper of the Week**: You were #1 on last week\'s bump leaderboard.\n' +
                       '4. | `2.0X` | **Active Chatter**: You sent 15+ messages in a day. Lasts until daily reset.\n' +
                       '5. | `1.5X` | **Server Booster, Staff, or Partner**: For supporting the Tavern directly. It\'s appreciated.\n' +
                       '6. | `1.0X` | **Default Rate**: Everyone starts here.',
				inline: false,
			},
		)
		.setFooter({ text: 'Now get out there and get those numbers up!' });

	await interaction.reply({ embeds: [embed] });
}

async function showEventsHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x34495E)
		.setTitle('🗓️ Tavern Events Help')
		.setDescription(tonyQuote('The Tavern runs like a clock. Here\'s the daily and weekly schedule.'))
		.addFields(
			{
				name: '☀️ Daily Reset (Midnight UTC)',
				value: '• Daily message counts are wiped clean.\n' +
                       '• The `Active Chatter` role is removed from everyone. Gotta earn it again.\n' +
                       '• The daily `/guild dues` command becomes available again.',
				inline: false,
			},
			{
				name: '🌙 Weekly Reset (Sunday at Midnight UTC)',
				value: '• The **Bump Leaderboard** resets for a new week.\n' +
                       '• The old `Top Bumper of the Week` loses their role and the new one gets it.\n' +
                       '• Crowns are paid out to the top 3 bumpers.\n' +
                       '• 👑 **Guilds receive compound interest!** A percentage of their vault balance is added as a bonus, based on their Tier.\n' +
                       '• The **Member of the Week** giveaway starts in the Hall of Fame.',
				inline: false,
			},
		)
		.setFooter({ text: 'Stay active. It pays.' });

	await interaction.reply({ embeds: [embed] });
}

async function showUtilityHelp(interaction) {
	const embed = new EmbedBuilder()
		.setColor(0x95A5A6)
		.setTitle('🔧 Utility Tools Help')
		.setDescription(tonyQuote('A few extra tools for the people in charge.'))
		.addFields(
			{
				name: '📌 Pinning (`/pin`)',
				value: '• **Usage**: For Section DMs in gamerooms, and Guildmasters/Vice-GMs in their guild halls.\n' +
                       '• **How it works**: Run the command, then just reply to the message you wanna pin. You got 60 seconds.',
				inline: false,
			},
		)
		.setFooter({ text: 'More tools might show up later. Or they might not.' });

	await interaction.reply({ embeds: [embed] });
}