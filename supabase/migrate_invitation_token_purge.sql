-- Purge plaintext invitation tokens (optional hardening).
--
-- Prerequisites:
-- - `migrate_invitation_token_hash.sql` has been applied
-- - `migrate_invitation_token_relax.sql` has been applied
-- - Server code has been deployed to use `token_hash` for lookups and writes
--
-- This migration:
-- - Makes `token_hash` NOT NULL
-- - Sets `token` to NULL for all rows (removing plaintext tokens)
-- - Drops the `token` column (so it can never leak again)
--
-- NOTE:
-- - If you want to keep `token` for a short grace period, comment out the DROP COLUMN.

alter table public.invitations
  alter column token_hash set not null;

-- Remove plaintext tokens.
update public.invitations
set token = null
where token is not null;

-- Finally, remove the column entirely.
alter table public.invitations
  drop column token;
