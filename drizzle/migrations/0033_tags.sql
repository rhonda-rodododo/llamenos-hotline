-- Tags table
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  name TEXT NOT NULL,
  encrypted_label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  encrypted_category TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX tags_hub_name_unique ON tags (hub_id, name);

-- GIN index for contacts.tags JSONB array
CREATE INDEX contacts_tags_gin_idx ON contacts USING GIN (tags);

-- strictTags setting on hubs
ALTER TABLE hubs ADD COLUMN strict_tags BOOLEAN NOT NULL DEFAULT true;
