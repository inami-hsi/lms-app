-- Optional scheduler setup for automatic invitation expiration
-- Requires pg_cron availability in your Supabase project plan.

create extension if not exists pg_cron;

select cron.schedule(
  'expire-pending-invitations-every-30m',
  '*/30 * * * *',
  $$select public.expire_pending_invitations();$$
);

-- To remove the job later:
-- select cron.unschedule('expire-pending-invitations-every-30m');
