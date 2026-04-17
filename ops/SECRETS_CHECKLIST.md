# Secrets / Access Checklist (Ops)

Date: `YYYY-MM-DD`

This doc is a **fill-in checklist** for secret management. Do not paste real secrets into Git.

## 1) Where secrets are stored (single source of truth)
- [ ] Storage location (choose one and write the path/name):
  - e.g. 1Password vault / Bitwarden collection / Google Drive (restricted) / internal password manager
- [ ] Owners (at least 2 admins): `<name1>`, `<name2>`
- [ ] Access policy: admins only / least privilege
- [ ] 2FA enabled for all admins

## 2) Supabase
- [ ] Project URL (`SUPABASE_URL`): `https://<project-ref>.supabase.co`
- [ ] Keys stored (do not paste values):
  - [ ] `SUPABASE_ANON_KEY` (frontend + server)
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` (server only)
- [ ] Admin bootstrap recorded (who is admin in `profiles`)
- [ ] SQL artifacts location:
  - [ ] `supabase/schema.sql`
  - [ ] `supabase/migrate_*.sql`

## 3) Vercel (APIs)
- [ ] Project name: `<vercel-project>`
- [ ] Production env vars set (values managed outside Git):
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_ANON_KEY`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `APP_BASE_URL` (e.g. `https://lms.ai-nagoya.com`)
  - [ ] `CORS_ALLOWED_ORIGINS` (comma-separated, includes `https://lms.ai-nagoya.com`)
  - [ ] `RESEND_API_KEY`
  - [ ] `INVITE_FROM_EMAIL`
- [ ] Team access reviewed (who can edit env vars / deploy)
- [ ] Alerting enabled for failed deployments / errors (if used)

## 4) Resend (invitation email)
- [ ] API key stored (do not paste): `RESEND_API_KEY`
- [ ] Sender domain verified (SPF/DKIM/DMARC) for: `<domain>`
- [ ] `INVITE_FROM_EMAIL` set to a verified sender (example: `LMS <noreply@ai-nagoya.com>`)
- [ ] Access reviewed (who can view keys / DNS records)

## 5) Frontend build-time env (Vite)
- [ ] `.env.production` exists locally only (not in Git)
- [ ] Values stored outside Git:
  - [ ] `VITE_SUPABASE_URL`
  - [ ] `VITE_SUPABASE_ANON_KEY`
  - [ ] `VITE_API_BASE_URL` (Vercel base URL, no trailing slash)

## 6) Rotation & incident notes
- [ ] Next rotation target date: `YYYY-MM-DD`
- [ ] If leaked: rotate keys in this order:
  1. `SUPABASE_SERVICE_ROLE_KEY` (server)
  2. `RESEND_API_KEY`
  3. `SUPABASE_ANON_KEY` / rebuild frontend if needed
  4. Update Vercel env vars + redeploy

