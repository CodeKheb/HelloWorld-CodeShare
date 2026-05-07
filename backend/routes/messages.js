import { Router } from "express";
import pool from "../db/pool.js";

const messagesRouter = Router();

async function ensureGroupMembership(groupId, userId) {
	const membership = await pool.query(
		`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
		[groupId, userId]
	);
	return membership.rows.length > 0;
}

// GET /api/messages/group/:groupId?limit=50
messagesRouter.get("/group/:groupId", async (req, res) => {
	try {
		if (!req.isAuthenticated()) {
			return res.status(401).json({ error: "User not authenticated" });
		}

		const { groupId } = req.params;
		const userId = req.user.id;
		const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

		const isMember = await ensureGroupMembership(groupId, userId);
		if (!isMember) {
			return res.status(403).json({ error: "You are not a member of this group" });
		}

		const result = await pool.query(
			`SELECT m.id,
					m.group_id,
					m.sender_id,
					m.content,
					m.type,
					m.created_at,
					u.username AS sender_username,
					u.avatar_url AS sender_avatar_url
			 FROM messages m
			 LEFT JOIN users u ON u.id = m.sender_id
			 WHERE m.group_id = $1
			 ORDER BY m.created_at DESC, m.id DESC
			 LIMIT $2`,
			[groupId, limit]
		);

		return res.json({
			success: true,
			messages: result.rows
		});
	} catch (error) {
		console.error("Error loading group messages:", error);
		return res.status(500).json({ error: "Failed to load group messages", details: error.message });
	}
});

export default messagesRouter;
