import express from "express";
import pool from "../db/pool.js";

const router = express.Router();

/**
 * GET /api/dashboard/recent-activity
 * Returns deduplicated recent GitHub events (from both webhooks and polling)
 * - Queries messages plus webhook_events to get raw payload data
 * - Deduplicates using DISTINCT ON (github_event_id)
 * - Extracts commit data, author, SHA from raw payloads
 * - Filters to user's groups only
 * - Limits to 20 results within the last 24 hours, ordered by most recent
 */
router.get("/recent-activity", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const query = `
            SELECT DISTINCT ON (pe.github_event_id)
                pe.github_event_id,
                m.created_at,
                pe.repo_full_name,
                we.payload,
                we.github_event,
                m.content AS message_content,
                pe.event_type
            FROM processed_events pe
            JOIN messages m ON m.group_id = pe.group_id
                AND m.type = 'system'
            JOIN group_repos gr ON gr.group_id = pe.group_id
                AND gr.repo_full_name = pe.repo_full_name
            LEFT JOIN webhook_events we ON we.group_id = pe.group_id
                AND we.repo_full_name = pe.repo_full_name
                AND (
                    we.message_id = m.id
                    OR (we.github_event = pe.event_type AND we.payload->>'id' = pe.github_event_id)
                )
            WHERE pe.group_id IN (
                SELECT gm.group_id 
                FROM group_members gm 
                WHERE gm.user_id = $1
            )
            AND m.created_at >= NOW() - INTERVAL '24 hours'
            ORDER BY pe.github_event_id, m.created_at DESC
            LIMIT 20
        `;

        const result = await pool.query(query, [req.user.id]);
        
        const activities = result.rows.map(row => {
            const payload = row.payload || {};
            const messageContent = row.message_content || "";
            
            // Extract commit data from webhook payload
            let commitData = {
                author: "Unknown",
                avatarUrl: null,
                message: "",
                sha: null,
                additions: 0,
                deletions: 0,
                branch: "main"
            };

            const parseMessageContent = (content) => {
                if (!content) return;

                const pushMatch = content.match(/^(.*?) pushed (\d+) commit(?:s)? to (.+?) \((.+)\)$/i);
                if (pushMatch) {
                    commitData.author = pushMatch[1] || commitData.author;
                    commitData.branch = pushMatch[4] || commitData.branch;
                    return;
                }

                const prMatch = content.match(/^(.*?) (opened|closed|reopened|synchronize|updated) PR #\d+ "(.+?)" on (.+?) \((.+)\)$/i);
                if (prMatch) {
                    commitData.author = prMatch[1] || commitData.author;
                    commitData.branch = prMatch[5] || commitData.branch;
                }
            };

            parseMessageContent(messageContent);

            // Priority 1: Get author from sender (most reliable for webhooks)
            if (payload.sender) {
                commitData.author = payload.sender.login || payload.sender.name || "Unknown";
                commitData.avatarUrl = payload.sender.avatar_url;
            }

            // Priority 2: For push events, extract commit details
            if (payload.commits && Array.isArray(payload.commits) && payload.commits.length > 0) {
                const commit = payload.commits[0];
                commitData.sha = commit.id || commit.sha;
                commitData.message = commit.message || "";
                
                // Fallback: get author from commit author if sender not available
                if (!commitData.author || commitData.author === "Unknown") {
                    if (commit.author?.username) {
                        commitData.author = commit.author.username;
                    } else if (commit.author?.name) {
                        commitData.author = commit.author.name;
                    }
                }
                
                // Get additions/deletions from commit stats
                if (typeof commit.stats === 'object') {
                    commitData.additions = commit.stats.additions || 0;
                    commitData.deletions = commit.stats.deletions || 0;
                }
            }

            // Priority 3: For pull request events
            if (payload.pull_request) {
                const pr = payload.pull_request;
                commitData.sha = pr.head?.sha || pr.merge_commit_sha;
                commitData.message = pr.title || "";
                
                // Try to get author from PR user or fallback to sender
                if (pr.user?.login) {
                    commitData.author = pr.user.login;
                    commitData.avatarUrl = pr.user.avatar_url;
                }
                
                commitData.additions = pr.additions || 0;
                commitData.deletions = pr.deletions || 0;
            }

            // Extract branch from ref (e.g., "refs/heads/main" -> "main")
            if (payload.ref) {
                const parts = payload.ref.split("/");
                commitData.branch = parts[parts.length - 1] || "main";
            }

            // Parse repo_full_name to get owner and repo
            const [owner, repo] = row.repo_full_name.split("/");

            return {
                id: row.github_event_id,
                author: commitData.author,
                avatar: commitData.avatarUrl || `https://github.com/${commitData.author || "unknown"}.png`,
                message: commitData.message || messageContent || "No commit message",
                additions: commitData.additions,
                deletions: commitData.deletions,
                timestamp: row.created_at, // ISO string in UTC
                repo: row.repo_full_name,
                repoShort: repo,
                branch: commitData.branch,
                sha: commitData.sha || payload.after || payload.head_commit?.id || null,
                commitUrl: (commitData.sha || payload.after || payload.head_commit?.id) && owner && repo
                    ? `https://github.com/${owner}/${repo}/commit/${commitData.sha || payload.after || payload.head_commit?.id}`
                    : null,
                eventType: row.github_event
            };
        });

        res.json({
            success: true,
            activities: activities
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
