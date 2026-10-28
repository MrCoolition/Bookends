import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { clientBookendsSchema, describeBookend, evaluateClientBookends, upcomingBookendWindows, type ClientBookend } from "../lib/scheduling/client-bookends";

const rule = (patch: Partial<ClientBookend> = {}): ClientBookend => ({ id: randomUUID(), name: "Client onboarding", purpose: "onboarding", phase: "start", enforcement: "required", cadence: "weeks", every: 2, anchorDate: "2027-01-04", windowDays: 1, noticeDays: 0, until: null, active: true, notes: "", ...patch });
const evaluate = (rules: ClientBookend[] | undefined, date: string, readyOn = "2026-12-01") => evaluateClientBookends(rules, date, { phase: "start", readyOn });

test("fortnightly intake exposes the actual wait after a missed opening", () => {
  const rules = [rule()], before = structuredClone(rules);
  assert.equal(evaluate(rules, "2027-01-04").status, "clear");
  const result = evaluate(rules, "2027-01-05");
  assert.equal(result.status, "delayed"); assert.equal(result.eligibleDate, "2027-01-18"); assert.equal(result.delayDays, 13);
  assert.equal(result.checks[0].windowStart, "2027-01-18");
  assert.deepEqual(rules, before);
  assert.deepEqual(upcomingBookendWindows(rules[0], "2027-01-05", "2026-12-01").map(value => value.start), ["2027-01-18", "2027-02-01", "2027-02-15"]);
  assert.equal(evaluate(rules, "2026-12-01").eligibleDate, "2027-01-04");
});

test("notice deadline is inclusive and belongs to opening, not each day of the window", () => {
  const intake = rule({ windowDays: 3, noticeDays: 3 });
  const onTime = evaluate([intake], "2027-01-05", "2027-01-01");
  assert.equal(onTime.eligibleDate, "2027-01-05"); assert.equal(onTime.checks[0].cutoff, "2027-01-01");
  assert.equal(evaluate([intake], "2027-01-05", "2027-01-02").eligibleDate, "2027-01-18");
  // Even a zero-notice window must be ready by its opening date.
  assert.equal(evaluate([rule({ windowDays: 3 })], "2027-01-05", "2027-01-05").eligibleDate, "2027-01-18");
});

test("multi-day windows and excluded dates retain the anchored recurrence", () => {
  const intake = rule({ windowDays: 3, excludedDates: ["2027-01-04", "2027-01-05", "2027-01-18", "2027-01-19", "2027-01-20"] });
  assert.equal(evaluate([intake], "2027-01-04").eligibleDate, "2027-01-06");
  assert.equal(evaluate([intake], "2027-01-06").eligibleDate, "2027-01-06");
  assert.equal(evaluate([intake], "2027-01-07").eligibleDate, "2027-02-01");
  assert.deepEqual(upcomingBookendWindows(intake, "2027-01-01", "2026-12-01").map(value => value.eligibleDate), ["2027-01-06", "2027-02-01", "2027-02-15"]);
});

test("required windows find a joint date instead of a misleading single-pass maximum", () => {
  const first = rule({ cadence: "days", every: 4, anchorDate: "2027-01-01", windowDays: 2 });
  const second = rule({ cadence: "days", every: 5, anchorDate: "2027-01-03", windowDays: 2 });
  const result = evaluate([first, second], "2027-01-01");
  assert.equal(result.eligibleDate, "2027-01-09"); assert.equal(result.delayDays, 8);
  assert.deepEqual(result.checks.map(value => value.eligibleDate), ["2027-01-01", "2027-01-03"]);
  assert.equal(evaluate([second, first], "2027-01-01").eligibleDate, result.eligibleDate);
});

test("incompatible required schedules stop with an explicit blocked result", () => {
  const odd = rule({ cadence: "days", every: 2, anchorDate: "2027-01-01" });
  const even = rule({ cadence: "days", every: 2, anchorDate: "2027-01-02" });
  const result = evaluate([odd, even], "2027-01-01");
  assert.equal(result.status, "blocked"); assert.equal(result.eligibleDate, null); assert.equal(result.delayDays, null);
  assert.match(result.reason!, /never overlap/);
});

