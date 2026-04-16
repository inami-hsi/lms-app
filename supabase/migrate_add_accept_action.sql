-- Migration: allow "accept" in invite_api_request_logs.action
-- Run this in Supabase SQL Editor for existing projects.
--
-- Note: older schemas used CHECK like:
--   action = ANY (ARRAY['create','resend','revoke'])
-- so we detect any CHECK constraint that references "action" (not only "action in (...)").

do $$
declare
  rel regclass := 'public.invite_api_request_logs'::regclass;
  existing_action_check text;
begin
  -- Best-effort: find an existing CHECK constraint referencing the action column.
  select c.conname
    into existing_action_check
  from pg_constraint c
  where c.conrelid = rel
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action%'
  limit 1;

  if existing_action_check is not null then
    execute format('alter table public.invite_api_request_logs drop constraint %I', existing_action_check);
  end if;

  -- Ensure the expected constraint name is cleared (in case a different constraint was dropped above).
  alter table public.invite_api_request_logs
    drop constraint if exists invite_api_request_logs_action_check;

  -- Re-add with accept included.
  alter table public.invite_api_request_logs
    add constraint invite_api_request_logs_action_check
    check (action = any (array['create', 'resend', 'revoke', 'accept']));
exception
  when duplicate_object then
    -- Already migrated (constraint exists); nothing to do.
    null;
end $$;
