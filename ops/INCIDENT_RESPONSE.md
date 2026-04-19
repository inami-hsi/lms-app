# Incident Response (Ops)

This is a practical “what to do first” guide when the LMS is partially or fully down.

## Scope / architecture
- Frontend: Xserver static (`https://lms.ai-nagoya.com`)
- APIs: Vercel serverless (`/api/*`)
- DB/Auth: Supabase
- Email: Resend

## 0) First actions (5 minutes)
1. Confirm user impact (what is broken, when it started, who is affected).
2. Pick a severity and owner.
3. Freeze risky changes (pause deploys / avoid schema changes) until stable.
4. Collect evidence:
   - Browser DevTools Network screenshot (status codes + failing request URL)
   - Exact error message shown to users
   - Time window (JST)

### Severity (simple)
- Sev1: login unusable / app unreachable / data loss risk
- Sev2: admin functions broken / invitations broken / degraded performance
- Sev3: minor UI bug / isolated users / non-critical feature

## 1) Fast triage: is it Frontend, API, or Supabase?
Use DevTools (Network tab) on `https://lms.ai-nagoya.com/admin/users`.

- If the page itself is 404/blank:
  - Likely Xserver deploy issue (missing `index.html` / wrong upload path)
  - Or SPA routing issue (missing `.htaccess`)
- If `OPTIONS /api/...` is failing (405/403):
  - CORS/preflight issue (Vercel env `CORS_ALLOWED_ORIGINS`, or API handler missing OPTIONS)
- If `GET /api/admin-logs` is 500/401:
  - Vercel env vars missing/invalid (`SUPABASE_*`)
  - Supabase auth/profile/role issue
- If Supabase calls from the frontend fail:
  - Frontend env (`VITE_SUPABASE_*`) mismatch or Supabase outage

## 2) Where to look (logs / status)
### Vercel
- Project → Deployments → latest deployment status
- Failed deployment → Functions Logs (error stack + env missing)

### Supabase
- Dashboard → Logs (API/DB/Auth)
- Authentication → Users (user exists? email verified? provider)
- Table editor: `profiles` (admin role/is_active)

### Resend
- Dashboard → Logs (delivery failures, bounces)
- Domains: sender domain status is Verified

## 2.1) Alerting (GitHub Actions uptime check)
This repo includes a scheduled workflow that checks:
- Frontend: `https://lms.ai-nagoya.com/`
- API: `<vercel>/api/invite-token?token=...` (expects HTTP 200 even if token is unknown)

When the workflow fails, GitHub can email the repo watchers (depends on each user's GitHub notification settings).

Setup:
- GitHub repo → Settings → Secrets and variables → Actions → Variables
  - Set `LMS_API_BASE_URL` if your Vercel project URL changes.
- GitHub user settings → Notifications
  - Enable notifications for Actions/Deployments failures (email/Slack as desired).

## 3) Common incidents & fixes
### A) `/admin/users` direct access returns 404
Symptoms:
- `https://lms.ai-nagoya.com/admin/users` is 404, but `/` may load.
Fix:
- Ensure Xserver has SPA fallback `.htaccess` at the web root.
- Re-upload frontend using the *contents* of `dist/` (not the `dist/` folder).

### B) CORS preflight fails (OPTIONS 405/403)
Symptoms:
- Network shows `OPTIONS /api/...` failing, followed by blocked `GET/POST`.
Fix:
- Confirm Vercel env: `CORS_ALLOWED_ORIGINS` includes `https://lms.ai-nagoya.com`
- Confirm API handler implements `OPTIONS` and returns 204 with CORS headers.
- Redeploy Vercel after env change.

### C) Supabase server env missing (500 from `/api/*`)
Symptoms:
- API returns 500 with “Supabase server env is not configured.”
Fix:
- Set/verify on Vercel (Production):
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Redeploy.

### D) Admin permission errors (403)
Symptoms:
- API returns 403 “Admin permission is required.”
Fix:
- In Supabase: ensure admin user exists in `public.profiles` with:
  - `role = 'admin'`
  - `is_active = true`

### E) Invitations not sending
Symptoms:
- Invite email log status is `failed` with `error_detail`.
Fix:
- Vercel env:
  - `RESEND_API_KEY`
  - `INVITE_FROM_EMAIL` uses verified domain (e.g. `noreply@ai-nagoya.com`)
- Resend domain: Verified
- Check Resend logs for bounces/blocks.

## 4) Rollback strategy (practical)
- Frontend (Xserver): re-upload the previous known-good `dist/` (keep a zip per release).
- APIs (Vercel): redeploy the last known-good deployment (Deployments screen).
- DB: avoid manual destructive changes; if recovery is needed, follow `ops/DR_RUNBOOK.md`.

## 5) After recovery (10 minutes)
- Re-run a minimal E2E:
  - login → admin/users → create invite → accept → logs
- Record a short incident note:
  - what happened / root cause (if known) / time to recover / next action
- If recurring: add a preventative checklist item to `ops/DEPLOY_CHECKLIST.md`.