test("fixed-cycle incompatibility checks handle wrapped and overlapping multi-day windows", () => {
  const a = rule({ cadence: "days", every: 8, anchorDate: "2027-01-01", windowDays: 2 });
  const b = rule({ cadence: "days", every: 12, anchorDate: "2027-01-04", windowDays: 2 });
  // Their projected intervals wrap modulo gcd(8, 12)=4 and do intersect.
  assert.equal(evaluate([a, b], "2027-01-01").eligibleDate, "2027-01-17");
  assert.equal(evaluate([a, { ...b, anchorDate: "2027-01-03" }], "2027-01-01").status, "blocked");
  assert.equal(evaluate([a, { ...b, anchorDate: "2027-01-03", windowDays: 3 }], "2027-01-01").eligibleDate, "2027-01-17");
});

test("advisory, inactive and other-phase bookends cannot delay the requested start", () => {
  const advisory = rule({ enforcement: "advisory" });
  const result = evaluate([advisory, rule({ active: false }), rule({ phase: "end" })], "2027-01-05");
  assert.equal(result.status, "clear"); assert.equal(result.eligibleDate, "2027-01-05");
  assert.equal(result.checks.length, 1); assert.equal(result.checks[0].eligibleDate, "2027-01-18");
  assert.equal(evaluate([rule({ active: false })], "2027-01-05").status, "unconfigured");
  assert.equal(evaluate(undefined, "2027-01-05").status, "unconfigured");
  assert.equal(upcomingBookendWindows(rule({ active: false }), "2027-01-01", "2026-12-01").length, 0);
  assert.equal(evaluateClientBookends([rule({ phase: "end" })], "2027-01-05", { phase: "end", readyOn: "2026-12-01" }).eligibleDate, "2027-01-18");
});

test("one-time and final-date rules cannot promise a date after expiry", () => {
  const once = rule({ cadence: "once", windowDays: 5, until: "2027-01-06" });
  assert.equal(evaluate([once], "2027-01-06").status, "clear");
  assert.equal(evaluate([once], "2027-01-07").status, "blocked");
  assert.deepEqual(upcomingBookendWindows(once, "2027-01-01", "2026-12-01"), [{ start: "2027-01-04", end: "2027-01-06", cutoff: "2027-01-04", eligibleDate: "2027-01-04" }]);
  assert.equal(evaluate([rule({ until: "2027-01-17" })], "2027-01-05").status, "blocked");
});

