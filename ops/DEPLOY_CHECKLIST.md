# Deploy Checklist (Xserver + Vercel + Supabase)

Target date: `YYYY-MM-DD`

## Architecture
- Frontend: Xserver static hosting (`https://lms.ai-nagoya.com`) from uploaded `dist/`.
- APIs: Vercel serverless (`https://<vercel-project>.vercel.app/api/...`).
- DB/Auth: Supabase.
- Email: Resend.

---

## 1) Local build (generate `dist/`)
- [ ] In `lms-app/`, run `npm ci` (first time only)
- [ ] Run `npm test`
- [ ] Run `npm run build`
- [ ] Confirm `lms-app/dist/` exists and contains:
  - [ ] `index.html`
  - [ ] `assets/`
  - [ ] `.htaccess` (SPA fallback)

Optional (upload-friendly):
- [ ] Create `dist.zip` from `dist/*`
- [ ] Archive release artifacts (recommended):
  - [ ] `powershell -ExecutionPolicy Bypass -File scripts/new-release-bundle.ps1`
  - [ ] Keep at least the latest 3 releases under `deliverables/lms-app/releases/`

---

## 2) Xserver deploy (frontend)
**Goal:** Place `dist` *contents* at the document root (do not upload the `dist/` folder itself).

- [ ] Open Xserver File Manager
- [ ] Go to: `public_html/lms.ai-nagoya.com/`
- [ ] Backup existing `.htaccess` (if present):
  - [ ] Copy to `.htaccess.bak` (or download a copy)
- [ ] Upload and overwrite with **dist contents**:
  - [ ] `index.html`
  - [ ] `assets/` (folder)
  - [ ] `favicon.svg`
  - [ ] `icons.svg`
  - [ ] `.htaccess`

Quick verification:
- [ ] `https://lms.ai-nagoya.com/` loads
- [ ] Direct open (no 404): `https://lms.ai-nagoya.com/admin/users`

---

## 3) Vercel deploy (APIs)
- [ ] Vercel project imports this repo and deploys from the correct root
- [ ] Production env vars set:
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_ANON_KEY`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `APP_BASE_URL` (e.g. `https://lms.ai-nagoya.com`)
  - [ ] `CORS_ALLOWED_ORIGINS` (comma-separated, include `https://lms.ai-nagoya.com`)
  - [ ] `RESEND_API_KEY`
  - [ ] `INVITE_FROM_EMAIL` (e.g. `LMS <noreply@ai-nagoya.com>`)
- [ ] Deploy succeeded (latest GitHub `main`)

Quick verification (Admin page):
- [ ] Network shows `OPTIONS /api/admin-logs` → `204`
- [ ] Network shows `GET /api/admin-logs` → `200`

---

## 4) Supabase (schema/migrations)
New project:
- [ ] Run `lms-app/supabase/schema.sql` in Supabase SQL Editor

Existing project:
- [ ] Apply needed `lms-app/supabase/migrate_*.sql`

Important check (ACCEPT logging):
- [ ] `invite_api_request_logs_action_check` includes `accept`

---

## 5) End-to-end smoke test (production)
- [ ] Login works
- [ ] Admin page opens: `https://lms.ai-nagoya.com/admin/users`
- [ ] Create invitation (admin)
- [ ] Accept invitation (`/invite/accept?token=...`)
- [ ] Learner can watch lessons
- [ ] Logs update under `24時間`:
  - [ ] `招待メール送信ログ` increases (`create/resend`)
  - [ ] `招待APIレート制限ログ` increases (`accept`)

---

## 6) Ops: monthly audit exports
- [ ] Follow `ops/audit-exports/README.md`
- [ ] Save CSVs using the naming convention:
  - [ ] `invite_email_logs_YYYY-MM-DD.csv`
  - [ ] `invite_api_request_logs_YYYY-MM-DD.csv`

---

## 7) Record the run
- [ ] Fill in `ops/deploy-runs/YYYY-MM-DD.md` (see `ops/deploy-runs/README.md`)
- [ ] Confirm the shared drive upload path is recorded (restricted access)

---

## 8) Incident readiness (optional)
- [ ] Confirm `ops/INCIDENT_RESPONSE.md` matches current architecture/env var names
