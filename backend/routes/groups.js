import { Router } from "express";
import pool from "../db/pool.js";

const groupsRouter = Router();

// POST /api/groups/create - Create a new group
groupsRouter.post("/create", async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { name, repoFullName } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!name || name.trim() === "") {
            return res.status(400).json({ error: "Group name is required" });
        }

        // Start a transaction to insert group, add creator as member, and optionally add repo
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // 1. Create the group
            const groupResult = await client.query(
                `INSERT INTO group_chats (name, created_by)
                 VALUES ($1, $2)
                 RETURNING *`,
                [name.trim(), userId]
            );

            const group = groupResult.rows[0];

            // 2. Add the creator as a group member
            await client.query(
                `INSERT INTO group_members (group_id, user_id)
                 VALUES ($1, $2)`,
                [group.id, userId]
            );

            // 3. If a repo was provided, add it to the group
            if (repoFullName && repoFullName.trim() !== "") {
                await client.query(
                    `INSERT INTO group_repos (group_id, repo_full_name)
                     VALUES ($1, $2)
                     ON CONFLICT (group_id, repo_full_name) DO NOTHING`,
                    [group.id, repoFullName.trim()]
                );
            }

            await client.query("COMMIT");

            // Return the created group
            return res.status(201).json({
                success: true,
                group: {
                    id: group.id,
                    name: group.name,
                    created_by: group.created_by,
                    created_at: group.created_at
                }
            });
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("Error creating group:", error);
        return res.status(500).json({ error: "Failed to create group", details: error.message });
    }
});

// GET /api/groups - Get all groups (optionally filter by user)
groupsRouter.get("/", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const userId = req.user.id;

        // Get all groups the user is a member of, including a small members array
        const result = await pool.query(
            `SELECT gc.id,
                    gc.name,
                    gc.created_by,
                    gc.created_at,
                    gc.last_summarized_at,
                    COUNT(gm.user_id) AS member_count,
                    COALESCE(json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar_url', u.avatar_url) ORDER BY gm.joined_at) FILTER (WHERE u.id IS NOT NULL), '[]') AS members
             FROM group_chats gc
             LEFT JOIN group_members gm ON gc.id = gm.group_id
             LEFT JOIN users u ON gm.user_id = u.id
             WHERE gc.id IN (
                 SELECT group_id FROM group_members WHERE user_id = $1
             )
             GROUP BY gc.id
             ORDER BY gc.created_at DESC`,
            [userId]
        );

        return res.json({ success: true, groups: result.rows });
    } catch (error) {
        console.error("Error fetching groups:", error);
        return res.status(500).json({ error: "Failed to fetch groups", details: error.message });
    }
});

// GET /api/groups/:groupId - Get group details
groupsRouter.get("/:groupId", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { groupId } = req.params;
        const userId = req.user.id;

        // Check if user is a member of this group
        const memberCheck = await pool.query(
            `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
            [groupId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: "You are not a member of this group" });
        }

        // Get group details with members and repos
        const groupResult = await pool.query(
            `SELECT * FROM group_chats WHERE id = $1`,
            [groupId]
        );

        if (groupResult.rows.length === 0) {
            return res.status(404).json({ error: "Group not found" });
        }

        const group = groupResult.rows[0];

        // Get group members
        const membersResult = await pool.query(
            `SELECT u.id, u.username, u.avatar_url, gm.joined_at
             FROM group_members gm
             JOIN users u ON gm.user_id = u.id
             WHERE gm.group_id = $1
             ORDER BY gm.joined_at ASC`,
            [groupId]
        );

        // Get group repos
        const reposResult = await pool.query(
            `SELECT * FROM group_repos WHERE group_id = $1`,
            [groupId]
        );

        return res.json({
            success: true,
            group: {
                ...group,
                members: membersResult.rows,
                repos: reposResult.rows
            }
        });
    } catch (error) {
        console.error("Error fetching group details:", error);
        return res.status(500).json({ error: "Failed to fetch group details", details: error.message });
    }
});

export default groupsRouter;