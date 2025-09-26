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
	// Draedic: Harsh, guttural sounds with hard consonants and jarring stops. Words are often short and forceful.
	DRAEDIC_SELF_SUBSTITUTE: {
		'from': 'krav', 'with': 'vath', 'they': 'kro', 'that': 'zoth', 'this': 'zik', 'was': 'kroz', 'will': 'g\'karr', 'have': 'h\'vok', 'not': 'n\'kar',
		'you': 'vok', 'the': 'khr', 'and': 'vath', 'are': 'kren', 'is': 'krin', 'it': 'kot', 'me': 'm\'ok', 'my': 'm\'ak', 'he': 'hrok', 'she': 's\'kro',
		'strength': 'g\'hor', 'power': 'k\'tharr', 'honor': 'g\'rak', 'battle': 'k\'rath', 'kill': 'g\'rok', 'fire': 'k\'nar', 'dark': 'd\'rok', 'blood': 'b\'lork',
		'tion': 't\'n', 'ing': 'n\'g', 'ent': 'n\'t', 'all': 'a\'k',
		'th': 'zth', 'sh': 'xsh', 'ch': 'k\'k', 'ou': 'ow\'w', 'gh': 'g\'h', 'ph': 'f\'k',
		'a': 'ahk', 'e': 'erk', 'i': 'ik', 'o': 'ok', 'u': 'uk',
		's': 'z', 'c': 'k', 'f': 'v', 'g': 'gh', 'j': 'j\'k', 'p': 'b', 't': 'd', 'w': 'v', 'y': 'i',
	},
	// Caeric: Light, airy, and sibilant, with elongated vowels and soft, flowing sounds. Words often end in vowels.
	CAERIC_SELF_SUBSTITUTE: {
		'from': 's\'ael', 'with': 'aelia', 'they': 's\'aelyn', 'that': 'th\'sae', 'this': 'th\'lia', 'was': 's\'aelin', 'will': 'linae', 'have': 'haelia', 'not': 'n\'ae',
		'you': 'aelyn', 'the': 's\'ae', 'and': 'ael', 'are': 'aelia', 'is': 's\'ae', 'it': 'lia', 'me': 'mia', 'my': 'm\'ai', 'he': 'h\'ael', 'she': 's\'aelia',
		'magic': 'aelune', 'light': 'linae', 'forest': 'sylvanis', 'star': 'asteria', 'moon': 'lunia', 'wind': 'aella', 'song': 'lyrae',
		'tion': 'tian', 'ing': 'in\'ae', 'ent': 'aen', 'all': 'ael',
		'ee': 'eae', 'oo': 'oe', 'th': 's\'th', 'sh': 's\'h', 'ch': 's\'c', 'ph': 'f\'ae', 'st': 's\'t',
		'a': 'ai', 'e': 'ae', 'i': 'ia', 'o': 'oa', 'u': 'iu',
		's': 's\'s', 'f': 'f\'f', 'l': 'l\'l', 'p': 'ph', 't': 'th', 'k': 'c', 'g': 'gh',
	},
	// Primordial: Chaotic and alien, mixing reversals, strange separators, and non-standard characters.
	PRIMORDIAL_SELF_SUBSTITUTE: {
		'from': 'morf~', 'with': 'h~tiw', 'they': 'yeht^', 'that': 'ta-ht', 'this': 's^ih', 'was': 's-aw', 'will': '~lliw', 'have': 'ev^ah', 'not': 't-on',
		'you': 'u-oy', 'the': 'eht^', 'and': '~dna', 'are': 'e^ra', 'is': 's-i', 'it': 't^i', 'me': 'e^m', 'my': 'y-m', 'he': 'e~h', 'she': 'e-hs',
		'chaos': 'soahk~', 'power': 'rew-op', 'world': 'dlor-w', 'time': 'em-it', 'space': 'ecaps^', 'form': 'mrof~', 'void': 'di-ov',
		'tion': 'n-oit', 'ing': 'g^ni', 'ent': 't-ne', 'all': '~lla',
		'th': '^ht', 'sh': 'hs~', 'ch': '~hc', 'ou': 'o-u', 'er': 'r-e', 'st': 't^s',
		'a': 'a^a', 'e': 'e-e', 'i': 'i^i', 'o': 'o-o', 'u': 'u^u',
		's': 's~', 'c': 'k^', 'g': 'g-', 'p': 'p^', 'd': 'd~', 'r': '~r',
	},
	// Bestial: Simple, guttural, using clicks and hard consonant pairs. Less about growls, more about a primitive but consistent language.
	BESTIAL_SELF_SUBSTITUTE: {
		'from': 't\'ka', 'with': 'n\'ta', 'they': 'tok', 'that': 'k\'ta', 'this': 'g\'ta', 'was': 't\'ok', 'will': 'n\'gar', 'have': 'h\'ak', 'not': 'k\'nar',
		'you': 'tuk', 'the': 'uk', 'and': 'g\'n', 'are': 'tok', 'is': 'guk', 'it': 'tik', 'me': 'mok', 'my': 'm\'ka', 'he': 'huk', 'she': 's\'ka',
		'hunt': 'grah', 'blood': 'klat', 'beast': 'k\'tok', 'claw': 'k\'lak', 'prey': 'p\'rak', 'territory': 'g\'tarr', 'pack': 'p\'ak',
		'tion': 't\'on', 'ing': 'n\'g', 'ent': 'n\'t', 'all': 'a\'k',
		'th': 't\'k', 'sh': 'shk', 'ch': 't\'ch', 'er': 'arr', 'ou': 'uk', 'st': 's\'k',
		'a': 'a', 'e': 'e', 'i': 'i', 'o': 'o', 'u': 'u',
		's': 'ss', 'r': 'rr', 'g': 'g\'k', 'b': 'b\'k', 'k': 'k\'t', 'p': 'p\'t', 'd': 'd\'k', 'f': 'f\'k',
	},
	// Aberrant: Unsettling and disjointed, with glottal stops, reversed pairs, and a stuttering rhythm.
	ABERRANT_SELF_SUBSTITUTE: {
		'from': 'morf', 'with': 'h\'tiw', 'they': 'y\'eht', 'that': 't\'aht', 'this': 's\'iht', 'was': 's\'aw', 'will': 'l\'liw', 'have': 'e\'vah', 'not': 't\'on',
		'you': 'ouy', 'the': 'eht', 'and': 'd\'na', 'are': 'e\'ra', 'is': 's\'i', 'it': 't\'i', 'me': 'e\'m', 'my': 'y\'m', 'he': 'e\'h', 'she': 'e\'hs',
		'flesh': 'h\'self', 'mind': 'd\'nim', 'dream': 'm\'aerd', 'fear': 'r\'aef', 'truth': 'h\'turt', 'lie': 'e\'il', 'eye': 'e\'ye',
		'tion': 'n\'oit', 'ing': 'g\'ni', 'ent': 't\'ne', 'all': 'l\'la',
		'ae': 'e\'a', 'ie': 'e\'i', 'ou': 'u\'o', 'ea': 'a\'e', 'oi': 'i\'o', 'ai': 'i\'a',
		'th': 'ht', 'sh': 'hs', 'ch': 'hc', 'ph': 'hp', 'gh': 'hg',
		'a': 'a\'a', 'e': 'e\'e', 'i': 'i\'i', 'o': 'o\'o', 'u': 'u\'u',
		'q': 'k\'q', 'x': 'k\'s', 'b': 'p\'b', 'd': 't\'d', 'g': 'k\'g', 'v': 'f\'v',
	},
	// Nocturne: Hushed, whispered, with elongated sibilants and soft, breathy consonants.
	NOCTURNE_SELF_SUBSTITUTE: {
		'from': 'phromh', 'with': 'shith', 'they': 'zheyh', 'that': 'zhath', 'this': 'zhis', 'was': 'shaz', 'will': 'shael', 'have': 'havh', 'not': 'noth',
		'you': 'shu', 'the': 'sheth', 'and': 'za', 'are': 'ahr', 'is': 'izh', 'it': 'hith', 'me': 'shem', 'my': 'shy', 'he': 'zhe', 'she': 'shae',
		'shadow': 'sshumbrath', 'night': 'nothyz', 'blood': 'ssanguineh', 'secret': 'shekreth', 'whisper': 'shisphur', 'dust': 'dushz', 'fear': 'pheer',
		'tion': 'shon', 'ing': 'ingh', 'ent': 'enth', 'all': 'ahll',
		's': 'sss', 'z': 'zh', 'f': 'ph', 'v': 'vh', 'th': 'thz', 'sh': 'shhh', 'wh': 'whh',
		'a': 'ah', 'e': 'eh', 'i': 'ih', 'o': 'oh', 'u': 'uh',
		'd': 'th', 'g': 'gh', 't': 'th', 'k': 'kh', 'p': 'ph', 'b': 'bh',
	},

	// --- DIALECTS ---
	// Ignic (Primordial): Crackling, hissing fire sounds. Modifies the chaotic output of Primordial.
	IGNIC_PRIMORDIAL_SUBSTITUTE: { 's': 'sh', 'f': 'fsh', 'k': 'kss', 'h': 'hss', 't': 'tsh', 'z': 'zzs', '^': '`', '-': '\'' },
	// Auric (Primordial): Rushing, breathy wind sounds.
	AURIC_PRIMORDIAL_SUBSTITUTE: { 's': 'swh', 'f': 'wh', 'r': 'rh', 'p': 'phw', 'k': 'khw', 'h': 'hh', 't': 'thw' },
	// Aquic (Primordial): Bubbling, flowing water sounds.
	AQUIC_PRIMORDIAL_SUBSTITUTE: { 'b': 'bl', 'g': 'gl', 's': 'sl', 'p': 'pl', 'm': 'ml', 'd': 'dr', 'k': 'kl' },
	// Ferric (Primordial): Grinding, metallic sounds.
	FERRIC_PRIMORDIAL_SUBSTITUTE: { 'g': 'grn', 'k': 'krn', 't': 'trn', 's': 'szk', 'd': 'drn', 'r': 'rrn', 'b': 'brn' },
	// Sylvic (Primordial): Rustling, wooden sounds.
	SYLVIC_PRIMORDIAL_SUBSTITUTE: { 's': 'shh', 'w': 'wh', 'f': 'ffr', 'r': 'rrh', 'b': 'brr', 'p': 'pfr', 't': 'tr' },

	// Vulpis (Bestial): Yips and sharp 'y' sounds. Modifies the guttural output of Bestial.
	VULPIS_BESTIAL_SUBSTITUTE: { 's': 'ss\'y', 'a': 'ayip', 'o': 'yow', 'e': 'yip', 'k\'t': 'kyip' },
	// Felis (Bestial): Hissing and purring sounds.
	FELIS_BESTIAL_SUBSTITUTE: { 's': 'sss', 'r': 'mrr', 'f': 'fff', 'p': 'prr', 'h': 'hss' },
	// Chelis (Bestial): Slow, hard, deliberate clicks.
	CHELIS_BESTIAL_SUBSTITUTE: { 't': 't\'k', 'd': 'd\'g', 's': 'shk', 'k': 'k\'t', 'g': 'g\'d' },
	// Canis (Bestial): Low growls and sharp barks.
	CANIS_BESTIAL_SUBSTITUTE: { 'b': 'brf', 'w': 'woof', 'gr': 'grrf', 'h': 'huff', 'r': 'rrr' },
	// Lapis (Bestial): Quick, soft, thumping sounds.
	LAPIS_BESTIAL_SUBSTITUTE: { 'p': 'pth', 'b': 'bth', 'th': 'thump', 'd': 'dth', 't': 't-thump' },

	// Klang (Aberrant): Mechanical, clicking sounds. Modifies the disjointed output of Aberrant.
	KLANG_ABBERANT_SUBSTITUTE: { 'c': 'kl', 'k': 'kl', 't': 't-t', 's': 'zz', 'r': 'rrr-t', 'p\'b': 'kl-b' },
	// Spoar (Aberrant): Fungal, soft, damp sounds.
	SPOAR_ABBERANT_SUBSTITUTE: { 's': 'sh', 'p': 'sp', 'o': 'oar', 'f': 'phl', 'm': 'mph' },
	// Gloop (Aberrant): Wet, bubbling sounds.
	GLOOP_ABBERANT_SUBSTITUTE: { 'g': 'gl', 'b': 'bl', 'o': 'oo', 'p': 'plb', 's': 'spl' },

	// Umbral (Nocturne): Fading, soft sounds, trailing off. Modifies the whispered output of Nocturne.
	UMBRAL_NOCTURNE_SUBSTITUTE: { 's': 'shh', 'd': 'thh', 'o': 'ohh', 'th': 'thh...', 'z': 'zhh...' },
	// Sanguine (Nocturne): Formal, gothic, sharp sibilants.
	SANGUINE_NOCTURNE_SUBSTITUTE: { 's': 'z', 'v': 'vz', 'th': 'zth', 'f': 'v', 'p': 'b', 't': 'd' },
};

