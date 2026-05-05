import crypto from "crypto";
import pool from "../db/pool.js";

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

    const savedMessages = [];
    for (const repo of repoRows.rows) {
      const inserted = await client.query(
        `INSERT INTO messages (group_id, sender_id, content, type)
         VALUES ($1, NULL, $2, 'system')
         RETURNING id, group_id, sender_id, content, type, created_at`,
        [repo.group_id, content]
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
      `INSERT INTO messages (group_id, sender_id, content, type)
       VALUES ($1, NULL, $2, 'system')
       RETURNING id, group_id, sender_id, content, type, created_at`,
      [repo.group_id, content]
    );
    savedMessages.push(inserted.rows[0]);
  }
  return savedMessages;
}

export const handleGithubWebhook = async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).send("Signatures did not match");
    }

    const event = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"];
    const payload = req.body;

    const transformed = transformGithubEvent(event, payload);
    if (!transformed) {
      return res.status(200).send("Ignored event");
    }

    const savedMessages = await saveSystemMessages(transformed.repoFullName, transformed.content, {
      event,
      deliveryId,
      payload
    });

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