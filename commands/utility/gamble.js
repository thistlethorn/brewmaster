const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
} = require('discord.js');
const db = require('../../database');
const { JACKPOT_BASE_AMOUNT } = db;


// --- GAME CONFIG & HELPERS ---

const SUITS = {
	spades: '<:spadecard:1388791886931693608>',
	clubs: '<:clubcard:1388791884205264987>',
	hearts: '<:heartcard:1388791889289019472>',
	diamonds: '<:diamondcard:1388791890970808340>',
};
const RANKS = { 'A': '🇦', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣', '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣', '10': '🔟', 'J': '🇯', 'Q': '🇶', 'K': '🇰' };

const GREG_DIALOGUE = {
	strong_bet: [
		'Let\'s see you call this.',
		'The cards are smiling on me today.',
		'I\'m feeling good about this one. Time to raise the stakes.',
		'This should make things interesting.',
		'All the pieces are falling into place.',
	],
	medium_bet: [
		'I\'ll bet.',
		'I think this hand is worth a bit more.',
		'Let\'s put some pressure on.',
	],
	bluff_bet: [
		'Are you feeling lucky, player?',
		'Go big or go home, right?',
		'You don\'t have the nerve to call this.',
		'I can smell your fear from here. I bet.',
		'Let\'s see how you handle a real bet.',
	],
	trap_check: [
		'I\'ll let you lead the way... for now.',
		'You can have the honor of betting first.',
		'I\'m just biding my time.',
		'Hmm, I\'ll just check.',
	],
	weak_check: [
		'Hmm, not the board I was hoping for.',
		'This is a tough spot. I\'ll check.',
		'I need to see another card for free, if I can.',
		'I don\'t love it, but I don\'t hate it. Check.',
	],
	call: [
		'I\'m not scared of that bet. I call.',
		'Fair enough. Call.',
		'Worth a look. I\'m in.',
		'You\'re not getting rid of me that easily. I call.',
	],
	fold: [
		'Nope, I\'m out.',
		'You got this one. I fold.',
		'Not worth the risk. The pot is yours.',
		'I\'ll wait for a better hand. I\'m folding.',
	],
};

function getJackpotPayoutTier(bet, jackpot) {
	let percentage = 0;
	if (bet >= 500) {
		percentage = 1.0;
	}
	else if (bet >= 250) {
		percentage = 0.75;
	}
	else if (bet >= 100) {
		percentage = 0.5;
	}
	else if (bet >= 50) {
		percentage = 0.25;
	}
	else {
		percentage = 0.1;
	}
	return {
		percentage: percentage,
		payoutAmount: Math.floor(jackpot * percentage),
	};
}

function getJackpot() {
	return db.prepare('SELECT amount FROM game_jackpot WHERE id = 1').get()?.amount || 0;
}

function addToJackpot(amount) {
	db.prepare('UPDATE game_jackpot SET amount = amount + ? WHERE id = 1').run(amount);
}

function resetJackpot() {
	db.prepare('UPDATE game_jackpot SET amount = ? WHERE id = 1').run(JACKPOT_BASE_AMOUNT);
}

function getUserBalance(userId) {
	return db.prepare('SELECT crowns FROM user_economy WHERE user_id = ?').get(userId)?.crowns || 0;
}

const SLOTS_SYMBOLS = {
	cherry:     { emoji: '🍒', weight: 30, payout: 2, rarity: 'Common' },
	lemon:      { emoji: '🍋', weight: 25, payout: 3, rarity: 'Common' },
	orange:     { emoji: '🍊', weight: 20, payout: 5, rarity: 'Uncommon' },
	watermelon: { emoji: '🍉', weight: 15, payout: 10, rarity: 'Uncommon' },
	bell:       { emoji: '🔔', weight: 10, payout: 20, rarity: 'Rare' },
	star:       { emoji: '⭐', weight: 5, payout: 50, rarity: 'Epic' },
	diamond:    { emoji: '💎', weight: 3, payout: 100, rarity: 'Legendary' },
	crown:      { emoji: '👑', weight: 1, payout: 'jackpot', rarity: 'Mythic' },
};

const spinningEmoji = '🌀';
const GRID_SIZE = 3;

function createReel() {
	const reel = [];
	for (const symbol of Object.values(SLOTS_SYMBOLS)) {
		for (let i = 0; i < symbol.weight; i++) {
			reel.push(symbol);
		}
	}
	return reel;
}

const reel = createReel();

function spinReels() {
	const grid = [];
	for (let i = 0; i < GRID_SIZE; i++) {
		const row = [];
		for (let j = 0; j < GRID_SIZE; j++) {
			row.push(reel[Math.floor(Math.random() * reel.length)]);
		}
		grid.push(row);
	}
	return grid;
}

function gridToString(grid) {
	return grid.map(row => row.map(s => s.emoji).join(' | ')).join('\n');
}

function calculatePayouts(grid, bet) {
	const lines = [];
	for (let i = 0; i < GRID_SIZE; i++) { lines.push(grid[i]); }
	for (let i = 0; i < GRID_SIZE; i++) { lines.push([grid[0][i], grid[1][i], grid[2][i]]); }
	lines.push([grid[0][0], grid[1][1], grid[2][2]]);
	lines.push([grid[0][2], grid[1][1], grid[2][0]]);

	let totalPayout = 0;
	let jackpotHit = false;

	for (const line of lines) {
		const firstSymbol = line[0].emoji;
		if (line.every(symbol => symbol.emoji === firstSymbol)) {
			const symbolData = Object.values(SLOTS_SYMBOLS).find(s => s.emoji === firstSymbol);
			if (symbolData.payout === 'jackpot') {
				jackpotHit = true;
			}
			else {
				totalPayout += bet * symbolData.payout;
			}
		}
	}

	return { totalPayout, jackpotHit };
}

function getSlotsLegend() {
	let legend = '';
	for (const symbol of Object.values(SLOTS_SYMBOLS)) {
		const payout = symbol.payout === 'jackpot' ? 'JACKPOT' : `${symbol.payout}x Bet`;
		legend += `3x ${symbol.emoji} = **${payout}** (${symbol.rarity})\n`;
	}
	return legend;
}

// --- POKER LOGIC & HAND EVALUATOR ---
const HAND_RANKS = {
	'Royal Flush':    { rank: 10, name: 'Royal Flush' },
	'Straight Flush': { rank: 9, name: 'Straight Flush' },
	'Four of a Kind': { rank: 8, name: 'Four of a Kind' },
	'Full House':     { rank: 7, name: 'Full House' },
	'Flush':          { rank: 6, name: 'Flush' },
	'Straight':       { rank: 5, name: 'Straight' },
	'Three of a Kind':{ rank: 4, name: 'Three of a Kind' },
	'Two Pair':       { rank: 3, name: 'Two Pair' },
	'One Pair':       { rank: 2, name: 'One Pair' },
	'High Card':      { rank: 1, name: 'High Card' },
};
const cardValues = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };

