# DR Runbook (Backup / Restore)

This document describes a minimal, repeatable recovery procedure for the LMS app.

## Architecture (Current)
- Frontend: static files on Xserver (`https://lms.ai-nagoya.com`) served from uploaded `dist/`.
- APIs: Vercel serverless (`https://<vercel-project>.vercel.app/api/...`).
- DB/Auth: Supabase.
- Email: Resend.

## 0. What To Keep Safe
- Supabase:
  - Project URL
  - `anon` key
  - `service_role` key (server only; never expose in frontend)
- Vercel:
  - Project settings
  - Environment variables (see below)
- Xserver:
  - `.htaccess`
  - `dist/` build output (can be regenerated)
- Resend:
  - API key
  - Sender domain verification status

## 1. Supabase Restore (New Project)
1. Create a new Supabase project.
2. Copy Project URL + keys:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Run schema:
   - Open Supabase Dashboard → SQL Editor → New query
   - Copy/paste and run `supabase/schema.sql`.
4. Create an initial admin:
   - Supabase Dashboard → Authentication → Users
   - Sign in once via the app (Google OAuth) OR create a user.
   - Copy the user UUID, then run:

```sql
insert into public.profiles (id, email, name, role, is_active)
values ('<USER_UUID>', '<ADMIN_EMAIL>', 'Admin', 'admin', true)
on conflict (id) do update
set role = 'admin',
    is_active = true,
    email = excluded.email,
    name = excluded.name;
```

Notes:
- Learners are granted access via invitation accept (inserts into `allowed_emails`).

## 2. Google OAuth Setup (Supabase)
1. Google Cloud Console:
   - Create a new OAuth Client (Web application).
   - Add Authorized redirect URI:
     - `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`
2. Supabase Dashboard → Authentication → Providers → Google:
   - Enable Google.
   - Set Client ID / Client Secret.
3. Supabase Dashboard → Authentication → URL Configuration:
   - Site URL: `https://lms.ai-nagoya.com`
   - Redirect URLs: include `https://lms.ai-nagoya.com` (and local dev URLs if needed)

## 3. Resend Setup (Invitation Email)
1. Resend Dashboard:
   - Verify sender domain (e.g. `ai-nagoya.com`) using DNS records.
2. Required Vercel env vars:
   - `RESEND_API_KEY`
   - `INVITE_FROM_EMAIL` (example: `LMS <noreply@ai-nagoya.com>`)

## 4. Vercel Setup (APIs)
### 4.1 Create/Import Project
1. Import `https://github.com/inami-hsi/lms-app` into Vercel.
2. Root directory: repository root (or the folder that contains `lms-app/` if monorepo changes).

### 4.2 Environment Variables (Production)
- `SUPABASE_URL` = `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY` = `<anon key>`
- `SUPABASE_SERVICE_ROLE_KEY` = `<service role key>`
- `RESEND_API_KEY` = `<resend api key>`
- `INVITE_FROM_EMAIL` = `LMS <noreply@ai-nagoya.com>`
- `APP_BASE_URL` = `https://lms.ai-nagoya.com`

Then redeploy.

## 5. Frontend Restore (Xserver)
1. Build locally:
```bash
cd lms-app
npm install
npm run build
```
2. Upload to Xserver:
- Upload the contents of `lms-app/dist/` to the web root used for `lms.ai-nagoya.com`.
- Keep existing `.htaccess` and icons if they are managed separately.
3. Verify:
- Open `https://lms.ai-nagoya.com/login` and sign in.
- Admin menus appear for admin profile.
- `https://lms.ai-nagoya.com/admin/users` loads and can call Vercel APIs.

## 6. Frontend Build-Time Env Vars
These must be present at build time so Vite embeds them.
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` = `https://<vercel-project>.vercel.app`

## 7. Smoke Test (Post-Restore)
1. Admin sign-in works and admin menu is visible.
2. Admin can create invite → learner accepts → learner can watch lessons.
3. Revoke blocks learner sign-in; reissue restores access.
4. Admin logs:
   - `招待メール送信ログ` increases for create/resend.
   - `招待APIレート制限ログ` increases for create/resend/revoke.

