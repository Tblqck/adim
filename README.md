# Collation — KYC admin dashboard

The white-label platform's admin design (`doc-fix/kyc-platform-whitelabel`)
running on the live verification server's functionality — the same
`/api/v1/admin/*` API the current dashboard (`development/admin`, repo
`Tblqck/adim`) uses. It has no database or verification logic of its own:
every call is relayed to the API server, which authenticates, authorises and
scopes it to a firm, exactly as before.

## Run

```bash
npm ci
cp .env.example .env     # defaults already point at the live API
npm run dev              # http://localhost:5050
npm run build && npm start
```

Sign in exactly as on the current dashboard: Firm ID + password (head admin),
Firm ID + username + password (employee), or password alone (super-admin).

## How it is wired

| Piece | File |
| --- | --- |
| Relay to the live API (replaces `admin_proxy.py`; pinned self-signed cert, cookies and Set-Cookie passed through) | `src/app/api/v1/admin/[...path]/route.ts`, `src/lib/server/upstream.ts`, `certs/` |
| Browser API helper (401 → sign-in) | `src/lib/api.ts` |
| Who is signed in (`/me`), super-admin firm filter | `src/components/admin/session-context.tsx` |
| Design system — copied unchanged from the white-label | `src/components/ui/`, `tailwind.config.ts`, `src/app/globals.css` |
| Brand name / logo (build-time) | `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO`, `src/lib/brand.ts` |

The super-admin's per-page "Firm" dropdown now lives once in the sidebar and
applies to every page.

## Pages

| Section (white-label design) | Live API | Was (old dashboard) |
| --- | --- | --- |
| Overview | `/verifications` totals, `/sessions` | — (new) |
| Verifications, review | `/verifications`, `/verifications/{id}` (PATCH review, DELETE, restore) | `list`, `detail` |
| Generate link | `/sessions` | `generate-link` |
| Document check | `/document-check` | `document-check` |
| AML → Person / Company | `/screen`, `/screen-company` | `screen`, `kyb` |
| AML settings | `/databases-catalog` | `databases` |
| Companies (super-admin) | `/firms`, `/firm-api-key`, `/firms/{id}/revoke-sessions` | `firms`, `firm-detail` |
| Users (firm admins) | `/firm-users` | `users`, `user-detail` |
| Recycle Bin | soft-deleted rows from the lists above + restore routes | — (new) |
| API | `/firm-api-key` + integration docs | `api` |
| Settings | `/me`, `/ip-bans` (super-admin) | — (new) |
| Guide | static | `guide` |

**Kept from the white-label but not wired yet** (marked "Soon" in the sidebar;
each page lists the endpoint it needs): Templates, Risk Policy, Audit Log,
Backup. The live API has nothing behind them today.

## Behaviour changes from the old dashboard

- Printed-vs-MRZ date check: a printed `12/08/1974` was parsed as 8 December,
  flagging real matches as mismatches. Either day/month order now matches.
- Employee detail reads from the `/firm-users` list (the single-user GET does
  not exist on every server version).
- Confirmations use in-page dialogs instead of `confirm()`/`alert()`.