// TWEAK: Added a `draws` property to the returned result for the AI
function evaluateHand(sevenCards) {
	const processedCards = sevenCards.map(c => ({
		value: cardValues[c.name],
		suit: c.suit,
		name: c.name,
		rank: c.rank,
	})).sort((a, b) => b.value - a.value);

	// eslint-disable-next-line max-statements-per-line
	const valueCounts = processedCards.reduce((acc, card) => { acc[card.value] = (acc[card.value] || 0) + 1; return acc; }, {});
	// eslint-disable-next-line max-statements-per-line
	const suitCounts = processedCards.reduce((acc, card) => { acc[card.suit] = (acc[card.suit] || 0) + 1; return acc; }, {});
	const getBestFive = (handCards, allCards) => {
		const remaining = allCards.filter(c => !handCards.some(hc => hc.name === c.name && hc.suit === c.suit));
		return handCards.concat(remaining).slice(0, 5);
	};
	const flushSuit = Object.keys(suitCounts).find(suit => suitCounts[suit] >= 5);
	const flushCards = flushSuit ? processedCards.filter(c => c.suit === flushSuit) : null;
	let straightFlushCards = null;
	if (flushCards) {
		const uniqueFlushValues = [...new Set(flushCards.map(c => c.value))].sort((a, b) => b - a);
		if (uniqueFlushValues.includes(14) && [2, 3, 4, 5].every(v => uniqueFlushValues.includes(v))) {
			const ace = flushCards.find(c => c.value === 14);
			const lowCards = [2, 3, 4, 5].map(v => flushCards.find(c => c.value === v));
			if (ace && lowCards.every(c => c)) straightFlushCards = [ace, ...lowCards];
		}
		else {
			for (let i = 0; i <= uniqueFlushValues.length - 5; i++) {
				const slice = uniqueFlushValues.slice(i, i + 5);
				if (slice[0] - slice[4] === 4) {
					straightFlushCards = slice.map(v => flushCards.find(c => c.value === v));
					break;
				}
			}
		}
	}
	if (straightFlushCards) {
		const isRoyal = straightFlushCards.every(c => c.value >= 10);
		return { ...HAND_RANKS[isRoyal ? 'Royal Flush' : 'Straight Flush'], cards: getBestFive(straightFlushCards, processedCards), draws: {} };
	}
	const fours = Object.entries(valueCounts).filter(([, count]) => count === 4);
	if (fours.length > 0) {
		const fourValue = parseInt(fours[0][0]);
		const hand = processedCards.filter(c => c.value === fourValue);
		return { ...HAND_RANKS['Four of a Kind'], cards: getBestFive(hand, processedCards), draws: {} };
	}
	const threes = Object.entries(valueCounts).filter(([, count]) => count === 3).map(([v]) => parseInt(v)).sort((a, b) => b - a);
	const pairs = Object.entries(valueCounts).filter(([, count]) => count === 2).map(([v]) => parseInt(v)).sort((a, b) => b - a);
	if (threes.length > 0 && pairs.length > 0) {
		const hand = processedCards.filter(c => c.value === threes[0] || c.value === pairs[0]);
		return { ...HAND_RANKS['Full House'], cards: getBestFive(hand.slice(0, 5), processedCards), draws: {} };
	}
	if (threes.length > 1) {
		const hand = processedCards.filter(c => c.value === threes[0] || c.value === threes[1]);
		return { ...HAND_RANKS['Full House'], cards: getBestFive(hand.slice(0, 5), processedCards), draws: {} };
	}
	if (flushCards) { return { ...HAND_RANKS['Flush'], cards: getBestFive(flushCards, processedCards), draws: {} }; }
	const uniqueValues = [...new Set(processedCards.map(c => c.value))].sort((a, b) => b - a);
	let straightCards = null;
	if (uniqueValues.includes(14) && [2, 3, 4, 5].every(v => uniqueValues.includes(v))) {
		straightCards = [14, 5, 4, 3, 2].map(v => processedCards.find(c => c.value === v));
	}
	else {
		for (let i = 0; i <= uniqueValues.length - 5; i++) {
			const slice = uniqueValues.slice(i, i + 5);
			if (slice[0] - slice[4] === 4) {
				straightCards = slice.map(v => processedCards.find(c => c.value === v));
				break;
			}
		}
	}
	if (straightCards) { return { ...HAND_RANKS['Straight'], cards: getBestFive(straightCards, processedCards), draws: {} }; }

	// --- AI DRAW CALCULATION HELPERS ---
	const draws = {};
	const flushDrawSuit = Object.keys(suitCounts).find(suit => suitCounts[suit] === 4);
	if (flushDrawSuit) { draws.flush = { outs: 9 }; }
	// 13 cards of a suit, 4 are visible -> 9 left
	const straightDrawOuts = (() => {
		const openEnded = [];
		for (let i = 0; i <= uniqueValues.length - 4; i++) {
			const slice = uniqueValues.slice(i, i + 4);
			if (slice[0] - slice[3] === 3) openEnded.push({ outs: 8, needs: [slice[0] + 1, slice[3] - 1] });
		}
		if (openEnded.length > 0) return 8;
		// Open-ended straight draw
		for (let i = 0; i <= uniqueValues.length - 4; i++) {
			const slice = uniqueValues.slice(i, i + 4);
			if (slice[0] - slice[3] === 4) return 4;
			// Gutshot straight draw
		}
		return 0;
	})();
	if (straightDrawOuts > 0) { draws.straight = { outs: straightDrawOuts }; }

	if (threes.length > 0) {
		const hand = processedCards.filter(c => c.value === threes[0]);
		return { ...HAND_RANKS['Three of a Kind'], cards: getBestFive(hand, processedCards), draws };
	}
	if (pairs.length >= 2) {
		const hand = processedCards.filter(c => c.value === pairs[0] || c.value === pairs[1]);
		return { ...HAND_RANKS['Two Pair'], cards: getBestFive(hand, processedCards), draws };
	}
	if (pairs.length === 1) {
		const hand = processedCards.filter(c => c.value === pairs[0]);
		return { ...HAND_RANKS['One Pair'], cards: getBestFive(hand, processedCards), draws };
	}
	return { ...HAND_RANKS['High Card'], cards: processedCards.slice(0, 5), draws };
}

function compareHands(playerResult, dealerResult) {
	if (playerResult.rank !== dealerResult.rank) { return playerResult.rank - dealerResult.rank; }
	for (let i = 0; i < 5; i++) {
		if (playerResult.cards[i].value !== dealerResult.cards[i].value) { return playerResult.cards[i].value - dealerResult.cards[i].value; }
	}
	return 0;
}

