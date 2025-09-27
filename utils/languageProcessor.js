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
		'th': 'zth', 'sh': 'xsh', 'ch': 'k\'k', 'ou': 'ow\'w', 'gh': 'g\'h', 'ph': 'f\'k', 'er': 'r\'k', 'st': 's\'d',
		'a': 'ahk', 'b': 'p', 'c': 'k', 'd': 't', 'e': 'erk', 'f': 'v', 'g': 'gh', 'h': 'h\'r', 'i': 'ik', 'j': 'j\'k', 'k': 'k\'r', 'l': 'l\'g', 'm': 'm\'r',
		'n': 'n\'g', 'o': 'ok', 'p': 'b', 'q': 'q\'k', 'r': 'r\'k', 's': 'z', 't': 'd', 'u': 'uk', 'v': 'v\'k', 'w': 'v', 'x': 'x\'k', 'y': 'i', 'z': 'z\'g',
	},
	// Caeric: Light, airy, and sibilant, with elongated vowels and soft, flowing sounds. Words often end in vowels.
	CAERIC_SELF_SUBSTITUTE: {
		'from': 's\'ael', 'with': 'aelia', 'they': 's\'aelyn', 'that': 'th\'sae', 'this': 'th\'lia', 'was': 's\'aelin', 'will': 'linae', 'have': 'haelia', 'not': 'n\'ae',
		'you': 'aelyn', 'the': 's\'ae', 'and': 'ael', 'are': 'aelia', 'is': 's\'ae', 'it': 'lia', 'me': 'mia', 'my': 'm\'ai', 'he': 'h\'ael', 'she': 's\'aelia',
		'magic': 'aelune', 'light': 'linae', 'forest': 'sylvanis', 'star': 'asteria', 'moon': 'lunia', 'wind': 'aella', 'song': 'lyrae',
		'tion': 'tian', 'ing': 'in\'ae', 'ent': 'aen', 'all': 'ael',
		'ee': 'eae', 'oo': 'oe', 'th': 's\'th', 'sh': 's\'h', 'ch': 's\'c', 'ph': 'f\'ae', 'st': 's\'t', 'er': 'aer', 'ay': 'ai\'e',
		'a': 'ai', 'b': 'bh', 'c': 'c\'h', 'd': 'dh', 'e': 'ae', 'f': 'f\'f', 'g': 'gh', 'h': 'h\'a', 'i': 'ia', 'j': 'j\'ae', 'k': 'c', 'l': 'l\'l', 'm': 'mh',
		'n': 'n\'h', 'o': 'oa', 'p': 'ph', 'q': 'quae', 'r': 'rh', 's': 's\'s', 't': 'th', 'u': 'iu', 'v': 'vh', 'w': 'w\'h', 'x': 'x\'ae', 'y': 'y\'a', 'z': 'z\'h',
	},
	// Primordial: Chaotic and alien, mixing reversals, strange separators, and non-standard characters.
	PRIMORDIAL_SELF_SUBSTITUTE: {
		'from': 'morf~', 'with': 'h~tiw', 'they': 'yeht^', 'that': 'ta-ht', 'this': 's^ih', 'was': 's-aw', 'will': '~lliw', 'have': 'ev^ah', 'not': 't-on',
		'you': 'u-oy', 'the': 'eht^', 'and': '~dna', 'are': 'e^ra', 'is': 's-i', 'it': 't^i', 'me': 'e^m', 'my': 'y-m', 'he': 'e~h', 'she': 'e-hs',
		'chaos': 'soahk~', 'power': 'rew-op', 'world': 'dlor-w', 'time': 'em-it', 'space': 'ecaps^', 'form': 'mrof~', 'void': 'di-ov',
		'tion': 'n-oit', 'ing': 'g^ni', 'ent': 't-ne', 'all': '~lla',
		'th': '^ht', 'sh': 'hs~', 'ch': '~hc', 'ou': 'o-u', 'er': 'r-e', 'st': 't^s',
		'a': 'a^a', 'b': 'b~b', 'c': 'k^', 'd': 'd~', 'e': 'e-e', 'f': 'f-h', 'g': 'g-', 'h': 'h^h', 'i': 'i^i', 'j': 'j-g', 'k': 'k^k', 'l': 'l~l', 'm': 'm-m',
		'n': 'n~n', 'o': 'o-o', 'p': 'p^', 'q': 'q^k', 'r': '~r', 's': 's~', 't': 't-t', 'u': 'u^u', 'v': 'v^h', 'w': 'w-w', 'x': 'x-s', 'y': 'y~y', 'z': 'z-z',
	},
	// Bestial: Simple, guttural, using clicks and hard consonant pairs. Less about growls, more about a primitive but consistent language.
	BESTIAL_SELF_SUBSTITUTE: {
		'from': 't\'ka', 'with': 'n\'ta', 'they': 'tok', 'that': 'k\'ta', 'this': 'g\'ta', 'was': 't\'ok', 'will': 'n\'gar', 'have': 'h\'ak', 'not': 'k\'nar',
		'you': 'tuk', 'the': 'uk', 'and': 'g\'n', 'are': 'tok', 'is': 'guk', 'it': 'tik', 'me': 'mok', 'my': 'm\'ka', 'he': 'huk', 'she': 's\'ka',
		'hunt': 'grah', 'blood': 'klat', 'beast': 'k\'tok', 'claw': 'k\'lak', 'prey': 'p\'rak', 'territory': 'g\'tarr', 'pack': 'p\'ak',
		'tion': 't\'on', 'ing': 'n\'g', 'ent': 'n\'t', 'all': 'a\'k',
		'th': 't\'k', 'sh': 'shk', 'ch': 't\'ch', 'er': 'arr', 'ou': 'uk', 'st': 's\'k',
		'a': 'a', 'b': 'b\'k', 'c': 'k\'t', 'd': 'd\'k', 'e': 'e', 'f': 'f\'k', 'g': 'g\'k', 'h': 'h\'k', 'i': 'i', 'j': 'j\'k', 'k': 'k\'t', 'l': 'l\'k', 'm': 'm\'k',
		'n': 'n\'k', 'o': 'o', 'p': 'p\'t', 'q': 'q\'k', 'r': 'rr', 's': 'ss', 't': 't\'k', 'u': 'u', 'v': 'v\'k', 'w': 'w\'k', 'x': 'x\'k', 'y': 'y\'k', 'z': 'z\'k',
	},
	// Aberrant: Unsettling and disjointed, with glottal stops, reversed pairs, and a stuttering rhythm.
	ABERRANT_SELF_SUBSTITUTE: {
		'from': 'morf', 'with': 'h\'tiw', 'they': 'y\'eht', 'that': 't\'aht', 'this': 's\'iht', 'was': 's\'aw', 'will': 'l\'liw', 'have': 'e\'vah', 'not': 't\'on',
		'you': 'ouy', 'the': 'eht', 'and': 'd\'na', 'are': 'e\'ra', 'is': 's\'i', 'it': 't\'i', 'me': 'e\'m', 'my': 'y\'m', 'he': 'e\'h', 'she': 'e\'hs',
		'flesh': 'h\'self', 'mind': 'd\'nim', 'dream': 'm\'aerd', 'fear': 'r\'aef', 'truth': 'h\'turt', 'lie': 'e\'il', 'eye': 'e\'ye',
		'tion': 'n\'oit', 'ing': 'g\'ni', 'ent': 't\'ne', 'all': 'l\'la',
		'ae': 'e\'a', 'ie': 'e\'i', 'ou': 'u\'o', 'ea': 'a\'e', 'oi': 'i\'o', 'ai': 'i\'a',
		'th': 'ht', 'sh': 'hs', 'ch': 'hc', 'ph': 'hp', 'gh': 'hg', 'er': 're',
		'a': 'a\'a', 'b': 'p\'b', 'c': 'k\'c', 'd': 't\'d', 'e': 'e\'e', 'f': 'v\'f', 'g': 'k\'g', 'h': 'h\'h', 'i': 'i\'i', 'j': 'j\'j', 'k': 'g\'k', 'l': 'l\'l', 'm': 'm\'m',
		'n': 'n\'n', 'o': 'o\'o', 'p': 'b\'p', 'q': 'k\'q', 'r': 'r\'r', 's': 's\'s', 't': 'd\'t', 'u': 'u\'u', 'v': 'f\'v', 'w': 'w\'w', 'x': 'k\'s', 'y': 'y\'y', 'z': 'z\'z',
	},
	// Nocturne: Hushed, whispered, with elongated sibilants and soft, breathy consonants.
	NOCTURNE_SELF_SUBSTITUTE: {
		'from': 'phromh', 'with': 'shith', 'they': 'zheyh', 'that': 'zhath', 'this': 'zhis', 'was': 'shaz', 'will': 'shael', 'have': 'havh', 'not': 'noth',
		'you': 'shu', 'the': 'sheth', 'and': 'za', 'are': 'ahr', 'is': 'izh', 'it': 'hith', 'me': 'shem', 'my': 'shy', 'he': 'zhe', 'she': 'shae',
		'shadow': 'sshumbrath', 'night': 'nothyz', 'blood': 'ssanguineh', 'secret': 'shekreth', 'whisper': 'shisphur', 'dust': 'dushz', 'fear': 'pheer',
		'tion': 'shon', 'ing': 'ingh', 'ent': 'enth', 'all': 'ahll',
		's': 'sss', 'z': 'zh', 'f': 'ph', 'v': 'vh', 'th': 'thz', 'sh': 'shhh', 'wh': 'whh', 'er': 'erh',
		'a': 'ah', 'b': 'bh', 'c': 'kh', 'd': 'th', 'e': 'eh', 'g': 'gh', 'h': 'h\'', 'i': 'ih', 'j': 'zh', 'k': 'kh', 'l': 'lh', 'm': 'mh', 'n': 'nh',
		'o': 'oh', 'p': 'ph', 'q': 'q\'h', 'r': 'rh', 't': 'th', 'u': 'uh', 'w': 'wh', 'x': 'xzh', 'y': 'yh',
	},

	// --- DIALECTS ---
	// Ignic (Primordial): Crackling, hissing fire sounds. Modifies the chaotic output of Primordial.
	IGNIC_PRIMORDIAL_SUBSTITUTE: { 's': 'sh', 'f': 'fsh', 'k': 'kss', 'h': 'hss', 't': 'tsh', 'z': 'zzs', '^': '`', '-': '\'', 'a': 'ash', 'e': 'esh', 'o': 'osh', 'u': 'ush', 'b':'bsh', 'r':'rsh', 'c':'css' },
	// Auric (Primordial): Rushing, breathy wind sounds.
	AURIC_PRIMORDIAL_SUBSTITUTE: { 's': 'swh', 'f': 'wh', 'r': 'rh', 'p': 'phw', 'k': 'khw', 'h': 'hh', 't': 'thw', 'a':'ahw', 'e':'ehw', 'i':'ihw', 'o':'ohw', 'u':'uhw', 'sh':'shwh' },
	// Aquic (Primordial): Bubbling, flowing water sounds.
	AQUIC_PRIMORDIAL_SUBSTITUTE: { 'b': 'bl', 'g': 'gl', 's': 'sl', 'p': 'pl', 'm': 'ml', 'd': 'dr', 'k': 'kl', 'f':'fl', 't':'tr', 'w':'wl', 'o':'obl', 'u':'ubl' },
	// Ferric (Primordial): Grinding, metallic sounds.
	FERRIC_PRIMORDIAL_SUBSTITUTE: { 'g': 'grn', 'k': 'krn', 't': 'trn', 's': 'szk', 'd': 'drn', 'r': 'rrn', 'b': 'brn', 'c':'crn', 'f':'frn', 'm':'mrn', 'p':'prn', 'l':'lrn', 'z':'zrn' },
	// Sylvic (Primordial): Rustling, wooden sounds.
	SYLVIC_PRIMORDIAL_SUBSTITUTE: { 's': 'shh', 'w': 'wh', 'f': 'ffr', 'r': 'rrh', 'b': 'brr', 'p': 'pfr', 't': 'tr', 'd':'drr', 'g':'ghr', 'k':'krh', 'l':'lsh', 'm':'mwh', 'n':'nh' },

	// Vulpis (Bestial): Yips and sharp 'y' sounds. Modifies the guttural output of Bestial.
	VULPIS_BESTIAL_SUBSTITUTE: { 's': 'ss\'y', 'a': 'ayip', 'o': 'yow', 'e': 'yip', 'k\'t': 'kyip', 'g':'yak', 't':'yak', 'r':'ryip', 'b':'b-yip', 'd':'d-yip', 'f':'yif', 'h':'yah', 'l':'yal', 'n':'yan' },
	// Felis (Bestial): Hissing and purring sounds.
	FELIS_BESTIAL_SUBSTITUTE: { 's': 'sss', 'r': 'mrr', 'f': 'fff', 'p': 'prr', 'h': 'hss', 'c':'hss', 't':'sss', 'w':'mrr', 'm':'mmm', 'b':'mrr', 'd':'sss', 'g':'mrr', 'l':'mrr', 'n':'mrr', 'v':'fff' },
	// Chelis (Bestial): Slow, hard, deliberate clicks.
	CHELIS_BESTIAL_SUBSTITUTE: { 't': 't\'k', 'd': 'd\'g', 's': 'shk', 'k': 'k\'t', 'g': 'g\'d', 'b':'b\'k', 'c':'k\'k', 'p':'p\'t', 'f':'f\'k', 'j':'j\'g', 'l':'l\'k', 'm':'m\'g', 'n':'n\'k', 'r':'r\'g', 'v':'v\'k', 'z':'z\'g' },
	// Canis (Bestial): Low growls and sharp barks.
	CANIS_BESTIAL_SUBSTITUTE: { 'b': 'brf', 'w': 'woof', 'gr': 'grrf', 'h': 'huff', 'r': 'rrr', 'a':'arf', 'o':'borf', 'd':'arf', 'f':'woof', 'k':'bark', 'l':'grr', 'm':'arf', 'p':'bark', 't':'grr' },
	// Lapis (Bestial): Quick, soft, thumping sounds.
	LAPIS_BESTIAL_SUBSTITUTE: { 'p': 'pth', 'b': 'bth', 'th': 'thump', 'd': 'dth', 't': 't-thump', 'o':'oth', 'u':'uth', 'h':'h-th', 'c':'thump', 'f':'fth', 'g':'gth', 'k':'kth', 'l':'lth', 'm':'mth', 'n':'nth', 'r':'rth', 's':'sth' },

	// Klang (Aberrant): Mechanical, clicking sounds. Modifies the disjointed output of Aberrant.
	KLANG_ABERRANT_SUBSTITUTE: { 'c': 'kl', 'k': 'kl', 't': 't-t', 's': 'zz', 'r': 'rrr-t', 'p\'b': 'kl-b', 'g':'k-g', 'z':'zz-t', 'b':'b-b', 'd':'d-d', 'f':'f-f', 'h':'h-h', 'j':'j-j', 'l':'l-l', 'm':'m-m', 'n':'n-n', 'v':'v-v' },
	// Spoar (Aberrant): Fungal, soft, damp sounds.
	SPOAR_ABERRANT_SUBSTITUTE: { 's': 'sh', 'p': 'sp', 'o': 'oar', 'f': 'phl', 'm': 'mph', 'b':'sph', 'd':'shl', 'g':'sphl', 't':'sh', 'c':'sh', 'h':'shl', 'k':'sh', 'l':'shl', 'n':'mph', 'r':'oar', 'v':'phl' },
	// Gloop (Aberrant): Wet, bubbling sounds.
	GLOOP_ABERRANT_SUBSTITUTE: { 'g': 'gl', 'b': 'bl', 'o': 'oo', 'p': 'plb', 's': 'spl', 'd':'bl', 'l':'gl', 'm':'bl', 'c':'gl', 'f':'bl', 'h':'bl', 'k':'gl', 'n':'spl', 'r':'oo', 't':'spl', 'v':'bl', 'w':'gl' },

	// Umbral (Nocturne): Fading, soft sounds, trailing off. Modifies the whispered output of Nocturne.
	UMBRAL_NOCTURNE_SUBSTITUTE: { 's': 'shh', 'd': 'thh', 'o': 'ohh', 'th': 'thh...', 'z': 'zhh...', 'a':'ahh...', 'e':'ehh...', 'h':'...', 'i':'ihh...', 't':'th...', 'b':'bh...', 'f':'ph...', 'g':'ghh...', 'k':'kh...', 'l':'lh...', 'm':'mh...', 'n':'nh...', 'p':'ph...', 'r':'rhh...', 'v':'vh...', 'w':'whh...' },
	// Sanguine (Nocturne): Formal, gothic, sharp sibilants.
	SANGUINE_NOCTURNE_SUBSTITUTE: { 's': 'z', 'v': 'vz', 'th': 'zth', 'f': 'v', 'p': 'b', 't': 'd', 'a':'ah', 'e':'eh', 'i':'i', 'o':'o', 'u':'u', 'b':'v', 'c':'z', 'g':'k', 'h':'h\'', 'j':'z', 'k':'c', 'l':'ll', 'm':'mm', 'n':'nn', 'q':'k', 'r':'rr', 'w':'v', 'x':'z', 'y':'i', 'z':'zz' },
};

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

	// This regex splits the string by markdown delimiters, but keeps them in the array.
	// It prioritizes code blocks to treat them as a single, untranslatable unit.
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
		if (/^[a-zA-Z']+$/.test(part)) {
			// It's a word.
			const originalWord = part;

			// 1. Determine the capitalization style of the original word.
			// We check length > 1 to treat single-letter words like "A" as Title Case, not ALL CAPS.
			const isAllCaps = originalWord.length > 1 && originalWord === originalWord.toUpperCase();
			const isTitleCase = !isAllCaps && originalWord[0] === originalWord[0].toUpperCase();

			// 2. Translate the word using the lowercase-based logic.
			let translatedWord = applyDictionary(originalWord, parentDictionary);
			if (dialectDictionary) {
				// If it's a dialect, apply the second pass.
				translatedWord = applyDictionary(translatedWord, dialectDictionary);
			}

			// 3. Re-apply the original capitalization style.
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

module.exports = { encode, decodeByWits };