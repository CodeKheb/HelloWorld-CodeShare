-- Drop commands DO NOT use yet until we need a clean wipe

-- DROP TABLE IF EXISTS messages;
-- DROP TABLE IF EXISTS group_repos;
-- DROP TABLE IF EXISTS group_members;
-- DROP TABLE IF EXISTS group_chats;
-- DROP TABLE IF EXISTS users;


-- User table that stores user information as well as timestamp
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  github_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  access_token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Stores group chat information such as chat name, who and when it was created, and when it was last summarized by AI
CREATE TABLE group_chats (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  last_summarized_at TIMESTAMP,
  is_direct BOOLEAN DEFAULT FALSE  -- checks if the conversation will be a DM or a Group (group as default)
);

-- Stores infromation in regards about the group members
CREATE TABLE group_members (
  group_id INTEGER REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- Stores which group owns the repository, the repo name, and its connection to github
CREATE TABLE group_repos (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES group_chats(id) ON DELETE CASCADE,
  repo_full_name VARCHAR(255) NOT NULL,
  webhook_id BIGINT,
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (group_id, repo_full_name)
);

-- Stores message information
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES group_chats(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'text'
    CHECK (type IN ('text', 'system', 'ai_summary')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Stores webhook delivery metadata linked to system messages
CREATE TABLE webhook_events (
  id SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES group_chats(id) ON DELETE CASCADE,
  repo_full_name VARCHAR(255) NOT NULL,
  webhook_id BIGINT,
  github_event VARCHAR(64),
  delivery_id VARCHAR(128),
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);