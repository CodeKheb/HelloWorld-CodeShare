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
      await client.query("COMMIT");
      return [];
    }

    // Determine event timestamp from payload (commit time for push events)
    const eventTimestamp = getEventTimestampFromPayload(metadata.event, metadata.payload) || new Date().toISOString();
    const eventMs = new Date(eventTimestamp).getTime();

    const savedMessages = [];

    for (const repo of repoRows.rows) {
      // Only insert system messages if group has at least one non-system message.
      const userMessageCheck = await client.query(
        `SELECT MAX(m.created_at) AS latest_message
         FROM messages m
         WHERE m.group_id = $1 AND m.type <> 'system'`,
        [repo.group_id]
      );

      const latestUserMessage = userMessageCheck.rows[0]?.latest_message;
      if (!latestUserMessage) {
        // No user messages yet, don't insert system message. Still mark as processed and
        // store webhook payload so dashboards and other tooling can read raw event data.
        console.log(`[WEBHOOK] Group ${repo.group_id} has no user messages yet, skipping system message but recording payload and marking processed`);

        // Insert webhook_events record (message_id NULL) so raw payload is preserved
        await client.query(
          `INSERT INTO webhook_events (message_id, group_id, repo_full_name, webhook_id, github_event, delivery_id, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [null, repo.group_id, repoFullName, repo.webhook_id, metadata.event || null, metadata.deliveryId || null, metadata.payload || null]
        );

        // Record processed_events so polling won't re-insert later
        await client.query(
          `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (github_event_id, group_id) DO NOTHING`,
          [metadata.deliveryId ? `webhook_${metadata.deliveryId}` : `webhook_${Date.now()}`, metadata.event || null, repo.group_id, repoFullName]
        );

        continue;
      }

      const cutoffAt = latestUserMessage;
      const cutoffMs = new Date(cutoffAt).getTime();

      // If event is older or equal to cutoff, skip inserting but still mark processed to avoid future duplicates
      if (Number.isFinite(eventMs) && eventMs <= cutoffMs) {
        // Record processed_events so polling won't re-insert later
        await client.query(
          `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (github_event_id, group_id) DO NOTHING`,
          [metadata.deliveryId ? `webhook_${metadata.deliveryId}` : `webhook_${Date.now()}`, metadata.event || null, repo.group_id, repoFullName]
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

      // Mark processed per-group
      await client.query(
        `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (github_event_id, group_id) DO NOTHING`,
        [metadata.deliveryId ? `webhook_${metadata.deliveryId}` : `webhook_${Date.now()}`, metadata.event || null, repo.group_id, repoFullName]
      );
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

    // Use deliveryId as event ID for deduplication (unique per GitHub delivery)
    const webhookEventId = `webhook_${deliveryId}`;

    const savedMessages = await saveSystemMessages(repoFullName, transformed.content, {
      event,
      deliveryId,
      payload
    });

    // After saving system messages for each group, mark the event as processed per group
    try {
      for (const saved of savedMessages) {
        await pool.query(
          `INSERT INTO processed_events (github_event_id, event_type, group_id, repo_full_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (github_event_id, group_id) DO NOTHING`,
          [webhookEventId, event, saved.group_id, repoFullName]
        );
      }
    } catch (err) {
      console.warn(`[WEBHOOK] Warning: failed to record processed event per group:`, err.message);
    }

    const io = req.app.get("io");
    if (io) {
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
      });
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Error processing webhook delivery:", error);
    return res.status(500).send("Failed to process webhook");
  }
};