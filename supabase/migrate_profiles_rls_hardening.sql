-- Fix privilege-escalation risk in `profiles` RLS.
--
-- Problem:
-- - If a user can `UPDATE public.profiles` for their own row without restrictions,
--   they could set `role='admin'` and become admin.
--
-- This migration:
-- - Makes `is_admin()` SECURITY DEFINER to avoid policy recursion.
-- - Adds INSERT policy for first-login profile creation.
-- - Restricts self INSERT/UPDATE to `role='learner'` (no self-promotion).
-- - Allows admins to manage profiles via RLS as well (optional but convenient).
--
-- Safe to run multiple times.

-- Recreate helper function (SECURITY DEFINER avoids RLS recursion)
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
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active = true
  );
$$;

-- Do not expose helper function to client roles (policies can still use it)
revoke all on function public.is_admin() from anon, authenticated;

-- Policies
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
using (id = auth.uid() or public.is_admin());

-- Allow first login to create own profile row.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (
  id = auth.uid()
  and email = (auth.jwt() ->> 'email')
  and role = 'learner'
);

-- Allow user to update only their own non-privileged fields, and never self-promote.
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

-- Optional: admin can manage profiles via SQL editor / Supabase UI.
drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all"
on public.profiles
for all
using (public.is_admin())
with check (public.is_admin());

