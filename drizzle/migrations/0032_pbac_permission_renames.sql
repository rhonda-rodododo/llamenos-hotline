-- Rename permission strings in stored roles
UPDATE roles SET permissions = replace(
  replace(
    replace(permissions::text,
      '"contacts:read-summary"', '"contacts:envelope-summary"'),
    '"contacts:read-pii"', '"contacts:envelope-full"'),
  '"shifts:read"', '"shifts:read-all"'
)::jsonb;

-- Add assignedTo column for case manager assignment
ALTER TABLE contacts ADD COLUMN assigned_to TEXT;
CREATE INDEX contacts_assigned_to_idx ON contacts (assigned_to) WHERE assigned_to IS NOT NULL;
