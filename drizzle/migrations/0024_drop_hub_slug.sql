-- Drop hub slug column (replaced by hub ID routing)
ALTER TABLE hubs DROP COLUMN IF EXISTS slug;
