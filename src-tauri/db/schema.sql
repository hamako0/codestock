CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  code TEXT NOT NULL,
  language TEXT NOT NULL,
  code_blocks TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS snippet_tags (
  snippet_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (snippet_id, tag_id),
  FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  snippet_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snippets_updated_at ON snippets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tags_normalized_name ON tags(normalized_name);
