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
            const isDM = !!clientState?.active_directed_recieverId;

            // --- BRANCH A: DIRECT MESSAGE LOGIC ---
            if (isDM) {
                const receiverId = clientState.active_directed_recieverId;
                const dmRoom = `dm_${[authUser.id, receiverId].sort().join("_")}`;

                // Persist DM using the stored dm_group_id on clientState
                const dmGroupId = clientState.active_dm_group_id;
                if (!dmGroupId) {
                    return socket.emit("server-error", { err: "error", reason: "DM session not initialized" });
                }

                const insertResult = await pool.query(
                    `INSERT INTO messages (group_id, sender_id, content, type, created_at)
                     VALUES ($1, $2, $3, 'text', $4)
                     RETURNING id, group_id, sender_id, content, type, created_at`,
                    [dmGroupId, authUser.id, cleanText, new Date().toISOString()]
                );

                const saved = insertResult.rows[0];
                const outbound = {
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
                };

                io.to(dmRoom).emit("server-direct-text", outbound);
                return;
            }

            // --- BRANCH B: GROUP MESSAGE LOGIC ---
            const activeGroupId = clientState?.active_group;
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

            const insertResult = await pool.query(
                `INSERT INTO messages (group_id, sender_id, content, type, created_at)
                 VALUES ($1, $2, $3, 'text', $4)
                 RETURNING id, group_id, sender_id, content, type, created_at`,
                [activeGroupId, authUser.id, cleanText, new Date().toISOString()]
            );

            const saved = insertResult.rows[0];
            const groupOutbound = {
                id: saved.id,
                groupId: saved.group_id,
                senderId: saved.sender_id,
                text: saved.content,
                type: saved.type,
                timestamp: saved.created_at,
                author: authUser.username,
                authorName: authUser.username,
                avatar: authUser.avatar_url
            };

            io.to(String(activeGroupId)).emit("server-group-text", groupOutbound);
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

        //     const joinNotification = {
        //         id: null, // Temporary unique ID for frontend keys
        //         groupId: groupId,
        //         senderId: null,          // Null indicates it's a system message
        //         text: `--- ${authUser.username} joined this group ---`,
        //         type: 'system',          // Changed type to distinguish from user 'text'
        //         timestamp: new Date(),
        //         author: "System",
        //         authorName: "System",
        //         avatar: null
        //     };

        // // 2. Emit the structured object instead of a raw string
        //     io.to(String(groupId)).emit("server-group-text", joinNotification);
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