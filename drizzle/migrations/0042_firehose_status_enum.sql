-- Convert firehose_connections.status from TEXT to a typed enum
CREATE TYPE firehose_connection_status AS ENUM ('pending', 'active', 'paused', 'disabled');

ALTER TABLE firehose_connections
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE firehose_connections
  ALTER COLUMN status TYPE firehose_connection_status
  USING status::firehose_connection_status;

ALTER TABLE firehose_connections
  ALTER COLUMN status SET DEFAULT 'pending'::firehose_connection_status;
