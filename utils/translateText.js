// utils/translateText.js

/**
 * Scrambles a string of text based on a specified method.
 * @param {string} content The original message content.
 * @param {string} type The scrambling method (e.g., 'PIG_LATIN', 'REVERSE').
 * @returns {string} The scrambled content.
 */
function scrambleMessage(content, type) {
	// Use optional chaining and a default to prevent errors if type is null/undefined
	switch (type?.toUpperCase() || 'NONE') {
	case 'PIG_LATIN':
		return content.split(' ').map(w => w.length < 2 ? w : `${w.slice(1)}${w[0]}ay`).join(' ');

	case 'SYMBOL_SUB':
		return content.replace(/a/gi, '@').replace(/e/gi, '3').replace(/i/gi, '!').replace(/o/gi, '0').replace(/s/gi, '$');

	case 'REVERSE':
		return content.split('').reverse().join('');

	case 'SCRAMBLE_VOWELS':
		return content.split(' ').map(w => {
			const v = w.match(/[aeiou]/gi) || [];
			// Shuffle the vowels
			const sV = v.sort(() => Math.random() - 0.5);
			let i = 0;
			// Replace vowels in order with the shuffled vowels
			return w.replace(/[aeiou]/gi, () => sV[i++]);
		}).join(' ');

	case 'INTERLEAVE':
		return content.split('').map((c, i) => (i % 2 === 1 && content[i - 1] !== ' ') ? content[i - 1] : (i % 2 === 0 && content[i + 1] !== ' ') ? content[i + 1] : c).join('');

	case 'WAVY_TEXT':
		return content.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join('');

	case 'NONE':
	default:
		return content;
	}
}

module.exports = { scrambleMessage };