/**
 * Encodes cleartext into a specified fictional language while preserving markdown.
 * Implements a two-pass system for dialects (Parent Language -> Dialect).
 * @param {string} text - The original English text.
 * @param {string} languageType - The scramble_type from the database.
 * @returns {string} The encoded (scrambled) text.
 */
function encode(text, languageType) {
	// --- Step 1: Identify if it's a dialect and get the correct dictionary/dictionaries ---
	const DIALECT_PARENTS = ['PRIMORDIAL', 'BESTIAL', 'ABBERANT', 'NOCTURNE'];
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

	// This regex splits the string by markdown delimiters, but keeps them in the array.
	// It prioritizes code blocks to treat them as a single, untranslatable unit.
	// Then it looks for other markdown symbols, newlines, and spaces as delimiters.
	const delimiterRegex = /(```[\s\S]*?```|`[^`]*?`|\s+|[^\w\s*`~|_#>\-+\\]+)/g;
	const parts = text.split(delimiterRegex).filter(part => part);

	const applyDictionary = (content, dictionary) => {
		let result = content.toLowerCase();
		for (const [key, value] of Object.entries(dictionary)) {
			const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			result = result.replace(new RegExp(escapedKey, 'g'), value);
		}
		return result;
	};

	return parts.map(part => {
		// Test if the part is a word (contains only letters and maybe an apostrophe).
		// We exclude anything that looks like a markdown delimiter, is a code block,
		// is purely whitespace, or is punctuation.
		if (/^[a-zA-Z']+$/.test(part)) {
			// It's a word, so translate it.
			let translatedPart = applyDictionary(part, parentDictionary);

			if (dialectDictionary) {
				// If it's a dialect, apply the second pass.
				translatedPart = applyDictionary(translatedPart, dialectDictionary);
			}
			return translatedPart;
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

module.exports = { encode, decodeByWits };