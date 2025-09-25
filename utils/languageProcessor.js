// utils/languageProcessor.js

/**
 * This file contains the thematic "dictionaries" and logic for translating text
 * into the various fictional languages of Tavernborne.
 */

// --- DICTIONARIES ---
// Each dictionary defines substitution rules for a language.
// The keys are the text to find (lowercase), and values are the replacement.
// Order matters: Longer keys should come before shorter ones (e.g., 'th' before 't').
const dictionaries = {
	// Draedic: Harsh, guttural sounds with hard consonants.
	DRAEDIC_SELF_SUBSTITUTE: {
		'you': 'vok', 'the': 'khr', 'and': 'vath', 'are': 'kren',
		'th': 'zth', 'sh': 'xsh', 'ch': 'k\'k', 'ou': 'ow\'w',
		'a': 'ar', 'e': 'eh', 'i': 'ik', 'o': 'ok', 'u': 'uk',
		's': 'z', 'c': 'k', 'f': 'v',
	},
	// Caeric: Light, airy, and sibilant, with elongated vowels.
	CAERIC_SELF_SUBSTITUTE: {
		'and': 'ael', 'the': 's\'ae', 'you': 'aelyn', 'are': 'aelia',
		'ee': 'eae', 'oo': 'oe', 'th': 's\'th', 'sh': 's\'h',
		'a': 'ai', 'e': 'ae', 'i': 'ia', 'o': 'oa', 'u': 'iu',
		's': 's\'s', 'f': 'f\'f', 'l': 'l\'l',
	},
	// Primordial: Chaotic and alien, mixing reversals and strange separators.
	PRIMORDIAL_SELF_SUBSTITUTE: {
		// This one is handled by a special function, not simple substitution.
	},
	// Bestial: Simple, guttural, focusing on core concepts.
	BESTIAL_SELF_SUBSTITUTE: {
		'i': 'me', 'you': 'you', 'go': 'run', 'food': 'meat', 'danger': 'snarl', 'friend': 'pack',
		's': 'ss', 'r': 'rr', 'gr': 'grr',
	},
	// More dictionaries can be added here for other languages...
	// For now, they will use a default scrambler.
};

/**
 * Encodes cleartext into a specified fictional language.
 * @param {string} text - The original English text.
 * @param {string} languageType - The scramble_type from the database.
 * @returns {string} The encoded (scrambled) text.
 */
function encode(text, languageType) {
	const dictionary = dictionaries[languageType];

	// Special case for Primordial
	if (languageType === 'PRIMORDIAL_SELF_SUBSTITUTE') {
		return text.split(' ').map(word => {
			if (word.length > 5) return word.split('').reverse().join('');
			if (word.length > 2) return word.split('').join('-');
			return word + '\'';
		}).join(' ');
	}

	if (!dictionary) {
		// Fallback for languages without a specific dictionary yet
		return text.split(' ').map(w => w.length < 2 ? w : `${w.slice(1)}${w[0]}ay`).join(' ');
	}

	let result = text.toLowerCase();
	for (const [key, value] of Object.entries(dictionary)) {
		// Use a RegExp for global replacement to catch all occurrences
		result = result.replace(new RegExp(key, 'g'), value);
	}

	return result;
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

module.exports = { encode, decodeByWits };