-- Test data for Admin Logs paging/sort verification.
-- Safe to run multiple times (uses unique-ish emails).

-- 1) Invite email logs: 180 rows, all with the exact same created_at to stress tie-break by id.
insert into public.invite_email_logs (email, action, status, error_detail, attempts, created_at)
select
  'test+cursor' || g.i || '@example.com',
  case when g.i % 2 = 0 then 'create' else 'resend' end,
  case when g.i % 5 = 0 then 'failed' else 'success' end,
  case when g.i % 5 = 0 then 'cursor tie-break test' else null end,
  1,
  timestamptz '2026-04-13 00:00:00+00'
from generate_series(1, 180) as g(i);

-- 2) Invite API request logs: 180 rows, same created_at.
insert into public.invite_api_request_logs (triggered_by, source_ip, action, allowed, reason, created_at)
select
  null,
  '203.0.113.' || (g.i % 50),
  case when g.i % 3 = 0 then 'revoke' when g.i % 2 = 0 then 'resend' else 'create' end,
  (g.i % 4) <> 0,
  case when (g.i % 4) = 0 then 'rate_limited' else null end,
  timestamptz '2026-04-13 00:00:00+00'
from generate_series(1, 180) as g(i);

-- Optional cleanup:
-- delete from public.invite_email_logs where email like 'test+cursor%';
-- delete from public.invite_api_request_logs where reason = 'rate_limited' and created_at = timestamptz '2026-04-13 00:00:00+00';
