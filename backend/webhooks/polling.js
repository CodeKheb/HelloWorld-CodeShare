import pool from "../db/pool.js";

/**
 * Fetch GitHub events API for a repo
 * Returns array of events from GitHub
 */
async function fetchGithubEvents({ owner, repo, accessToken }) {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/events`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"
            }
        });

        if (!response.ok) {
            console.warn(`[POLLING] Failed to fetch events for ${owner}/${repo}: ${response.status}`);
            return {
                events: [],
                pollInterval: 60  // Default to 60 seconds
            };
        }

        const events = await response.json();
        
        // Extract poll interval from header (GitHub tells us minimum interval)
        const pollInterval = response.headers.get("X-Poll-Interval");
        const minInterval = pollInterval ? Math.max(parseInt(pollInterval), 60) : 60;

        return {
            events: Array.isArray(events) ? events : [],
            pollInterval: minInterval
        };
    } catch (err) {
        console.warn(`[POLLING] Error fetching events for ${owner}/${repo}:`, err.message);
        return {
            events: [],
            pollInterval: 60
        };
    }
}

/**
 * Check if an event has already been processed (deduplication)
 * Returns true if event is NEW, false if already processed
 */
async function isEventNew({ eventId, groupId, repoFullName }) {
    try {
        const result = await pool.query(
            `SELECT 1 FROM processed_events 
             WHERE github_event_id = $1 AND group_id = $2 AND repo_full_name = $3
             LIMIT 1`,
            [eventId, groupId, repoFullName]
        );

        return result.rows.length === 0;  // true if NOT found (is new)
    } catch (err) {
        console.error(`[POLLING] Error checking deduplication:`, err.message);
        return false;  // Assume already processed on error (safer)
    }
}

/**
 * Transform GitHub event to system message
 * Supports: PushEvent, PullRequestEvent, IssuesEvent, CreateEvent, DeleteEvent
 */
function transformEventToMessage(event, repoFullName) {
    const eventType = event.type;
    const actor = event.actor?.login || "Unknown";
    const payload = event.payload || {};

    let message = "";

    if (eventType === "PushEvent") {
        const ref = payload.ref?.split("/").pop() || "main";
        const commitCount = payload.commits?.length || 1;
        const commitWord = commitCount === 1 ? "commit" : "commits";
        message = `${actor} pushed ${commitCount} ${commitWord} to ${repoFullName} (${ref})`;
    } else if (eventType === "PullRequestEvent") {
        const action = payload.action || "updated";
        const prNumber = payload.number || "?";
        const prTitle = payload.pull_request?.title || "";
        const branch = payload.pull_request?.base?.ref || "main";
        message = `${actor} ${action} PR #${prNumber} "${prTitle}" on ${repoFullName} (${branch})`;
    } else if (eventType === "IssuesEvent") {
        const action = payload.action || "updated";
        const issueNumber = payload.number || "?";
        const issueTitle = payload.issue?.title || "";
        message = `${actor} ${action} issue #${issueNumber} "${issueTitle}" on ${repoFullName}`;
    } else if (eventType === "CreateEvent") {
        const refType = payload.ref_type || "ref";
        const ref = payload.ref || "?";
        message = `${actor} created ${refType} ${ref} on ${repoFullName}`;
    } else if (eventType === "DeleteEvent") {
        const refType = payload.ref_type || "ref";
        const ref = payload.ref || "?";
        message = `${actor} deleted ${refType} ${ref} on ${repoFullName}`;
    } else {
        // Generic fallback
        message = `${actor} triggered ${eventType} on ${repoFullName}`;
    }

    return message;
}

/**
 * Poll a single repo for new events and insert system messages
 */
async function pollRepoForEvents({ groupId, repoFullName, accessToken, io }) {
    try {
        const [owner, repo] = repoFullName.split("/");
        if (!owner || !repo) {
            console.warn(`[POLLING] Invalid repo format: ${repoFullName}`);
            return;
        }

        // Fetch recent events from GitHub
        const { events, pollInterval } = await fetchGithubEvents({
            owner,
            repo,
            accessToken
        });

        if (events.length === 0) {
            console.log(`[POLLING] No events found for ${repoFullName}`);
            return;
        }

        console.log(`[POLLING] Found ${events.length} events for ${repoFullName}, checking for new ones...`);

        // Process events in order (oldest first)
        // GitHub API returns newest first, so reverse to process chronologically
        const newMessages = [];

        for (const event of events.reverse()) {
            const eventId = event.id?.toString();
            if (!eventId) continue;

            // Check deduplication
            const isNew = await isEventNew({ eventId, groupId, repoFullName });
            if (!isNew) {
                console.log(`[POLLING] Event ${eventId} already processed, skipping...`);
                continue;
            }

            // Transform event to message
            const content = transformEventToMessage(event, repoFullName);

            // Insert system message
            const client = await pool.connect();
            try {
                await client.query("BEGIN");

                // Insert message
                const msgResult = await client.query(
                    `INSERT INTO messages (group_id, sender_id, content, type)
                     VALUES ($1, NULL, $2, 'system')
                     RETURNING id, content, created_at`,
                    [groupId, content]
                );

                const messageRow = msgResult.rows[0];

                // Record as processed
                await client.query(
                    `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (github_event_id) DO NOTHING`,
                    [eventId, event.type, groupId, repoFullName]
                );

                await client.query("COMMIT");
                newMessages.push(messageRow);
                console.log(`[POLLING] Inserted event ${eventId} as system message for ${repoFullName}`);

            } catch (err) {
                await client.query("ROLLBACK");
                console.error(`[POLLING] Error inserting event ${eventId}:`, err.message);
            } finally {
                client.release();
            }
        }

        // Emit socket events for all new messages
        if (io && newMessages.length > 0) {
            newMessages.forEach(msg => {
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
                console.log(`[POLLING] Emitted socket event for message ${msg.id}`);
            });
        }

    } catch (err) {
        console.error(`[POLLING] Error polling ${repoFullName}:`, err.message);
    }
}

/**
 * Main polling job: poll all repos with use_polling = TRUE
 */
async function pollAllReposWithPolling(io) {
    try {
        console.log(`[POLLING] Starting polling cycle at ${new Date().toISOString()}...`);

        // Get all repos that need polling
        // For each group with a polling repo, get one user's access token
        const repos = await pool.query(
            `SELECT DISTINCT gr.group_id, gr.repo_full_name, u.access_token
             FROM group_repos gr
             JOIN group_chats gc ON gr.group_id = gc.id
             JOIN group_members gm ON gc.id = gm.group_id
             JOIN users u ON gm.user_id = u.id
             WHERE gr.use_polling = TRUE AND u.access_token IS NOT NULL
             LIMIT 20
            `
        );

        if (repos.rows.length === 0) {
            console.log(`[POLLING] No repos to poll`);
            return;
        }

        console.log(`[POLLING] Polling ${repos.rows.length} repo(s)...`);

        // Poll each repo
        for (const repo of repos.rows) {
            await pollRepoForEvents({
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

export { pollAllReposWithPolling, pollRepoForEvents };
