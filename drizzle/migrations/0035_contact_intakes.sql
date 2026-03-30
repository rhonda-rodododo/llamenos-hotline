CREATE TABLE contact_intakes (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  contact_id TEXT,
  call_id TEXT,
  encrypted_payload TEXT NOT NULL,
  payload_envelopes JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  submitted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contact_intakes_hub_idx ON contact_intakes (hub_id);
CREATE INDEX contact_intakes_status_idx ON contact_intakes (hub_id, status);
CREATE INDEX contact_intakes_contact_idx ON contact_intakes (contact_id);
