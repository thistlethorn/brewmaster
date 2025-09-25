const { encode, decodeByWits } = require('./languageProcessor');

/**
 * Processes a string of text, either encoding it into a fictional language
 * or decoding it based on a success chance.
 * @param {string} content - The original message content.
 * @param {string} type - The scrambling method (e.g., 'DRAEDIC_SUB', 'PIG_LATIN').
 * @param {object} [options] - Optional parameters for decoding.
 * @param {boolean} [options.decode=false] - Whether to decode instead of encode.
 * @param {number} [options.successRatio=0] - The success chance for decoding.
 * @returns {string} The processed content.
 */
function processMessage(content, type, options = {}) {
	if (options.decode) {
		return decodeByWits(content, options.successRatio || 0);
	}

	// Use optional chaining and a default to prevent errors if type is null/undefined
	const langType = type?.toUpperCase() || 'NONE';

	// Check if it's one of our new substitution-based languages
	if (langType.endsWith('_SUBSTITUTE')) {
		return encode(content, langType);
	}

	// --- Fallback to old, simple scramblers ---
	switch (langType) {
	case 'PIG_LATIN':
		return content.split(' ').map(w => w.length < 2 ? w : `${w.slice(1)}${w[0]}ay`).join(' ');
	case 'SYMBOL_SUB':
		return content.replace(/a/gi, '@').replace(/e/gi, '3').replace(/i/gi, '!').replace(/o/gi, '0').replace(/s/gi, '$');
	case 'REVERSE':
		return content.split('').reverse().join('');
	case 'SCRAMBLE_VOWELS':
		return content.split(' ').map(w => {
			const v = w.match(/[aeiou]/gi) || [];
			const sV = v.sort(() => Math.random() - 0.5);
			let i = 0;
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

// Renamed for clarity in other files
module.exports = { scrambleMessage: processMessage };