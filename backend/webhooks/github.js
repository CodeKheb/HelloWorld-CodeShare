import crypto from "crypto";
import pool from "../db/pool.js";

function getEventTimestampFromPayload(event, payload) {
  try {
    if (event === 'push') {
      const commits = Array.isArray(payload?.commits) ? payload.commits : [];
      const commitDates = commits.map(c => c?.timestamp).filter(Boolean);
      if (commitDates.length > 0) {
        // return the latest commit timestamp (ISO string)
        return commitDates.reduce((latest, cur) => (new Date(cur).getTime() > new Date(latest).getTime() ? cur : latest));
      }
      return payload?.head_commit?.timestamp || payload?.created_at || null;
    }

    // For other events, prefer the payload timestamps or fallback to now
    return payload?.created_at || payload?.updated_at || null;
  } catch (err) {
    return null;
  }
}

/**
 * Generate a stable event ID that works consistently across webhook and polling sources
 * Uses repo + event type + unique identifier from payload
 */
function generateStableEventId(event, repoFullName, payload) {
  try {
    if (event === 'push') {
      // Use the commit SHA as it's stable across sources
      const afterSha = payload?.after;
      if (afterSha) return `${repoFullName}:push:${afterSha}`;
    }

    if (event === 'pull_request') {
      const prNumber = payload?.number || payload?.pull_request?.number;
      if (prNumber) return `${repoFullName}:pr:${prNumber}`;
    }

    if (event === 'issues') {
      const issueNumber = payload?.number || payload?.issue?.number;
      if (issueNumber) return `${repoFullName}:issue:${issueNumber}`;
    }

    if (event === 'create' || event === 'delete') {
      const refType = payload?.ref_type || '';
      const ref = payload?.ref || '';
      if (ref) return `${repoFullName}:${event}:${refType}:${ref}`;
    }

    // Fallback: use timestamp-based ID (less precise but better than nothing)
    const timestamp = getEventTimestampFromPayload(event, payload) || new Date().toISOString();
    const ts = new Date(timestamp).getTime();
    return `${repoFullName}:${event}:${ts}`;
  } catch (err) {
    // Last resort: use timestamp
    return `${repoFullName}:${event}:${Date.now()}`;
  }
}

/**
 * Generate stable event ID for GitHub API events (used by polling)
 * Maps GitHub API event format to stable ID
 */
export function generatePollingEventId(event, repoFullName) {
  try {
    // GitHub API events have: { id, type, payload, created_at, actor, repo }
    const eventType = event.type;
    const payload = event.payload || {};

    if (eventType === 'PushEvent') {
      const afterSha = payload.after;
      if (afterSha) return `${repoFullName}:push:${afterSha}`;
    }

    if (eventType === 'PullRequestEvent') {
      const prNumber = payload.number || payload.pull_request?.number;
      if (prNumber) return `${repoFullName}:pr:${prNumber}`;
    }

    if (eventType === 'IssuesEvent') {
      const issueNumber = payload.number || payload.issue?.number;
      if (issueNumber) return `${repoFullName}:issue:${issueNumber}`;
    }

    if (eventType === 'CreateEvent' || eventType === 'DeleteEvent') {
      const refType = payload.ref_type || '';
      const ref = payload.ref || '';
      if (ref) return `${repoFullName}:${eventType === 'CreateEvent' ? 'create' : 'delete'}:${refType}:${ref}`;
    }

    // Fallback: use event creation time
    const timestamp = event.created_at || new Date().toISOString();
    const ts = new Date(timestamp).getTime();
    return `${repoFullName}:${eventType}:${ts}`;
  } catch (err) {
    return `${repoFullName}:event:${Date.now()}`;
  }
}

export function generateStableEventIdForWebhook(event, repoFullName, payload) {
  return generateStableEventId(event, repoFullName, payload);
}


