const STONE_ID = '<:stonerank:1395209438180147232>';
const BRONZE_ID = '<:bronzerank:1395209435919417424>';
const SILVER_ID = '<:silverrank:1395209440558317768>';
const GOLD_ID = '<:goldrank:1395209433629593641>';
const ADA_ID = '<:adarank:1395209442122797087>';

const ONLY_CRESTS = [
	STONE_ID,
	BRONZE_ID,
	SILVER_ID,
	GOLD_ID,
	ADA_ID,
];

module.exports = {

	ONLY_CRESTS,

	arrayTierEmoji: () => {
		// Stone, Bronze, Silver, Gold, Adamantium
		// custom emojis already uploaded to discord server
		// ${STONE_ID}
		// ${BRONZE_ID}
		// ${SILVER_ID}
		// ${GOLD_ID}
		// ${ADA_ID}
		return [
			`${STONE_ID} \`Stone III\` ${STONE_ID}`, `${STONE_ID} \`Stone II\` ${STONE_ID}`, `${STONE_ID} \`Stone I\` ${STONE_ID}`,
			`${BRONZE_ID} \`Bronze III\` ${BRONZE_ID}`, `${BRONZE_ID} \`Bronze II\` ${BRONZE_ID}`, `${BRONZE_ID} \`Bronze I\` ${BRONZE_ID}`,
			`${SILVER_ID} \`Silver III\` ${SILVER_ID}`, `${SILVER_ID} \`Silver II\` ${SILVER_ID}`, `${SILVER_ID} \`Silver I\` ${SILVER_ID}`,
			`${GOLD_ID} \`Gold III\` ${GOLD_ID}`, `${GOLD_ID} \`Gold II\` ${GOLD_ID}`, `${GOLD_ID} \`Gold I\` ${GOLD_ID}`,
			`${ADA_ID} \`Adamantium III\` ${ADA_ID}`, `${ADA_ID} \`Adamantium II\` ${ADA_ID}`, `${ADA_ID} \`Adamantium I\` ${ADA_ID}`,
		];
	},

	textTierEmoji: () => {
		return `${STONE_ID} → ${BRONZE_ID} → ${SILVER_ID} → ${GOLD_ID} → ${ADA_ID}`;
	},
};