# Shared workspace before company sign-in

Set `BOOKENDS_ADMIN_MODE=shared` to use a single PostgreSQL-backed setup behind a workspace passcode. Clients, HOMEs, people, engagements, roles, skills, and playbooks then persist across browsers. The first authenticated request creates the workspace and adds the nine supplied starting clients. No fictional people or engagements are inserted.

Everyone holding this interim passcode can read and edit the shared setup. Its configuration members and role entries do not establish corporate identities or grant permissions in the existing protected journey APIs. Those APIs continue to require their existing OIDC membership and RLS checks. Company sign-in remains a separate activation step.

## Operator configuration

Apply migration `0004_shared_workspace.sql` with the existing reviewed migration runner and a separate migration connection. Runtime connections must inherit `be_runtime`, must not own BOOKENDS tables, and must not have superuser, RLS bypass, database/role creation, or direct membership/organization write privileges. Startup requests verify those limits. The migration adds scoped workspace, request-budget, and immutable audit tables; it does not modify existing business records.

Required deployment settings:

- `BOOKENDS_ADMIN_MODE=shared`
- `BOOKENDS_ENV=production` (or the appropriate preview/development environment)
- `BOOKENDS_WORKSPACE_ORIGIN` — the exact canonical HTTPS origin
- `BOOKENDS_WORKSPACE_PASSCODE_HASH` — salted scrypt hash
- `BOOKENDS_WORKSPACE_SESSION_SECRET` — at least 32 random characters
- `BOOKENDS_SHARED_DATABASE_URL` — restricted runtime PostgreSQL connection; if omitted, the same restrictions apply to `DATABASE_URL`
- `BOOKENDS_WORKSPACE_ID` — optional deployment-scoped key; defaults to `main`

Run `npx tsx scripts/create-workspace-secrets.ts` to generate a random passcode, its hash, and a session secret in the ignored `.tmp/shared-workspace-secrets.json` file. The script refuses to overwrite existing credentials and prints only the path. Keep the file private and share only the passcode with intended workspace users. Never expose any of these settings through `NEXT_PUBLIC_` variables.

Initial activation used a separately protected, temporary operator endpoint to apply the reviewed migrations and provision the restricted runtime login. That HTTP route was removed after provisioning; it is not part of the running application. Future migrations use the reviewed migration runner with a separate operator connection. Normal requests use only the restricted runtime credential.

## Saving and recovery

Each change locks the shared workspace row and checks its revision before saving. If another browser saves first, a stale request receives HTTP 409 and cannot overwrite those newer changes. Reviewed Excel and JSON imports use the same transaction and revision check. A JSON import replaces the reviewed setup; an Excel import prepares a merged snapshot. Validation runs again on the server. Export a JSON backup before a deliberate replacement.

Writes also carry a random retry key. If a connection drops after a successful commit, retrying the same payload acknowledges the saved result without creating a second record. Reusing that key for a different payload is rejected. The browser keeps the same key while retrying a pending change, including after refreshing the visible records.

Existing browser-local records are not silently copied into the shared workspace. Export the browser's local setup and use the reviewed shared import when it should become the shared source of truth. No browser-local values establish an authenticated identity.

Sessions are signed, contain no business data, expire after 12 hours, and use HttpOnly, Secure, SameSite=Strict cookies on HTTPS. Changing either the passcode hash or session secret invalidates all existing sessions. Log out clears the current browser's cookie. Sign-in attempts and AI intake budgets persist in PostgreSQL across deployment instances. No passcode, raw IP address, uploaded SOW content, or request body is written to audit logs.

The record audit identifies a passcode session and action, not an individually verified teammate. It must not be presented as proof of an individual's approval.