export function verifyWebhookSignature(req) {
  const skip = process.env.WEBHOOK_SKIP_SIGNATURE === "true";
  if (skip) return true;

  const secret = process.env.GITHUB_WEBHOOK_SECRET || "test_secret";
  const signature = req.headers["x-hub-signature-256"];
  const rawBody = req.rawBody;

  if (!signature || !rawBody) return false;

  const hmac = crypto.createHmac("sha256", secret);
  const digest = `sha256=${hmac.update(rawBody).digest("hex")}`;

  const digestBuffer = Buffer.from(digest, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  if (digestBuffer.length !== signatureBuffer.length) return false;

  return crypto.timingSafeEqual(digestBuffer, signatureBuffer);
}

export function transformGithubEvent(event, payload) {
  const repoFullName = payload?.repository?.full_name;
  if (!repoFullName) return null;

  if (event === "push") {
    const pusher = payload?.pusher?.name || payload?.sender?.login || "Someone";
    const branch = String(payload?.ref || "").replace("refs/heads/", "") || "unknown";
    const commitCount = Array.isArray(payload?.commits) ? payload.commits.length : 0;
    return {
      repoFullName,
      content: `${pusher} pushed ${commitCount} commit${commitCount === 1 ? "" : "s"} to ${repoFullName} (${branch})`
    };
  }

  if (event === "pull_request") {
    const action = payload?.action;
    if (!["opened", "closed", "reopened", "synchronize"].includes(action)) {
      return null;
    }
    const actor = payload?.sender?.login || "Someone";
    const title = payload?.pull_request?.title || "Untitled PR";
    const number = payload?.pull_request?.number || payload?.number;
    return {
      repoFullName,
      content: `${actor} ${action} PR #${number}: ${title} in ${repoFullName}`
    };
  }

  return null;
}

export async function saveSystemMessages(repoFullName, content, metadata = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const repoRows = await client.query(
      `SELECT group_id, webhook_id FROM group_repos WHERE repo_full_name = $1`,
      [repoFullName]
    );

    if (repoRows.rows.length === 0) {
      console.log(`[WEBHOOK] No groups found for repo ${repoFullName}`);
      await client.query("COMMIT");
      return [];
    }

    console.log(`[WEBHOOK] Found ${repoRows.rows.length} group(s) with repo ${repoFullName}`);

    // Determine event timestamp from payload (commit time for push events).
    // Normalize to UTC string because messages.created_at is timestamp without time zone
    // and the frontend treats stored values as UTC.
    const eventTimestampRaw = getEventTimestampFromPayload(metadata.event, metadata.payload) || new Date().toISOString();
    const parsedEventDate = new Date(eventTimestampRaw);
    const eventTimestamp = Number.isNaN(parsedEventDate.getTime())
      ? new Date().toISOString()
      : parsedEventDate.toISOString();
    const eventMs = new Date(eventTimestamp).getTime();

    // Generate a stable event ID that works consistently across webhook and polling
    const stableEventId = generateStableEventIdForWebhook(metadata.event, repoFullName, metadata.payload);
    console.log(`[WEBHOOK] Generated stable event ID: ${stableEventId}`);

    const savedMessages = [];

    for (const repo of repoRows.rows) {
      // Check if already processed for this group
      const alreadyProcessed = await client.query(
        `SELECT 1 FROM processed_events 
         WHERE github_event_id = $1 AND group_id = $2 AND repo_full_name = $3 
         LIMIT 1`,
        [stableEventId, repo.group_id, repoFullName]
      );

      if (alreadyProcessed.rows.length > 0) {
        console.log(`[WEBHOOK] Event ${stableEventId} already processed for group ${repo.group_id}, skipping`);
        continue;
      }
      // Only insert system messages if group has at least one non-system message.
      const userMessageCheck = await client.query(
        `SELECT MAX(m.created_at) AS latest_message
         FROM messages m
         WHERE m.group_id = $1 AND m.type <> 'system'`,
        [repo.group_id]
      );

      const latestUserMessage = userMessageCheck.rows[0]?.latest_message;
      const cutoffAt = latestUserMessage || null;
      const cutoffMs = cutoffAt ? new Date(cutoffAt).getTime() : null;

      // If we have a cutoff (there are prior user messages) and the event is older or equal to cutoff,
      // skip inserting the system message AND mark processed to avoid future duplicates.
      if (cutoffMs !== null && Number.isFinite(eventMs) && eventMs <= cutoffMs) {
        console.log(`[WEBHOOK] Event ${stableEventId} is older than latest user message in group ${repo.group_id}, skipping message creation but marking processed`);
        await client.query(
          `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (github_event_id, group_id) DO NOTHING`,
          [stableEventId, metadata.event || null, repo.group_id, repoFullName]
        );
        continue;
      }

      // Insert message with the event's timestamp (UTC)
      const inserted = await client.query(
        `INSERT INTO messages (group_id, sender_id, content, type, created_at)
         VALUES ($1, NULL, $2, 'system', $3)
         RETURNING id, group_id, sender_id, content, type, created_at`,
        [repo.group_id, content, eventTimestamp]
      );

      const saved = inserted.rows[0];
      savedMessages.push(saved);

      // Keep webhook metadata for audit/debugging without blocking message delivery.
      await client.query(
        `INSERT INTO webhook_events (message_id, group_id, repo_full_name, webhook_id, github_event, delivery_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          saved.id,
          repo.group_id,
          repoFullName,
          repo.webhook_id,
          metadata.event || null,
          metadata.deliveryId || null,
          metadata.payload || null
        ]
      );

      // Mark processed only after successfully creating message
      await client.query(
        `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (github_event_id, group_id) DO NOTHING`,
        [stableEventId, metadata.event || null, repo.group_id, repoFullName]
      );
      
      console.log(`[WEBHOOK] Created message ${saved.id} for group ${repo.group_id}, marked event processed`);
    }

    await client.query("COMMIT");
    return savedMessages;
  } catch (error) {
    await client.query("ROLLBACK");
    // If metadata table is missing in existing DBs, still keep system message behavior.
    if (error?.code === "42P01") {
      return await saveSystemMessagesWithoutMetadata(repoFullName, content);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function saveSystemMessagesWithoutMetadata(repoFullName, content) {
  const repoRows = await pool.query(
    `SELECT group_id FROM group_repos WHERE repo_full_name = $1`,
    [repoFullName]
  );

  const savedMessages = [];
  for (const repo of repoRows.rows) {
    const inserted = await pool.query(
      `INSERT INTO messages (group_id, sender_id, content, type, created_at)
       VALUES ($1, NULL, $2, 'system', $3)
       RETURNING id, group_id, sender_id, content, type, created_at`,
      [repo.group_id, content, new Date().toISOString()]
    );
    savedMessages.push(inserted.rows[0]);
  }
  return savedMessages;
}

export const handleGithubWebhook = async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) {
      console.warn('[WEBHOOK] Missing/invalid signature for delivery', req.headers['x-github-delivery'], 'signatureHeaderPresent=', !!req.headers['x-hub-signature-256']);
      return res.status(401).send("Signatures did not match");
    }

    const event = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"];
    const payload = req.body;

    const transformed = transformGithubEvent(event, payload);
    if (!transformed) {
      return res.status(200).send("Ignored event");
    }

    const repoFullName = transformed.repoFullName;

    const savedMessages = await saveSystemMessages(repoFullName, transformed.content, {
      event,
      deliveryId,
      payload
    });

    // Note: events are now marked as processed in saveSystemMessages() for each group
    // No need for redundant marking here

    const io = req.app.get("io");
    if (io) {
      console.log(`[WEBHOOK] Broadcasting ${savedMessages.length} message(s) to groups...`);
      savedMessages.forEach((saved) => {
        io.to(String(saved.group_id)).emit("server-group-text", {
          id: saved.id,
          groupId: saved.group_id,
          senderId: null,
          text: saved.content,
          type: saved.type,
          timestamp: saved.created_at,
          author: "System",
          authorName: "System",
          avatar: "/default-avatar.png"
        });
        console.log(`[WEBHOOK] Emitted message to group ${saved.group_id}`);
      });
    }

    return res.status(200).json({
      status: "OK",
      savedMessages: savedMessages.length,
      groups: savedMessages.map(m => m.group_id)
    });
  } catch (error) {
    console.error("Error processing webhook delivery:", error);
    return res.status(500).json({ error: "Failed to process webhook" });
  }
};