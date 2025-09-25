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
		'you': 'vok', 'the': 'khr', 'and': 'vath', 'are': 'kren', 'is': 'krin', 'it': 'kot',
		'th': 'zth', 'sh': 'xsh', 'ch': 'k\'k', 'ou': 'ow\'w',
		'a': 'ar', 'e': 'eh', 'i': 'ik', 'o': 'ok', 'u': 'uk',
		's': 'z', 'c': 'k', 'f': 'v', 'g': 'gh', 'j': 'j\'k',
	},
	// Caeric: Light, airy, and sibilant, with elongated vowels and soft sounds.
	CAERIC_SELF_SUBSTITUTE: {
		'and': 'ael', 'the': 's\'ae', 'you': 'aelyn', 'are': 'aelia', 'is': 's\'ae', 'it': 'lia',
		'ee': 'eae', 'oo': 'oe', 'th': 's\'th', 'sh': 's\'h', 'ch': 's\'c',
		'a': 'ai', 'e': 'ae', 'i': 'ia', 'o': 'oa', 'u': 'iu',
		's': 's\'s', 'f': 'f\'f', 'l': 'l\'l', 'p': 'ph', 't': 'th',
	},
	// Primordial: Chaotic and alien, mixing reversals and strange separators.
	PRIMORDIAL_SELF_SUBSTITUTE: {
		// This one is handled by a special function, not simple substitution.
	},
	// Bestial: Simple, guttural, focusing on repeated hard sounds and growls.
	BESTIAL_SELF_SUBSTITUTE: {
		'the': 'grr', 'and': 'sn', 'you': 'yarr',
		'ar': 'arr', 'er': 'err', 'ou': 'owr', 'th': 'thr', 'sh': 'sssh',
		'a': 'ra', 'e': 're', 'i': 'ri', 'o': 'ro', 'u': 'ru',
		's': 'ss', 'r': 'rr', 'g': 'gr', 'b': 'br', 'k': 'kr',
	},
	// Aberrant: Unsettling, disjointed, with glottal stops and reversed pairs.
	ABERRANT_SELF_SUBSTITUTE: {
		'the': 'eht', 'and': 'd\'na', 'you': 'ouy',
		'ae': 'e\'a', 'ie': 'e\'i', 'ou': 'u\'o',
		'th': 'ht', 'sh': 'hs', 'ch': 'hc',
		'a': 'a\'a', 'e': 'e\'e', 'i': 'i\'i', 'o': 'o\'o', 'u': 'u\'u',
		'q': 'k\'q', 'x': 'k\'s',
	},
	// Nocturne: Hushed, whispered, elongated sibilants and soft consonants.
	NOCTURNE_SELF_SUBSTITUTE: {
		'the': 'sheth', 'and': 'za', 'you': 'shu',
		's': 'sss', 'z': 'zh', 'f': 'ph', 'th': 'thz', 'sh': 'shhh',
		'a': 'ah', 'e': 'eh', 'i': 'ih', 'o': 'oh', 'u': 'uh',
		'd': 'th', 'g': 'gh', 't': 'th',
	},
	// --- DIALECTS ---
	// Ignic (Primordial): Crackling, hissing fire sounds.
	IGNIC_PRIMORDIAL_SUBSTITUTE: { 's': 'sh', 'f': 'fsh', 'k': 'kss', 'h': 'hss' },
	// Auric (Primordial): Rushing, breathy wind sounds.
	AURIC_PRIMORDIAL_SUBSTITUTE: { 's': 'swh', 'f': 'wh', 'r': 'rh' },
	// Aquic (Primordial): Bubbling, flowing water sounds.
	AQUIC_PRIMORDIAL_SUBSTITUTE: { 'b': 'bl', 'g': 'gl', 's': 'sl' },
	// Ferric (Primordial): Grinding, metallic sounds.
	FERRIC_PRIMORDIAL_SUBSTITUTE: { 'g': 'grn', 'k': 'krn', 't': 'trn', 's': 'szk' },
	// Sylvic (Primordial): Rustling, wooden sounds.
	SYLVIC_PRIMORDIAL_SUBSTITUTE: { 's': 'shh', 'w': 'wh', 'f': 'ffr' },

	// Vulpis (Bestial): Yips and sharp 's' sounds.
	VULPIS_BESTIAL_SUBSTITUTE: { 's': 'ssy', 'a': 'ya', 'o': 'yo' },
	// Felis (Bestial): Hissing and purring sounds.
	FELIS_BESTIAL_SUBSTITUTE: { 's': 'sss', 'r': 'mrr', 'f': 'fff' },
	// Chelis (Bestial): Slow, hard, deliberate sounds.
	CHELIS_BESTIAL_SUBSTITUTE: { 't': 'tk', 'd': 'dg', 's': 'shk' },
	// Canis (Bestial): Barks and growls.
	CANIS_BESTIAL_SUBSTITUTE: { 'b': 'brf', 'w': 'woof', 'gr': 'grrf' },
	// Lapis (Bestial): Quick, soft, thumping sounds.
	LAPIS_BESTIAL_SUBSTITUTE: { 'p': 'pth', 'b': 'bth', 'th': 'thump' },

	// Klang (Aberrant): Mechanical, clicking sounds.
	KLANG_ABBERANT_SUBSTITUTE: { 'c': 'kl', 'k': 'kl', 't': 't-t', 's': 'zz' },
	// Spoar (Aberrant): Fungal, soft, damp sounds.
	SPOAR_ABBERANT_SUBSTITUTE: { 's': 'sh', 'p': 'sp', 'o': 'oar' },
	// Gloop (Aberrant): Wet, bubbling sounds.
	GLOOP_ABBERANT_SUBSTITUTE: { 'g': 'gl', 'b': 'bl', 'o': 'oo' },

	// Umbral (Nocturne): Fading, soft sounds.
	UMBRAL_NOCTURNE_SUBSTITUTE: { 's': 'shh', 'd': 'thh', 'o': 'ohh' },
	// Sanguine (Nocturne): Formal, gothic, sibilant sounds.
	SANGUINE_NOCTURNE_SUBSTITUTE: { 's': 'z', 'v': 'vz', 'th': 'zth' },
};

