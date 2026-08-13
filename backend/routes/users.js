import { Router } from "express";
import pool from "../db/pool.js";
import { getOnlineUserIds } from "../socket/presence.js";

const usersRouter = Router();

/**
 * GET /api/users/online
 * Returns the internal user ids currently online (have an open socket).
 * Used to seed presence state before the live socket stream takes over.
 */
usersRouter.get("/online", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    return res.json({ success: true, online: getOnlineUserIds() });
});

/**
 * GET /api/users/search?q=username
 * Search all registered users by username (excludes the current user).
 * Each result includes `shared_groups` — how many groups the current user
 * shares with that person (0 means they are not a contact yet).
 */
usersRouter.get("/search", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const q = String(req.query.q || "").trim();
    if (!q) {
        return res.json({ success: true, users: [] });
    }

    // Escape LIKE wildcards so users can't inject % or _ patterns
    const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);

    try {
        const result = await pool.query(
            `SELECT u.id,
                    u.username,
                    u.avatar_url,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM group_members mine
                        JOIN group_members theirs ON theirs.group_id = mine.group_id
                        WHERE mine.user_id = $1
                          AND theirs.user_id = u.id
                    ), 0)::int AS shared_groups
             FROM users u
             WHERE u.id <> $1
               AND u.username ILIKE '%' || $2 || '%'
             ORDER BY shared_groups DESC, u.username ASC
             LIMIT 50`,
            [req.user.id, escaped]
        );

        return res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error("Error searching users:", err);
        return res.status(500).json({ error: "Failed to search users", details: err.message });
    }
});

export default usersRouter;
