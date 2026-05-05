import pool from "../db/pool.js";

/**
 * Poll GitHub API for recent commits on a repo
 * Returns array of commits, or empty array if error
 */
async function getRecentCommits({ owner, repo, accessToken, lastCommitSha }) {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/commits`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"
            }
        });

        if (!response.ok) {
            console.warn(`[POLLING] Failed to fetch commits for ${owner}/${repo}: ${response.status}`);
            return [];
        }

        const commits = await response.json();
        
        // If we have a last commit SHA, find where that commit appears in the list
        // and return only newer commits
        if (lastCommitSha && Array.isArray(commits)) {
            const lastIndex = commits.findIndex(c => c.sha === lastCommitSha);
            if (lastIndex > -1) {
                // Return commits newer than the last one we processed
                return commits.slice(0, lastIndex);
            }
        }

        // If no last commit, return most recent 5
        return commits.slice(0, 5);
    } catch (err) {
        console.warn(`[POLLING] Error fetching commits for ${owner}/${repo}:`, err.message);
        return [];
    }
}

/**
 * Transform a GitHub commit into a system message
 */
function transformCommitToMessage(commit, repoFullName) {
    const author = commit.commit?.author?.name || "Unknown";
    const message = commit.commit?.message || "";
    const firstLine = message.split("\n")[0];
    const sha = commit.sha?.substring(0, 7) || "";

    return `${author} pushed commit ${sha} to ${repoFullName}: ${firstLine}`;
}

/**
 * Poll a single repo for new commits and create system messages
 */
async function pollRepoForUpdates({ groupId, repoFullName, accessToken, io }) {
    try {
        const [owner, repo] = repoFullName.split("/");
        if (!owner || !repo) {
            console.warn(`[POLLING] Invalid repo format: ${repoFullName}`);
            return;
        }

        // Get the group_repos row to check last_commit_sha
        const repoRow = await pool.query(
            `SELECT id, last_commit_sha FROM group_repos 
             WHERE group_id = $1 AND repo_full_name = $2`,
            [groupId, repoFullName]
        );

        if (repoRow.rows.length === 0) {
            console.warn(`[POLLING] Repo not found in group: ${repoFullName}`);
            return;
        }

        const { last_commit_sha } = repoRow.rows[0];

        // Fetch recent commits
        const commits = await getRecentCommits({
            owner,
            repo,
            accessToken,
            lastCommitSha: last_commit_sha
        });

        if (commits.length === 0) {
            console.log(`[POLLING] No new commits for ${repoFullName}`);
            return;
        }

        console.log(`[POLLING] Found ${commits.length} new commits for ${repoFullName}`);

        // Insert system messages for each new commit (newest first in reverse)
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const messages = [];
            for (let i = commits.length - 1; i >= 0; i--) {
                const commit = commits[i];
                const content = transformCommitToMessage(commit, repoFullName);

                const msgResult = await client.query(
                    `INSERT INTO messages (group_id, sender_id, content, type)
                     VALUES ($1, NULL, $2, 'system')
                     RETURNING id, content, created_at`,
                    [groupId, content]
                );

                messages.push(msgResult.rows[0]);
            }

            // Update last_commit_sha to the newest commit
            const newestCommitSha = commits[0]?.sha;
            if (newestCommitSha) {
                await client.query(
                    `UPDATE group_repos
                     SET last_commit_sha = $1, last_checked_at = NOW()
                     WHERE group_id = $2 AND repo_full_name = $3`,
                    [newestCommitSha, groupId, repoFullName]
                );
            }

            await client.query("COMMIT");

            // Emit socket events for all new messages
            if (io) {
                messages.forEach(msg => {
                    io.to(`group-${groupId}`).emit("server-group-text", {
                        id: msg.id,
                        group_id: groupId,
                        sender_id: null,
                        sender_username: null,
                        sender_avatar: null,
                        content: msg.content,
                        type: "system",
                        created_at: msg.created_at
                    });
                });
            }

        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

    } catch (err) {
        console.error(`[POLLING] Error polling ${repoFullName}:`, err.message);
    }
}

/**
 * Poll all repos without webhooks in all groups
 * Called by background job
 */
async function pollAllReposWithoutWebhooks(io) {
    try {
        console.log(`[POLLING] Starting polling cycle...`);

        // Get all repos that:
        // 1. Don't have a webhook (webhook_id IS NULL)
        // 2. Haven't been checked in the last 5 minutes OR have never been checked
        const repos = await pool.query(
            `SELECT gr.group_id, gr.repo_full_name, u.access_token
             FROM group_repos gr
             JOIN group_chats gc ON gr.group_id = gc.id
             JOIN group_members gm ON gc.id = gm.group_id
             JOIN users u ON gm.user_id = u.id
             WHERE gr.webhook_id IS NULL
             AND (gr.last_checked_at IS NULL OR gr.last_checked_at < NOW() - INTERVAL '5 minutes')
             LIMIT 1  -- Take one user per repo for polling
            `
        );

        if (repos.rows.length === 0) {
            console.log(`[POLLING] No repos to poll`);
            return;
        }

        // Poll each repo
        for (const repo of repos.rows) {
            await pollRepoForUpdates({
                groupId: repo.group_id,
                repoFullName: repo.repo_full_name,
                accessToken: repo.access_token,
                io
            });
        }

        console.log(`[POLLING] Polling cycle complete`);
    } catch (err) {
        console.error(`[POLLING] Error in polling cycle:`, err.message);
    }
}

export { pollRepoForUpdates, pollAllReposWithoutWebhooks };
