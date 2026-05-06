import express from "express";
import pool from "../db/pool.js";

const router = express.Router();

/**
 * GET /api/dashboard/recent-activity
 * Returns deduplicated recent GitHub events (from both webhooks and polling)
 */
router.get("/recent-activity", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const query = `
            WITH activity_rows AS (
                SELECT
                    CASE
                        WHEN we.github_event = 'push' THEN
                            we.repo_full_name || ':push:' || COALESCE(
                                we.payload->>'after',
                                we.payload->'head_commit'->>'id',
                                we.payload->'commits'->0->>'id',
                                we.payload->>'id',
                                we.id::text
                            )
                        WHEN we.github_event = 'pull_request' THEN
                            we.repo_full_name || ':pr:' || COALESCE(
                                we.payload->'pull_request'->>'number',
                                we.payload->>'number',
                                we.payload->>'id',
                                we.id::text
                            )
                        ELSE
                            we.repo_full_name || ':' || COALESCE(
                                we.github_event,
                                we.payload->>'id',
                                we.id::text
                            )
                    END AS activity_key,
                    COALESCE(m.created_at, we.created_at) AS created_at,
                    we.repo_full_name,
                    we.payload,
                    we.github_event,
                    m.content AS message_content,
                    m.id AS message_id
                FROM webhook_events we
                LEFT JOIN messages m ON m.id = we.message_id
                JOIN group_repos gr ON gr.group_id = we.group_id
                    AND gr.repo_full_name = we.repo_full_name
                WHERE we.group_id IN (
                    SELECT gm.group_id
                    FROM group_members gm
                    WHERE gm.user_id = $1
                )
                AND COALESCE(m.created_at, we.created_at) >= (timezone('UTC', NOW()) - INTERVAL '24 hours')
            )
            SELECT DISTINCT ON (activity_key)
                activity_key AS github_event_id,
                created_at,
                repo_full_name,
                payload,
                github_event,
                message_content
            FROM activity_rows
            ORDER BY activity_key, created_at DESC, message_id DESC NULLS LAST
            LIMIT 20
        `;

        const result = await pool.query(query, [req.user.id]);

        const activities = result.rows.map(row => {
            const envelope = row.payload || {};
            const payload = envelope && envelope.type && envelope.payload ? envelope.payload : envelope;
            const eventType = row.github_event || envelope.type || payload.type || "";
            const messageContent = row.message_content || "";

            const commitData = {
                author: "Unknown",
                avatarUrl: null,
                message: "",
                sha: null,
                additions: 0,
                deletions: 0,
                branch: "main"
            };

            const sender = envelope.sender || payload.sender || envelope.actor || payload.actor || payload.pusher;
            if (sender) {
                commitData.author = sender.login || sender.name || sender.username || "Unknown";
                commitData.avatarUrl = sender.avatar_url || sender.avatarUrl || null;
            }

            const commits = Array.isArray(payload.commits)
                ? payload.commits
                : Array.isArray(envelope.commits)
                    ? envelope.commits
                    : [];

            if (commits.length > 0) {
                const commit = commits[0];
                commitData.sha = commit.id || commit.sha;
                commitData.message = commit.message || "";

                if (commitData.author === "Unknown") {
                    if (commit.author?.username) {
                        commitData.author = commit.author.username;
                    } else if (commit.author?.name) {
                        commitData.author = commit.author.name;
                    }
                }

                if (typeof commit.stats === "object") {
                    commitData.additions = commit.stats.additions || 0;
                    commitData.deletions = commit.stats.deletions || 0;
                }
            }

            const pullRequest = payload.pull_request || envelope.pull_request;
            if (pullRequest) {
                commitData.sha = pullRequest.head?.sha || pullRequest.merge_commit_sha;
                commitData.message = pullRequest.title || "";

                if (pullRequest.user?.login) {
                    commitData.author = pullRequest.user.login;
                    commitData.avatarUrl = pullRequest.user.avatar_url;
                }

                commitData.additions = pullRequest.additions || 0;
                commitData.deletions = pullRequest.deletions || 0;
            }

            const refValue = payload.ref || envelope.ref || payload?.payload?.ref || envelope?.payload?.ref;
            if (refValue) {
                const parts = refValue.split("/");
                commitData.branch = parts[parts.length - 1] || "main";
            }

            const [owner, repo] = row.repo_full_name.split("/");
            const resolvedSha = commitData.sha || payload.after || envelope.after || payload.head_commit?.id || envelope.head_commit?.id || null;

            return {
                id: row.github_event_id,
                author: commitData.author,
                avatar: commitData.avatarUrl || `https://github.com/${commitData.author || "unknown"}.png`,
                message: commitData.message || messageContent || "No commit message",
                additions: commitData.additions,
                deletions: commitData.deletions,
                timestamp: row.created_at,
                repo: row.repo_full_name,
                repoShort: repo,
                branch: commitData.branch,
                sha: resolvedSha,
                commitUrl: resolvedSha && owner && repo
                    ? `https://github.com/${owner}/${repo}/commit/${resolvedSha}`
                    : null,
                eventType
            };
        });

        res.json({
            success: true,
            activities
        });
    } catch (err) {
        console.error("[Dashboard] Error fetching recent activity:", err.message);
        res.status(500).json({
            error: "Failed to fetch recent activity",
            details: err.message
        });
    }
});

export default router;
