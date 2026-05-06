import express from "express";
import pool from "../db/pool.js";

const router = express.Router();

/**
 * GET /api/dashboard/recent-activity
 * Returns deduplicated recent GitHub events (from both webhooks and polling)
 * - Queries messages table where type = 'system'
 * - Joins with group_repos to get repo info
 * - Deduplicates using DISTINCT ON (github_event_id)
 * - Extracts commit data from webhook_events payload
 * - Limits to 20 results, ordered by most recent
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
                gr.repo_full_name,
                we.payload,
                pe.event_type
            FROM processed_events pe
            JOIN messages m ON m.id = (
                SELECT id FROM messages 
                WHERE group_id = pe.group_id 
                AND type = 'system'
                ORDER BY created_at DESC 
                LIMIT 1
            )
            JOIN group_repos gr ON gr.group_id = pe.group_id 
                AND gr.repo_full_name = pe.repo_full_name
            LEFT JOIN webhook_events we ON we.group_id = pe.group_id 
                AND we.repo_full_name = pe.repo_full_name
                AND we.payload->>'id' = pe.github_event_id
            -- Also include the user's groups
            WHERE pe.group_id IN (
                SELECT gm.group_id 
                FROM group_members gm 
                WHERE gm.user_id = $1
            )
            ORDER BY pe.github_event_id, m.created_at DESC
            LIMIT 20
        `;

        const result = await pool.query(query, [req.user.id]);
        
        const activities = result.rows.map(row => {
            const payload = row.payload || {};
            
            // Extract commit data from webhook payload
            let commitData = {
                author: "Unknown",
                message: "",
                sha: null,
                additions: 0,
                deletions: 0,
                avatar: null
            };
            
            // Try to get author and avatar from sender (most reliable)
            if (payload.sender) {
                commitData.author = payload.sender.login || payload.sender.name || "Unknown";
                commitData.avatar = payload.sender.avatar_url;
            }
            
            // For push events with commits
            if (payload.commits && Array.isArray(payload.commits) && payload.commits.length > 0) {
                const commit = payload.commits[0];
                commitData.sha = commit.id || commit.sha;
                commitData.message = commit.message || "";
                
                // Try to get author from commit if not from sender
                if (commitData.author === "Unknown" && commit.author) {
                    commitData.author = commit.author.username || commit.author.name || "Unknown";
                }
                
                // For GitHub API data, look for additions/deletions at commit level
                if (typeof commit.stats === 'object') {
                    commitData.additions = commit.stats.additions || 0;
                    commitData.deletions = commit.stats.deletions || 0;
                }
            }
            
            // For pull request events
            if (payload.pull_request) {
                const pr = payload.pull_request;
                commitData.sha = pr.head?.sha || pr.merge_commit_sha;
                commitData.message = pr.title || "";
                commitData.author = pr.user?.login || payload.sender?.login || "Unknown";
                commitData.avatar = pr.user?.avatar_url || payload.sender?.avatar_url;
                commitData.additions = pr.additions || 0;
                commitData.deletions = pr.deletions || 0;
            }

            // Parse repo_full_name to get owner and repo
            const [owner, repo] = row.repo_full_name.split("/");

            return {
                id: row.github_event_id,
                author: commitData.author,
                avatar: commitData.avatar || `https://avatars.githubusercontent.com/u/0?v=4`, // Fallback avatar
                message: commitData.message,
                additions: commitData.additions,
                deletions: commitData.deletions,
                timestamp: row.created_at,
                repo: row.repo_full_name,
                repoShort: repo,
                branch: payload.ref ? payload.ref.split("/").pop() : "main",
                sha: commitData.sha,
                commitUrl: commitData.sha 
                    ? `https://github.com/${owner}/${repo}/commit/${commitData.sha}`
                    : null,
                eventType: row.event_type
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
