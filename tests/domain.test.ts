import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSIGNMENTS, INITIAL_STATE, PEOPLE, TODAY } from "../lib/data";
import { addDays, committedHours, coverageFor, evaluateMove, inclusiveEnd, matching, missionFor, scenarioAssignments, uncoveredHours, validDate, workingDays } from "../lib/domain";
import type { ScenarioMove } from "../lib/types";

const alex = PEOPLE[0];
const valid: ScenarioMove = { id: "test-move", personId: alex.id, missionId: "m2", start: "2026-11-02", end: "2027-01-30", weeklyHours: 40 };

test("date-only boundaries survive daylight-saving transitions", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-11-01", 1), "2026-11-02");
  assert.equal(inclusiveEnd("2026-10-31"), "2026-10-30");
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2026-02-28"), true);
});

test("Friday finish followed by Monday start has no weekday gap", () => {
  assert.deepEqual(workingDays("2026-10-31", "2026-11-02"), []);
  const maya = PEOPLE[1];
  assert.equal(uncoveredHours(maya, "2026-10-26", "2026-11-09"), 0);
});

test("partial release and tentative assignments do not imply full-time coverage", () => {
  const ethan = PEOPLE.find(p => p.id === "p5")!;
  assert.equal(committedHours(ethan.id, TODAY), 20);
  assert.equal(uncoveredHours(ethan, TODAY, "2026-10-12"), 20);
  assert.equal(committedHours(ethan.id, "2026-11-09"), 0);
});

test("blocked opening still reserves accepted staffing capacity", () => {
  const sofia = PEOPLE.find(p => p.id === "p4")!;
  assert.equal(committedHours(sofia.id, "2026-11-09"), 40);
  assert.equal(uncoveredHours(sofia, "2026-11-09", "2026-11-16"), 0);
});

test("valid landing passes but overlapping live commitments fail", () => {
  assert.deepEqual(evaluateMove(valid, alex, missionFor("m2")), []);
  const overlap = { ...valid, missionId: "m1", start: "2026-10-19", end: "2026-10-31" };
  assert.ok(evaluateMove(overlap, alex, missionFor("m1")).some(i => i.startsWith("Capacity conflict")));
});

test("saved scenario moves consume scenario capacity without changing the baseline", () => {
  const second = { ...valid, id: "second", weeklyHours: 20 };
  assert.ok(evaluateMove(second, alex, missionFor("m2"), [valid]).some(i => i.startsWith("Capacity conflict")));
  const baseline = coverageFor(PEOPLE, TODAY, "2027-01-04");
  const withDraft = coverageFor(PEOPLE, TODAY, "2027-01-04", [...ASSIGNMENTS, ...scenarioAssignments([valid])]);
  assert.deepEqual(withDraft, baseline);
});

test("shared mission demand is checked across proposed people", () => {
  const james = PEOPLE.find(p => p.id === "p3")!;
  const other: ScenarioMove = { ...valid, id: "james", personId: james.id, start: "2026-11-16", weeklyHours: 32 };
  const errors = evaluateMove(other, james, missionFor("m2"), [valid]);
  assert.ok(errors.some(i => i.includes("remaining funded demand")));
  assert.ok(!errors.some(i => i.startsWith("Capacity conflict")));
});

test("zero, non-quarter hours, out-of-scope dates and empty dates are rejected", () => {
  for (const hours of [0, -1, 1.1, Number.NaN]) assert.ok(evaluateMove({ ...valid, weeklyHours: hours }, alex, missionFor("m2")).length);
  assert.ok(evaluateMove({ ...valid, start: "2026-10-19" }, alex, missionFor("m2")).some(i => i.includes("approved span")));
  assert.ok(evaluateMove({ ...valid, end: "" }, alex, missionFor("m2")).length);
});

test("equipment return is closeout, not a start blocker", () => {
  const fit = matching(alex, missionFor("m2"), INITIAL_STATE.obligations);
  assert.equal(fit.label, "Skills aligned");
  assert.equal(fit.blockers.length, 0);
});

test("evidence submission alone cannot clear a mandatory prerequisite", () => {
  const sofia = PEOPLE.find(p => p.id === "p4")!;
  const obligations = INITIAL_STATE.obligations.map(o => o.id === "b2" ? { ...o, state: "submitted" as const } : o);
  assert.equal(matching(sofia, missionFor("m5"), obligations).label, "Fits after prerequisites");
});