// --- MODIFIED: NEW ADVANCED GREG AI (WITH PERSONALITY) ---
function gregAI(gameState) {
	if (!gameState || !gameState.dealerHand) { return { action: 'check', confidence: 'weak' }; }

	const { stage, dealerHand, communityCards, pot, playerBetInRound, gregBetInRound } = gameState;
	let action = 'check';
	let confidence = 'weak';
	// Default confidence

	// --- PRE-FLOP LOGIC ---
	if (stage === 'preflop') {
		const [card1, card2] = dealerHand;
		const v1 = cardValues[card1.name];
		const v2 = cardValues[card2.name];
		const isPair = v1 === v2;
		const isSuited = card1.suit === card2.suit;


		// GENERAL LOGIC FOR PREFLOP pls stop bugging out

		// AA, KK, QQ
		// eslint-disable-next-line max-statements-per-line
		if (isPair && v1 >= 11) { action = 'bet'; confidence = 'strong'; }

		// AK, AQ, KQ
		// eslint-disable-next-line max-statements-per-line
		else if ((v1 >= 13 && v2 >= 12) || (v1 >= 12 && v2 >= 13)) { action = 'bet'; confidence = 'strong'; }

		// Any other pair
		// eslint-disable-next-line max-statements-per-line
		else if (isPair) { action = 'bet'; confidence = 'medium'; }

		// High cards
		// eslint-disable-next-line max-statements-per-line
		else if (v1 >= 10 && v2 >= 10) { action = 'bet'; confidence = 'medium'; }

		// Check/call suited cards, fuck it we ball - type beat
		// eslint-disable-next-line max-statements-per-line
		else if (isSuited) { action = 'check'; confidence = 'weak'; }

		// Honestly just shit cards
		// eslint-disable-next-line max-statements-per-line
		else if (v1 < 7 && v2 < 7 && !isSuited) { action = 'check'; confidence = 'very_weak'; }

		else { action = 'check'; confidence = 'weak'; }

	// --- POST-FLOP LOGIC (Flop, Turn, River) ---
	}
	else {
		const handAndBoard = [...dealerHand, ...communityCards];
		const evaluation = evaluateHand(handAndBoard);
		const handRank = evaluation.rank;
		const draws = evaluation.draws;
		let totalOuts = 0;
		if (draws.flush) totalOuts += draws.flush.outs;
		if (draws.straight) totalOuts += draws.straight.outs;
		if (draws.flush && draws.straight) totalOuts -= 2;
		const multiplier = (stage === 'flop') ? 4 : 2;
		const hitChance = totalOuts * multiplier;
		let handScore = handRank * 10;
		if (handRank >= 2) handScore += 20;
		handScore += hitChance;
		const betToCall = playerBetInRound - gregBetInRound;
		const potOdds = betToCall > 0 ? (betToCall / (pot + betToCall)) * 100 : 0;
		const hasGoodPotOdds = (hitChance > potOdds);

		if (stage === 'river') {
			// eslint-disable-next-line max-statements-per-line
			if (handRank >= 4) { action = 'bet'; confidence = 'strong'; }
			// eslint-disable-next-line max-statements-per-line
			else if (handRank >= 2) { action = 'bet'; confidence = 'medium'; }
			else { action = 'check'; confidence = 'weak'; }
		}
		// Flop/Turn both use same logic
		// eslint-disable-next-line max-statements-per-line
		else if (handScore > 60) { action = 'bet'; confidence = 'strong'; }
		// eslint-disable-next-line max-statements-per-line
		else if (handScore > 40) { action = 'bet'; confidence = 'medium'; }

		// Intention to call is a weak 'bet' and just wring them for money
		// eslint-disable-next-line max-statements-per-line
		else if (hasGoodPotOdds) { action = 'bet'; confidence = 'weak'; }
		// eslint-disable-next-line max-statements-per-line
		else if (handScore > 20) { action = 'check'; confidence = 'weak'; }
		else { action = 'check'; confidence = 'very_weak'; }
	}

	// --- BLUFF/TRAP LOGIC (15% chance) ---
	const isMischievous = Math.random() < 0.15;
	if (isMischievous) {
		if (confidence === 'strong' || confidence === 'medium') {
			// TRAP: Strong hand, but act weak.
			action = 'check';
			confidence = 'trap';
		}
		else if (confidence === 'weak' || confidence === 'very_weak') {
			// BLUFF: Weak hand, but act strong.
			action = 'bet';
			confidence = 'bluff';
		}
	}

	return { action, confidence };
}


// --- NEW HELPER: Processes Greg's turn to add dialogue and flavor text ---
function processGregsTurn(gregMove, gameState) {
	const { action, confidence } = gregMove;
	const { ante, playerBetInRound, gregBetInRound } = gameState;
	const isFacingBet = playerBetInRound > gregBetInRound;

	let finalAction = action;
	let quipKey = `${confidence}_${action}`;
	let actionString = '';
	let amount = ante;

	// 1. Determine the real action based on game context
	if (isFacingBet) {
		if (action === 'bet') {
			// AI wants to bet/raise, which means call in this context
			finalAction = 'call';
			quipKey = 'call';
			amount = playerBetInRound - gregBetInRound;
		}
		else {
			// AI wants to check, but can't check a bet, so it folds
			finalAction = 'fold';
			quipKey = 'fold';
			amount = 0;
		}
	}
	// Not facing a bet, AI can bet or check freely

	else if (action === 'check') {
		quipKey = confidence === 'trap' ? 'trap_check' : 'weak_check';
	}
	else {
		// action is 'bet'
		quipKey = confidence === 'bluff' ? 'bluff_bet' : (confidence === 'strong' ? 'strong_bet' : 'medium_bet');
	}


	// 2. Select a quip and add it to the log
	const quipPool = GREG_DIALOGUE[quipKey] || [];
	if (quipPool.length > 0) {
		const quip = quipPool[Math.floor(Math.random() * quipPool.length)];
		gameState.log.push(`*🧙‍♂️: "${quip}"*`);
	}

	// 3. Generate the descriptive action string
	switch (finalAction) {
	case 'bet':
		actionString = confidence === 'bluff' || confidence === 'strong'
			? `Greg boldly slides a stack of chips forward, betting 👑 ${amount}.`
			: `Greg makes a standard bet of 👑 ${amount}.`;
		break;
	case 'check':
		actionString = confidence === 'trap'
			? 'Greg taps the table with a knowing smirk.'
			: 'Greg looks over his cards again, and nervously checks.';
		break;
	case 'call':
		actionString = `Greg meets your bet, calling 👑 ${amount}.`;
		break;
	case 'fold':
		actionString = 'Greg mucks his cards.';
		break;
	}

	if (actionString) {
		gameState.log.push(`**Turn ${gameState.turnCounter++}:** ${actionString}`);
	}

	return { finalAction, amount };
}

async function handlePoker(interaction) {
	const userId = interaction.user.id;
	const bet = interaction.options.getInteger('bet');

	if (activeGames.has(userId)) { return interaction.reply({ content: 'You already have an active game! Please finish it first.', flags: MessageFlags.Ephemeral }); }
	const balance = getUserBalance(userId);
	if (balance < bet * 4) { return interaction.reply({ content: `You need at least **👑 ${bet * 4}** to play a full hand with this ante. You only have **👑 ${balance}**.` }); }

	// Two-stage coin flip announcement
	const initialEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('🃏 Texas Hold\'em vs. Greg 🃏').setDescription('Flipping a coin to see who posts the ante (the blind)...');

	// --- FIX: Use fetchReply: true to guarantee we get the message object with an ID ---
	const message = await interaction.reply({ embeds: [initialEmbed], fetchReply: true });
	await new Promise(r => setTimeout(r, 1500));

	const deck = createDeck();
	shuffleDeck(deck);
	const dealer = Math.random() < 0.5 ? 'player' : 'greg';
	const poster = dealer === 'player' ? 'greg' : 'player';
	const posterName = poster === 'player' ? 'You' : 'Greg';

	// Announce the winner of the flip
	initialEmbed.setDescription(`The coin has landed! **${posterName}** will post the ante of 👑 ${bet}.`);
	await interaction.editReply({ embeds: [initialEmbed] });
	await new Promise(r => setTimeout(r, 2500));

	const gameState = {
		game: 'poker', ante: bet, pot: 0, stage: 'preflop', deck: deck,
		playerHand: [deck.pop(), deck.pop()], dealerHand: [deck.pop(), deck.pop()],
		communityCards: [], playerBetInRound: 0, gregBetInRound: 0,
		messageId: message.id,
		// --- FIX: This is now a valid snowflake string ---
		log: ['--- Pre-flop ---'], dealer: dealer,
		turnCounter: 1,
		actionsSinceLastBet: 0,
	};
	activeGames.set(userId, gameState);

	let isPlayerTurnFirst = false;

	if (poster === 'player') {
		db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(bet, userId);
		gameState.pot = bet;
		gameState.playerBetInRound = bet;
		gameState.log.push(`You were chosen to post the ante of 👑 ${bet}.`);

		const gregMove = gregAI(gameState);
		const gregResponse = processGregsTurn(gregMove, gameState);

		if (gregResponse.finalAction === 'call') {
			gameState.pot += bet;
			gameState.gregBetInRound = bet;
		}
		else {
			db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(bet, userId);
			return endPokerGame(interaction, gameState, { winner: 'player', reason: `Greg folded to your ante. You win the pot of 👑 ${bet}.` });
		}
	}
	else {
		// Greg is the poster
		gameState.pot = bet;
		gameState.gregBetInRound = bet;
		gameState.log.push(`Greg was chosen to post the ante of 👑 ${bet}.`);
		isPlayerTurnFirst = true;
	}

	// --- FIX: Ensure the correct message.id is used to build the buttons ---
	const embed = buildPokerEmbed(gameState, interaction.user, false, false, isPlayerTurnFirst);
	const components = buildPokerButtons(gameState, userId, message.id);
	await interaction.editReply({ content: ' ', embeds: [embed], components: components });
}

