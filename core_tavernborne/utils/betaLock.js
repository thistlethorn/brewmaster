// utils/betaLock.js

const config = require('@root/config.json');
const BETA_TESTER_ROLE_ID = '1414796278008774736';
const GUILD_ID = config.guildId;

const lockedCommands = [
	'character.js',
	'inventory.js',
	'pve.js',
	'craft.js',
	'market.js',
	'shop.js',
];

/**
 * Resolve a GuildMember from an Interaction, Message, or Client context.
 * @param {import('discord.js').Interaction|import('discord.js').Message|import('discord.js').Client} source - The source to resolve the member from.
 * @param {string} [userId] - User ID to fetch; when provided, returns that member instead of the invoking member.
 * @returns {Promise<import('discord.js').GuildMember|null>} The resolved GuildMember, or `null` if the member cannot be resolved.
 */
async function getMember(source, userId) {
	// Case 1: Source is an Interaction or Message.
	if (source?.guild) {
		try {
			// If a specific userId is provided, ALWAYS prioritize fetching that user.
			// This is crucial for admin commands that target other users.
			if (userId) {
				return await source.guild.members.fetch(userId);
			}
			// If no specific userId is given, fall back to the person who initiated the action.
			return source.member;
		}
		catch (error) {
			console.error(`[betaLock.getMember] Failed to fetch member ${userId} from guild:`, error);
			return null;
		}
	}

	// Case 2: Source is the Client itself. We must fetch the member.
	if (source?.ws && userId) {
		try {
			const guild = await source.guilds.fetch(GUILD_ID);
			// Fetching from the guild is more reliable than from the cache.
			const member = await guild.members.fetch(userId);
			return member;
		}
		catch (error) {
			// Fail closed by returning null
			console.error(`[betaLock.getMember] Failed to fetch member ${userId}:`, error);
			return null;
		}
	}

	// If the source is unknown or userId is missing for the client, return null.
	return null;
}

/**
 * Determine whether access should be blocked by the beta-testing lock.
 *
 * @param {Client|Interaction|Message} inputSource - The interaction, message, or client used to resolve the member.
 * @param {string|null} commandFilename - The command filename to check, or null to only check beta-tester status.
 * @param {string|null} [userIdForClient] - User ID required when `inputSource` is a Client to fetch that member.
 * @returns {boolean} `true` if access is DENIED, `false` if ALLOWED.
 */
async function checkBetatestLock(inputSource, commandFilename = null, userIdForClient = null) {
	const member = await getMember(inputSource, userIdForClient);

	if (!member) {
		// Fail closed - DENIED
		return true;
	}

	const isUserBetaTester = member.roles.cache.has(BETA_TESTER_ROLE_ID);

	if (!commandFilename) {

		// Is a beta tester, so they are not locked out.
		return !isUserBetaTester;
	}

	const isCommandLocked = lockedCommands.includes(commandFilename);

	// Access is ALLOWED if the command is not locked at all.
	if (!isCommandLocked) {
		// ALLOWED
		return false;
	}

	// Access is ALLOWED if the command IS locked, but the user is a beta tester.
	if (isUserBetaTester) {
		// ALLOWED
		return false;
	}

	// Otherwise, access is DENIED.
	return true;
}

module.exports = { checkBetatestLock };