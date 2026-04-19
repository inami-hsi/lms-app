-- Migration: allow admin writes for courses/lessons (via RLS + authenticated grants)
-- Run this in Supabase SQL Editor for existing projects.
--
-- Background:
-- - RLS policies already restrict writes to admins (public.is_admin()).
-- - But `authenticated` also needs table privileges for INSERT/UPDATE/DELETE.

grant select, insert, update, delete on table public.courses to authenticated;
grant select, insert, update, delete on table public.lessons to authenticated;