function addLogFieldsToEmbed(embed, log) {
	const MAX_LENGTH = 1024;
	let currentField = '';
	let part = 1;

	for (const line of log) {
		// If adding the next line would exceed the limit...
		if (currentField.length + line.length + 1 > MAX_LENGTH) {
			// ...add the current field to the embed...
			embed.addFields({
				name: part === 1 ? 'Full Hand History' : '... (continued)',
				value: currentField,
			});
			// ...and start a new field with the current line.
			currentField = line + '\n';
			part++;
		}
		else {
			// Otherwise, just append the line.
			currentField += line + '\n';
		}
	}

	// Add the last remaining field if it has content
	if (currentField) {
		embed.addFields({
			name: part === 1 ? 'Full Hand History' : '... (continued)',
			value: currentField,
		});
	}
}

async function endPokerGame(interaction, gameState, result) {
	const userId = interaction.user.id;
	const currentBalance = getUserBalance(userId);
	activeGames.delete(userId);


	if (result.reason) {
		gameState.log.push(result.reason);
	}
	const winnerName = result.winner === 'player' ? interaction.user.username : 'Greg';
	gameState.log.push(`\n**Game over! ${winnerName} wins the hand.**`);

	// Now, build the embed with the fully updated log.
	const embed = buildPokerEmbed(gameState, interaction.user, false, true);

	let finalDescription = '';
	let finalFooterText = '';

	if (result.winner === 'player') {
		const isAnteOnlyWin = result.reason?.includes('ante');

		// Only pay out the pot if it was a normal win.
		// For an ante-only win, the user's ante was already refunded before this function was called.
		if (!isAnteOnlyWin) {
			db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(gameState.pot, userId);
		}

		const finalBalance = getUserBalance(userId);
		finalDescription = '**YOU WIN!**';
		embed.setColor(0x2ECC71);

		if (isAnteOnlyWin) {
			finalFooterText = `Your Final Balance: 👑 ${finalBalance.toLocaleString()}`;
		}
		else {
			const preWinBalance = finalBalance - gameState.pot;
			finalFooterText = `Your Balance: 👑 ${preWinBalance.toLocaleString()} + 👑 ${gameState.pot.toLocaleString()} = 👑 ${finalBalance.toLocaleString()}`;
		}
	}
	else if (result.winner === 'greg') {
		addToJackpot(Math.floor(gameState.pot * 0.5));
		finalDescription = '**GREG WINS!**';
		embed.setColor(0xE74C3C);
		finalFooterText = `Your Final Balance: 👑 ${currentBalance.toLocaleString()} | Greg Wins Pot: 👑 ${gameState.pot.toLocaleString()}`;
	}
	else if (result.winner === 'showdown') {
		const playerResult = evaluateHand([...gameState.playerHand, ...gameState.communityCards]);
		const dealerResult = evaluateHand([...gameState.dealerHand, ...gameState.communityCards]);
		const comparison = compareHands(playerResult, dealerResult);
		embed.setTitle(SUITS['hearts'] + ' 💥 Showdown! 💥 ' + SUITS['diamonds']);

		if (comparison > 0) {
			db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(gameState.pot, userId);
			const finalBalance = currentBalance + gameState.pot;
			finalDescription = `**YOU WIN!** You take the pot with a **${playerResult.name}**.`;
			embed.setColor(0x2ECC71);
			finalFooterText = `Your Balance: 👑 ${currentBalance.toLocaleString()} + 👑 ${gameState.pot.toLocaleString()} = 👑 ${finalBalance.toLocaleString()}`;
			if (playerResult.rank >= HAND_RANKS['Straight Flush'].rank) {
				const jackpot = getJackpot();
				db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(jackpot, userId);
				resetJackpot();
				embed.addFields({ name: '🎉🎉 JACKPOT! 🎉🎉', value: `Your **${playerResult.name}** has won the Jackpot of **👑 ${jackpot.toLocaleString()}**!` });
			}
		}
		else if (comparison < 0) {
			addToJackpot(Math.floor(gameState.pot * 0.5));
			finalDescription = `**Greg Wins!** The house takes the pot with a **${dealerResult.name}**.`;
			embed.setColor(0xE74C3C);
			finalFooterText = `Your Final Balance: 👑 ${currentBalance.toLocaleString()} | Greg Wins Pot: 👑 ${gameState.pot.toLocaleString()}`;
		}
		else {
			const refund = Math.floor(gameState.pot / 2);
			db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(refund, userId);
			const finalBalance = currentBalance + refund;
			finalDescription = `**It's a TIE!** The pot of **👑 ${gameState.pot.toLocaleString()}** is split. Your bets are returned.`;
			embed.setColor(0x95A5A6);
			finalFooterText = `Your Final Balance: 👑 ${finalBalance.toLocaleString()}`;
		}
		embed.addFields(
			{ name: `Your Best Hand: ${playerResult.name}`, value: `> ${handToString(playerResult.cards)}`, inline: true },
			{ name: `Greg's Best Hand: ${dealerResult.name}`, value: `> ${handToString(dealerResult.cards)}`, inline: true },
		);
	}

	embed
		.setDescription(finalDescription)
		.setFooter({ text: finalFooterText });

	// Safely add the hand history, splitting it into multiple fields if needed.
	addLogFieldsToEmbed(embed, gameState.log);

	await interaction.editReply({ embeds: [embed], components: [] });

}

function buildPokerButtons(gameState, userId, messageId) {
	const actionRow = new ActionRowBuilder();
	const { ante, playerBetInRound, gregBetInRound } = gameState;
	const betButton = new ButtonBuilder().setCustomId(`gamble_poker_bet_${userId}_${messageId}`).setLabel(`Bet ${ante}`).setStyle(ButtonStyle.Primary);
	const foldButton = new ButtonBuilder().setCustomId(`gamble_poker_fold_${userId}_${messageId}`).setLabel('Fold').setStyle(ButtonStyle.Danger);
	if (gregBetInRound > playerBetInRound) {
		const callAmount = gregBetInRound - playerBetInRound;
		actionRow.addComponents(
			new ButtonBuilder().setCustomId(`gamble_poker_call_${userId}_${messageId}`).setLabel(`Call ${callAmount}`).setStyle(ButtonStyle.Success),
			betButton.setLabel(`Raise to ${ante + callAmount}`),
			foldButton,
		);
	}
	else {
		actionRow.addComponents(
			new ButtonBuilder().setCustomId(`gamble_poker_check_${userId}_${messageId}`).setLabel('Check').setStyle(ButtonStyle.Secondary).setDisabled(playerBetInRound !== gregBetInRound),
			betButton,
			foldButton,
		);
	}
	return [actionRow];
}

