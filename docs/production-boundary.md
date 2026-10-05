# Production implementation boundary

The current deliverable is a visually complete, interactive synthetic workspace. It is intended to review design and the core user journey before operational integration. A successful demo build is not acceptance of the full BOOKENDS Developer Specification.

## Implemented and checked

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

## Required before real operations

1. **Identity and scoped authorization.** Obtain the firm's OIDC provider/tenant, authorized invitation policy, and actual role grants. Derive organization and actor identity on the server. Protect every read, mutation, evidence link, and presentation projection. Login alone must not confer staffing permissions.
2. **Neon persistence.** Establish separate development, preview, and production databases. Implement reviewed SQL migrations, composite organization keys, least-privilege runtime roles, transaction-local RLS context, audit history, and immutable accepted revisions. Never copy production records into demo preview branches.
3. **Transactional staffing.** Add shared typed commands with expected revisions, idempotency receipts, deterministic locking of resource/seat/SOW controls, per-day exact numeric capacity, working-calendar exceptions, funding verification, and all-or-nothing commits. The current client-side validation is not sufficient for concurrent users.
4. **Operational records and imports.** Implement people and mission creation, SOW/seat revision services, phased seats, configurable grades/calendars, source verification, CSV templates/mapping/preview/results, and automatic durable bookends.
5. **Approvals and publication.** Record action-specific readiness gates, required independent approvers, publication revisions, and resource-safe projections. A demo review request is not a submitted production approval.
6. **Durable communications.** Configure the approved sender domain, templates, recipients, quiet hours, cadence, and escalation owners. Implement a transactional PostgreSQL outbox, leased bounded batches, retry/reconciliation, provider idempotency, verified webhooks, and independent scheduler alerts. Capture preview email; never send it to real recipients.
7. **Executive security.** Produce redacted payloads server-side. Persist frozen snapshots separately from live views, enforce scoped sign-in and share expiry/revocation, audit access, and implement bounded private exports. Hiding names in the current synthetic presentation is only a demo UI control.
8. **Release and recovery.** Add pinned CI, isolated database integration tests, load tests, additive migrations, staged production artifacts, active-release outbound guards, promotion/rollback records, restore rehearsal, retention policy, and operating runbooks.

Binary uploads, anonymous sharing, finance, and external messaging are absent. No controls claim that these services are operating. There are no real credentials, device serials, private notes, contact details, compensation, or client secrets in the synthetic fixture.

## Acceptance still outstanding

The specification's CORE and domain acceptance cases require authenticated server/database tests and production-like delivery infrastructure. The existing suite covers the demo's implemented calculations and browser journey only. It does not cover concurrent database writes, org/record authorization, webhook/cron recovery, private exports/shares, actual email delivery, import idempotency, 1,000-resource performance, or disaster recovery.
