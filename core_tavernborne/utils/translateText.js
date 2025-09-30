const dictionaries = require('@core_tavernborne/utils/dictionary.js');

/**
 * Processes a string of text, either encoding it into a fictional language
 * or decoding it based on a success chance.
 * @param {string} content - The original message content.
 * @param {string} type - The language type.
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

	return content;
}
/**
 * Encodes cleartext into a specified fictional language while preserving markdown and capitalization.
 * Implements a two-pass system for dialects (Parent Language -> Dialect).
 * @param {string} text - The original English text.
 * @param {string} languageType - The scramble_type from the database.
 * @returns {string} The encoded (scrambled) text.
 */
function encode(text, languageType) {
	// --- Step 1: Identify if it's a dialect and get the correct dictionary/dictionaries ---
	const DIALECT_PARENTS = ['PRIMORDIAL', 'BESTIAL', 'ABERRANT', 'NOCTURNE'];
	let parentDictionary = null;
	let dialectDictionary = null;

	const parentLang = DIALECT_PARENTS.find(p => languageType.includes(p));

	if (parentLang && !languageType.startsWith(parentLang)) {
		// This is a dialect. We need two dictionaries.
		parentDictionary = dictionaries[`${parentLang}_SELF_SUBSTITUTE`];
		dialectDictionary = dictionaries[languageType];
	}
	else {
		// This is a primary language. We only need one.
		parentDictionary = dictionaries[languageType];
	}

	if (!parentDictionary) {
		// Fallback for languages without a specific dictionary yet or if something goes wrong
		return text;
	}

	const delimiterRegex = /(```[\s\S]*?```|`[^`]*?`|\s+|[^a-zA-Z0-9\s`#>+\\]+)/g;

	const parts = text.split(delimiterRegex).filter(part => part);

	const applyDictionary = (content, dictionary) => {
		let result = content.toLowerCase();
		const sortedKeys = Object.keys(dictionary).sort((a, b) => b.length - a.length);

		for (const key of sortedKeys) {
			const value = dictionary[key];
			const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			result = result.replace(new RegExp(escapedKey, 'g'), value);
		}
		return result;
	};

	return parts.map(part => {
		// Test if the part is a word (contains only letters and maybe an apostrophe).
		if (/^[a-zA-Z']+$/.test(part)) {
			// It's a word.
			const originalWord = part;

			const isAllCaps = originalWord.length > 1 && originalWord === originalWord.toUpperCase();
			const isTitleCase = !isAllCaps && originalWord[0] === originalWord[0].toUpperCase();

			let translatedWord = applyDictionary(originalWord, parentDictionary);
			if (dialectDictionary) {
				translatedWord = applyDictionary(translatedWord, dialectDictionary);
			}

			if (isAllCaps) {
				return translatedWord.toUpperCase();
			}
			if (isTitleCase && translatedWord.length > 0) {
				return translatedWord.charAt(0).toUpperCase() + translatedWord.slice(1);
			}
			return translatedWord;
		}

		// It's not a word (it's markdown, a code block, punctuation, or whitespace), so leave it as is.
		return part;

	}).join('');
}

/**
 * "Decodes" a message by revealing parts of the original text based on a success ratio.
 * This is used for the Wits/Fortune/Charm translation attempts.
 * @param {string} originalContent - The original, unscrambled message.
 * @param {number} successRatio - A float between 0.0 and 1.0 representing success.
 * @returns {string} The partially revealed message.
 */
function decodeByWits(originalContent, successRatio) {
	if (successRatio >= 1.0) return originalContent;
	if (successRatio <= 0.0) return originalContent.split(' ').map(w => '`...`'.repeat(Math.ceil(w.length / 5))).join(' ');

	const words = originalContent.split(' ');
	const revealedWords = words.map(word => {
		return Math.random() < successRatio ? word : '`...`';
	});

	return revealedWords.join(' ');
}

// Renamed for clarity in other files
module.exports = { scrambleMessage: processMessage };