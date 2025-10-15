function getWeekIdentifier() {
	const date = new Date();
	date.setHours(0, 0, 0, 0);
	date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
	// Nearest Thursday
	const week1 = new Date(date.getFullYear(), 0, 4);
	// First Thursday of year
	const weekNum = 1 + Math.round((date - week1) / 604800000);
	// 604800000 = 1 week in ms
	return `${weekNum.toString().padStart(2, '0')}`;
}

module.exports = getWeekIdentifier;