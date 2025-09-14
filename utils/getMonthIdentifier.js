// utils/getMonthIdentifier.js
function getMonthIdentifier() {
	const now = new Date();
	// Format: YYYY-MM
	return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

function getMonthName(monthNumber) {
	const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December',
	];
	return monthNames[monthNumber];
}

module.exports = { getMonthIdentifier, getMonthName };