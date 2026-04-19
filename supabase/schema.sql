-- LMS MVP schema for Supabase (PostgreSQL)

create extension if not exists pgcrypto;

-- Optional (performance): enable if you want fast ILIKE search on text columns.
-- create extension if not exists pg_trgm;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null unique,
  avatar_url text,
  role text not null check (role in ('admin', 'learner')) default 'learner',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.allowed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  thumbnail_url text not null default '',
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  youtube_video_id text not null,
  "order" integer not null default 1,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.watch_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  watched_seconds integer not null default 0,
  total_seconds integer not null default 0,
  is_completed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- Store only a hash of the invite token (token itself is sent in the URL, never stored in DB).
  token_hash text not null unique,
  invited_by uuid,
  status text not null check (status in ('pending', 'accepted', 'expired', 'revoked')) default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.invite_email_logs (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid references public.invitations(id) on delete set null,
  email text not null,
  action text not null check (action in ('create', 'resend')),
  status text not null check (status in ('success', 'failed')),
  error_detail text,
  attempts integer not null default 1,
  triggered_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.invite_api_request_logs (
  id uuid primary key default gen_random_uuid(),
  triggered_by uuid,
  source_ip text,
  action text not null check (action in ('create', 'resend', 'revoke', 'accept')),
  allowed boolean not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  start_date date,
  cadence_days integer not null default 1,
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

-- Indexes (performance)
-- Note: If you already ran this schema, apply these via SQL Editor separately.
create index if not exists invite_email_logs_created_at_id_idx
  on public.invite_email_logs (created_at desc, id desc);

create index if not exists invite_api_request_logs_created_at_id_idx
  on public.invite_api_request_logs (created_at desc, id desc);

create index if not exists invite_email_logs_action_status_created_at_idx
  on public.invite_email_logs (action, status, created_at desc);

create index if not exists invite_api_request_logs_action_allowed_created_at_idx
  on public.invite_api_request_logs (action, allowed, created_at desc);

create index if not exists invite_api_request_logs_triggered_by_created_at_idx
  on public.invite_api_request_logs (triggered_by, created_at desc);

create index if not exists invite_api_request_logs_source_ip_created_at_idx
  on public.invite_api_request_logs (source_ip, created_at desc);

-- Optional (performance): use trigram indexes for fast ILIKE '%term%' search.
-- create index if not exists invite_email_logs_email_trgm_idx
--   on public.invite_email_logs using gin (email gin_trgm_ops);
-- create index if not exists invite_api_request_logs_source_ip_trgm_idx
--   on public.invite_api_request_logs using gin (source_ip gin_trgm_ops);

create or replace function public.expire_pending_invitations()
returns integer
language plpgsql
security definer
as $$
declare
  affected integer;
begin
  update public.invitations
  set status = 'expired'
  where status = 'pending'
    and expires_at < now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.expire_pending_invitations() to authenticated;

alter table public.profiles enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.watch_progress enable row level security;
alter table public.invitations enable row level security;
alter table public.invite_email_logs enable row level security;
alter table public.invite_api_request_logs enable row level security;
alter table public.calendar_feeds enable row level security;
alter table public.calendar_feed_tokens enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.is_active = true
  );
$$;

-- Do not expose helper function to client roles (policies can still use it)
revoke all on function public.is_admin() from anon, authenticated;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (
  id = auth.uid()
  and email = (auth.jwt() ->> 'email')
  and role = 'learner'
);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and email = (auth.jwt() ->> 'email')
  and role = 'learner'
);

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all"
on public.profiles
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "allowed_emails_admin_all" on public.allowed_emails;
create policy "allowed_emails_admin_all"
on public.allowed_emails
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "allowed_emails_select_by_email" on public.allowed_emails;
create policy "allowed_emails_select_by_email"
on public.allowed_emails
for select
using ((auth.jwt() ->> 'email') = email);

drop policy if exists "invitations_admin_all" on public.invitations;
create policy "invitations_admin_all"
on public.invitations
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "invite_email_logs_admin_all" on public.invite_email_logs;
create policy "invite_email_logs_admin_all"
on public.invite_email_logs
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "invite_api_request_logs_admin_all" on public.invite_api_request_logs;
create policy "invite_api_request_logs_admin_all"
on public.invite_api_request_logs
for all
using (public.is_admin())
with check (public.is_admin());

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


drop policy if exists "courses_select_published_or_admin" on public.courses;
create policy "courses_select_published_or_admin"
on public.courses
for select
using (is_published = true or public.is_admin());

drop policy if exists "courses_admin_write" on public.courses;
create policy "courses_admin_write"
on public.courses
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "lessons_select_published_or_admin" on public.lessons;
create policy "lessons_select_published_or_admin"
on public.lessons
for select
using (is_published = true or public.is_admin());

drop policy if exists "lessons_admin_write" on public.lessons;
create policy "lessons_admin_write"
on public.lessons
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "watch_progress_select_own_or_admin" on public.watch_progress;
create policy "watch_progress_select_own_or_admin"
on public.watch_progress
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "watch_progress_insert_own" on public.watch_progress;
create policy "watch_progress_insert_own"
on public.watch_progress
for insert
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "watch_progress_update_own_or_admin" on public.watch_progress;
create policy "watch_progress_update_own_or_admin"
on public.watch_progress
for update
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Privileges hardening
--
-- Supabase projects often start with broad default grants for `anon` and
-- `authenticated`. We revoke them and re-grant the minimum needed by the
-- client app. Admin-only tables are accessed through server APIs using the
-- Service Role key.
-- ---------------------------------------------------------------------------
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all routines in schema public from anon, authenticated;

grant select on table public.courses to authenticated;
grant select on table public.lessons to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select on table public.allowed_emails to authenticated;
grant select, insert, update on table public.watch_progress to authenticated;

-- Maintenance function should not be callable from the client.
revoke execute on function public.expire_pending_invitations() from authenticated;
