-- Allow running the app without storing plaintext invitation tokens.
--
-- This migration keeps the `token` column temporarily for backward compatibility,
-- but makes it optional so server code can stop writing it immediately.
--
-- Apply after `migrate_invitation_token_hash.sql`, and before deploying server code
-- that only writes `token_hash`.

alter table public.invitations
  alter column token drop default,
  alter column token drop not null;

