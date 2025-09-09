// utils/betaLock.js

const BETA_TESTER_ROLE_ID = '1414796278008774736';

const lockedCommands = [
	'character.js',
	'inventory.js',
	'pve.js',
	'craft.js',
	'market.js',
	'shop.js',
];

/**
 * Checks if a command is locked for beta testing and if the user has permission to use it.
 * @param {string} commandFilename - The filename of the command being executed (e.g., 'character.js').
 * @param {import('discord.js').Interaction} interaction - The interaction object from the command.
 * @returns {boolean} Returns `true` if access is DENIED, `false` if access is ALLOWED.
 */
function checkBetatestLock(commandFilename, interaction) {
	// First, check if the command being run is on our list of locked features.
	const isCommandLocked = lockedCommands.includes(commandFilename);

	// If the command is not on the list, it's a public feature. Allow access for everyone.
	if (!isCommandLocked) {
		// Access ALLOWED
		return false;
	}

	// The command is locked. Now, check if the user has the beta tester role.
	// We use the roles cache on the member object for an efficient check.
	const isUserBetaTester = interaction.member.roles.cache.has(BETA_TESTER_ROLE_ID);

	// If the user has the role, they are a beta tester. Allow access.
	if (isUserBetaTester) {
		// Access ALLOWED
		return false;
	}

	// If the command is locked and the user does NOT have the role, deny access.
	// Access DENIED
	return true;
}

module.exports = { checkBetatestLock };