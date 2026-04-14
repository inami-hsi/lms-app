-- Add hashed invitation tokens.
--
-- Why:
-- - Avoid storing plaintext invite tokens in the database.
-- - Invitation links still use the original token in the URL, but the DB stores only a hash.
--
-- This is the "safe first step":
-- - Adds `token_hash`
-- - Backfills existing rows from `token`
-- - Adds a unique index on `token_hash`
--
-- After deploying server code that reads/writes `token_hash`, you can optionally
-- run `migrate_invitation_token_purge.sql` to drop the plaintext token column.

create extension if not exists pgcrypto;

alter table public.invitations
  add column if not exists token_hash text;

-- Backfill: sha256(token::text) -> hex
update public.invitations
set token_hash = encode(digest(token::text, 'sha256'), 'hex')
where token_hash is null;

create unique index if not exists invitations_token_hash_key
  on public.invitations (token_hash);

