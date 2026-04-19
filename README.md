# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
  ])
```

## Admin Logs API Notes

### Endpoint
- `GET /api/admin-logs`

### Query Params
- `type`: `email` | `api` (default: `email`)
- `limit`: 1..200 (default: 30)
- `hours`: number (optional)
- `cursor`: Base64 JSON string (see Cursor Format)
- `sort`: `asc` | `desc` (default: `desc`)
- Filters:
  - Email logs: `action`, `status`, `email`
  - API logs: `action`, `allowed`, `triggeredBy`, `sourceIp`

### Cursor Format
- Base64 JSON: `{"createdAt":"<ISO8601>","id":"<string>"}`
- Fallback: raw ISO8601 string (id will be `null`)
- Pagination rule:
  - `sort=desc`: fetch rows older than cursor (created_at < cursor.createdAt)
  - `sort=asc`: fetch rows newer than cursor (created_at > cursor.createdAt)
  - When `created_at` equals, compare by `id` in the same direction.

### Response
For `type=email`:
```json
{
  "emailLogs": [],
  "nextCursor": "string|null",
  "hasMore": true,
  "totalCount": 123
}
```

For `type=api`:
```json
{
  "apiLogs": [],
  "nextCursor": "string|null",
  "hasMore": true,
  "totalCount": 123
}
```

Notes:
- `totalCount` is based on the current query (and may represent remaining rows when `cursor` is used).
- Responses include `Cache-Control: no-store`.

## Admin Logs Ops Notes

### Recommended Indexes
If `invite_email_logs` / `invite_api_request_logs` grows, apply the index section in `supabase/schema.sql`.
If you've already applied the schema, you can copy/paste the index block into Supabase `SQL Editor` and run it.

### Cursor + Sort Verification (Manual)
To stress-test paging with many rows sharing the same `created_at` (tie-break by `id`), run:
- `supabase/admin_logs_testdata.sql` in Supabase `SQL Editor`

Then confirm in `https://lms.ai-nagoya.com/admin/users`:
- Email logs: `sort=desc` and page through `もっと見る` until end (no duplicates / no missing).
- Switch to `sort=asc` and repeat.
- Repeat the same for API logs.

Cleanup SQL (optional) is included at the bottom of `supabase/admin_logs_testdata.sql`.

## Deployment Notes

### Architecture
- Frontend: static hosting on Xserver (`https://lms.ai-nagoya.com`), built from `dist/`.
- APIs: Vercel serverless functions (example: `https://lms-app-kappa-nine.vercel.app/api/...`).
- DB/Auth: Supabase.

### Frontend Build/Upload (Xserver)
1. Run `npm run build` in `lms-app/`.
2. Upload `lms-app/dist/` to Xserver (keep `.htaccess` and existing icons if needed).

### Required Environment Variables
Frontend (Vite):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` (Vercel base URL, no trailing slash)

Vercel (Server):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Invitation email (Resend):
- `RESEND_API_KEY`
- `INVITE_FROM_EMAIL` (e.g. `LMS <noreply@ai-nagoya.com>`)

## Invitation Flow Notes

### Endpoints
- `POST /api/admin-invitations` (admin only): `create` / `resend` / `revoke`
- `GET /api/invite-token?token=...`: returns masked invitation email + status
- `POST /api/invite-accept`: accepts invitation and adds the email to `allowed_emails`

### UI/Behavior
- Invitation link: `/invite/accept?token=...`.
- After a user accepts an invitation, the same token becomes `already-used`.
- `revoked` invitations cannot be resent, but can be reissued (regenerates token and returns to `pending`).

### Smoke Test (Manual)
Run this checklist on `https://lms.ai-nagoya.com`:
1. Create invite (admin) → accept (learner) → confirm learner can watch lessons and admin sees `accepted`.
2. Revoke (admin) → learner cannot sign in (shows "アクセス許可されていません").
3. Reissue (admin) → accept again (learner) → learner can sign in and admin sees `accepted`.
4. Logs: `招待メール送信ログ` and `招待APIレート制限ログ` increase under `24時間` (includes `ACCEPT`).

## Ops / DR
- Disaster recovery runbook: `ops/DR_RUNBOOK.md`
- Incident response: `ops/INCIDENT_RESPONSE.md`
- Monthly audit export routine: `ops/audit-exports/README.md`
- Recurring ops tasks: `ops/RECURRING_TASKS.md`
- Key rotation procedure: `ops/KEY_ROTATION.md`
- Release archive script: `scripts/new-release-bundle.ps1`
- Access review & offboarding: `ops/ACCESS_REVIEW.md`
- Learner guide (Google Calendar): `ops/templates/learner_google_calendar_guide.md`

## Supabase Schema / Migrations
- New project setup: run `supabase/schema.sql` in Supabase SQL Editor.
- Existing project updates: apply `supabase/migrate_*.sql` as needed.
  - `supabase/migrate_add_accept_action.sql`: enables `ACCEPT` logging in `invite_api_request_logs`.
  - `supabase/migrate_courses_lessons_write_grants.sql`: fixes admin write permissions for courses/lessons.
  - `supabase/migrate_calendar_feed.sql`: per-user Google Calendar subscription feed (ICS).

## Ops: CSV Export Routine
To keep a simple audit trail outside Supabase, export CSVs periodically from:
- `https://lms.ai-nagoya.com/admin/users`
- Panels:
  - `招待メール送信ログ`
  - `招待APIレート制限ログ`

Detailed guide: `ops/audit-exports/README.md`

Suggested routine:
- Frequency: once per month (or once per week if volume is high)
- Filter: `期間=7日` (or `全期間` if low volume)
- Save to: a shared drive folder (e.g. `ops/audit-exports/` in your organization)
- Filename:
  - `invite_email_logs_YYYY-MM-DD.csv`
  - `invite_api_request_logs_YYYY-MM-DD.csv`

Notes:
- The first meta rows include the current filters (range/action/status/sort/totalCount).
- `招待APIレート制限ログ` includes `ACCEPT` after the migration `supabase/migrate_add_accept_action.sql` is applied.

### Resend Domain Verification (High Level)
To reliably send to external recipients, verify the sender domain in Resend:
- Add domain (e.g. `ai-nagoya.com`) in Resend → Domains.
- Add the provided DNS records (DKIM/SPF/MX/DMARC) in Xserver DNS settings.
- Wait until the domain is `Verified`, then set `INVITE_FROM_EMAIL` on Vercel.
