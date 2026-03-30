ALTER TABLE contacts ADD COLUMN merged_into TEXT;
CREATE INDEX contacts_merged_into_idx ON contacts (merged_into) WHERE merged_into IS NOT NULL;