/**
 * Encodes cleartext into a specified fictional language while preserving markdown.
 * @param {string} text - The original English text.
 * @param {string} languageType - The scramble_type from the database.
 * @returns {string} The encoded (scrambled) text.
 */
function encode(text, languageType) {
	// Special case for Primordial, which has its own complex rules.
	if (languageType === 'PRIMORDIAL_SELF_SUBSTITUTE') {
		return text.split(' ').map(word => {
			if (word.length > 5) return word.split('').reverse().join('');
			if (word.length > 2) return word.split('').join('-');
			return word + '\'';
		}).join(' ');
	}

	const dictionary = dictionaries[languageType];

	if (!dictionary) {
		// Fallback for languages without a specific dictionary yet (e.g., Pig Latin)
		return text.split(' ').map(w => w.length < 2 ? w : `${w.slice(1)}${w[0]}ay`).join(' ');
	}

	// This regex is the key to preserving markdown. It matches either:
	// 1. Common markdown patterns (bold, italics, code, strikethrough, headers, list items).
	// 2. A sequence of word characters (a word).
	// 3. A sequence of non-word, non-space characters (punctuation).
	const markdownAndWordRegex = /(\*\*.*?\*\*|\*.*?\*|~~.*?~~|`.*?`|#+\s?.*?(\n|$)|-\s?.*?(\n|$)|[\w']+|[^\s\w]+)/g;
	const parts = text.match(markdownAndWordRegex) || [];

	return parts.map(part => {
		// If the part is NOT a word (i.e., it's markdown, punctuation, or a number), leave it as is.
		if (!/^[a-zA-Z']+$/.test(part)) {
			return part;
		}

		// If it IS a word, apply the translation dictionary.
		let result = part.toLowerCase();
		for (const [key, value] of Object.entries(dictionary)) {
			result = result.replace(new RegExp(key, 'g'), value);
		}
		return result;
	}).join(' ');
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