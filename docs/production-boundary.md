# Production implementation boundary — journey release

The release now includes an authenticated, database-backed journey implementation at `/journeys`, alongside the fictional staffing preview at `/demo`. **Operational activation and full V1 acceptance remain outstanding.** The organization has not chosen its sign-in system or email provider. No real Neon schema or identities have been provisioned by this release. Follow [production setup](production-setup.md) before admitting real records.

## New journey implementation

| Capability | Current behavior | Evidence |
| --- | --- | --- |
| Four distinct journeys | Company arrival/farewell and mission onboarding/offboarding, each with versioned policy | Domain/service tests |
| Approved playbooks | Draft starter requirements require named administrator approval and policy source | Domain and SQL tests |
| Baggage prerequisites | Training, approved equipment/access, handoff acceptance, returns and disposition alongside human support | Domain tests and UI review |
| Scoped ownership | Journey owner and per-step owner/fulfiller/verifier; explicit scope and independent verification | Service tests |
| OIDC identity | Verified issuer/subject, active server membership, no email-based access grants | Auth configuration tests; live provider test outstanding |
| PostgreSQL persistence | Composite org keys, FORCE RLS, least-privilege runtime, no operational browser storage | Isolated PGlite SQL tests |
| Atomic commands | Typed body, origin checks, revisions, idempotent retry receipt, transactional audit | Service/database tests |
| In-app updates | Journey notices, version-specific acknowledgment, help attached to a step | Service/database tests |
| Privacy | Scoped reads and evidence redaction before browser delivery | Service tests |
| Configuration administration | Clients, HOMEs, people, missions, organization name, access, playbook drafts/approval; revisioned edits and reversible archive | Admin service/SQL tests and UI review |

These are an implemented foundation, not proof of live infrastructure. PGlite exercises actual migration SQL/service transactions in an isolated embedded PostgreSQL engine; it does not validate Neon networking/pooling, concurrent distributed writes, live OIDC login, restore, or production scale. See [requirement traceability](journey-traceability.md).

## Existing synthetic preview

| Capability | Current behavior | Evidence |
| --- | --- | --- |
| HOME / resource / mission views | Four HOMEs, W2/1099, full and partial allocations | Browser filters and mobile tests |
| Date boundaries | Half-open internal spans, inclusive display, weekend handling | Domain tests |
| Coverage | Authorized and committed assignments only; blocked accepted assignments remain allocated | Domain tests |
| Draft placement | Dates, positive quarter-hour weekly allocations, person and shared mission demand checks | Domain and browser tests |
| Scenario | Proposed moves persisted locally, baseline unaffected, demo review queue | Browser test |
| Baggage | Equipment, access, handoff tasks; evidence submission remains pending verification | Domain and browser tests |
| Awareness | Version-specific synthetic notice acknowledgment without staffing acceptance | Browser test |
| Presentation | Six local scenes; scope/horizon, readable totals, keyboard navigation | Browser test and visual inspection |
| Mobile | Person cards and short forms instead of a reduced desktop timeline | 320px browser overflow checks |
| Accessibility | Semantic alternate table, labeled inputs, native modal focus handling, reduced motion | Keyboard browser test and source review |

## Remaining full V1 work

1. **Activate identity and review scope.** Register the firm's OIDC provider, test real callbacks, provision verified identities and actual grants, and complete access review. The implemented identity and membership boundary does not grant production staffing permissions.
2. **Activate Neon persistence.** Establish isolated databases and restricted runtime roles, apply the reviewed migration, test pooled concurrent transactions, and rehearse backup/restore. No actual database migration has run. Never copy real data into demo previews.
3. **Transactional staffing.** Add shared typed commands with expected revisions, idempotency receipts, deterministic locking of resource/seat/SOW controls, per-day exact numeric capacity, working-calendar exceptions, funding verification, and all-or-nothing commits. The current client-side validation is not sufficient for concurrent users.
4. **Broader operational administration and imports.** Client/HOME/people/mission configuration, role access, organization name, and versioned playbook editing/approval are implemented. Bulk imports, controlled migration of existing journeys to new policies, HOME/client transfers with existing history, reassignment/escalation queues, pagination beyond the bounded workspace, SOW/seat revisions, calendars, and automatic assignment-triggered bookends remain unfinished.
5. **Staffing approvals and publication.** Journey readiness and independent evidence verification are implemented. Staffing approval/publication and related projection controls remain unfinished. A synthetic scenario review is not production approval.
6. **Durable communications.** Configure the approved sender domain, templates, recipients, quiet hours, cadence, and escalation owners. Implement a transactional PostgreSQL outbox, leased bounded batches, retry/reconciliation, provider idempotency, verified webhooks, and independent scheduler alerts. Capture preview email; never send it to real recipients.
7. **Executive security.** Produce redacted payloads server-side. Persist frozen snapshots separately from live views, enforce scoped sign-in and share expiry/revocation, audit access, and implement bounded private exports. Hiding names in the current synthetic presentation is only a demo UI control.
8. **Release and recovery.** Add pinned CI, isolated database integration tests, load tests, additive migrations, staged production artifacts, active-release outbound guards, promotion/rollback records, restore rehearsal, retention policy, and operating runbooks.

Binary uploads, anonymous sharing, finance, and external messaging are absent. Journey steps record obligations and evidence; they do not revoke accounts, delete data, return equipment, release capacity, or change employment/payroll. The synthetic fixture contains no real teammate/client records.

## Acceptance still outstanding

The expanded suite covers journey domain behavior, org/record authorization, actual SQL isolation/FKs, command rollback/replay, evidence privacy, and synthetic browser journeys. It does not establish live OIDC/Neon acceptance, concurrent pooled writes, webhook/cron recovery, private exports/shares, actual email delivery, import idempotency, 1,000-resource performance, or disaster recovery. A successful build does not constitute complete specification acceptance.
