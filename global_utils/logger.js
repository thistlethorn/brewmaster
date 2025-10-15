// ANSI color codes
const COLORS = {
	reset: '\x1b[0m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
};

/**
 * A simple logger utility to add color to console output.
 */
const log = {
	/**
     * Logs a standard informational message (cyan).
     * @param {...any} args The message parts to log.
     */
	info: (...args) => {
		console.log(`${COLORS.cyan}%s${COLORS.reset}`, ...args);
	},

	/**
     * Logs a success message (green).
     * @param {...any} args The message parts to log.
     */
	success: (...args) => {
		console.log(`${COLORS.green}%s${COLORS.reset}`, ...args);
	},

	/**
     * Logs a warning message (yellow).
     * @param {...any} args The message parts to log.
     */
	warn: (...args) => {
		console.warn(`${COLORS.yellow}%s${COLORS.reset}`, ...args);
	},

	/**
     * Logs an error message (red).
     * @param {...any} args The message parts to log.
     */
	error: (...args) => {
		console.error(`${COLORS.red}%s${COLORS.reset}`, ...args);
	},

	/**
     * Logs a debug message (magenta).
     * @param {...any} args The message parts to log.
     */
	debug: (...args) => {
		console.log(`${COLORS.magenta}%s${COLORS.reset}`, ...args);
	},

	/**
     * Logs a special message (blue).
     * @param {...any} args The message parts to log.
     */
	special: (...args) => {
		console.log(`${COLORS.blue}%s${COLORS.reset}`, ...args);
	},

	/**
     * Logs a basic message (no color).
     * @param {...any} args The message parts to log.
     */
	basic: (...args) => {
		console.log(...args);
	},
};

module.exports = log;