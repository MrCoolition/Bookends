import { z } from "zod";

const DAY = 86_400_000;
const firstDay = Date.parse("0001-01-01T00:00:00.000Z") / DAY;
const lastDay = Date.parse("9999-12-31T00:00:00.000Z") / DAY;
const day = (value: string) => Date.parse(`${value}T00:00:00.000Z`) / DAY;
const iso = (value: number) => new Date(value * DAY).toISOString().slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(0, 4) !== "0000" && Number.isFinite(day(value)) && iso(day(value)) === value;
const date = z.string().refine(validDate, "Choose a valid calendar date (YYYY-MM-DD).");
const text = (max: number, required = true) => z.string().trim().min(required ? 1 : 0).max(max).refine(value => !value.includes("\u0000"), "Text cannot contain null characters.");

/** A permitted entry/exit window, not the duration of onboarding or proof that
 * prerequisites are complete. All dates are inclusive calendar dates in UTC. */
export const clientBookendSchema = z.object({
  id: z.uuid(), name: text(120),
  purpose: z.enum(["onboarding", "offboarding", "access", "review", "custom"]),
  phase: z.enum(["start", "end"]), enforcement: z.enum(["required", "advisory"]),
  cadence: z.enum(["once", "days", "weeks", "months"]), every: z.int().min(1).max(366),
  anchorDate: date, windowDays: z.int().min(1).max(90), noticeDays: z.int().min(0).max(365),
  until: date.nullable(), active: z.boolean(), notes: text(1000, false),
  excludedDates: z.array(date).max(100).refine(values => new Set(values).size === values.length, "List each excluded date once.").optional(),
}).strict().refine(value => !value.until || value.until >= value.anchorDate, { message: "The final eligible date must be on or after the first window.", path: ["until"] });
export const clientBookendsSchema = z.array(clientBookendSchema).max(20).refine(values => new Set(values.map(value => value.id.toLowerCase())).size === values.length, "Each client bookend needs a unique ID.");
export type ClientBookend = z.infer<typeof clientBookendSchema>;
export type ClientBookendWindow = { start: string; end: string; cutoff: string; eligibleDate: string };
export type ClientBookendCheck = {
  bookendId: string; name: string; enforcement: ClientBookend["enforcement"];
  eligibleDate: string | null; delayDays: number | null;
  windowStart: string | null; windowEnd: string | null; cutoff: string | null;
};
export type ClientBookendEvaluation = {
  requestedDate: string; eligibleDate: string | null; delayDays: number | null;
  status: "clear" | "delayed" | "blocked" | "unconfigured";
  checks: ClientBookendCheck[]; reason?: string;
};