function buildPokerEmbed(gameState, user, isThinking = false, isOver = false, isPlayerTurn = false) {
	const finalBalance = getUserBalance(user.id);
	const embed = new EmbedBuilder()
		.setColor(0x1ABC9C)
		.setTitle(SUITS['spades'] + ' 🃏 Texas Hold\'em vs. Greg 🃏 ' + SUITS['clubs'])
		.setFooter({ text: `Your balance: 👑 ${finalBalance.toLocaleString()} | Pot Size: 👑 ${gameState.pot.toLocaleString()}` })
		.addFields(
			{ name: `Community Cards (${gameState.stage})`, value: gameState.communityCards.length > 0 ? handToString(gameState.communityCards) : 'Not yet revealed.' },
			{ name: 'Your Hand', value: handToString(gameState.playerHand), inline: true },
			{ name: 'Greg\'s Hand', value: isOver ? handToString(gameState.dealerHand) : '<:backside:1389616850521817319> <:backside:1389616850521817319>', inline: true },
		);

	// Create a clean, persistent log with temporary prompts
	let description = gameState.log.slice(-5).join('\n');
	if (isThinking) {
		description += '\n\n`Greg is thinking...`';
	}
	else if (isPlayerTurn && !isOver) {
		// Don't show "action is on you" if the game is over
		description += '\n\n`The action is on you.`';
	}

	embed.setDescription(description);
	return embed;
}
const activeGames = new Map();

async function handleSlots(interaction) {
	const userId = interaction.user.id;
	const bet = interaction.options.getInteger('bet');

	if (activeGames.has(userId)) { return interaction.reply({ content: 'You already have an active game! Please finish it first.' }); }
	const balance = getUserBalance(userId);
	if (balance < bet) { return interaction.reply({ content: `You don't have enough Crowns! You need ${bet} but only have ${balance}.` }); }

	const defaultGrid = spinReels();
	const embed = new EmbedBuilder()
		.setColor(0x9B59B6)
		.setTitle('🎰 Slots at The Weary Wager 🎰')
		.setDescription(gridToString(defaultGrid))
		.addFields(
			{ name: 'Bet Amount', value: `👑 ${bet.toLocaleString()}` },
			{ name: 'Payouts (3 in a row, any line)', value: getSlotsLegend() },
		);
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`gamble_slots_start_${userId}_${bet}`)
			.setLabel(`Insert ${bet} Crowns & Spin`)
			.setStyle(ButtonStyle.Success)
			.setEmoji('🪙'),
	);
	await interaction.reply({ embeds: [embed], components: [row] });
}

function createDeck() {
	const deck = [];
	for (const suit of Object.values(SUITS)) {
		for (const rank in RANKS) {
			let value;
			if (rank === 'A') { value = 11; }
			else if (['K', 'Q', 'J'].includes(rank)) { value = 10; }
			else { value = parseInt(rank); }
			deck.push({ suit, rank: RANKS[rank], value, name: rank });
		}
	}
	return deck;
}

function shuffleDeck(deck) {
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[deck[i], deck[j]] = [deck[j], deck[i]];
	}
}

function getHandValue(hand) {
	let value = hand.reduce((sum, card) => sum + card.value, 0);
	let aces = hand.filter(card => card.name === 'A').length;
	while (value > 21 && aces > 0) {
		value -= 10;
		aces--;
	}
	return value;
}

function handToString(hand) {
	return hand.map(card => `${card.suit}${card.rank}`).join(' ');
}

async function handleBlackjack(interaction) {
	const userId = interaction.user.id;
	const bet = interaction.options.getInteger('bet');

	if (activeGames.has(userId)) { return interaction.reply({ content: 'You already have an active game! Please finish it first.' }); }
	const balance = getUserBalance(userId);
	if (balance < bet) { return interaction.reply({ content: `You don't have enough Crowns! You need ${bet} but only have ${balance}.` }); }

	db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(bet, userId);
	const deck = createDeck();
	shuffleDeck(deck);
	const playerHand = [deck.pop(), deck.pop()];
	const dealerHand = [deck.pop(), deck.pop()];
	const gameState = { game: 'blackjack', bet, deck, playerHand, dealerHand, status: 'playing' };
	activeGames.set(userId, gameState);

	const embed = new EmbedBuilder()
		.setColor(0xF1C40F)
		.setTitle('🃏 Blackjack at The Weary Wager 🃏')
		.setDescription(`**${interaction.user.displayName}** vs. **Greg the Dealer**`)
		.addFields(
			{ name: `Your Hand (${getHandValue(playerHand)})`, value: handToString(playerHand), inline: true },
			{ name: 'Greg\'s Hand (?)', value: `${handToString([dealerHand[0]])} <:backside:1389616850521817319>`, inline: true },
			{ name: 'Bet Amount', value: `👑 ${bet.toLocaleString()}` },
		)
		.setFooter({ text: 'What will you do?' });
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`gamble_blackjack_hit_${userId}`).setLabel('Hit').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`gamble_blackjack_stand_${userId}`).setLabel('Stand').setStyle(ButtonStyle.Danger),
	);
	await interaction.reply({ embeds: [embed], components: [row] });
	if (getHandValue(playerHand) === 21) { await resolveBlackjack(interaction, 'stand'); }
}

