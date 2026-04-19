# Access Review & Offboarding (Ops)

This doc helps keep access to production systems minimal, and defines what to do when someone leaves (resignation / vendor contract end).

## Systems in scope
- GitHub (repo access)
- Vercel (deploy + env vars)
- Supabase (DB/Auth + SQL)
- Resend (email sending)
- Google Drive (Shared Drive: `ops/audit-exports/`)

## Roles (recommended)
- **Owner/Admin (2+ people)**: full access, can manage members + secrets
- **Deployer**: can deploy, view logs; cannot manage members (if possible)
- **Viewer**: read-only logs/config (if possible)

## Monthly access review (10 minutes)
Run together with the monthly audit exports (`ops/audit-exports/README.md`).

Checklist:
1) GitHub
- [ ] Confirm who has repo access (Admins/Write)
- [ ] Remove inactive accounts
- [ ] Ensure 2FA is enabled for admins

2) Vercel
- [ ] Review Project Members / Team access
- [ ] Confirm who can edit Production Environment Variables
- [ ] Remove inactive accounts

3) Supabase
- [ ] Review Organization/Project members and roles
- [ ] Remove inactive accounts
- [ ] Confirm the admin user in `public.profiles` is still correct (`role=admin`, `is_active=true`)

4) Resend
- [ ] Review team members / API key access
- [ ] Ensure sender domain remains Verified

5) Google Drive (Shared Drive)
- [ ] `ops/audit-exports/` is **restricted** (not “Anyone with the link”)
- [ ] Only admins have access (or the smallest required group)

Record (optional but recommended):
- Create/append a short note in `ops/deploy-runs/YYYY-MM-DD.md`.

## Offboarding checklist (when someone leaves)
Do this **same day** the person leaves (or earlier if possible).

1) Google Drive
- [ ] Remove the user from the Shared Drive (or from `ops/audit-exports/` permissions)

2) GitHub
- [ ] Remove from org/repo access
- [ ] Revoke any personal access tokens if centrally managed

3) Vercel
- [ ] Remove from team/project
- [ ] If the user had env-var access, consider rotating server keys (below)

4) Supabase
- [ ] Remove from org/project
- [ ] Confirm no admin-only SQL snippets/secrets were shared

5) Resend
- [ ] Remove user access
- [ ] Rotate API key if the user had access

## Key rotation trigger
Rotate keys when:
- A person with access leaves
- A secret is suspected leaked

Procedure:
- Follow `ops/KEY_ROTATION.md`

