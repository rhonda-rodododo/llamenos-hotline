ALTER TABLE users ADD COLUMN phone_envelopes JSONB NOT NULL DEFAULT '[]';
ALTER TABLE invite_codes ADD COLUMN phone_envelopes JSONB NOT NULL DEFAULT '[]';
