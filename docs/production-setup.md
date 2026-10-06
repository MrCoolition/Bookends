# Activate the journey workspace

This procedure applies to `/journeys`. None of these database or identity provisioning steps run automatically during deployment. The current release is not operationally activated.

For interim configuration work, `/admin` can run with `BOOKENDS_ADMIN_MODE=local` and save without sign-in in this browser. See [everyday administration](administration.md) for backup and import. This is separate from the procedure below. Set `BOOKENDS_ADMIN_MODE=protected` when moving to shared administration; `BOOKENDS_MODE=production` also forces the protected path. Preserve local backups and explicitly review/migrate their configuration before changing modes.

## Isolated environments and credentials

Use separate empty development, preview, and production databases/branches and separate identity registrations. Never copy real teammate records into a preview. Set variables in the matching deployment environment. Updated Vercel variables apply to a new deployment; see [Vercel environment variables](https://vercel.com/docs/environment-variables).

`.env.example` lists placeholders. Keep real values in ignored env files and deployment secrets. The existing `neon_connect` variable is not reused automatically: its target and role privileges have not been established. The app requires an explicit restricted `DATABASE_URL`.

Use a direct administrative `MIGRATION_DATABASE_URL` able to create tables, functions, policies, and the `be_runtime` NOLOGIN role (or have a database administrator create that group first). Never put the migration credential into the web deployment. Create a separate login through your database administration process, grant it only `be_runtime` membership and required connection rights, and use it for `DATABASE_URL`. It must not own tables, inherit privileged roles, bypass RLS, or have superuser, database-creation, or role-creation rights. Do not use a provider's default database owner as the runtime login. See [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Migrations

With administrative credentials already securely loaded, run in PowerShell:

```powershell
$env:BOOKENDS_ENV = 'preview'
npm run db:migrate
```

Production requires both an environment and explicit flag:

```powershell
$env:BOOKENDS_ENV = 'production'
npm run db:migrate -- --production
```

The command uses a transaction, advisory lock, and checksum ledger. Never edit an applied migration; add the next numbered file. It refuses missing environment, pooled migration endpoint, unsafe remote TLS configuration, and checksum mismatch. Test backup/restore before real intake. Apply additive migrations before dependent code; reverting a deployment does not revert data.

## Sign-in and membership

Use an organization-controlled OIDC provider. Email hosting is a separate decision. Register the exact callback `https://YOUR-BOOKENDS-ORIGIN/api/auth/callback/corporate`. Configure fixed HTTPS `AUTH_URL`, `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`, and a cryptographically random `AUTH_SECRET` of at least 32 characters. Microsoft must use one tenant UUID, not a shared issuer. Generic OIDC currently uses client-secret-basic; Microsoft uses client-secret-post. Confirm provider compatibility, PKCE, discovery, immutable subject claims, and logout expectations in preview. Auth.js is currently the lockfile-pinned v5 beta; approve that dependency before operational activation.

There is no public signup or email-domain membership. Verified issuer + subject identify the account; every business request rechecks active membership. A signed-in account without membership sees only an access message and its own identifiers for the administrator.

Provision through the trusted database administration environment. Placeholders below must be replaced with provider-verified values, never an inferred email address:

```powershell
npm run db:bootstrap -- --organization-name "Your company" --issuer "https://YOUR-ISSUER" --subject "VERIFIED-SUBJECT" --name "First administrator"
```

Add `--production` for production. Save returned organization and member IDs. Bootstrap never overwrites existing access. Create the teammate record through the workspace, then explicitly link their verified identity:

After first-administrator setup, use **Administration → Access & settings** to link verified identities, choose roles and scope, and enable/disable access. The server uses narrowly defined database functions for these changes; the runtime still has no direct table mutation privileges on memberships or organization settings. The CLI below remains an administrative alternative.

```powershell
npm run db:bootstrap -- --organization-id "ORGANIZATION-UUID" --actor-id "ADMIN-MEMBER-UUID" --issuer "https://YOUR-ISSUER" --subject "VERIFIED-SUBJECT" --name "Teammate name" --roles "resource" --resource-id "RESOURCE-UUID"
```

Coordinator/verifier roles are explicit: `placement_owner`, `home_leader` (requires `--home-scope`), `mission_owner`, `asset_access_owner`, `client_liaison`, and `administrator`. Multiple comma-separated roles must be intentional. Assign each step to appropriate approved owners, fulfillers, and independent verifiers. Administrator status alone does not grant equipment or mission verification authority.

## Approve policies and pilot

In **Administration → Playbooks**, review all four starter playbooks and record real approved policy sources. They are starting templates, not automatically adopted HR/client policy. Edit inappropriate requirements, evidence types, roles, or timing in a draft before approving it. Changes to an approved playbook create a new version; running journeys keep their existing snapshot.

In an isolated preview, create fictional people and all four journey kinds. Mission journeys need a registered mission and authoritative assignment reference. That reference associates the journey with the source assignment; it does not accept staffing or reserve capacity. Company journeys remain independent.

Test separate identities through sign-in → coordinator creation → teammate's scoped view → acknowledgment → assigned evidence submission → independent verification → persisted reload in another session. Exercise deactivated membership, denied scope, cross-origin requests, simultaneous revisions, a network retry, evidence privacy, and company/mission separation. Test actual Neon TLS/pooling and concurrent transactions; embedded SQL tests do not substitute for this pilot. Complete role review, monitoring, retention, backups, and restore rehearsal.

Run `npm run verify` and `npm run test:e2e` against the demo server. Review `journey-traceability.md`. External email is not part of this release: notices, acknowledgments, and help requests stay in app.

## Activate after acceptance

Set `BOOKENDS_MODE=production` and deploy after the pilot and operating prerequisites pass. `/` routes to `/journeys`; missing setup or membership fails closed. `/demo` remains fictional and disconnected from real records.

Activation applies to journey and configuration administration capabilities. Transactional staffing, automatic assignment bookends, external revocation, employment/payroll actions, email delivery, bulk imports, existing-journey policy migrations, and the remaining V1 acceptance cases remain separate work. See `production-boundary.md`.
