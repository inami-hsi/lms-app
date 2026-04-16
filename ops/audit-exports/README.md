# Ops: Monthly CSV Audit Exports

This document describes a lightweight routine to keep an external audit trail of invitation activity, using the Admin Logs CSV export.

## Where to export from
- Admin page: `https://lms.ai-nagoya.com/admin/users`
- Panels:
  - `招待メール送信ログ` (`type=email`)
  - `招待APIレート制限ログ` (`type=api`, includes `accept` after migration)

## Recommended routine
- Frequency: monthly (weekly if volume is high)
- Range:
  - Low volume: `全期間`
  - Normal: `7日` or `30日`
- Keep the filter meta rows included at the top of the CSV.

## File naming
Use a consistent, sortable naming convention:
- `invite_email_logs_YYYY-MM-DD.csv`
- `invite_api_request_logs_YYYY-MM-DD.csv`

Example:
- `invite_email_logs_2026-04-16.csv`
- `invite_api_request_logs_2026-04-16.csv`

## Storage location
Store the exports in a shared folder with restricted access (admins only), for example:
- Google Drive / OneDrive / Dropbox folder: `ops/audit-exports/`

Notes:
- These CSVs can contain email addresses / IP addresses. Treat them as sensitive.
- Prefer encrypted storage at rest if available (organizational drive settings).

## Quick verification checklist
After export, open the CSV to confirm:
- The first meta rows match the filters you intended (range/action/status/sort/totalCount).
- Rows are not empty unless you expected zero.
- For API logs, `ACCEPT` appears after an invitation acceptance event.

