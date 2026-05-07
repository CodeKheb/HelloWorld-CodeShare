import { io } from "../server.js";
import { socketMapList } from "./activeSockets";
import pool from "../db/pool.js";

export default function chatHandler(socket) {
    const clientState = socketMapList.get(socket.id);

    socket.on("client_ID", (socketId) => {
        console.log(socketId);
    });

    socket.on("client-message", async (message) => {
        try {
            if (!message || !message.text || !String(message.text).trim()) {
                return socket.emit("server-error", { err: "error", reason: "No-message-recieved" });
            }

            const authUser = socket.request.user;
            if (!authUser || !authUser.id) {
                return socket.emit("server-error", { err: "auth", reason: "Not authenticated" });
            }

            const cleanText = String(message.text).trim();
            const requestedGroupId = message.groupId ? String(message.groupId) : null;

            // Resolve target chat from current socket state OR explicit groupId from client message.
            // This prevents "No active group selected" when a DM is opened from sidebar/history
            // without running direct-connect in the same socket session.
            let activeGroupId = clientState?.active_group ? String(clientState.active_group) : null;
            let dmGroupId = clientState?.active_dm_group_id ? String(clientState.active_dm_group_id) : null;
            let receiverId = clientState?.active_directed_recieverId || null;
            let isDM = !!receiverId;

            if (requestedGroupId && requestedGroupId !== String(activeGroupId || dmGroupId || '')) {
                const chatRes = await pool.query(
                    `SELECT gc.id,
                            gc.is_direct,
                            (
                              SELECT gm.user_id
                              FROM group_members gm
                              WHERE gm.group_id = gc.id AND gm.user_id != $2
                              LIMIT 1
                            ) AS receiver_id
                     FROM group_chats gc
                     JOIN group_members me ON me.group_id = gc.id AND me.user_id = $2
                     WHERE gc.id = $1
                     LIMIT 1`,
                    [requestedGroupId, authUser.id]
                );

                if (chatRes.rows.length === 0) {
                    return socket.emit("server-error", { err: "forbidden", reason: "You are not a member of this group" });
                }

                const chat = chatRes.rows[0];
                if (chat.is_direct) {
                    isDM = true;
                    dmGroupId = String(chat.id);
                    receiverId = chat.receiver_id;
                    activeGroupId = null;

                    clientState.active_group = null;
                    clientState.active_dm_group_id = dmGroupId;
                    clientState.active_directed_recieverId = receiverId;

                    if (receiverId) {
                        const dmRoom = `dm_${[authUser.id, receiverId].sort().join("_")}`;
                        socket.join(dmRoom);
                    }
                } else {
                    isDM = false;
                    activeGroupId = String(chat.id);
                    dmGroupId = null;
                    receiverId = null;

                    clientState.active_group = activeGroupId;
                    clientState.active_dm_group_id = null;
                    clientState.active_directed_recieverId = null;
                    socket.join(activeGroupId);
                }
            }

            if (isDM) {
                if (!dmGroupId) {
                    return socket.emit("server-error", { err: "error", reason: "DM session not initialized" });
                }

                // Ensure this is still a valid DM group for the sender and resolve receiver.
                const dmInfoRes = await pool.query(
                    `SELECT gc.is_direct,
                            (
                              SELECT gm.user_id
                              FROM group_members gm
                              WHERE gm.group_id = gc.id AND gm.user_id != $2
                              LIMIT 1
                            ) AS receiver_id
                     FROM group_chats gc
                     JOIN group_members me ON me.group_id = gc.id AND me.user_id = $2
                     WHERE gc.id = $1
                     LIMIT 1`,
                    [dmGroupId, authUser.id]
                );

                if (dmInfoRes.rows.length === 0 || !dmInfoRes.rows[0].is_direct) {
                    return socket.emit("server-error", { err: "forbidden", reason: "Invalid DM target" });
                }

                if (!receiverId) {
                    receiverId = dmInfoRes.rows[0].receiver_id;
                }
                if (!receiverId) {
                    return socket.emit("server-error", { err: "error", reason: "DM receiver not found" });
                }

                clientState.active_group = null;
                clientState.active_dm_group_id = dmGroupId;
                clientState.active_directed_recieverId = receiverId;

                const dmRoom = `dm_${[authUser.id, receiverId].sort().join("_")}`;
                socket.join(dmRoom);

                const insertResult = await pool.query(
                    `INSERT INTO messages (group_id, sender_id, content, type, created_at)
                     VALUES ($1, $2, $3, 'text', $4)
                     RETURNING id, group_id, sender_id, content, type, created_at`,
                    [dmGroupId, authUser.id, cleanText, new Date().toISOString()]
                );

                const saved = insertResult.rows[0];
                io.to(dmRoom).emit("server-direct-text", {
                    id: saved.id,
                    senderId: authUser.id,
                    receiverId,
                    text: saved.content,
                    type: saved.type,
                    timestamp: saved.created_at,
                    author: authUser.username,
                    authorName: authUser.username,
                    avatar: authUser.avatar_url,
                    DmId: dmGroupId
                });
                return;
            }

            // Group message path
            activeGroupId = activeGroupId || requestedGroupId;
            if (!activeGroupId) {
                return socket.emit("server-error", { err: "error", reason: "No active group selected" });
            }

            const membership = await pool.query(
                `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
                [activeGroupId, authUser.id]
            );
            if (membership.rows.length === 0) {
                return socket.emit("server-error", { err: "forbidden", reason: "You are not a member of this group" });
            }

            clientState.active_group = activeGroupId;
            clientState.active_dm_group_id = null;
            clientState.active_directed_recieverId = null;

            const insertResult = await pool.query(
                `INSERT INTO messages (group_id, sender_id, content, type, created_at)
                 VALUES ($1, $2, $3, 'text', $4)
                 RETURNING id, group_id, sender_id, content, type, created_at`,
                [activeGroupId, authUser.id, cleanText, new Date().toISOString()]
            );

            const saved = insertResult.rows[0];
            io.to(String(activeGroupId)).emit("server-group-text", {
                id: saved.id,
                groupId: saved.group_id,
                senderId: saved.sender_id,
                text: saved.content,
                type: saved.type,
                timestamp: saved.created_at,
                author: authUser.username,
                authorName: authUser.username,
                avatar: authUser.avatar_url
            });
        } catch (error) {
            console.error("Error handling client-message:", error);
            socket.emit("server-error", { err: "server", reason: "Failed to send message" });
        }
    });

    socket.on("join-group", async (groupId) => {
        try {
            const authUser = socket.request.user;
            if (!authUser || !authUser.id) {
                return socket.emit("server-error", { err: "auth", reason: "Not authenticated" });
            }

            const membership = await pool.query(
                `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
                [groupId, authUser.id]
            );
            if (membership.rows.length === 0) {
                return socket.emit("server-error", { err: "forbidden", reason: "You are not a member of this group" });
            }

            clientState.active_directed_recieverId = null;
            clientState.active_dm_group_id = null;
            clientState.active_group = groupId;
            socket.join(String(groupId));

       
            io.to(String(groupId)).emit("member-joined", {
                userId: authUser.id,
                username: authUser.username,
                avatar_url: authUser.avatar_url,
                groupId
            });

            console.log(socket.rooms);
            console.log(clientState);
        } catch (error) {
            console.error("Error joining group:", error);
            socket.emit("server-error", { err: "server", reason: "Failed to join group" });
        }
    });

    socket.on("subscribe-group", async (groupId) => {
        try {
            const authUser = socket.request.user;
            if (!authUser || !authUser.id) return;

            const membership = await pool.query(
                `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
                [groupId, authUser.id]
            );
            if (membership.rows.length === 0) return;

            socket.join(String(groupId));
            console.log(`Subscribed socket ${socket.id} to group room ${groupId}`);
        } catch (error) {
            console.error("Error subscribing to group room:", error);
        }
    });

    socket.on("subscribe-dm", async (dmGroupId) => {
        try {
            const authUser = socket.request.user;
            if (!authUser || !authUser.id) return;

            const membership = await pool.query(
                `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
                [dmGroupId, authUser.id]
            );
            if (membership.rows.length === 0) return;

            const receiverRes = await pool.query(
                `SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2 LIMIT 1`,
                [dmGroupId, authUser.id]
            );
            if (receiverRes.rows.length === 0) return;

            const receiverId = receiverRes.rows[0].user_id;
            const dmRoom = `dm_${[authUser.id, receiverId].sort().join("_")}`;
            socket.join(dmRoom);
            console.log(`Subscribed socket ${socket.id} to DM room ${dmRoom}`);
        } catch (error) {
            console.error("Error subscribing to DM room:", error);
        }
    });

    socket.on("direct-connect", async (receiverId) => {
        try {
            const authUser = socket.request.user;
            if (!authUser) return;

            const dmRoom = `dm_${[authUser.id, receiverId].sort().join("_")}`;

            // Find or create the DM group_chat row
            const existing = await pool.query(
                `SELECT gc.id FROM group_chats gc
                 JOIN group_members gm1 ON gm1.group_id = gc.id AND gm1.user_id = $1
                 JOIN group_members gm2 ON gm2.group_id = gc.id AND gm2.user_id = $2
                 WHERE gc.is_direct = TRUE
                 LIMIT 1`,
                [authUser.id, receiverId]
            );

            let dmGroupId;

            if (existing.rows.length > 0) {
                dmGroupId = existing.rows[0].id;
            } else {
                // Create the DM group_chat

                const newChat = await pool.query(
                    `INSERT INTO group_chats (name, created_by, is_direct)
                    VALUES ($1, $2, TRUE)
                    RETURNING id`,
                    [`dm_${[authUser.id, receiverId].sort().join("_")}`, authUser.id]
                );
                // const newChat = await pool.query(
                //     `INSERT INTO group_chats (name, created_by, is_direct)
                //      VALUES (${authUser.id, receiverId}, $1, TRUE)
                //      RETURNING id`,
                //     [authUser.id]
                // );
                dmGroupId = newChat.rows[0].id;

                // Add both users as members
                await pool.query(
                    `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2), ($1, $3)
                     ON CONFLICT DO NOTHING`,
                    [dmGroupId, authUser.id, receiverId]
                );
            }

            // Update sender's client state
            clientState.active_group = null;
            clientState.active_directed_recieverId = receiverId;
            clientState.active_dm_group_id = dmGroupId;
            socket.join(dmRoom);

            // Bring receiver into the room if they're online
            for (const [receiverSocketId, state] of socketMapList.entries()) {
                if (String(state.userId) === String(receiverId)) {
                    const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                    if (receiverSocket) {
                        receiverSocket.join(dmRoom);
                        receiverSocket.emit("incoming-dm", {
                            senderId: authUser.id,
                            senderUsername: authUser.username,
                            senderAvatar: authUser.avatar_url,
                            dmGroupId,
                            dmRoom
                        });
                    }
                    break;
                }
            }

            // Confirm to sender with the dmGroupId so client can fetch history
            socket.emit("dm-ready", { dmGroupId, receiverId });

            console.log(`User ${authUser.id} joined DM room: ${dmRoom} (group_id: ${dmGroupId})`);
        } catch (error) {
            console.error("Error in direct-connect:", error);
            socket.emit("server-error", { err: "server", reason: "Failed to initialize DM" });
        }
    });
}