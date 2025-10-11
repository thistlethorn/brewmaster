// core_brewmaster/tasks/refreshVanityRoleInfo.js
const rolesToSeed = require('@core_brewmaster/utils/vanityRoleInfo.js');
const log = require('@utils/logger.js');

/**
 * Synchronizes the vanity roles in all guilds with the configuration file.
 * This function checks each role's name and color and updates them if they don't match.
 * It's designed to be run on bot startup to ensure consistency.
 * @param {import('discord.js').Client} client The Discord client instance.
 */
async function refreshVanityRoleInfo(client) {
	log.info('[Vanity Roles] Starting vanity role synchronization...');

	// Avoid refreshing the role info every single time we renode the bot, use a hardcoded developer bypass.
	const bypass = true;

	if (bypass) return log.special('Bypass: Skipped refreshing vanity role info.');

	// Use a for...of loop to correctly handle async operations within the loop.
	// client.guilds.cache.values() gives us an iterator for all cached guilds.
	for (const guild of client.guilds.cache.values()) {
		log.info(`[Vanity Roles] Checking guild: ${guild.name} (${guild.id})`);

		for (const roleToSeed of rolesToSeed) {
			try {
				// Fetch the role from the guild. Use .catch() to handle cases where the role doesn't exist.
				const existingRole = await guild.roles.fetch(roleToSeed.role_id).catch(() => null);

				// If the role doesn't exist in this guild, log a warning and skip it.
				if (!existingRole) {
					// log.warn(`[Vanity Roles] Role "${roleToSeed.name}" (ID: ${roleToSeed.role_id}) not found in guild "${guild.name}". Skipping.`);
					continue;
				}

				// Check if the name or color are different from our source of truth.
				// Note: d.js hexColor is always uppercase, so we compare against the uppercase version of our config color.
				const nameIsDifferent = existingRole.name !== roleToSeed.name;
				const colorIsDifferent = existingRole.hexColor !== roleToSeed.color_hex.toUpperCase();

				if (nameIsDifferent || colorIsDifferent) {
					// log.info(`[Vanity Roles] Updating role "${existingRole.name}" in guild "${guild.name}".`);

					// Prepare the changes object. Only include properties that need changing.
					const changes = {};
					if (nameIsDifferent) changes.name = roleToSeed.name;
					if (colorIsDifferent) changes.color = roleToSeed.color_hex;

					// Apply the changes.
					await existingRole.edit(changes, 'Synchronizing vanity role info on startup.');

					log.success(`[Vanity Roles] Successfully updated role "${roleToSeed.name}" in guild "${guild.name}".`);
				}
			}
			catch (error) {
				// This will catch permissions errors (e.g., bot role is below the vanity role).
				log.error(`[Vanity Roles] Failed to process role "${roleToSeed.name}" in guild "${guild.name}":`, error);
			}
		}
	}
	log.info('[Vanity Roles] Finished vanity role synchronization.');
}

module.exports = {
	refreshVanityRoleInfo,
};