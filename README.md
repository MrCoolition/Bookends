# BOOKENDS

A visual resource-alignment workspace for people, missions, and the transitions between them. The design uses warm paper, ink, cobalt, and vermilion, with distinct HOME colors and patterned proposals.

This repository currently delivers an **interactive product demonstration**, not the specification's complete production V1. All people, clients, assignments, and messages are synthetic. Demo edits persist only in this browser. No Neon database, corporate identity provider, real approval workflow, or email transport is connected. Do not enter real employee or client information.

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
- **Scenario studio:** date and allocation inputs; person and mission capacity validation; saved proposed moves; a separate demo review request. Nothing changes accepted staffing or sends a real notification.
- **Presentation:** six scenes using the same baseline calculations, with scoped HOME selection, horizon, synthetic-name display controls, and keyboard navigation. This is a local presentation preview, not secure sharing or a frozen server-side snapshot.
- **Appearance:** light, dark, and projector options. Light is the default. Reduced-motion preferences are respected.

`Ctrl+K` opens command search. Escape closes dialogs. Native dialogs trap focus and return it to the initiating control. Person links use `?view=runway&person=p1`.

Reset the synthetic workspace from **Appearance and demo settings → Reset demo workspace**. The versioned browser storage key is `bookends.synthetic-workspace.v1`; it must never be reused for real operational data.

## Code map

| Location | Purpose |
| --- | --- |
| `app/` | Next.js entry points, metadata, base responsive styling, visual theme |
| `components/workspace.tsx` | Navigation, synthetic state, filters, commands, dialog routing |
| `components/runway.tsx` | Timeline ribbons, alternate table, phone person cards |
| `components/details.tsx` | Person and mission details, evidence, placement and scenario forms |
| `components/views.tsx` | Missions, decisions, self-service, executive presentation |
| `lib/data.ts` | Fixed-clock synthetic fixture, ten people and ten missions |
| `lib/domain.ts` | Shared date, coverage, matching and proposal calculations |
| `tests/` | Domain edge cases and browser user stories |
| `docs/production-boundary.md` | Explicit implementation boundary and production requirements |

## Planning semantics

Business intervals are stored as `[start, end)` and displayed with an inclusive last day. The demo uses explicit equal-hours Monday–Friday calendars in America/New_York, with no holidays, leave, or internal reservations. Business-date arithmetic does not convert a date through the viewer's timezone.

Only commercially authorized, committed assignments count toward confirmed funded coverage. A blocked start retains its accepted capacity reservation. Proposed work and scenario moves do not count as confirmed coverage. Contractor unassigned hours are availability, not W2 bench. Evidence submission remains awaiting independent verification, and acknowledgment is not assignment acceptance.

The synthetic planner supports quarter-hour weekly inputs. These browser calculations are previews, not a production concurrency or security boundary. Full calendar exceptions, per-day allocation patterns, exact database numeric arithmetic, funding caps, and transactional approval remain production work.

## Deployment

The app builds as a standard Next.js project on Vercel. Use `npm ci`, `npm run build`, and the Next.js framework preset. No environment variables are needed for the synthetic demo. Never attach production operational data to this unauthenticated build.

The connected Vercel project deploys pushes to `main`. `vercel.json` explicitly selects Next.js and the lockfile-based build. Deploying this demo does not configure or migrate Neon and does not enable real approvals or email. The supplied developer specification remains the source for production acceptance; the current demo does not claim to pass that acceptance suite.
