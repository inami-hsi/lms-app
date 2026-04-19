-- Migration: calendar feed (per-user ICS subscription)
-- Run this in Supabase SQL Editor for existing projects.
--
-- Creates:
-- - public.calendar_feeds: per-user schedule settings
-- - public.calendar_feed_tokens: subscription tokens (hashed)
--
-- Notes:
-- - Tokens are stored as SHA-256 hashes only.
-- - This feature is served via Vercel API endpoints; client roles should not have table privileges.

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  start_date date,
  cadence_days integer not null default 1,
  lessons_per_day integer not null default 1,
  skip_weekends boolean not null default false,
  course_cadence_days jsonb not null default '{}'::jsonb,
  deadline_days integer not null default 7,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.calendar_feeds(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists calendar_feed_tokens_feed_id_created_at_idx
  on public.calendar_feed_tokens (feed_id, created_at desc);

alter table public.calendar_feeds enable row level security;
alter table public.calendar_feed_tokens enable row level security;

-- Admin-only access via RLS (optional). Server APIs typically use service_role key.
drop policy if exists "calendar_feeds_admin_all" on public.calendar_feeds;
create policy "calendar_feeds_admin_all"
on public.calendar_feeds
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "calendar_feed_tokens_admin_all" on public.calendar_feed_tokens;
create policy "calendar_feed_tokens_admin_all"
on public.calendar_feed_tokens
for all
using (public.is_admin())
with check (public.is_admin());

-- Ensure client roles don't gain access.
revoke all privileges on table public.calendar_feeds from anon, authenticated;
revoke all privileges on table public.calendar_feed_tokens from anon, authenticated;
