-- schema_reset.sql
-- ⚠️  WARNING: Running this file PERMANENTLY DELETES ALL DATA. ⚠️
-- Use ONLY for local development resets. NEVER run against production.

DROP TABLE IF EXISTS processed_events;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS group_repos;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS group_chats;
DROP TABLE IF EXISTS users;
