-- Migration: allow "accept" in invite_api_request_logs.action
-- Run this in Supabase SQL Editor for existing projects.

do $$
declare
  rel regclass := 'public.invite_api_request_logs'::regclass;
  existing_action_check text;
begin
  -- Find an existing CHECK constraint that references "action in (...)".
  select c.conname
    into existing_action_check
  from pg_constraint c
  where c.conrelid = rel
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action in (%';

  if existing_action_check is not null then
    execute format('alter table public.invite_api_request_logs drop constraint %I', existing_action_check);
  end if;

  -- Re-add with accept included.
  alter table public.invite_api_request_logs
    add constraint invite_api_request_logs_action_check
    check (action in ('create', 'resend', 'revoke', 'accept'));
exception
  when duplicate_object then
    -- Already migrated (constraint exists); nothing to do.
    null;
end $$;

