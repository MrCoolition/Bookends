# BOOKENDS

A visual resource-alignment workspace for people, missions, and the transitions between them. The design uses warm paper, ink, cobalt, and vermilion, with distinct HOME colors and patterned proposals.

This repository contains the **synthetic staffing preview** at `/demo` and an **authenticated journey workspace** at `/journeys`. The latter implements server-persisted company and mission onboarding/offboarding, policy approval, prerequisites, independent evidence verification, and in-app acknowledgments. Sign-in and a restricted PostgreSQL runtime connection must be configured before it admits real records. Infrastructure activation and the specification's full production V1 acceptance remain outstanding. See [production setup](docs/production-setup.md) and the [implementation boundary](docs/production-boundary.md).

Until operational activation, `/` remains the fictional design preview. Do not enter real employee or client information there. Setting `BOOKENDS_MODE=production` routes `/` to the protected journey workspace; `/demo` stays explicitly synthetic.

`/admin` provides clients, HOMEs, people, missions, versioned playbooks, role planning, and organization settings. The current interim release sets `BOOKENDS_ADMIN_MODE=local` so the forms open without sign-in and save to this browser. A downloadable Excel template seeds the four core lists through a validated, reviewed batch import; JSON export/import backs up the complete configuration. This configuration is separate from the synthetic staffing preview and the protected operational database. Shared administration still requires activation; `BOOKENDS_MODE=production` always uses the protected workspace. See [everyday administration](docs/administration.md).

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

- **Runway:** four HOME groups, 13/26/52-week horizons, precise dates, person/skill search, metrics that filter their underlying records, a semantic table, and a dedicated phone view.
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
| `lib/journeys/` | Versioned playbooks, prerequisite transitions, scoped action readiness |
| `lib/operations/` | Strict commands, authenticated membership, SQL transactions, redacted projections |
| `auth.ts`, `lib/auth/` | Fixed-issuer OIDC sign-in and server identity |
| `db/`, `scripts/` | Reviewed migration, Drizzle schema, explicit administration commands |
| `tests/` | Domain edge cases and browser user stories |
| `docs/production-boundary.md` | Explicit implementation boundary and production requirements |

## Planning semantics

Business intervals are stored as `[start, end)` and displayed with an inclusive last day. The demo uses explicit equal-hours Monday–Friday calendars in America/New_York, with no holidays, leave, or internal reservations. Business-date arithmetic does not convert a date through the viewer's timezone.

Only commercially authorized, committed assignments count toward confirmed funded coverage. A blocked start retains its accepted capacity reservation. Proposed work and scenario moves do not count as confirmed coverage. Contractor unassigned hours are availability, not W2 bench. Evidence submission remains awaiting independent verification, and acknowledgment is not assignment acceptance.

The synthetic planner supports quarter-hour weekly inputs. Suggestions prefer the highest feasible hours, then the longest uninterrupted working-day window, accounting for committed staffing and other saved scenario moves. Editing a move excludes its own allocation from the capacity check. Suggestions check scheduling, not readiness or approval. These browser calculations are previews, not a production concurrency or security boundary. Full calendar exceptions, per-day allocation patterns, exact database numeric arithmetic, funding caps, and transactional approval remain production work.

## Deployment

The app builds as a standard Next.js project on Vercel. Use `npm ci`, `npm run verify`, and the Next.js framework preset. The release command checks TypeScript, domain and database/service tests, then builds. No environment variables are needed for the synthetic preview. Operational variables are documented in `.env.example`; actual values belong only in ignored local files and deployment secrets.

The connected Vercel project deploys pushes to `main`. A deployment never runs migrations or provisions identities. Email delivery, transactional staffing, and external employment/access changes are not enabled by the journey workspace. The supplied developer specification remains the source for full V1 acceptance.
