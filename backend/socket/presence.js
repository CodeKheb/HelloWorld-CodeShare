import { io } from "../server.js";

/**
 * Presence tracking — which users currently have an authenticated socket open.
 *
 * Keyed by the internal users.id (the same id used in group_members, contacts,
 * and the frontend). Multiple sockets per user (tabs/devices) are supported:
 * a user is "online" while at least one of their sockets is connected.
 *
 * NOTE: state is in-memory per process — fine for the single-instance deploy.
 */

const userSockets = new Map(); // userId (string) -> Set of socket ids

/** Internal user ids currently online. */
export function getOnlineUserIds() {
    return Array.from(userSockets.keys());
}

/** Mark a socket as belonging to an online user and broadcast if newly online. */
export function registerPresence(userId, socket) {
    if (userId == null) return;
    const key = String(userId);
    const wasOnline = userSockets.has(key);

    if (!userSockets.has(key)) {
        userSockets.set(key, new Set());
    }
    userSockets.get(key).add(socket.id);

    if (!wasOnline) {
        io.emit("presence:update", { online: getOnlineUserIds() });
    }
}

/** Remove a socket; broadcast when the user has no sockets left. */
export function unregisterPresence(userId, socket) {
    if (userId == null) return;
    const key = String(userId);
    const sockets = userSockets.get(key);
    if (!sockets) return;

    sockets.delete(socket.id);
    if (sockets.size === 0) {
        userSockets.delete(key);
        io.emit("presence:update", { online: getOnlineUserIds() });
    }
}
