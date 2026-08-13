//Stores all active sockets/clients
export const socketMapList = new Map ()

export function userInit(socketId, user = {}) {
    socketMapList.set(socketId, {
        authenticated: Boolean(user.authenticated),
        userId: user.id || user.userId || null,
        github_id: user.github_id || null,
        username: user.username || null,
        avatar_url: user.avatar_url || null,
        access_token: user.access_token || null,
        active_group: user.active_group || null,
        active_dm_group_id: null,
        active_directed_recieverId: null
    });
}

