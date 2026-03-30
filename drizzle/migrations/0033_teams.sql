-- Teams tables for team-based contact assignment
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  encrypted_name TEXT NOT NULL,
  encrypted_description TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX teams_hub_idx ON teams (hub_id);

CREATE TABLE team_members (
  team_id TEXT NOT NULL,
  user_pubkey TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_pubkey)
);

CREATE INDEX team_members_user_idx ON team_members (user_pubkey);

CREATE TABLE contact_team_assignments (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  hub_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX contact_team_unique ON contact_team_assignments (contact_id, team_id);
CREATE INDEX contact_team_assignments_contact_idx ON contact_team_assignments (contact_id);
CREATE INDEX contact_team_assignments_team_idx ON contact_team_assignments (team_id);
CREATE INDEX contact_team_assignments_hub_idx ON contact_team_assignments (hub_id);