const monthDays = (year: number, month: number) => month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
function calendarDay(year: number, month: number, dateOfMonth: number): number {
  return day(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(dateOfMonth, monthDays(year, month))).padStart(2, "0")}`);
}
function searchLimit(from: number): number {
  const [year, month, dateOfMonth] = iso(from).split("-").map(Number);
  return year + 10 > 9999 ? lastDay : calendarDay(year + 10, month, dateOfMonth);
}
type Prepared = { rule: ClientBookend; anchor: number; end: number; excluded: Set<number>; year: number; month: number; dateOfMonth: number };
function prepare(rule: ClientBookend): Prepared {
  const [year, month, dateOfMonth] = rule.anchorDate.split("-").map(Number);
  return { rule, anchor: day(rule.anchorDate), end: rule.until ? day(rule.until) : lastDay, excluded: new Set((rule.excludedDates ?? []).map(day)), year, month, dateOfMonth };
}
function openingAt(prepared: Prepared, index: number): number {
  const { rule, anchor, year, month, dateOfMonth } = prepared;
  if (rule.cadence === "once") return index === 0 ? anchor : Infinity;
  if (rule.cadence !== "months") return anchor + index * rule.every * (rule.cadence === "weeks" ? 7 : 1);
  const ordinal = year * 12 + month - 1 + index * rule.every, nextYear = Math.floor(ordinal / 12), nextMonth = ordinal % 12 + 1;
  return nextYear > 9999 ? Infinity : calendarDay(nextYear, nextMonth, dateOfMonth);
}
function firstOpeningIndex(prepared: Prepared, earliest: number): number {
  const { rule, anchor, year, month } = prepared;
  if (rule.cadence === "once" || earliest <= anchor) return 0;
  if (rule.cadence !== "months") return Math.ceil((earliest - anchor) / (rule.every * (rule.cadence === "weeks" ? 7 : 1)));
  const target = new Date(Math.min(earliest, lastDay) * DAY);
  let index = Math.max(0, Math.floor(((target.getUTCFullYear() - year) * 12 + target.getUTCMonth() + 1 - month) / rule.every));
  if (openingAt(prepared, index) < earliest) index++;
  return index;
}

function incompatibleFixedWindows(required: Prepared[]): [Prepared, Prepared] | null {
  const fixed = required.filter(item => item.rule.cadence === "days" || item.rule.cadence === "weeks");
  const period = (item: Prepared) => item.rule.every * (item.rule.cadence === "weeks" ? 7 : 1);
  const gcd = (a: number, b: number): number => { while (b) { const remainder = a % b; a = b; b = remainder; } return a; };
  for (let index = 0; index < fixed.length; index++) for (let other = index + 1; other < fixed.length; other++) {
    const left = fixed[index], right = fixed[other], divisor = gcd(period(left), period(right));
    // Any shared date must have a residue covered by both windows modulo the
    // periods' gcd. Notice, expiry and exclusions only remove possible dates.
    if (left.rule.windowDays >= divisor || right.rule.windowDays >= divisor) continue;
    const offset = ((right.anchor - left.anchor) % divisor + divisor) % divisor;
    const overlaps = offset < left.rule.windowDays || offset + right.rule.windowDays > divisor;
    if (!overlaps) return [left, right];
  }
  return null;
}

/** Jump directly to the first possible occurrence. The only inner date scan is
 * inside a window (at most 90 days); excluded dates never reset the recurrence. */
function nextWindow(prepared: Prepared, from: number, ready: number, through: number, openingAfter = firstDay - 1): ClientBookendWindow | null {
  const { rule, anchor, end, excluded } = prepared;
  const earliestOpening = Math.max(anchor, ready + rule.noticeDays, from - rule.windowDays + 1, openingAfter + 1);
  if (from > through || from > end || earliestOpening > through || earliestOpening > end) return null;
  let index = firstOpeningIndex(prepared, earliestOpening);
  // At most 100 individually excluded dates can reject an otherwise viable
  // occurrence. The bound also protects this primitive from future schema edits.
  for (let attempts = 0; attempts <= 101; attempts++, index++) {
    const start = openingAt(prepared, index);
    if (!Number.isFinite(start) || start > through || start > end) return null;
    if (start < earliestOpening) continue;
    const finish = Math.min(start + rule.windowDays - 1, end, lastDay), cutoff = start - rule.noticeDays;
    if (cutoff < firstDay) continue;
    let eligible = Math.max(from, start);
    while (eligible <= finish && eligible <= through && excluded.has(eligible)) eligible++;
    if (eligible <= finish && eligible <= through) return { start: iso(start), end: iso(finish), cutoff: iso(cutoff), eligibleDate: iso(eligible) };
  }
  return null;
}

/** Up to twelve distinct upcoming openings. Invalid or inactive configuration
 * yields no dates; it must not accidentally promise an eligible start. */
export function upcomingBookendWindows(rule: ClientBookend, fromDate: string, readyOn: string, count = 3): ClientBookendWindow[] {
  const parsed = clientBookendSchema.safeParse(rule);
  if (!parsed.success || !parsed.data.active || !validDate(fromDate) || !validDate(readyOn) || !Number.isInteger(count) || count < 1 || count > 12) return [];
  const prepared = prepare(parsed.data), from = day(fromDate), ready = day(readyOn), through = searchLimit(from), values: ClientBookendWindow[] = [];
  let openingAfter = firstDay - 1;
  while (values.length < count) {
    const window = nextWindow(prepared, from, ready, through, openingAfter);
    if (!window) break;
    values.push(window); openingAfter = day(window.start);
  }
  return values;
}

/** Required windows intersect. Advisory windows are visible evidence but never
 * change the promised date. No staffing record, commitment or plan is mutated. */
export function evaluateClientBookends(bookends: ClientBookend[] | undefined, requestedDate: string, options: { phase: "start" | "end"; readyOn: string }): ClientBookendEvaluation {
  const blocked = (reason: string, checks: ClientBookendCheck[] = []): ClientBookendEvaluation => ({ requestedDate, eligibleDate: null, delayDays: null, status: "blocked", checks, reason });
  if (!validDate(requestedDate) || !validDate(options.readyOn) || !["start", "end"].includes(options.phase)) return blocked("Choose valid planning and ready-to-submit dates.");
  const parsed = clientBookendsSchema.safeParse(bookends ?? []);
  if (!parsed.success) return blocked("Review this client's bookend configuration before relying on its dates.");
  const applicable = parsed.data.filter(rule => rule.active && rule.phase === options.phase);
  if (!applicable.length) return { requestedDate, eligibleDate: requestedDate, delayDays: 0, status: "unconfigured", checks: [] };
  const from = day(requestedDate), ready = day(options.readyOn), through = searchLimit(from);
  const prepared = applicable.map(prepare);
  const checks = prepared.map(item => {
    const window = nextWindow(item, from, ready, through);
    return { bookendId: item.rule.id, name: item.rule.name, enforcement: item.rule.enforcement,
      eligibleDate: window?.eligibleDate ?? null, delayDays: window ? day(window.eligibleDate) - from : null,
      windowStart: window?.start ?? null, windowEnd: window?.end ?? null, cutoff: window?.cutoff ?? null };
  });
  const required = prepared.filter(item => item.rule.enforcement === "required");
  const incompatible = incompatibleFixedWindows(required);
  if (incompatible) return blocked(`The required windows “${incompatible[0].rule.name}” and “${incompatible[1].rule.name}” never overlap. Review their schedules.`, checks);
  let candidate = from;
  // Each unsuccessful pass moves forward by at least one calendar day. Ten
  // years bounds both work and the usefulness of a planning suggestion.
  for (let attempt = 0; attempt <= through - from; attempt++) {
    let next = candidate;
    for (const item of required) {
      const window = nextWindow(item, candidate, ready, through);
      if (!window) return blocked(`No shared eligible date within the planning horizon (up to 10 years). Review “${item.rule.name}”, its final date or the other required windows.`, checks);
      next = Math.max(next, day(window.eligibleDate));
    }
    if (next === candidate) return { requestedDate, eligibleDate: iso(candidate), delayDays: candidate - from, status: candidate === from ? "clear" : "delayed", checks };
    candidate = next;
  }
  return blocked("The required windows do not share an eligible date within the next 10 years. Review their schedules or final dates.", checks);
}

export function describeBookend(rule: ClientBookend): string {
  const recurrence = rule.cadence === "once" ? "One-time window" : rule.every === 1 ? `Every ${rule.cadence.slice(0, -1)}` : `Every ${rule.every} ${rule.cadence}`;
  return `${recurrence} · ${rule.windowDays}-day ${rule.phase === "end" ? "exit" : "entry"} window${rule.noticeDays ? ` · ${rule.noticeDays} ${rule.noticeDays === 1 ? "day's" : "days'"} notice` : ""}`;
}
