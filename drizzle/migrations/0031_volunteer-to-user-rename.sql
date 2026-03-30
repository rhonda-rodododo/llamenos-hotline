ALTER TABLE volunteers RENAME TO users;
ALTER TABLE call_legs RENAME COLUMN volunteer_pubkey TO user_pubkey;
ALTER TABLE shift_schedules RENAME COLUMN volunteer_pubkeys TO user_pubkeys;
ALTER TABLE shift_overrides RENAME COLUMN volunteer_pubkeys TO user_pubkeys;
ALTER TABLE ring_groups RENAME COLUMN volunteer_pubkeys TO user_pubkeys;
ALTER TABLE fallback_group RENAME COLUMN volunteer_pubkeys TO user_pubkeys;
ALTER TABLE webauthn_settings RENAME COLUMN require_for_volunteers TO require_for_users;
ALTER TABLE custom_field_definitions RENAME COLUMN show_in_volunteer_view TO show_in_user_view;
ALTER TABLE transcription_settings RENAME COLUMN allow_volunteer_opt_out TO allow_user_opt_out;
UPDATE roles SET permissions = replace(permissions::text, '"volunteers:', '"users:')::jsonb
  WHERE permissions::text LIKE '%"volunteers:%';
