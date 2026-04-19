-- Migration: extend calendar feed settings (weekend skip / lessons per day / per-course cadence)
-- Run this in Supabase SQL Editor for existing projects that already applied `migrate_calendar_feed.sql`.

alter table public.calendar_feeds
  add column if not exists lessons_per_day integer not null default 1;

alter table public.calendar_feeds
  add column if not exists skip_weekends boolean not null default false;

alter table public.calendar_feeds
  add column if not exists course_cadence_days jsonb not null default '{}'::jsonb;

