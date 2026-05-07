-- Fix system message timestamps to use actual GitHub event times.
-- IMPORTANT: messages.created_at is TIMESTAMP WITHOUT TIME ZONE and is treated as UTC by the app.
-- So we parse GitHub ISO strings as timestamptz, then store them as UTC wall-clock timestamps.

-- Push: prefer latest commit timestamp, fallback to head_commit.timestamp
UPDATE messages m
SET created_at = (
  COALESCE(
    (
      SELECT MAX((c->>'timestamp')::timestamptz)
      FROM jsonb_array_elements(COALESCE(we.payload->'commits', '[]'::jsonb)) c
      WHERE c ? 'timestamp'
    ),
    NULLIF(we.payload->'head_commit'->>'timestamp', '')::timestamptz
  ) AT TIME ZONE 'UTC'
)
FROM webhook_events we
WHERE m.id = we.message_id
  AND m.type = 'system'
  AND we.github_event = 'push'
  AND (
    (we.payload ? 'commits' AND jsonb_typeof(we.payload->'commits') = 'array')
    OR (we.payload->'head_commit'->>'timestamp') IS NOT NULL
  );

-- Pull request: updated_at, fallback to created_at
UPDATE messages m
SET created_at = (
  COALESCE(
    NULLIF(we.payload->'pull_request'->>'updated_at', '')::timestamptz,
    NULLIF(we.payload->'pull_request'->>'created_at', '')::timestamptz
  ) AT TIME ZONE 'UTC'
)
FROM webhook_events we
WHERE m.id = we.message_id
  AND m.type = 'system'
  AND we.github_event = 'pull_request'
  AND (we.payload ? 'pull_request');

-- Issues: updated_at, fallback to created_at
UPDATE messages m
SET created_at = (
  COALESCE(
    NULLIF(we.payload->'issue'->>'updated_at', '')::timestamptz,
    NULLIF(we.payload->'issue'->>'created_at', '')::timestamptz
  ) AT TIME ZONE 'UTC'
)
FROM webhook_events we
WHERE m.id = we.message_id
  AND m.type = 'system'
  AND we.github_event = 'issues'
  AND (we.payload ? 'issue');

-- Verify all updates
SELECT
  we.github_event AS event_type,
  COUNT(*) AS updated_count,
  MIN(m.created_at) AS earliest,
  MAX(m.created_at) AS latest
FROM messages m
LEFT JOIN webhook_events we ON m.id = we.message_id
WHERE m.type = 'system'
GROUP BY we.github_event
ORDER BY event_type;
