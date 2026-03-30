ALTER TABLE custom_field_definitions ADD COLUMN visible_to TEXT NOT NULL DEFAULT 'contacts:envelope-summary';
ALTER TABLE custom_field_definitions DROP COLUMN show_in_user_view;
