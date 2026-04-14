-- Harden table/function privileges for Supabase roles.
--
-- Goal:
-- - `anon`: no direct table access (all access should go through Auth + RLS)
-- - `authenticated`: only the minimum required for learner UI
-- - Admin-only tables are accessed via server APIs using the Service Role key
--
-- Safe to run multiple times.

-- 1) Remove overly-broad default grants
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all routines in schema public from anon, authenticated;

-- 2) Re-grant only what the client app needs
-- Courses/Lessons: authenticated users can read (RLS still applies)
grant select on table public.courses to authenticated;
grant select on table public.lessons to authenticated;

-- Profiles: the app upserts/updates the logged-in user's row (RLS restricts to own id)
grant select, insert, update on table public.profiles to authenticated;

-- Allowed emails: client checks if the logged-in email is invited (RLS restricts to own email)
grant select on table public.allowed_emails to authenticated;

-- Watch progress: the app writes the logged-in user's progress (RLS restricts to own user_id)
grant select, insert, update on table public.watch_progress to authenticated;

-- Optional: if you want to allow signed-out browsing of published courses/lessons,
-- uncomment the following lines (RLS will still restrict to published rows).
-- grant select on table public.courses to anon;
-- grant select on table public.lessons to anon;

-- 3) Functions
-- `expire_pending_invitations()` shouldn't be callable from the client; it's for scheduled maintenance.
-- Revoke any broad grants and leave it to service_role/postgres (cron).
revoke execute on function public.expire_pending_invitations() from authenticated;
