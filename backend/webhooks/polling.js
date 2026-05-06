import pool from "../db/pool.js";

/**
 * Fetch GitHub events API for a repo
 * Returns array of events from GitHub
 */
async function fetchGithubEvents({ owner, repo, accessToken }) {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/events?per_page=10`;
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

function getEventTimestamp(event) {
    const payload = event?.payload || {};

    if (event?.type === "PushEvent") {
        const commitDates = Array.isArray(payload.commits)
            ? payload.commits
                .map(commit => commit?.timestamp)
                .filter(Boolean)
            : [];

        if (commitDates.length > 0) {
            return commitDates.reduce((latest, current) => {
                return new Date(current).getTime() > new Date(latest).getTime() ? current : latest;
            });
        }

        return payload.head_commit?.timestamp || event.created_at || null;
    }

    return event?.created_at || event?.updated_at || null;
}

function isAfterCutoff(eventTimestamp, cutoffTimestamp) {
    if (!cutoffTimestamp) return false;
    if (!eventTimestamp) return false;

    // Normalize both timestamps to UTC milliseconds to avoid timezone mismatches
    // GitHub events are in UTC; database timestamps may vary, so always normalize
    const eventMs = new Date(eventTimestamp).getTime();
    const cutoffMs = new Date(cutoffTimestamp).getTime();

    if (Number.isNaN(eventMs) || Number.isNaN(cutoffMs)) {
        return true;
    }

    return eventMs > cutoffMs;
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

        // Determine cutoff: the later of when the group was created
        // and when this repo was attached to the group.
        // This guarantees we NEVER surface commits that predate the group's existence.
        const cutoffRow = await pool.query(
            `SELECT
                gc.created_at           AS group_created_at,
                gr.attached_at          AS repo_attached_at,
                gr.last_checked_at      AS last_checked_at
            FROM group_chats gc
            JOIN group_repos gr
                ON gr.group_id = gc.id
                AND gr.repo_full_name = $2
            WHERE gc.id = $1`,
            [groupId, repoFullName]
        );

        if (cutoffRow.rows.length === 0) {
            console.warn(`[POLLING] Could not find group/repo row for group ${groupId}, repo ${repoFullName}. Skipping.`);
            return;
        }


        const { group_created_at, repo_attached_at, last_checked_at } = cutoffRow.rows[0];

        // Use the latest of: group creation, repo attachment, or last successful poll.
        // This is the earliest possible moment a commit could be relevant.
        const candidates = [group_created_at, repo_attached_at, last_checked_at]
            .filter(Boolean)
            .map(t => new Date(t).getTime())
            .filter(ms => !Number.isNaN(ms));

        const cutoffAtMs = candidates.length > 0 ? Math.max(...candidates) : 0;
        const cutoffAtRow = new Date(cutoffAtMs).toISOString();
        console.log(`[POLLING] Cutoff for group ${groupId} / ${repoFullName}: ${cutoffAtRow} (group_created=${group_created_at}, repo_attached=${repo_attached_at}, last_checked=${last_checked_at})`);


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

            const eventTimestamp = getEventTimestamp(event);

            // Normalize event timestamp and log decision context
            const eventMs = eventTimestamp ? new Date(eventTimestamp).getTime() : NaN;
            const eventLocal = eventTimestamp || 'unknown';
            const cmpResult = Number.isNaN(eventMs) || Number.isNaN(cutoffAtMs) ? 'invalid' : (eventMs > cutoffAtMs ? 'after' : 'before');
            console.log(`[POLLING] Event ${eventId} timestamp=${eventLocal} (${eventMs}ms) cutoff=${cutoffAtRow} (${cutoffAtMs}ms) => ${cmpResult}`);

            if (!isAfterCutoff(eventTimestamp, cutoffAtMs)) {
                console.log(`[POLLING] Skipping event ${eventId} for ${repoFullName} because ${eventTimestamp || 'unknown time'} is not after cutoff ${cutoffAtRow || 'none'}`);
                // still mark processed to avoid re-processing across polls
                try {
                    await pool.query(
                        `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (github_event_id, group_id) DO NOTHING`,
                        [eventId, event.type, groupId, repoFullName]
                    );
                } catch (e) {
                    console.warn(`[POLLING] Failed to mark skipped event ${eventId} processed:`, e.message);
                }
                continue;
            }

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
                    `INSERT INTO messages (group_id, sender_id, content, type, created_at)
                    VALUES ($1, NULL, $2, 'system', $3)
                    RETURNING id, content, created_at`,
                    [groupId, content, new Date(eventTimestamp).toISOString()]
                );

                const messageRow = msgResult.rows[0];

                // Record as processed
                await client.query(
                    `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (github_event_id, group_id) DO NOTHING`,
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

        await pool.query(
            `UPDATE group_repos SET last_checked_at = NOW()
            WHERE group_id = $1 AND repo_full_name = $2`,
            [groupId, repoFullName]
        );

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

        // Get all repos that need polling.
        // For each group, use one authenticated member's token.
        const repos = await pool.query(
            `SELECT gr.group_id,
                    gr.repo_full_name,
                    auth_user.access_token
             FROM group_repos gr
             JOIN group_chats gc ON gr.group_id = gc.id
             JOIN LATERAL (
                 SELECT u.access_token
                 FROM group_members gm
                 JOIN users u ON gm.user_id = u.id
                 WHERE gm.group_id = gc.id
                   AND u.access_token IS NOT NULL
                 ORDER BY gm.joined_at ASC
                 LIMIT 1
             ) auth_user ON TRUE
             WHERE gr.use_polling = TRUE
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