async function resolveBlackjack(interaction, action) {
	const userId = interaction.user.id;
	const gameState = activeGames.get(userId);
	if (!gameState) {
		const replyMethod = interaction.replied || interaction.deferred ? 'editReply' : 'update';
		return interaction[replyMethod]({ content: 'This game has expired or could not be found.', embeds: [], components: [] });
	}
	if (action === 'hit') { gameState.playerHand.push(gameState.deck.pop()); }
	const playerValue = getHandValue(gameState.playerHand);
	let dealerValue = getHandValue(gameState.dealerHand);
	const embed = new EmbedBuilder().setColor(0xF1C40F).setTitle('🃏 Blackjack at The Weary Wager 🃏').setDescription(`**${interaction.user.displayName}** vs. **Greg the Dealer**`).addFields({ name: 'Bet Amount', value: `👑 ${gameState.bet.toLocaleString()}` });
	const playerTurnOver = action === 'stand' || playerValue >= 21;
	if (playerTurnOver) {
		while (dealerValue < 17) {
			gameState.dealerHand.push(gameState.deck.pop());
			dealerValue = getHandValue(gameState.dealerHand);
		}
		if (playerValue > 21) { gameState.status = 'lose'; }
		else if (dealerValue > 21 || playerValue > dealerValue) { gameState.status = 'win'; }
		else if (playerValue < dealerValue) { gameState.status = 'lose'; }
		else { gameState.status = 'push'; }
		const dbTransaction = db.transaction(() => {
			const streakData = db.prepare('SELECT blackjack_wins FROM user_game_streaks WHERE user_id = ?').get(userId);
			let currentStreak = streakData?.blackjack_wins || 0;
			let jackpotWon = false;
			if (gameState.status === 'win') {
				const winnings = gameState.bet * 2;
				db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(winnings, userId);
				embed.setColor(0x2ECC71).addFields({ name: 'Result: YOU WON!', value: `You win **👑 ${winnings.toLocaleString()}**!` });
				currentStreak++;
				db.prepare('INSERT INTO user_game_streaks (user_id, blackjack_wins) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET blackjack_wins = blackjack_wins + 1').run(userId, 1);
			}
			else if (gameState.status === 'lose') {
				const jackpotContribution = Math.floor(gameState.bet * 0.5);
				addToJackpot(jackpotContribution);
				embed.setColor(0xE74C3C).addFields({ name: 'Result: YOU LOST!', value: `You lose your bet. **👑 ${jackpotContribution.toLocaleString()}** was added to the jackpot.` });
				currentStreak = 0;
				db.prepare('UPDATE user_game_streaks SET blackjack_wins = 0 WHERE user_id = ?').run(userId);
			}
			else {
				db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(gameState.bet, userId);
				embed.setColor(0x95A5A6).addFields({ name: 'Result: Tie.', value: `Your bet of **👑 ${gameState.bet.toLocaleString()}** was returned and winning streak reset.` });
				currentStreak = 0;
				db.prepare('UPDATE user_game_streaks SET blackjack_wins = 0 WHERE user_id = ?').run(userId);
			}
			if (currentStreak >= 5) {
				const jackpot = getJackpot();
				const payoutTier = getJackpotPayoutTier(gameState.bet, jackpot);
				if (payoutTier.percentage == 1.0) {
					db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(jackpot, userId);
					resetJackpot();
					embed.addFields({ name: '🎉🎉 JACKPOT! 🎉🎉', value: `With a bet of **👑 ${gameState.bet}**, you won **${payoutTier.percentage * 100}%** of the jackpot!\n> **Reward:** **👑 ${payoutTier.payoutAmount.toLocaleString()}**!` });
					jackpotWon = true;
				}
				else {
					db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(payoutTier.payoutAmount, userId);
					db.prepare('UPDATE game_jackpot SET amount = amount - ? WHERE id = 1').run(payoutTier.payoutAmount);
					db.prepare('UPDATE user_game_streaks SET blackjack_wins = 0 WHERE user_id = ?').run(userId);
					embed.addFields({ name: '🎉🎉 JACKPOT! 🎉🎉', value: `With a bet of **👑 ${gameState.bet}**, you won **${payoutTier.percentage * 100}%** of the jackpot!\n> **Reward:** **👑 ${payoutTier.payoutAmount.toLocaleString()}**!` });
					jackpotWon = true;
				}
			}
			embed.addFields({ name: 'Win Streak', value: `${jackpotWon ? '0 (Jackpot Claimed!)' : currentStreak} / 5` });
		});
		dbTransaction();
		embed.addFields({ name: `Your Hand (${playerValue})`, value: handToString(gameState.playerHand), inline: true }, { name: `Greg's Hand (${dealerValue})`, value: handToString(gameState.dealerHand), inline: true });
		activeGames.delete(userId);
		if (interaction.isButton()) { await interaction.update({ embeds: [embed], components: [] }); }
		else { await interaction.editReply({ embeds: [embed], components: [] }); }
	}
	else {
		embed.addFields({ name: `Your Hand (${playerValue})`, value: handToString(gameState.playerHand), inline: true }, { name: 'Greg\'s Hand (?)', value: `${handToString([gameState.dealerHand[0]])} <:backside:1389616850521817319>`, inline: true });
		const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gamble_blackjack_hit_${userId}`).setLabel('Hit').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`gamble_blackjack_stand_${userId}`).setLabel('Stand').setStyle(ButtonStyle.Danger));
		if (interaction.isButton()) { await interaction.update({ embeds: [embed], components: [row] }); }
		else { await interaction.editReply({ embeds: [embed], components: [row] }); }
	}
}

async function handleCoinflip(interaction) {
	const userId = interaction.user.id;
	if (activeGames.has(userId)) { return interaction.reply({ content: 'You already have an active game! Please finish it first.' }); }
	const jackpot = getJackpot();
	const jackpotBet = Math.max(1, Math.floor(jackpot * 0.05));
	const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('🪙 Flip a Coin 🪙').setDescription('Feeling lucky? Place your bet and call it in the air!').addFields({ name: 'Current Jackpot', value: `👑 ${jackpot.toLocaleString()}` });
	const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gamble_coinflip_custom_${userId}`).setLabel('Custom Bet').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`gamble_coinflip_jackpot_${userId}_${jackpotBet}`).setLabel(`Play for Jackpot (Bet ${jackpotBet.toLocaleString()})`).setStyle(ButtonStyle.Primary));
	await interaction.reply({ embeds: [embed], components: [row] });
}

async function resolveCoinflip(interaction, bet, forJackpot = false) {
	const userId = interaction.user.id;
	const balance = getUserBalance(userId);
	const replyMethod = interaction.isModalSubmit() ? 'reply' : 'update';
	if (balance < bet) { return interaction[replyMethod]({ content: `You don't have enough Crowns to make that bet! You need ${bet}, but only have ${balance}.`, embeds: [], components: [] }); }
	const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
	const choice = interaction.customId.includes('heads') ? 'Heads' : 'Tails';
	const win = result === choice;
	const embed = new EmbedBuilder().setDescription(`The coin spins through the air... and it's **${result}**!`);
	const dbTransaction = db.transaction(() => {
		const streakData = db.prepare('SELECT coinflip_losses FROM user_game_streaks WHERE user_id = ?').get(userId);
		let currentLossStreak = streakData?.coinflip_losses || 0;
		if (forJackpot) { embed.setTitle('🪙 Coin Flip Result 🪙 - Playing for Jackpot'); }
		else { embed.setTitle('🪙 Coin Flip Result 🪙'); }
		if (win) {
			const winnings = bet;
			db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(winnings, userId);
			embed.setColor(0x2ECC71).addFields({ name: 'Result: YOU WON!', value: `You called it right and won **👑 ${bet.toLocaleString()}**!` });
			db.prepare('INSERT INTO user_game_streaks (user_id, coinflip_losses) VALUES (?, 0) ON CONFLICT(user_id) DO UPDATE SET coinflip_losses = 0').run(userId);
			currentLossStreak = 0;
			if (forJackpot) embed.addFields({ name: 'Loss Streak RESET!', value: `${currentLossStreak} / 5` });
		}
		else {
			db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(bet, userId);
			addToJackpot(bet);
			embed.setColor(0xE74C3C).addFields({ name: 'Result: YOU LOST!', value: `You called it wrong and lost your bet. **👑 ${bet.toLocaleString()}** was added to the jackpot.` });
			if (forJackpot) {
				currentLossStreak++;
				db.prepare('INSERT INTO user_game_streaks (user_id, coinflip_losses) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET coinflip_losses = coinflip_losses + 1').run(userId);
				if (currentLossStreak >= 5) {
					const jackpot = getJackpot();
					db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(jackpot, userId);
					resetJackpot();
					db.prepare('UPDATE user_game_streaks SET coinflip_losses = 0 WHERE user_id = ?').run(userId);
					embed.addFields({ name: '🎉🎉 ANTI-JACKPOT! 🎉🎉', value: `You are so unlucky! You've lost 5 jackpot-qualifying games in a row and won the jackpot of **👑 ${jackpot.toLocaleString()}**!` });
				}
			}
		}
	});
	dbTransaction();
	await interaction[replyMethod]({ embeds: [embed], components: [] });
}

