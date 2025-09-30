// utils/messageUtils.js

/**
 * Splits a long string into an array of smaller strings, each under a specified length.
 * It intelligently splits at the last whitespace character to avoid breaking words.
 * @param {string} text The long string to split.
 * @param {number} [maxLength=2000] The maximum length for each chunk.
 * @returns {string[]} An array of string chunks.
 */
function splitMessage(text, maxLength = 2000) {
	if (text.length <= maxLength) {
		return [text];
	}

	const chunks = [];
	let currentChunk = text;

	while (currentChunk.length > 0) {
		if (currentChunk.length <= maxLength) {
			chunks.push(currentChunk);
			break;
		}

		let splitPos = currentChunk.lastIndexOf(' ', maxLength);
		if (splitPos === -1) {
			// If no space is found, check for a newline
			splitPos = currentChunk.lastIndexOf('\n', maxLength);
		}
		if (splitPos === -1) {
			// If no natural break point is found, hard split at the max length
			splitPos = maxLength;
		}

		chunks.push(currentChunk.substring(0, splitPos));
		currentChunk = currentChunk.substring(splitPos).trim();
	}

	return chunks;
}

module.exports = { splitMessage };