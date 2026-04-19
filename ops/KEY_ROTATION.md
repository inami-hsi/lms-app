# Key Rotation Procedure (Ops)

This document describes how to rotate production keys safely for the LMS.
Do **not** paste secret values into GitHub issues, commits, or chat logs.

## What keys exist (high level)
### Supabase
- `SUPABASE_SERVICE_ROLE_KEY` (server only; Vercel)
- `SUPABASE_ANON_KEY` (frontend + server)

### Resend
- `RESEND_API_KEY` (server only; Vercel)

## Recommended rotation order (least disruption)
1. `SUPABASE_SERVICE_ROLE_KEY` (Vercel only)
2. `RESEND_API_KEY` (Vercel only)
3. `SUPABASE_ANON_KEY` (Vercel + **rebuild frontend** + Xserver upload)

Reason:
- Rotating server-only keys avoids rebuilding the frontend and usually has the smallest user-visible impact.

---

## Pre-flight checklist
- [ ] You have admin access to: Supabase + Vercel + Resend + Xserver
- [ ] You can log in as an admin on `https://lms.ai-nagoya.com`
- [ ] You can view Vercel deployments/logs
- [ ] You have a rollback path:
  - Frontend: previous `dist/` or `dist.zip`
  - Vercel: previous known-good deployment (Deployments screen)

After any rotation, run the smoke test in `ops/DEPLOY_CHECKLIST.md`.

---

## Rotate `SUPABASE_SERVICE_ROLE_KEY` (server-only)
1. Supabase Dashboard → Project Settings → API
2. Generate a new Service Role key (or reset if using that workflow).
3. Vercel → Project Settings → Environment Variables:
   - Update `SUPABASE_SERVICE_ROLE_KEY` (Production)
4. Redeploy Vercel (or trigger a new deployment).
5. Verify:
   - Admin page loads: `https://lms.ai-nagoya.com/admin/users`
   - API calls succeed (Network: `GET /api/admin-logs` → `200`)

Rollback:
- Revert the env var to the previous key and redeploy.

---

## Rotate `RESEND_API_KEY` (server-only)
1. Resend Dashboard → API Keys:
   - Create a new API key
   - (Optional) revoke the old key after verification
2. Vercel → Project Settings → Environment Variables:
   - Update `RESEND_API_KEY` (Production)
3. Redeploy Vercel.
4. Verify (no new external address required):
   - Create an invite
   - In Admin Logs → `招待メール送信ログ`, confirm `status=success`

Rollback:
- Restore previous `RESEND_API_KEY` and redeploy.

---

## Rotate `SUPABASE_ANON_KEY` (frontend + server)
This rotation affects:
- Vercel env: `SUPABASE_ANON_KEY`
- Frontend build-time env: `VITE_SUPABASE_ANON_KEY` (requires rebuild + Xserver upload)

Steps:
1. Supabase Dashboard → Project Settings → API
2. Generate a new anon key.
3. Vercel → Environment Variables:
   - Update `SUPABASE_ANON_KEY` (Production)
4. Frontend build env (local only; not committed):
   - Update `.env.production`:
     - `VITE_SUPABASE_ANON_KEY=<new anon key>`
5. Build and deploy frontend:
   - `npm test`
   - `npm run build`
   - Upload `dist/` contents (or `dist.zip`) to Xserver
6. Redeploy Vercel (to ensure both sides use the new key).
7. Verify:
   - Login works
   - Courses/lessons list works
   - Admin page works

Rollback:
- Restore previous anon key on Vercel and rebuild/re-upload the frontend with the previous `VITE_SUPABASE_ANON_KEY`.

---

## Record keeping
- Add a short note in `ops/deploy-runs/YYYY-MM-DD.md`:
  - Which keys rotated (names only, no values)
  - Why (scheduled rotation / incident)
  - Verification results
- Update `ops/SECRETS_CHECKLIST.md` next rotation date if needed.

