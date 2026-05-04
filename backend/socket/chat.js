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
            if (!message || !message.text || !String(message.text).trim()) {
                socket.emit("server-error", { err: "error", reason: "No-message-recieved" });
                return;
            }

            const activeGroupId = clientState?.active_group;
            if (!activeGroupId) {
                socket.emit("server-error", { err: "error", reason: "No active group selected" });
                return;
            }

            const authUser = socket.request.user;
            if (!authUser || !authUser.id) {
                socket.emit("server-error", { err: "auth", reason: "Not authenticated" });
                return;
            }

            // Ensure sender is still a member of the room they are posting to.
            const membership = await pool.query(
                `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
                [activeGroupId, authUser.id]
            );
            if (membership.rows.length === 0) {
                socket.emit("server-error", { err: "forbidden", reason: "You are not a member of this group" });
                return;
            }

            const insertResult = await pool.query(
                `INSERT INTO messages (group_id, sender_id, content, type)
                 VALUES ($1, $2, $3, 'text')
                 RETURNING id, group_id, sender_id, content, type, created_at`,
                [activeGroupId, authUser.id, String(message.text).trim()]
            );

            const saved = insertResult.rows[0];
            const outbound = {
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

            // Broadcast to everyone in group, including sender, to keep UI/state consistent.
            io.to(String(activeGroupId)).emit("server-group-text", outbound);
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

            if (clientState?.active_directed_recieverId) {
                socket.leave(clientState.active_directed_recieverId);
                clientState.active_directed_recieverId = null;
            }

            if (clientState?.active_group) {
                socket.leave(String(clientState.active_group));
            }

            clientState.active_group = groupId;
            socket.join(String(groupId));

            console.log(socket.rooms);
            console.log(clientState);
        } catch (error) {
            console.error("Error joining group:", error);
            socket.emit("server-error", { err: "server", reason: "Failed to join group" });
        }
    });

    socket.on("direct-connect", (recieverId) => {
        socket.leave(clientState.active_group)
        clientState.active_group = null

        clientState.active_directed_recieverId = recieverId
        socket.join(recieverId)

        console.log(socket.rooms);

        console.log(clientState);
        
    })
}