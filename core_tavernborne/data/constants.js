const rarityEmojis = {
	STARTER: '🟤',
	COMMON: '⚪',
	UNCOMMON: '🟢',
	RARE: '🔵',
	EPIC: '🟣',
	LEGENDARY: '🟡',
	MYTHIC: '🔴',
};

const rarityColors = {
	STARTER:   0x836953,
	COMMON:    0x95A5A6,
	UNCOMMON:  0x2ECC71,
	RARE:      0x3498DB,
	EPIC:      0x9B59B6,
	LEGENDARY: 0xF1C40F,
	MYTHIC:    0xE74C3C,
};

const tavernborneEmojis = {
	XP: '<a:xp:1415141534533292123>',
};

// Export both objects so other files can use them
module.exports = {
	rarityEmojis,
	rarityColors,
	tavernborneEmojis,
};