# BOOKENDS

A visual resource-alignment workspace for people, missions, and the transitions between them. The design uses warm paper, ink, cobalt, and vermilion, with distinct HOME colors and patterned proposals.

This repository contains the **synthetic staffing preview** at `/demo` and an **authenticated journey workspace** at `/journeys`. The latter implements server-persisted company and mission onboarding/offboarding, policy approval, prerequisites, independent evidence verification, and in-app acknowledgments. Sign-in and a restricted PostgreSQL runtime connection must be configured before it admits real records. Infrastructure activation and the specification's full production V1 acceptance remain outstanding. See [production setup](docs/production-setup.md) and the [implementation boundary](docs/production-boundary.md).

Until operational activation, `/` remains the fictional design preview. Do not enter real employee or client information there. Setting `BOOKENDS_MODE=production` routes `/` to the protected journey workspace; `/demo` stays explicitly synthetic.

`/admin` provides clients, HOMEs, teammate profiles, SOW engagements, a configurable Roles & skills catalog, versioned playbooks, and access settings. The engagement wizard starts with the SOW and months-long delivery dates, then captures role headcount, allocation, skills, responsibilities, and phased dates before review. Existing mission IDs and journey history are retained. Profile matches show recorded role/skill alignment; they do not check availability or assign teammates.

The current interim release sets `BOOKENDS_ADMIN_MODE=local` so administration opens without sign-in and saves to this browser. The Excel template seeds HOMEs, Clients, People, Engagements, Engagement roles, Roles, and Skills; the legacy Missions sheet remains supported. Validated imports merge reviewed changes and preserve unmentioned records. JSON export/import backs up the whole configuration. Local setup remains separate from the synthetic staffing preview and the protected operational database. Shared administration requires activation; `BOOKENDS_MODE=production` always uses the protected workspace. See [everyday administration](docs/administration.md) for the workflow and exact Excel columns.

## Run locally

Requires Node.js 20.9 or newer. The existing Vercel project is configured for Node.js 24.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000).

```sh
npm run typecheck
npm test
npm run build
npm start
```

With a development or production server running on port 3000, `npm run test:e2e` runs the browser suite. Its default browser is installed Microsoft Edge; change `channel` in `playwright.config.ts` if using another Playwright browser.

## Explore the demo

- **Runway:** four HOME groups, 13/26/52-week horizons, precise dates, person/skill search, a semantic table, and a dedicated phone view. People metrics open focused action lists with direct planning and blocker-review buttons, preserving HOME, search, and horizon filters.
- **Missions:** client mission cards, commercial state, funded demand, existing assignments, and open-demand filters.
- **Decisions:** owned landing gaps, start prerequisites, unanswered updates, reported questions, and demo scenario review requests.
- **My Bookends:** a person's itinerary, confirmed versus unknown next landing, evidence submission, and explicit acknowledgment of a specific update.
- **Scenario studio:** a guided landing → dates and hours → review flow. Mission cards show feasible windows, a weekly capacity map separates a person's availability from a mission's funded room, and direct recovery choices explain existing reservations. Quick date windows, earlier part-time alternatives, hour presets, a final review card, and resumable drafts keep the next action clear. A separate demo review request leaves accepted staffing unchanged and sends no real notification.
- **Presentation:** six scenes using the same baseline calculations, with scoped HOME selection, horizon, synthetic-name display controls, and keyboard navigation. This is a local presentation preview, not secure sharing or a frozen server-side snapshot.
- **Appearance:** light, dark, and projector options. Light is the default. Reduced-motion preferences are respected.

`Ctrl+K` opens command search. Escape closes dialogs. Native dialogs trap focus and return it to the initiating control. Person links use `?view=runway&person=p1`.

Reset the synthetic workspace from **Appearance and demo settings → Reset demo workspace**. This also clears unfinished planner forms. The versioned browser storage keys are `bookends.synthetic-workspace.v1` and `bookends.planner-draft.v1.*`; they must never be reused for real operational data. If browser storage is unavailable, unfinished forms survive closing and reopening for the current visit only.

## Code map

