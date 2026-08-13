import pool from "../db/pool.js";
import { generatePollingEventId } from "./github.js";
import { decryptToken } from "../db/tokenEncryption.js";

async function resolveUserTokenColumn() {
        const result = await pool.query(
                `SELECT column_name
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                     AND table_name = 'users'
                     AND column_name IN ('access_token', 'accessToken')
                 ORDER BY CASE column_name WHEN 'access_token' THEN 1 WHEN 'accessToken' THEN 2 ELSE 99 END
                 LIMIT 1`
        );

        return result.rows[0]?.column_name || null;
}

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

function normalizeGithubEventType(eventType) {
    if (eventType === "PushEvent") return "push";
    if (eventType === "PullRequestEvent") return "pull_request";
    if (eventType === "IssuesEvent") return "issues";
    if (eventType === "CreateEvent") return "create";
    if (eventType === "DeleteEvent") return "delete";
    return eventType;
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
            // Generate stable event ID that matches webhook format
            const stableEventId = generatePollingEventId(event, repoFullName);
            const legacyEventId = event.id?.toString(); // Keep for fallback compatibility
            
            if (!stableEventId && !legacyEventId) continue;

            const eventTimestamp = getEventTimestamp(event);

            // Normalize event timestamp and log decision context
            const eventMs = eventTimestamp ? new Date(eventTimestamp).getTime() : NaN;
            const eventLocal = eventTimestamp || 'unknown';
            const cmpResult = Number.isNaN(eventMs) || Number.isNaN(cutoffAtMs) ? 'invalid' : (eventMs > cutoffAtMs ? 'after' : 'before');
            console.log(`[POLLING] Event ${stableEventId} timestamp=${eventLocal} (${eventMs}ms) cutoff=${cutoffAtRow} (${cutoffAtMs}ms) => ${cmpResult}`);

            if (!isAfterCutoff(eventTimestamp, cutoffAtMs)) {
                console.log(`[POLLING] Skipping event ${stableEventId} for ${repoFullName} because ${eventTimestamp || 'unknown time'} is not after cutoff ${cutoffAtRow || 'none'}`);
                continue;
            }

            // Check deduplication BEFORE doing any processing
            const isNew = await isEventNew({ eventId: stableEventId, groupId, repoFullName });
            if (!isNew) {
                console.log(`[POLLING] Event ${stableEventId} already processed, skipping...`);
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

                // Preserve the raw GitHub event payload so the dashboard can render
                // polling activity using the same data path as webhook events.
                await client.query(
                    `INSERT INTO webhook_events (message_id, group_id, repo_full_name, webhook_id, github_event, delivery_id, payload)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        messageRow.id,
                        groupId,
                        repoFullName,
                        null,
                        normalizeGithubEventType(event.type),
                        null,
                        event
                    ]
                );

                // Record as processed
                await client.query(
                    `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (github_event_id, group_id) DO NOTHING`,
                    [stableEventId, normalizeGithubEventType(event.type), groupId, repoFullName]
                );

                await client.query("COMMIT");
                newMessages.push(messageRow);
                console.log(`[POLLING] Inserted event ${stableEventId} as system message for ${repoFullName}`);

            } catch (err) {
                await client.query("ROLLBACK");
                console.error(`[POLLING] Error inserting event ${stableEventId}:`, err.message);
            } finally {
                client.release();
            }
        }

        // Emit socket events for all new messages
        if (io && newMessages.length > 0) {
            newMessages.forEach(msg => {
                io.to(String(groupId)).emit("server-group-text", {
                    id: msg.id,
                    group_id: groupId,
                    sender_id: null,
                    sender_username: null,
                    sender_avatar: null,
                    content: msg.content,
                    type: "system",
                    created_at: msg.created_at
                });
                console.log(`[POLLING] Emitted socket event for message ${msg.id} to group ${groupId}`);
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

        const tokenColumn = await resolveUserTokenColumn();
        if (!tokenColumn) {
            console.warn('[POLLING] No token column found on users table (expected access_token or accessToken); skipping polling cycle');
            return;
        }

        const tokenExpr = `u.${tokenColumn}`;

        // Diagnostics: count repos flagged for polling vs repos with at least one member token
        try {
            const totalToPollRes = await pool.query(`SELECT COUNT(*) AS cnt FROM group_repos WHERE use_polling = TRUE`);
            const pollableReposRes = await pool.query(`
                SELECT COUNT(DISTINCT gr.group_id) AS cnt
                FROM group_repos gr
                WHERE gr.use_polling = TRUE
                  AND (
                      -- Group has its own member with token
                      EXISTS (
                          SELECT 1 FROM group_members gm JOIN users u ON gm.user_id = u.id
                          WHERE gm.group_id = gr.group_id AND ${tokenExpr} IS NOT NULL
                      )
                      OR
                      -- OR another group sharing this repo has a member with token
                      EXISTS (
                          SELECT 1 FROM group_repos gr2
                          JOIN group_members gm ON gm.group_id = gr2.group_id
                          JOIN users u ON gm.user_id = u.id
                          WHERE gr2.repo_full_name = gr.repo_full_name AND ${tokenExpr} IS NOT NULL
                      )
                  )
            `);
            console.log(`[POLLING] Repos flagged for polling=${totalToPollRes.rows[0].cnt}, repos with available tokens=${pollableReposRes.rows[0].cnt}`);
        } catch (diagErr) {
            console.warn('[POLLING] Diagnostics query failed:', diagErr.message);
        }

        // Get all repos that need polling.
        // For each group, use one authenticated member's token from the same group if available,
        // otherwise use a token from ANY OTHER group that has the same repo.
        const repos = await pool.query(
            `SELECT gr.group_id,
                    gr.repo_full_name,
                                        COALESCE(
                                                (SELECT ${tokenExpr}
                                                 FROM group_members gm
                                                 JOIN users u ON gm.user_id = u.id
                                                 WHERE gm.group_id = gr.group_id
                                                     AND ${tokenExpr} IS NOT NULL
                                                 ORDER BY gm.joined_at ASC
                                                 LIMIT 1),
                                                (SELECT ${tokenExpr}
                                                 FROM group_repos gr2
                                                 JOIN group_members gm ON gm.group_id = gr2.group_id
                                                 JOIN users u ON gm.user_id = u.id
                                                 WHERE gr2.repo_full_name = gr.repo_full_name
                                                     AND ${tokenExpr} IS NOT NULL
                                                 ORDER BY gm.joined_at ASC
                                                 LIMIT 1)
                                        ) AS access_token
                         FROM group_repos gr
                         WHERE gr.use_polling = TRUE
            `
        );

                const pollableRepos = repos.rows.filter((repo) => repo.access_token);

                if (pollableRepos.length === 0) {
            console.log(`[POLLING] No repos to poll`);
            try {
                const sampleNoTokenRes = await pool.query(`
                    SELECT gr.group_id, gr.repo_full_name
                    FROM group_repos gr
                    WHERE gr.use_polling = TRUE
                      AND NOT EXISTS (
                        SELECT 1 FROM group_members gm JOIN users u ON gm.user_id = u.id
                                                WHERE gm.group_id = gr.group_id AND ${tokenExpr} IS NOT NULL
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM group_repos gr2
                        JOIN group_members gm ON gm.group_id = gr2.group_id
                        JOIN users u ON gm.user_id = u.id
                                                WHERE gr2.repo_full_name = gr.repo_full_name AND ${tokenExpr} IS NOT NULL
                      )
                    LIMIT 10
                `);
                if (sampleNoTokenRes.rows.length > 0) {
                    console.log('[POLLING] Sample repos with no available tokens:', sampleNoTokenRes.rows);
                } else {
                    console.log('[POLLING] All repos have available tokens but polling failed for other reasons');
                }
            } catch (diagErr) {
                console.warn('[POLLING] Diagnostics sample query failed:', diagErr.message);
            }

            return;
        }

        console.log(`[POLLING] Polling ${pollableRepos.length} repo(s)...`);

        // Poll each repo
        for (const repo of pollableRepos) {
            await pollRepoForEvents({
                groupId: repo.group_id,
                repoFullName: repo.repo_full_name,
                accessToken: decryptToken(repo.access_token),
                io
            });
        }

        console.log(`[POLLING] Polling cycle complete`);
    } catch (err) {
        console.error(`[POLLING] Error in polling cycle:`, err?.message || err || 'Unknown error');
        if (err?.stack) console.error(err.stack);
    }
}

export { pollAllReposWithPolling, pollRepoForEvents };
