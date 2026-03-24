ALTER TABLE "spam_settings" ADD COLUMN "captcha_max_attempts" integer DEFAULT 3 NOT NULL;
ALTER TABLE "captcha_state" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
