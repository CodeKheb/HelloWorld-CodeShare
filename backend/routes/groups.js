import { Router } from "express";
import pool from "../db/pool.js";
import { io } from "../server.js";

const groupsRouter = Router();

async function getExistingWebhooks({ owner, repo, accessToken }) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    });

    if (!response.ok) {
        console.log(`[WEBHOOK] Could not list existing webhooks for ${owner}/${repo}: ${response.status}`);
        return [];
    }

    return await response.json();
}

async function createGithubWebhook({ repoFullName, accessToken }) {
    const [owner, repo] = String(repoFullName).split("/");
    if (!owner || !repo) {
        throw new Error("Invalid repository format. Use owner/repo");
    }

    const appBaseUrl = process.env.APP_BASE_URL;
    if (!appBaseUrl) {
        throw new Error("APP_BASE_URL is required to create webhooks");
    }

    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || "test_secret";
    const targetUrl = `${appBaseUrl.replace(/\/$/, "")}/api/webhooks/github`;
    
    // Check if webhook already exists for this URL using the current user's token
    try {
        const existingHooks = await getExistingWebhooks({ owner, repo, accessToken });
        const existingHook = existingHooks.find(h => h.config?.url === targetUrl);
        
        if (existingHook) {
            console.log(`[WEBHOOK] Webhook already exists for ${owner}/${repo} with ID ${existingHook.id}`);
            return existingHook.id;
        }
    } catch (checkErr) {
        // If checking for existing webhooks fails (permission issue), fall back to polling
        console.log(`[WEBHOOK] Could not verify existing webhooks for ${owner}/${repo} with current token: ${checkErr.message}. Will use polling instead.`);
        throw new Error("PERMISSION_ERROR_USE_POLLING");
    }

    const webhookUrl = `https://api.github.com/repos/${owner}/${repo}/hooks`;
    console.log(`[WEBHOOK] Creating webhook for ${owner}/${repo} at ${webhookUrl}`);
    const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: "web",
            active: true,
            events: ["push", "pull_request"],
            config: {
                url: targetUrl,
                content_type: "json",
                secret: webhookSecret,
                insecure_ssl: "0"
            }
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`GitHub webhook creation failed: ${response.status} ${errText}`);
    }

    const hook = await response.json();
    return hook.id;
}

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

        // Edge case: only attach repositories that actually exist on GitHub.
        // Reject fake/nonexistent repos instead of silently attaching them.
        const repoProvided = repoFullName && repoFullName.trim() !== "";
        if (repoProvided) {
            const [repoOwner, repoName] = String(repoFullName).split("/");
            if (!repoOwner || !repoName) {
                return res.status(400).json({ error: "Repository name must be in owner/repo format" });
            }

            const accessToken = req.user.accessToken;
            if (!accessToken) {
                return res.status(401).json({ error: "Missing GitHub access token. Please log in again." });
            }

            let repoExists = false;
            let repoCheckError = null;
            try {
                const repoCheck = await fetch(
                    `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}`,
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            Accept: "application/vnd.github+json",
                            "User-Agent": "CodeShare-App"
                        }
                    }
                );
                repoExists = repoCheck.ok;
                if (!repoCheck.ok) {
                    repoCheckError = repoCheck.status;
                }
            } catch (checkErr) {
                repoCheckError = checkErr;
            }

            if (!repoExists) {
                if (repoCheckError === 404) {
                    return res.status(404).json({
                        error: `Repository "${repoFullName}" does not exist or you don't have access to it.`
                    });
                }
                if (repoCheckError === 403) {
                    return res.status(403).json({
                        error: "GitHub rejected the repository check (rate limit or permissions). Please try again."
                    });
                }
                console.error("[GROUPS] Repo existence check failed during group creation:", repoCheckError?.message || repoCheckError);
                return res.status(502).json({
                    error: `Could not verify that "${repoFullName}" exists on GitHub. Please try again.`
                });
            }
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
                const insertedRepo = await client.query(
                    `INSERT INTO group_repos (group_id, repo_full_name)
                     VALUES ($1, $2)
                     ON CONFLICT (group_id, repo_full_name) DO NOTHING
                     RETURNING id, repo_full_name, webhook_id, added_at, attached_at`,
                    [group.id, repoFullName.trim()]
                );

                let repoRow = insertedRepo.rows[0];
                if (repoRow) {
                    // Stamp attached_at and last_checked_at to NOW() to prevent immediate backfill
                    const stamped = await client.query(
                        `UPDATE group_repos
                         SET attached_at = NOW(), last_checked_at = NOW()
                         WHERE id = $1
                         RETURNING id, repo_full_name, webhook_id, added_at, attached_at, last_checked_at, use_polling`,
                        [repoRow.id]
                    );
                    repoRow = stamped.rows[0] || repoRow;

                    try {
                        const webhookId = await createGithubWebhook({
                            repoFullName: repoRow.repo_full_name,
                            accessToken: req.user.accessToken
                        });

                        await client.query(
                            `UPDATE group_repos SET webhook_id = $1 WHERE id = $2`,
                            [webhookId, repoRow.id]
                        );
                        console.log(`[WEBHOOK] Successfully created webhook for ${repoRow.repo_full_name} (ID: ${webhookId})`);
                    } catch (webhookErr) {
                        const isPermissionError = 
                            webhookErr.message.includes('403') || 
                            webhookErr.message.includes('404') ||
                            webhookErr.message.includes('PERMISSION_ERROR_USE_POLLING');
                        if (isPermissionError) {
                            console.log(`[POLLING] Webhook creation/verification failed due to permissions. Enabling polling for ${repoRow.repo_full_name}`);
                            await client.query(
                                `UPDATE group_repos SET use_polling = TRUE WHERE id = $1`,
                                [repoRow.id]
                            );
                        } else {
                            console.warn(`[WEBHOOK] Failed to create webhook for ${repoRow.repo_full_name}: ${webhookErr.message}`);
                        }
                    }
                }
            }

            await client.query("COMMIT");

            // Return the created group
            return res.status(201).json({
            success: true,
            group: {
                id: group.id,
                name: group.name,
                created_by: group.created_by,
                created_at: group.created_at,
                invite_code: group.invite_code 
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
                    gc.invite_code,
                    gc.is_direct,
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

// POST /api/groups/:groupId/repos - Attach a repository to a group
groupsRouter.post("/:groupId/repos", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { groupId } = req.params;
        const { repoFullName } = req.body;
        const userId = req.user.id;
        const accessToken = req.user.accessToken;
        const userName = req.user.username

        if (!repoFullName || repoFullName.trim() === "") {
            return res.status(400).json({ error: "Repository name is required (owner/repo)" });
        }

        if (!accessToken) {
            return res.status(401).json({ error: "Missing GitHub access token. Please log in again." });
        }

        // Ensure the user is a member of this group
        const memberCheck = await pool.query(
            `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
            [groupId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: "You are not a member of this group" });
        }

        // Edge case: only attach repositories that actually exist on GitHub.
        // Reject fake/nonexistent repos instead of silently attaching them.
        const [repoOwner, repoName] = String(repoFullName).split("/");
        if (!repoOwner || !repoName) {
            return res.status(400).json({ error: "Repository name must be in owner/repo format" });
        }

        let repoExists = false;
        let repoCheckError = null;
        try {
            const repoCheck = await fetch(
                `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: "application/vnd.github+json",
                        "User-Agent": "CodeShare-App"
                    }
                }
            );
            repoExists = repoCheck.ok;
            if (!repoCheck.ok) {
                repoCheckError = repoCheck.status;
            }
        } catch (checkErr) {
            repoCheckError = checkErr;
        }

        if (!repoExists) {
            if (repoCheckError === 404) {
                return res.status(404).json({
                    error: `Repository "${repoFullName}" does not exist or you don't have access to it.`
                });
            }
            if (repoCheckError === 403) {
                return res.status(403).json({
                    error: "GitHub rejected the repository check (rate limit or permissions). Please try again."
                });
            }
            console.error("[GROUPS] Repo existence check failed:", repoCheckError?.message || repoCheckError);
            return res.status(502).json({
                error: `Could not verify that "${repoFullName}" exists on GitHub. Please try again.`
            });
        }

        const client = await pool.connect();
        let repoRow;
        try {
            await client.query("BEGIN");

            // Insert repo relation (idempotent per UNIQUE(group_id, repo_full_name))
            const insertResult = await client.query(
                `INSERT INTO group_repos (group_id, repo_full_name)
                 VALUES ($1, $2)
                 ON CONFLICT (group_id, repo_full_name) DO NOTHING
                     RETURNING id, group_id, repo_full_name, webhook_id, added_at, attached_at`,
                [groupId, repoFullName.trim()]
            );

            repoRow = insertResult.rows[0];
            if (!repoRow) {
                const existing = await client.query(
                    `SELECT id, group_id, repo_full_name, webhook_id, added_at, attached_at
                     FROM group_repos
                     WHERE group_id = $1 AND repo_full_name = $2`,
                    [groupId, repoFullName.trim()]
                );
                repoRow = existing.rows[0] || null;
            }

            if (!repoRow) {
                throw new Error("Failed to load repository attachment row");
            }

            // Always update attached_at to NOW() to mark when this repo was attached to this group.
            // This ensures the polling cutoff uses the correct baseline for the group.
            const normalized = await client.query(
                `UPDATE group_repos
                 SET attached_at = NOW(), last_checked_at = NOW()
                 WHERE id = $1
                 RETURNING id, group_id, repo_full_name, webhook_id, added_at, attached_at, last_checked_at, use_polling`,
                [repoRow.id]
            );
            repoRow = normalized.rows[0];

            // Create webhook automatically if missing, but don't block repo attachment if it fails
            if (!repoRow.webhook_id) {
                try {
                    const webhookId = await createGithubWebhook({
                        repoFullName: repoRow.repo_full_name,
                        accessToken
                    });

                    const updated = await client.query(
                        `UPDATE group_repos
                         SET webhook_id = $1
                         WHERE id = $2
                         RETURNING id, group_id, repo_full_name, webhook_id, added_at, attached_at, use_polling`,
                        [webhookId, repoRow.id]
                    );
                    repoRow = updated.rows[0];
                    console.log(`[WEBHOOK] Successfully created webhook for ${repoRow.repo_full_name} (ID: ${webhookId})`);
                } catch (webhookErr) {
                    // Check for permission errors or webhook verification failures
                    const isPermissionError = 
                        webhookErr.message.includes('403') || 
                        webhookErr.message.includes('404') ||
                        webhookErr.message.includes('PERMISSION_ERROR_USE_POLLING');
                    
                    if (isPermissionError) {
                        console.log(`[POLLING] Webhook creation/verification failed due to permissions. Enabling polling for ${repoRow.repo_full_name}`);
                        // Fall back to polling
                        const updated = await client.query(
                            `UPDATE group_repos
                             SET use_polling = TRUE
                             WHERE id = $1
                             RETURNING id, group_id, repo_full_name, webhook_id, added_at, attached_at, use_polling`,
                            [repoRow.id]
                        );
                        repoRow = updated.rows[0];
                    } else {
                        // Some other error — log but don't fail
                        console.warn(`[WEBHOOK] Failed to create webhook for ${repoRow.repo_full_name}: ${webhookErr.message}`);
                    }
                }
            }
            io.to(String(groupId)).emit("server-group-text", {
                          id: null,
                          groupId: groupId,
                          senderId: userId,
                          text: `${userName} attached ${repoFullName} to this conversation.`,
                          type: "system",
                          timestamp: new Date(),
                          author: "System",
                          authorName: "System",
                          avatar: "/default-avatar.png"
                        });
            io.to(String(groupId)).emit("repo-attached", {
                          groupId: groupId,
                          repo: repoRow
                        });
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        return res.status(201).json({ success: true, repo: repoRow });
    } catch (error) {
        console.error("Error attaching repo to group:", error);
        return res.status(500).json({ error: "Failed to attach repository", details: error.message });
    }
});

