CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_uploads_owner ON uploads(owner_id, created_at);
CREATE INDEX idx_uploads_message ON uploads(message_id);

CREATE TABLE message_mentions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  mention_type TEXT NOT NULL,
  target_id TEXT,
  PRIMARY KEY (message_id, mention_type, target_id)
);
CREATE INDEX idx_mentions_target ON message_mentions(mention_type, target_id);
