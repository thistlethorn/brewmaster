const TIER_DATA = [
	// Tier 1 (Stone Rank III->II->I)
	{ name: 'Stone III', tier: 1, cost: 0, ac: 11, stolen: 25, bonus: 2 },
	{ name: 'Stone II', tier: 1, cost: 7500, ac: 12, stolen: 23, bonus: 3 },
	{ name: 'Stone I', tier: 1, cost: 15000, ac: 13, stolen: 21, bonus: 4 },
	// Tier 2 (Bronze Rank III->II->I)
	{ name: 'Bronze III', tier: 2, cost: 25000, ac: 14, stolen: 19, bonus: 5 },
	{ name: 'Bronze II', tier: 2, cost: 40000, ac: 15, stolen: 17, bonus: 6 },
	{ name: 'Bronze I', tier: 2, cost: 60000, ac: 16, stolen: 15, bonus: 7 },
	// Tier 3 (Silver Rank III->II->I)
	{ name: 'Silver III', tier: 3, cost: 85000, ac: 17, stolen: 13, bonus: 8 },
	{ name: 'Silver II', tier: 3, cost: 120000, ac: 18, stolen: 11, bonus: 9 },
	{ name: 'Silver I', tier: 3, cost: 175000, ac: 19, stolen: 10, bonus: 10 },
	// Tier 4 (Gold Rank III->II->I)
	{ name: 'Gold III', tier: 4, cost: 250000, ac: 20, stolen: 9, bonus: 12 },
	{ name: 'Gold II', tier: 4, cost: 350000, ac: 21, stolen: 8, bonus: 14 },
	{ name: 'Gold I', tier: 4, cost: 500000, ac: 22, stolen: 7, bonus: 16 },
	// Tier 5 (Adamantium Rank III->II->I)
	{ name: 'Adamantium III', tier: 5, cost: 750000, ac: 23, stolen: 6, bonus: 18 },
	{ name: 'Adamantium II', tier: 5, cost: 1000000, ac: 24, stolen: 5, bonus: 20 },
	{ name: 'Adamantium I', tier: 5, cost: 2500000, ac: 25, stolen: 4, bonus: 25 },
];


function getTierBenefits(tier) {
	const tierInfo = TIER_DATA[tier - 1];
	if (!tierInfo) return 'Unknown Tier';

	return `• Next Tier Upgrade Cost: 📈 \`👑 ${TIER_DATA[tier].cost}\`\n• Armor Class: 🛡️ \`${tierInfo.ac}\`\n• Treasury Max Stolen: 💰 \`${tierInfo.stolen}%\`\n• Weekly Compound Bonus: 🪙 \`${tierInfo.bonus}%\``;
}
function getTierData() {
	return TIER_DATA;
}
module.exports = {
	getTierBenefits,
	getTierData,
};