// POST /groups/join/:inviteCode - Must come BEFORE /:groupId/join to match first
groupsRouter.post("/join/:inviteCode", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { inviteCode } = req.params;
        const userId = req.user.id;

        // Resolve invite code → group (never expose UUID to join flow)
        const groupCheck = await pool.query(
            `SELECT id, name, is_direct FROM group_chats 
             WHERE invite_code = $1`,
            [inviteCode.toUpperCase()]  // normalize in case user types lowercase
        );

        if (groupCheck.rows.length === 0) {
            return res.status(404).json({ error: "Invalid invite code" });
        }

        const group = groupCheck.rows[0];

        // DMs shouldn't be joinable via invite code
        if (group.is_direct) {
            return res.status(403).json({ error: "Cannot join a direct message via invite code" });
        }

        // Insert member (idempotent) and notify the group only when the user is newly added
        const joinResult = await pool.query(
            `INSERT INTO group_members (group_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (group_id, user_id) DO NOTHING
             RETURNING user_id`,
            [group.id, userId]
        );

        if (joinResult.rows.length > 0) {
            io.to(String(group.id)).emit("server-group-text", {
                id: null,
                groupId: group.id,
                senderId: userId,
                text: `${req.user.username} joined the group.`,
                type: "system",
                timestamp: new Date(),
                author: "System",
                authorName: "System",
                avatar: "/default-avatar.png"
            });
        }

        return res.status(200).json({ 
            success: true, 
            groupId: group.id,   // return UUID only after join is confirmed
            groupName: group.name
        });

    } catch (error) {
        console.error("Error joining group:", error);
        return res.status(500).json({ error: "Failed to join group", details: error.message });
    }
});

