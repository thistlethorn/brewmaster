module.exports = {
	isBot: (message) => message.author.bot,

	isInGameroom: (message) => {
		const channel = message.channel;

		// Check channel name first
		if (channel.name.toLowerCase().includes('gameroom')) {
			return true;
		}

		// Get the parent channel (works for both regular channels and threads)
		const parent = channel.parent;

		// For threads, we need to get the parent channel's parent (the category)
		if (channel.isThread()) {
			return true;
		}

		// Check if we found a category with "section" in the name
		if (parent?.type === 'GUILD_CATEGORY') {
			return parent.name.toLowerCase().includes('section');
		}

		return false;
	},
	isNormalMessage: (content) => {
		// Trim and clean the message
		const text = content.trim();
		if (text.length < 3) return false;
		// Too short

		// Check for excessive repetition
		if (/(\S+)(?:\s+\1){3,}/i.test(text)) return false;
		// Repeating words

		if (/([a-zA-Z])\1{4,}/.test(text)) return false;
		// Repeating letters (aaaaa)

		// Check for nonsense character spam
		const charVariety = new Set(text.replace(/\s+/g, '')).size;
		if (charVariety < 4 && text.length > 10) return false;

		// Check for excessive punctuation
		const punctRatio = (text.match(/[.,!?;:]/g) || []).length / text.length;
		if (punctRatio > 0.3) return false;

		// Check for non-alphabetic content
		const letters = text.replace(/[^a-zA-Z]/g, '');
		if (letters.length < text.length * 0.4) return false;

		return true;
	},
};