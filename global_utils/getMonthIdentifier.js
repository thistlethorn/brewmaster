/**
 * Produce the current year and month as a hyphen-separated identifier.
 * @returns {string} The current year and month in the format "YYYY-MM" (e.g., "2025-10").
 */
function getMonthIdentifier() {
	const now = new Date();
	// Format: YYYY-MM
	return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

/**
 * Return the English month name for a zero-based month index.
 * @param {number} monthNumber - The zero-based month index (0 = January, 11 = December).
 * @returns {string|undefined} The month name for the given index, or `undefined` if the index is outside 0–11.
 */
function getMonthName(monthNumber) {
	const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December',
	];
	return monthNames[monthNumber];
}

module.exports = { getMonthIdentifier, getMonthName };