-- Drop role slug (replaced by encrypted name + id)
ALTER TABLE roles DROP COLUMN IF EXISTS slug;