| Location | Purpose |
| --- | --- |
| `app/` | Next.js entry points, metadata, base responsive styling, visual theme |
| `components/workspace.tsx` | Navigation, synthetic state, filters, commands, dialog routing |
| `components/runway.tsx` | Timeline ribbons, alternate table, phone person cards |
| `components/details.tsx` | Person and mission details, evidence and scenario review |
| `components/planner.tsx` | Guided placement form, recovery, editing and local draft persistence |
| `components/views.tsx` | Missions, decisions, self-service, executive presentation |
| `lib/data.ts` | Fixed-clock synthetic fixture, ten people and ten missions |
| `lib/domain.ts` | Shared date, coverage, matching and proposal calculations |
| `lib/planning.ts` | Available weekly hours and feasible placement suggestions |
| `components/production-workspace.tsx` | Company and mission journeys, step ownership, help, evidence, verification, in-app updates |
| `components/admin-workspace.tsx`, `lib/admin/` | Configuration forms, scoped administration commands, versioning and account management |
| `components/engagement-editor.tsx`, `lib/admin/engagement.ts` | SOW and delivery-team wizard, role/skill alignment and phased demand summaries |
| `components/capability-editor.tsx` | Configurable delivery roles and skills, with retained former names |
| `lib/admin/spreadsheet.ts`, `scripts/build-seed-template.mjs` | Atomic Excel setup import and reproducible blank template builder |
| `lib/journeys/` | Versioned playbooks, prerequisite transitions, scoped action readiness |
| `lib/operations/` | Strict commands, authenticated membership, SQL transactions, redacted projections |
| `auth.ts`, `lib/auth/` | Fixed-issuer OIDC sign-in and server identity |
| `db/`, `scripts/` | Reviewed migration, Drizzle schema, explicit administration commands |
| `tests/` | Domain edge cases and browser user stories |
| `docs/production-boundary.md` | Explicit implementation boundary and production requirements |

## Planning semantics

Staffing intervals use `[start, end)` and display an inclusive last day. Admin SOW engagement and role-demand dates are stored as inclusive calendar dates. Engagement demand uses headcount × allocation percentage, with peak FTE accounting for overlapping role dates; it assumes no fixed 40-hour week and creates no staffing assignments. The demo uses explicit equal-hours Monday–Friday calendars in America/New_York, with no holidays, leave, or internal reservations. Business-date arithmetic does not convert a date through the viewer's timezone.

Only commercially authorized, committed assignments count toward confirmed funded coverage. A blocked start retains its accepted capacity reservation. Proposed work and scenario moves do not count as confirmed coverage. Contractor unassigned hours are availability, not W2 bench. Evidence submission remains awaiting independent verification, and acknowledgment is not assignment acceptance.

The synthetic planner supports quarter-hour weekly inputs. Suggestions prefer the highest feasible hours, then the longest uninterrupted working-day window, accounting for committed staffing and other saved scenario moves. Editing a move excludes its own allocation from the capacity check. Suggestions check scheduling, not readiness or approval. These browser calculations are previews, not a production concurrency or security boundary. Full calendar exceptions, per-day allocation patterns, exact database numeric arithmetic, funding caps, and transactional approval remain production work.

## Deployment

The app builds as a standard Next.js project on Vercel. Use `npm ci`, `npm run verify`, and the Next.js framework preset. The release command checks TypeScript, domain and database/service tests, then builds. No environment variables are needed for the synthetic preview. Operational variables are documented in `.env.example`; actual values belong only in ignored local files and deployment secrets.

The connected Vercel project deploys pushes to `main`. A deployment never runs migrations or provisions identities. Apply migration `0003_engagement_planning.sql` through `npm run db:migrate` before activating this release's protected administration; it adds SOW plans, teammate profiles, and the organization-scoped capability catalog while retaining existing mission identities. Email delivery, transactional staffing, and external employment/access changes are not enabled by the journey workspace. The supplied developer specification remains the source for full V1 acceptance.

## Rebuild the Excel template

`scripts/build-seed-template.mjs` uses the bundled `@oai/artifact-tool` runtime, without adding application dependencies. Set `BOOKENDS_ARTIFACT_NODE_MODULES` to that runtime's `node_modules` directory and `BOOKENDS_ARTIFACT_PYTHON` to its Python executable, then run the script with the bundled Node executable. Use `load_workspace_dependencies` in Codex to locate those paths. The builder writes `public/templates/BOOKENDS_Seed_Template.xlsx` and ignored previews under `.tmp/bookends-seed/`; `--render-before` only inspects and renders the current guide. Review the generated tabs and run the spreadsheet tests after changing the template.
