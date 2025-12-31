-- Migration: Add email content fields to messages table
-- Purpose: Support direct storage of email content in D1 database (replacing R2 storage)
-- Date: 2025-12-30
-- Execution: wrangler d1 migrations apply --local TEMP_MAIL_DB

-- Add email_content field (full raw email content)
ALTER TABLE messages ADD COLUMN email_content TEXT DEFAULT '';

-- Add text_content field (plain text version)
ALTER TABLE messages ADD COLUMN text_content TEXT DEFAULT '';

-- Add html_content field (HTML version)
ALTER TABLE messages ADD COLUMN html_content TEXT DEFAULT '';

-- Note: This migration is idempotent-safe via wrangler's migration tracking
-- Note: Existing r2_bucket and r2_object_key fields are preserved for rollback capability
-- Note: D1 single row limit is 1MB; email content should be validated before insert