// POST /groups/join/:groupId - Join by group ID (less common, kept for compatibility)
groupsRouter.post("/:groupId/join", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { groupId } = req.params;
        const userId = req.user.id;

        // Check group exists
        const groupCheck = await pool.query(
            `SELECT id FROM group_chats WHERE id = $1`,
            [groupId]
        );
        if (groupCheck.rows.length === 0) {
            return res.status(404).json({ error: "Group not found" });
        }

        // Insert member (idempotent) and notify the group only when the user is newly added
        const joinResult = await pool.query(
            `INSERT INTO group_members (group_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (group_id, user_id) DO NOTHING
             RETURNING user_id`,
            [groupId, userId]
        );

        if (joinResult.rows.length > 0) {
            io.to(String(groupId)).emit("server-group-text", {
                id: null,
                groupId,
                senderId: userId,
                text: `${req.user.username} joined the group.`,
                type: "system",
                timestamp: new Date(),
                author: "System",
                authorName: "System",
                avatar: "/default-avatar.png"
            });
        }

        return res.status(200).json({ success: true, groupId });
    } catch (error) {
        console.error("Error joining group:", error);
        return res.status(500).json({ error: "Failed to join group", details: error.message });
    }
});

// POST /api/groups/:groupId/members - Add a user to a group (any member can add)
groupsRouter.post("/:groupId/members", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { groupId } = req.params;
        const { userId } = req.body;
        const requesterId = req.user.id;

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        // Requester must already be a member of the group
        const memberCheck = await pool.query(
            `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
            [groupId, requesterId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: "You are not a member of this group" });
        }

        // Target user must exist
        const userCheck = await pool.query(
            `SELECT id, username, avatar_url FROM users WHERE id = $1`,
            [userId]
        );
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const addedUser = userCheck.rows[0];

        // Add member (idempotent)
        const insertResult = await pool.query(
            `INSERT INTO group_members (group_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (group_id, user_id) DO NOTHING
             RETURNING user_id`,
            [groupId, userId]
        );

        const wasAdded = insertResult.rows.length > 0;

        if (wasAdded) {
            // Notify the group in real time
            io.to(String(groupId)).emit("server-group-text", {
                id: null,
                groupId,
                senderId: requesterId,
                text: `${addedUser.username} was added to the group by ${req.user.username}.`,
                type: "system",
                timestamp: new Date(),
                author: "System",
                authorName: "System",
                avatar: "/default-avatar.png"
            });
            io.to(String(groupId)).emit("member-added", {
                groupId,
                user: {
                    id: addedUser.id,
                    username: addedUser.username,
                    avatar_url: addedUser.avatar_url
                }
            });
        }

        return res.status(201).json({
            success: true,
            added: wasAdded,
            groupId,
            user: { id: addedUser.id, username: addedUser.username, avatar_url: addedUser.avatar_url }
        });
    } catch (error) {
        console.error("Error adding member to group:", error);
        return res.status(500).json({ error: "Failed to add member", details: error.message });
    }
});

// POST /groups/:groupId/regenerate-invite
groupsRouter.post("/:groupId/regenerate-invite", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { groupId } = req.params;
        const userId = req.user.id;

        // Only group creator should be able to rotate the code
        const authCheck = await pool.query(
            `SELECT id FROM group_chats WHERE id = $1 AND created_by = $2`,
            [groupId, userId]
        );
        if (authCheck.rows.length === 0) {
            return res.status(403).json({ error: "Not authorized" });
        }

        const result = await pool.query(
            `UPDATE group_chats
             SET invite_code = upper(substring(gen_random_uuid()::text FROM 1 FOR 8))
             WHERE id = $1
             RETURNING invite_code`,
            [groupId]
        );

        return res.status(200).json({ inviteCode: result.rows[0].invite_code });

    } catch (error) {
        console.error("Error regenerating invite:", error);
        return res.status(500).json({ error: "Failed to regenerate invite code" });
    }
});

// DELETE /api/groups/:groupId/leave - Leave a group
groupsRouter.delete("/:groupId/leave", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { groupId } = req.params;
        const userId = req.user.id;
        const userName = req.user.username;
        const avatarUrl = req.user.avatar_url;

        // Check if the user is the creator
        const groupCheck = await pool.query(
            `SELECT created_by FROM group_chats WHERE id = $1`,
            [groupId]
        );

        if (groupCheck.rows.length === 0) {
            return res.status(404).json({ error: "Group not found" });
        }

        // Logic choice: If the owner leaves, you might want to prevent it or delete the group.
        // Here, we let them leave, but warn that the group persists.
        if (groupCheck.rows[0].created_by === userId) {
            return res.status(400).json({ error: "Owners cannot leave. Delete the group instead." });
        }

        const result = await pool.query(
            `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
            [groupId, userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "You are not a member of this group" });
        }

        // Notify other members via Socket.io
        io.to(String(groupId)).emit("server-group-text", {
            id: null,
            groupId: groupId,
            senderId: userId,
            text: `${userName} has left the group.`,
            type: "system",
            timestamp: new Date(),
            author: "System",
            authorName: "System",
            avatar: "/default-avatar.png"
        });

        io.to(String(groupId)).emit("member-leave", {
                userId: userId,
                username: userName,
                avatar_url: avatarUrl,
                groupId
            })
        return res.json({ success: true, message: "Successfully left the group" });
    } catch (error) {
        console.error("Error leaving group:", error);
        return res.status(500).json({ error: "Failed to leave group" });
    }
});

// DELETE /api/groups/:groupId - Delete a group (Creator only)
groupsRouter.delete("/:groupId", async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        const { groupId } = req.params;
        const userId = req.user.id;

        // Verify ownership
        const groupCheck = await pool.query(
            `SELECT created_by FROM group_chats WHERE id = $1`,
            [groupId]
        );

        if (groupCheck.rows.length === 0) {
            return res.status(404).json({ error: "Group not found" });
        }

        if (groupCheck.rows[0].created_by !== userId) {
            return res.status(403).json({ error: "Only the group creator can delete this group" });
        }

        // Because of ON DELETE CASCADE in your schema, 
        // this will automatically delete group_members, group_repos, and messages.
        await pool.query(`DELETE FROM group_chats WHERE id = $1`, [groupId]);

        // Notify members the group is gone
        io.to(String(groupId)).emit("group-deleted", { groupId });

        return res.json({ success: true, message: "Group deleted successfully" });
    } catch (error) {
        console.error("Error deleting group:", error);
        return res.status(500).json({ error: "Failed to delete group" });
    }
});

export default groupsRouter;
