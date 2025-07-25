// tasks/tempRoleManager.js

const db = require('../database');
const { updateMultiplier } = require('../utils/handleCrownRewards');
const schedule = require('node-schedule');

const activeRemovalJobs = new Map();

/**
 * Removes a role from a user and cleans up the database.
 * @param {import('discord.js').Client} client The Discord client.
 * @param {number} recordId The database ID of the temp_roles record.
 */
async function removeRole(client, recordId) {
	const roleRecord = db.prepare('SELECT * FROM temp_roles WHERE id = ?').get(recordId);
	if (!roleRecord) {
		console.log(`[tempRoleManager] No record found for ID ${recordId}. It might have been removed already.`);
		activeRemovalJobs.delete(recordId);
		return;
	}

	const { user_id, guild_id, role_id } = roleRecord;

	try {
		const guild = await client.guilds.fetch(guild_id).catch(() => null);
		if (!guild) {
			console.error(`[tempRoleManager] Could not find guild ${guild_id} to remove role from user ${user_id}.`);
			return;
		}

		const member = await guild.members.fetch(user_id).catch(() => null);
		if (!member) {
			console.log(`[tempRoleManager] User ${user_id} not found in guild ${guild_id}, cannot remove role.`);
			return;
		}

		if (member.roles.cache.has(role_id)) {
			await member.roles.remove(role_id);
			console.log(`[tempRoleManager] Successfully removed role ${role_id} from user ${user_id}.`);
		}

		// Update the user's multiplier after removing the role
		await updateMultiplier(user_id, guild);

	}
	catch (error) {
		console.error(`[tempRoleManager] Failed to remove role ${role_id} for user ${user_id}:`, error);
	}
	finally {
		// Clean up the database and scheduled jobs map regardless of success
		db.prepare('DELETE FROM temp_roles WHERE id = ?').run(recordId);
		activeRemovalJobs.delete(recordId);
	}
}

/**
 * Schedules a role to be removed from a user after a specified duration.
 * @param {import('discord.js').Client} client The Discord client.
 * @param {string} userId The user's ID.
 * @param {string} guildId The guild's ID.
 * @param {string} roleId The role's ID.
 * @param {number} durationMs The duration in milliseconds until the role is removed.
 */
async function scheduleRoleRemoval(client, userId, guildId, roleId, durationMs) {
	const expiryTime = new Date(Date.now() + durationMs);

	// Store in DB to survive restarts
	const result = db.prepare(`
        INSERT INTO temp_roles (user_id, guild_id, role_id, expiry_time) 
        VALUES (?, ?, ?, ?)
    `).run(userId, guildId, roleId, expiryTime.toISOString());

	const recordId = result.lastInsertRowid;

	// Schedule the job in the current session
	const job = schedule.scheduleJob(expiryTime, () => removeRole(client, recordId));
	activeRemovalJobs.set(recordId, job);
	console.log(`[tempRoleManager] Scheduled removal of role ${roleId} for user ${userId} at ${expiryTime.toISOString()}.`);
}

/**
 * Resumes all pending role removals on bot startup.
 * @param {import('discord.js').Client} client The Discord client.
 */
async function resumeTempRoleRemovals(client) {
	console.log('[tempRoleManager] Resuming pending role removals...');
	const pendingRoles = db.prepare('SELECT * FROM temp_roles').all();
	const now = new Date();
	let immediateRemovals = 0;
	let scheduledRemovals = 0;

	for (const roleRecord of pendingRoles) {
		const expiryTime = new Date(roleRecord.expiry_time);

		if (expiryTime <= now) {
			// Expiry time is in the past, remove it now.
			await removeRole(client, roleRecord.id);
			immediateRemovals++;
		}
		else {
			// Expiry time is in the future, schedule it.
			const job = schedule.scheduleJob(expiryTime, () => removeRole(client, roleRecord.id));
			activeRemovalJobs.set(roleRecord.id, job);
			scheduledRemovals++;
		}
	}

	console.log(`[tempRoleManager] Resumed role removals: ${immediateRemovals} immediately removed, ${scheduledRemovals} scheduled for the future.`);
}

module.exports = {
	scheduleRoleRemoval,
	resumeTempRoleRemovals,
};