test("monthly anchors clamp month ends without drifting after February", () => {
  const monthly = rule({ cadence: "months", every: 1, anchorDate: "2027-01-31" });
  assert.deepEqual(upcomingBookendWindows(monthly, "2027-02-01", "2026-12-01", 4).map(value => value.start), ["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  const leap = rule({ cadence: "months", every: 1, anchorDate: "2028-01-31" });
  assert.equal(evaluate([leap], "2028-02-01").eligibleDate, "2028-02-29");
  assert.equal(evaluate([rule({ cadence: "months", every: 2, anchorDate: "2027-01-31" })], "2027-02-01").eligibleDate, "2027-03-31");
});

test("weekly calendar dates cross daylight-saving changes without moving weekdays", () => {
  const weekly = rule({ cadence: "weeks", every: 1, anchorDate: "2027-03-07" });
  assert.deepEqual(upcomingBookendWindows(weekly, "2027-03-07", "2026-12-01", 4).map(value => value.start), ["2027-03-07", "2027-03-14", "2027-03-21", "2027-03-28"]);
});

test("overlapping recurring windows remain distinct upcoming occurrences", () => {
  const overlapping = rule({ cadence: "days", every: 1, windowDays: 3 });
  assert.deepEqual(upcomingBookendWindows(overlapping, "2027-01-05", "2026-12-01").map(value => value.start), ["2027-01-04", "2027-01-05", "2027-01-06"]);
  const withNotice = rule({ cadence: "days", every: 2, windowDays: 5, noticeDays: 1 });
  const result = evaluate([withNotice], "2027-01-07", "2027-01-05");
  assert.equal(result.eligibleDate, "2027-01-07");
  assert.equal(result.checks[0].windowStart, "2027-01-06", "The older opening's missed deadline must not hide a later overlapping window.");
});

test("calendar boundaries and invalid configuration fail safely", () => {
  const late = rule({ anchorDate: "9999-12-31", windowDays: 90 });
  assert.deepEqual(upcomingBookendWindows(late, "9999-12-30", "9999-12-01"), [{ start: "9999-12-31", end: "9999-12-31", cutoff: "9999-12-31", eligibleDate: "9999-12-31" }]);
  assert.equal(evaluate([rule({ cadence: "months", anchorDate: "9999-12-01" })], "9999-12-31", "9999-01-01").status, "blocked");
  assert.equal(evaluate([late], "9999-12-31", "9999-12-31").status, "clear");
  assert.equal(evaluate([{ ...late, noticeDays: 1 }], "9999-12-31", "9999-12-31").status, "blocked");
  assert.equal(evaluate([rule({ anchorDate: "0001-01-01", noticeDays: 1 })], "0001-01-01", "0001-01-01").eligibleDate, "0001-01-15");
  assert.deepEqual(upcomingBookendWindows(rule({ anchorDate: "0001-01-31", cadence: "months", every: 1 }), "0001-02-01", "0001-01-01").map(value => value.start), ["0001-02-28", "0001-03-31", "0001-04-30"]);
  for (const invalid of ["2027-02-30", "0000-01-01", "10000-01-01", "not-a-date"]) assert.equal(evaluate([rule()], invalid).status, "blocked");
  assert.equal(evaluate([rule({ every: 0 })], "2027-01-04").status, "blocked");
  assert.equal(upcomingBookendWindows(rule(), "2027-01-01", "2026-12-01", 1000).length, 0);
});

test("the full excluded-date allowance cannot suppress the first usable opening", () => {
  const epoch = Date.parse("2027-01-01T00:00:00Z"), at = (offset: number) => new Date(epoch + offset * 86_400_000).toISOString().slice(0, 10);
  const intake = rule({ cadence: "days", every: 1, anchorDate: at(0), excludedDates: Array.from({ length: 100 }, (_, index) => at(index)) });
  assert.equal(evaluate([intake], at(0)).eligibleDate, at(100));
  assert.equal(upcomingBookendWindows(intake, at(0), "2026-12-01")[0].eligibleDate, at(100));
});

test("schema rejects duplicate IDs, invalid dates and oversized configurations", () => {
  const intake = rule();
  assert.equal(clientBookendsSchema.safeParse([intake, intake]).success, false);
  assert.equal(clientBookendsSchema.safeParse([rule({ until: "2027-01-03" })]).success, false);
  assert.equal(clientBookendsSchema.safeParse([rule({ anchorDate: "2027-02-29" })]).success, false);
  assert.equal(clientBookendsSchema.safeParse([rule({ excludedDates: ["2027-01-04", "2027-01-04"] })]).success, false);
  assert.equal(clientBookendsSchema.safeParse(Array.from({ length: 21 }, () => rule())).success, false);
  assert.match(describeBookend(rule({ noticeDays: 3 })), /Every 2 weeks.*3 days' notice/);
  assert.match(describeBookend(rule({ phase: "end" })), /exit window/);
});

test("joint fixed-day schedules agree with independent calendar enumeration", () => {
  const epoch = Date.parse("2027-01-01T00:00:00Z"), at = (offset: number) => new Date(epoch + offset * 86_400_000).toISOString().slice(0, 10);
  // Different cycle lengths, overlap widths, notice periods and exclusions
  // exercise the intersection independently of the engine's event jumping.
  for (let seed = 0; seed < 30; seed++) {
    const values = [0, 1, 2].map(index => rule({ cadence: "days", every: 2 + (seed + index * 3) % 9, anchorDate: at(index * 2), windowDays: 1 + (seed + index) % 4, noticeDays: seed % 4, excludedDates: [at(15 + index), at(25 + index)] }));
    const requested = seed % 8, ready = seed % 5;
    const eligible = (candidate: number, value: ClientBookend) => {
      if (value.excludedDates!.includes(at(candidate))) return false;
      const anchor = Math.round((Date.parse(`${value.anchorDate}T00:00:00Z`) - epoch) / 86_400_000);
      for (let start = anchor; start <= candidate; start += value.every) if (candidate < start + value.windowDays && ready <= start - value.noticeDays) return true;
      return false;
    };
    let first: number | undefined;
    for (let candidate = requested; candidate <= 180; candidate++) if (values.every(value => eligible(candidate, value))) { first = candidate; break; }
    const result = evaluate(values, at(requested), at(ready));
    if (first !== undefined) assert.equal(result.eligibleDate, at(first), `Calendar case ${seed}`);
    else assert.ok(result.eligibleDate === null || result.eligibleDate > at(180), `No earlier date in calendar case ${seed}`);
  }
});
