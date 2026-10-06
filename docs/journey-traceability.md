# Journey requirement traceability

Source: supplied BOOKENDS Developer Specification, especially section 6 and Baggage acceptance cases. The user's clarification adds **both company and mission transitions, as separate journeys**. Email setup is undecided.

| Requirement | Implementation | Evidence and limit |
| --- | --- | --- |
| Four distinct arrival/departure journeys | Versioned templates, explicit kind and mission assignment reference | Domain/service tests; no HR system action |
| Approved requirement source, owner, version | Draft catalog, named policy approval, fixed instance snapshot | Unapproved-policy rejection and SQL version uniqueness |
| BG01/BG05: outstanding obligations do not implicitly block new landing/capacity release | Separate opening/release/closeout gates and explicit blocked actions | Domain-only tests; staffing integration outstanding |
| BG04: action-specific prerequisites | Scoped readiness evaluation | Domain tests and operational command flow |
| BG09: evidence submission precedes independent verification | Exact verifier role/scope and author separation | Domain and SQL/service evidence flow |
| BG10: scoped, evidenced, expiring waiver | Decision validation and evaluation | Domain test; no waiver authoring UI yet |
| BG11: separate client obligations | Mission/assignment/resource scope and organization FKs | Domain two-client and SQL cross-org tests; account revocation remains external |
| BG14: unknown timing stays explicit | Nullable owned dates and unknown-input reasons | Domain-only missing-timing test |
| BG17: stable obligation identity | Trigger occurrence + requirement/scope key, SQL uniqueness | Domain key and SQL duplicate tests; distributed concurrency test outstanding |
| Human support and departure care | Guide, check-ins, help requests, reflection, next contact | Template inspection, help transition tests, UI review |
| No browser authority | Strict command schema; server membership; origin, revision, receipt checks | Validation/auth/service tests; live OIDC acceptance outstanding |
| Scoped private evidence | Server projections and FORCE RLS | SQL org denial, participant redaction, inactive membership tests |
| Atomic audit and persistence | Transaction covers changes, notice, event, receipt | Rollback, stale revision, idempotent replay tests; Neon concurrency outstanding |
| Awareness | Version-specific in-app notices/acknowledgments | Actual service/database tests; external delivery deferred |
| Configurable clients, HOMEs, people and missions | Admin forms, stable scoped identifiers, revisions, archive/reactivate | `tests/admin.test.ts`, SQL FK/identity/backfill tests; no bulk imports yet |
| Policy editing | Draft graph validation and reviewed version approval; existing snapshots retained | Admin versioning tests and UI review |
| Account administration | Fixed issuer, verified subject, explicit scopes, bounded database commands | SQL/function tests, self-access protection; actual IdP provisioning remains external |

Test files: `tests/journeys.test.ts`, `tests/operations.test.ts`, `tests/database.test.ts`, `tests/auth-config.test.ts`. Embedded PostgreSQL tests are not live Neon or identity-provider acceptance. No complete CORE/COM/IMPORT/EXEC/BG sign-off is implied. See `production-boundary.md`.
