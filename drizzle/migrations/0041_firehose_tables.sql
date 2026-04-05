-- Firehose Report Agent tables
CREATE TABLE firehose_connections (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL REFERENCES hubs(id),
  signal_group_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  encrypted_display_name TEXT,
  report_type_id TEXT NOT NULL REFERENCES report_types(id),
  agent_pubkey TEXT NOT NULL,
  encrypted_agent_nsec TEXT NOT NULL,
  geo_context TEXT,
  geo_context_country_codes TEXT[],
  inference_endpoint TEXT,
  extraction_interval_sec INTEGER NOT NULL DEFAULT 60,
  system_prompt_suffix TEXT,
  buffer_ttl_days INTEGER NOT NULL DEFAULT 7,
  notify_via_signal BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX firehose_connections_hub_idx ON firehose_connections (hub_id);
CREATE INDEX firehose_connections_signal_group_idx ON firehose_connections (signal_group_id);

CREATE TABLE firehose_message_buffer (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES firehose_connections(id) ON DELETE CASCADE,
  signal_timestamp TIMESTAMPTZ NOT NULL,
  encrypted_content TEXT NOT NULL,
  encrypted_sender_info TEXT NOT NULL,
  cluster_id TEXT,
  extracted_report_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX firehose_buffer_connection_idx ON firehose_message_buffer (connection_id);
CREATE INDEX firehose_buffer_expires_idx ON firehose_message_buffer (expires_at);

CREATE TABLE firehose_notification_optouts (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES firehose_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX firehose_optout_unique ON firehose_notification_optouts (connection_id, user_id);
