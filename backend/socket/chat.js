import { io } from "../server.js";
import { socketMapList } from "./activeSockets";
import pool from "../db/pool.js";

export default function chatHandler(socket) {
    const clientState = socketMapList.get(socket.id);

    socket.on("client_ID", (socketId) => {
        console.log(socketId);
        
    })

    socket.on("client-message", async (message) => {
        try {
           // 1. Basic Content Validation
            if (!message || !message.text || !String(message.text).trim()) {
                return socket.emit("server-error", { err: "error", reason: "No-message-recieved" });
            }

            // 2. Auth Check
            const authUser = socket.request.user;
            if (!authUser || !authUser.id) {
                return socket.emit("server-error", { err: "auth", reason: "Not authenticated" });
            }

            const cleanText = String(message.text).trim();
            const isDM = !!clientState?.active_directed_recieverId;

            // --- BRANCH A: DIRECT MESSAGE LOGIC ---
            if (isDM) {
                const receiverId = clientState.active_directed_recieverId;
                
                // Construct a unique room ID based on the two User IDs (sorted to ensure consistency)
                const dmRoom = `dm_${[authUser.id, receiverId].sort().join("_")}`;

                // TODO: Coordinate with DB team for direct_messages table
                // Example: const saved = await pool.query(`INSERT INTO direct_messages...`);

                const outbound = {
                    senderId: authUser.id,
                    receiverId,
                    text: cleanText,
                    type: "text",
                    timestamp: new Date(),
                    author: authUser.username,
                    avatar: authUser.avatar_url
                };

                io.to(dmRoom).emit("server-direct-text", outbound);
                return; // Exit handler
            }

            // --- BRANCH B: GROUP MESSAGE LOGIC ---
            const activeGroupId = clientState?.active_group;
            if (!activeGroupId) {
                return socket.emit("server-error", { err: "error", reason: "No active group selected" });
            }

            // Verify membership before allowing the post
            const membership = await pool.query(
                `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
                [activeGroupId, authUser.id]
            );

            if (membership.rows.length === 0) {
                return socket.emit("server-error", { err: "forbidden", reason: "You are not a member of this group" });
            }

            // Persist Group Message
            const insertResult = await pool.query(
                `INSERT INTO messages (group_id, sender_id, content, type)
                 VALUES ($1, $2, $3, 'text')
                 RETURNING id, group_id, sender_id, content, type, created_at`,
                [activeGroupId, authUser.id, cleanText]
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
                socket.emit("server-error", { err: "auth", reason: "Not authenticated" });
                return;
            }

            const membership = await pool.query(
                `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
                [groupId, authUser.id]
            );
            if (membership.rows.length === 0) {
                socket.emit("server-error", { err: "forbidden", reason: "You are not a member of this group" });
                return;
            }

            // Just update the cursor, no leaving
            clientState.active_directed_recieverId = null;
            clientState.active_group = groupId;
            socket.join(String(groupId));

            console.log(socket.rooms);
            console.log(clientState);
        } catch (error) {
            console.error("Error joining group:", error);
            socket.emit("server-error", { err: "server", reason: "Failed to join group" });
        }
    });

    socket.on("direct-connect", (receiverId) => {
        const authUser = socket.request.user;
        if (!authUser) return;

        // Just update the cursor, no leaving
        clientState.active_group = null;
        clientState.active_directed_recieverId = receiverId;

        const dmRoom = `dm_${[authUser.id, receiverId].sort().join("_")}`;
        socket.join(dmRoom);

        console.log(`User ${authUser.id} joined DM room: ${dmRoom}`);
    });
}