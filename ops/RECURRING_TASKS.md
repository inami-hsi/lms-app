# Recurring Ops Tasks

This document defines recurring operations tasks and ready-to-send reminder templates.

## Monthly (recommended)
### 1) Audit CSV exports
- When: first business day of each month (or your preferred date)
- Owner: Admin
- Task:
  1. Open `https://lms.ai-nagoya.com/admin/users`
  2. Export CSV from:
     - `招待メール送信ログ`
     - `招待APIレート制限ログ`
  3. Save files using:
     - `invite_email_logs_YYYY-MM-DD.csv`
     - `invite_api_request_logs_YYYY-MM-DD.csv`
  4. Upload to shared drive: `ops/audit-exports/` (restricted)
- Guide: `ops/audit-exports/README.md`

### 2) Access review (light)
- When: monthly (same day as audit exports)
- Owner: Admin
- Task:
  - Check shared drive folder permissions for `ops/audit-exports/` remain restricted
  - Confirm who has access to:
    - Vercel project
    - Supabase project
    - Resend account

## Quarterly
### 3) Secrets rotation (if policy requires)
- When: quarterly (or on incident)
- Owner: Admin
- Task:
  - Rotate in safe order:
    1. `SUPABASE_SERVICE_ROLE_KEY` (Vercel)
    2. `RESEND_API_KEY` (Vercel)
    3. (Optional) `SUPABASE_ANON_KEY` (Vercel + rebuild frontend)
  - Update Vercel env vars and redeploy
  - Record the change (date + reason) in a deploy run note: `ops/deploy-runs/YYYY-MM-DD.md`
- Checklist: `ops/SECRETS_CHECKLIST.md`

## After each deploy (ad hoc)
### 4) Post-deploy smoke test + record
- When: every production deploy
- Owner: Deployer
- Task:
  - Follow `ops/DEPLOY_CHECKLIST.md`
  - Record the run in `ops/deploy-runs/YYYY-MM-DD.md`

## Reminder templates
See `ops/reminders/`.