// --- MAIN COMMAND STRUCTURE ---
module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('gamble')
		.setDescription('Play games of chance at The Weary Wager!')
		.addSubcommand(subcommand => subcommand.setName('blackjack').setDescription('Play a game of Blackjack against the dealer.').addIntegerOption(option => option.setName('bet').setDescription('The amount of Crowns to bet.').setRequired(true).setMinValue(10)))
		.addSubcommand(subcommand => subcommand.setName('coinflip').setDescription('Flip a coin for a 50/50 chance to double your bet!'))
		.addSubcommand(subcommand => subcommand.setName('slots').setDescription('Try your luck at the slot machine!').addIntegerOption(option => option.setName('bet').setDescription('The amount of Crowns to bet per spin.').setRequired(true).setMinValue(5)))
		.addSubcommand(subcommand => subcommand.setName('horseracing').setDescription('Bet on a horse and watch the race! (Coming Soon)'))
		.addSubcommand(subcommand => subcommand.setName('spinthewheel').setDescription('Spin the wheel for a variety of prizes! (Coming Soon)'))
		.addSubcommand(subcommand => subcommand.setName('poker').setDescription('Play a 1v1 game of Texas Hold\'em against the dealer.').addIntegerOption(option => option.setName('bet').setDescription('The ante and amount for each betting round.').setRequired(true).setMinValue(10)))
		.addSubcommand(subcommand => subcommand.setName('jackpot').setDescription('Check the current global jackpot amount.')),

	async execute(interaction) {
		const gamblingChannelId = '1393361841102786771';

		if (interaction.channel.id !== gamblingChannelId) {
			const errorEmbed = new EmbedBuilder()
				.setColor(0xE74C3C)
				.setTitle('❌ Wrong Channel!')
				.setDescription(`Whoa there! To keep the Tavern tidy, all gambling games must be played in the <#${gamblingChannelId}> channel.`);

			return interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'blackjack') { await handleBlackjack(interaction); }
		else if (subcommand === 'coinflip') { await handleCoinflip(interaction); }
		else if (subcommand === 'slots') { await handleSlots(interaction); }
		else if (subcommand === 'poker') { await handlePoker(interaction); }
		else if (subcommand === 'jackpot') {
			const jackpot = getJackpot();
			const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('🤑 Global Jackpot 🤑').setDescription(`The current jackpot is **👑 ${jackpot.toLocaleString()}**!\nWin it in a variety of games!`);
			await interaction.reply({ embeds: [embed] });
		}
		else { await interaction.reply({ content: 'This game is still being built by the Brewmaster. Check back later!' }); }
	},

	buttons: {
		async handleGameButton(interaction) {
			const parts = interaction.customId.split('_');
			const game = parts[1];

			// Each game now handles its own ID parsing and user validation.
			// This prevents parsing conflicts between different games.

			if (game === 'blackjack') {
				const action = parts[2];
				const userId = parts[3];
				if (interaction.user.id !== userId) { return interaction.reply({ content: 'This isn\'t your game!', flags: MessageFlags.Ephemeral }); }

				await resolveBlackjack(interaction, action);
			}
			else if (game === 'poker') {
				// Robust parsing specifically for poker buttons
				const action = parts[2];
				const userId = parts[3];
				const messageId = parts[4];

				// 1. Check if the button belongs to the user interacting
				if (interaction.user.id !== userId) {
					return interaction.reply({ content: 'This isn\'t your game!', flags: MessageFlags.Ephemeral });
				}

				const gameState = activeGames.get(userId);

				if (!gameState || gameState.messageId !== messageId) {
					if (gameState) {
						// The game state exists but is for a different game message. Clear the stuck state.
						activeGames.delete(userId);
					}
					return interaction.update({ content: 'This poker game has expired or is invalid. The game has been cleared, so please feel free to start a new one.', embeds: [], components: [] });
				}

				// --- From here, the original poker logic continues, but uses the safely parsed 'action' variable ---
				await interaction.update({ components: [] });

				let roundOver = false;
				const { ante, dealer } = gameState;
				const balance = getUserBalance(userId);

				if (action === 'fold') {
					return endPokerGame(interaction, gameState, { winner: 'greg', reason: 'You folded.' });
				}
				else if (action === 'bet') {
					const raiseAmount = gameState.gregBetInRound > gameState.playerBetInRound ? ante + (gameState.gregBetInRound - gameState.playerBetInRound) : ante;
					if (balance < raiseAmount) {
						await interaction.followUp({ content: `You don't have enough to bet 👑 ${raiseAmount}! You fold automatically.`, flags: MessageFlags.Ephemeral });
						return endPokerGame(interaction, gameState, { winner: 'greg', reason: 'You folded (insufficient funds).' });
					}
					const amountToCall = gameState.gregBetInRound - gameState.playerBetInRound;
					const newBet = amountToCall > 0 ? raiseAmount : ante;
					db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(newBet, userId);
					gameState.pot += newBet;
					gameState.playerBetInRound += newBet;
					gameState.log.push(`**Turn ${gameState.turnCounter++}:** You bet 👑 ${newBet}.`);
					gameState.actionsSinceLastBet = 0;
				}
				else if (action === 'call') {
					const callAmount = gameState.gregBetInRound - gameState.playerBetInRound;
					if (balance < callAmount) {
						await interaction.followUp({ content: `You don't have enough to call 👑 ${callAmount}! You fold automatically.`, flags: MessageFlags.Ephemeral });
						return endPokerGame(interaction, gameState, { winner: 'greg', reason: 'You folded (insufficient funds).' });
					}
					db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(callAmount, userId);
					gameState.pot += callAmount;
					gameState.playerBetInRound += callAmount;
					gameState.log.push(`**Turn ${gameState.turnCounter++}:** You call 👑 ${callAmount}.`);
					roundOver = true;
				}
				else if (action === 'check') {
					gameState.log.push(`**Turn ${gameState.turnCounter++}:** You check.`);
					gameState.actionsSinceLastBet++;
					if (gameState.actionsSinceLastBet >= 2) {
						roundOver = true;
					}
				}

				if (!roundOver) {
					const thinkingEmbed = buildPokerEmbed(gameState, interaction.user, true);
					await interaction.editReply({ embeds: [thinkingEmbed], components: [] });
					await new Promise(r => setTimeout(r, 2000));

					const gregMove = gregAI(gameState);
					const gregResponse = processGregsTurn(gregMove, gameState);

					if (gregResponse.finalAction === 'call') {
						gameState.pot += gregResponse.amount;
						gameState.gregBetInRound += gregResponse.amount;
						roundOver = true;
					}
					else if (gregResponse.finalAction === 'fold') {
						return endPokerGame(interaction, gameState, { winner: 'player', reason: 'Greg folded.' });
					}
					else if (gregResponse.finalAction === 'bet') {
						gameState.pot += ante;
						gameState.gregBetInRound += ante;
						gameState.actionsSinceLastBet = 0;
					}
					else {
						gameState.actionsSinceLastBet++;
						if (gameState.actionsSinceLastBet >= 2) {
							roundOver = true;
						}
					}
				}

				if (roundOver) {
					gameState.playerBetInRound = 0;
					gameState.gregBetInRound = 0;
					gameState.actionsSinceLastBet = 0;
					let nextStage = '';
					switch (gameState.stage) {
					case 'preflop': nextStage = 'flop'; break;
					case 'flop': nextStage = 'turn'; break;
					case 'turn': nextStage = 'river'; break;
					case 'river': return endPokerGame(interaction, gameState, { winner: 'showdown' });
					}

					if (nextStage === 'flop') { gameState.communityCards.push(gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop()); }
					else if (nextStage) { gameState.communityCards.push(gameState.deck.pop()); }
					gameState.stage = nextStage;
					gameState.log.push(`--- The ${gameState.stage.charAt(0).toUpperCase() + gameState.stage.slice(1)} (${handToString(gameState.communityCards)}) ---`);

					const isPlayerTurnFirst = dealer !== 'player';
					if (isPlayerTurnFirst) {
						const embed = buildPokerEmbed(gameState, interaction.user, false, false, true);
						const components = buildPokerButtons(gameState, userId, messageId);
						await interaction.editReply({ embeds: [embed], components: components });
					}
					else {
						const thinkingEmbed = buildPokerEmbed(gameState, interaction.user, true);
						await interaction.editReply({ embeds: [thinkingEmbed], components: [] });
						await new Promise(r => setTimeout(r, 2000));

						const gregMove = gregAI(gameState);
						const gregResponse = processGregsTurn(gregMove, gameState);

						if (gregResponse.finalAction === 'bet') {
							gameState.pot += gregResponse.amount;
							gameState.gregBetInRound += gregResponse.amount;
						}

						const embed = buildPokerEmbed(gameState, interaction.user, false, false, true);
						const components = buildPokerButtons(gameState, userId, messageId);
						await interaction.editReply({ embeds: [embed], components: components });
					}
				}
				else {
					const embed = buildPokerEmbed(gameState, interaction.user, false, false, true);
					const components = buildPokerButtons(gameState, userId, messageId);
					await interaction.editReply({ embeds: [embed], components: components });
				}
			}
			else if (game === 'slots') {
				const action = parts[2];
				const userId = parts[3];
				const bet = parseInt(parts[4]);

				if (interaction.user.id !== userId) { return interaction.reply({ content: 'This isn\'t your game!', flags: MessageFlags.Ephemeral }); }

				if (action === 'start') {
					const balance = getUserBalance(userId);
					if (balance < bet) { return interaction.update({ content: `You no longer have enough Crowns! You need ${bet} but only have ${balance}.`, components: [], embeds: [] }); }
					db.prepare('UPDATE user_economy SET crowns = crowns - ? WHERE user_id = ?').run(bet, userId);
					const spinningGrid = Array(GRID_SIZE).fill(Array(GRID_SIZE).fill({ emoji: spinningEmoji }));
					const spinningEmbed = new EmbedBuilder(interaction.message.embeds[0]).setDescription(gridToString(spinningGrid));
					const spinningButton = new ButtonBuilder().setCustomId('gamble_slots_spinning').setLabel('Spinning...').setStyle(ButtonStyle.Secondary).setDisabled(true);
					await interaction.update({ embeds: [spinningEmbed], components: [new ActionRowBuilder().addComponents(spinningButton)] });
					await new Promise(resolve => setTimeout(resolve, 1500));
					const teaseGrid = spinReels();
					const teaseEmbed = new EmbedBuilder(interaction.message.embeds[0]).setDescription(gridToString(teaseGrid));
					const teaseButton = new ButtonBuilder().setCustomId('gamble_slots_tease').setLabel('Slowing down...').setStyle(ButtonStyle.Secondary).setDisabled(true);
					await interaction.editReply({ embeds: [teaseEmbed], components: [new ActionRowBuilder().addComponents(teaseButton)] });
					await new Promise(resolve => setTimeout(resolve, 1000));
					await interaction.editReply({ embeds: [spinningEmbed], components: [new ActionRowBuilder().addComponents(spinningButton)] });
					await new Promise(resolve => setTimeout(resolve, 1000));
					const finalGrid = spinReels();
					const results = calculatePayouts(finalGrid, bet);
					const resultEmbed = new EmbedBuilder().setColor(0x9B59B6).setTitle('🎰 Slots Result 🎰').setDescription(gridToString(finalGrid)).addFields({ name: 'Bet Amount', value: `👑 ${bet.toLocaleString()}` }, { name: 'Payouts (3 in a row, any line)', value: getSlotsLegend() });
					let resultButton;
					const dbTransaction = db.transaction(() => {
						if (results.jackpotHit) {
							const jackpot = getJackpot();
							db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(jackpot, userId);
							resetJackpot();
							resultEmbed.setColor(0xFFD700);
							resultButton = new ButtonBuilder().setCustomId('gamble_slots_win_jackpot').setLabel(`JACKPOT! YOU WON ${jackpot.toLocaleString()} CROWNS!`).setStyle(ButtonStyle.Success).setDisabled(true);
						}
						else if (results.totalPayout > 0) {
							db.prepare('UPDATE user_economy SET crowns = crowns + ? WHERE user_id = ?').run(results.totalPayout, userId);
							resultEmbed.setColor(0x2ECC71);
							resultButton = new ButtonBuilder().setCustomId('gamble_slots_win').setLabel(`You Won ${results.totalPayout.toLocaleString()} Crowns!`).setStyle(ButtonStyle.Success).setDisabled(true);
						}
						else {
							addToJackpot(bet);
							resultEmbed.setColor(0xE74C3C);
							resultButton = new ButtonBuilder().setCustomId('gamble_slots_lose').setLabel(`You Lost! ${bet.toLocaleString()} Crowns added to Jackpot.`).setStyle(ButtonStyle.Danger).setDisabled(true);
						}
					});
					dbTransaction();
					await interaction.editReply({ embeds: [resultEmbed], components: [new ActionRowBuilder().addComponents(resultButton)] });
				}
			}
			else if (game === 'coinflip') {
				const action = parts[2];
				const userId = parts[3];

				if (interaction.user.id !== userId) { return interaction.reply({ content: 'This isn\'t your game!', flags: MessageFlags.Ephemeral }); }

				if (action === 'custom') {
					const modal = new ModalBuilder().setCustomId(`gamble_coinflip_modal_${userId}`).setTitle('Custom Coin Flip Bet');
					const amountInput = new TextInputBuilder().setCustomId('bet_amount').setLabel(`How much to bet? (You have ${getUserBalance(userId)})`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Enter a number');
					modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
					await interaction.showModal(modal);
				}
				else if (action === 'jackpot') {
					const bet = parseInt(parts[4]);
					const choiceEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('Call it in the air!').setDescription(`You are betting **👑 ${bet.toLocaleString()}** for a chance at the anti-jackpot.`);
					const choiceRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gamble_coinflip_resolve_${userId}_jackpot_heads_${bet}`).setLabel('Heads').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`gamble_coinflip_resolve_${userId}_jackpot_tails_${bet}`).setLabel('Tails').setStyle(ButtonStyle.Primary));
					await interaction.update({ embeds: [choiceEmbed], components: [choiceRow] });
				}
				else if (action === 'resolve') {
					const forJackpot = parts[4] === 'jackpot';
					const bet = parseInt(parts[6]);
					await resolveCoinflip(interaction, bet, forJackpot);
				}
			}
		},
	},

	modals: {
		async handleModalSubmit(interaction) {
			const parts = interaction.customId.split('_');
			// eslint-disable-next-line no-unused-vars
			const [_, game, action, userId] = parts;
			if (interaction.user.id !== userId) { return interaction.reply({ content: 'This isn\'t your game!' }); }
			if (game === 'coinflip' && action === 'modal') {
				const bet = parseInt(interaction.fields.getTextInputValue('bet_amount'));
				if (isNaN(bet) || bet <= 0) { return interaction.reply({ content: 'Please enter a valid positive number for your bet.' }); }
				const choiceEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('Call it in the air!').setDescription(`You are betting **👑 ${bet.toLocaleString()}**.`);
				const choiceRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gamble_coinflip_resolve_${userId}_custom_heads_${bet}`).setLabel('Heads').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`gamble_coinflip_resolve_${userId}_custom_tails_${bet}`).setLabel('Tails').setStyle(ButtonStyle.Primary));
				await interaction.reply({ embeds: [choiceEmbed], components: [choiceRow] });
			}
		},
	},
};