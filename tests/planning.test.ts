import { test } from "node:test";
import assert from "node:assert/strict";
import { MISSIONS, PEOPLE, TODAY } from "../lib/data";
import { daysBetween, evaluateMove, missionFor } from "../lib/domain";
import { availableWeeklyHours, recommendMove } from "../lib/planning";
import type { ScenarioMove } from "../lib/types";

const alex = PEOPLE[0];
const ethan = PEOPLE.find(person => person.id === "p5")!;
const northstar = missionFor("m2");
const aperture = missionFor("m6");
const alexMove: ScenarioMove = {
  id: "alex-draft", personId: alex.id, missionId: northstar.id,
  start: northstar.start, end: northstar.end, weeklyHours: 40,
};

test("recommendation waits for full capacity instead of overlapping an existing commitment", () => {
  assert.equal(availableWeeklyHours(ethan, aperture, TODAY, aperture.end), 20);
  assert.deepEqual(recommendMove(ethan, aperture), {
    start: "2026-11-09", end: "2026-12-19", weeklyHours: 40,
  });
});

test("shared funded demand limits an otherwise available person", () => {
  const isabella = PEOPLE.find(person => person.id === "p6")!;
  const atlas = missionFor("m4");
  assert.equal(availableWeeklyHours(isabella, atlas, TODAY, atlas.end), 0);
  assert.deepEqual(recommendMove(isabella, atlas), {
    start: "2026-10-19", end: "2026-11-07", weeklyHours: 20,
  });
  assert.equal(availableWeeklyHours(alex, northstar, northstar.start, northstar.end, [
    { ...alexMove, id: "other", personId: "p3", weeklyHours: 32 },
  ]), 8);
});

test("drafts reserve both personal capacity and mission demand", () => {
  const otherMission = { ...alexMove, missionId: "m8", weeklyHours: 25 };
  assert.equal(availableWeeklyHours(alex, northstar, northstar.start, northstar.end, [otherMission]), 15);
  assert.deepEqual(recommendMove(alex, northstar, [otherMission]), {
    start: northstar.start, end: northstar.end, weeklyHours: 15,
  });
  assert.equal(recommendMove(alex, northstar, [alexMove]), null);
});

test("editing excludes the current move without excluding other drafts", () => {
  const smallOtherDraft = { ...alexMove, id: "other", personId: "p3", weeklyHours: 8 };
  assert.equal(availableWeeklyHours(alex, northstar, northstar.start, northstar.end, [alexMove], alexMove.id), 40);
  assert.deepEqual(recommendMove(alex, northstar, [alexMove, smallOtherDraft], alexMove.id), {
    start: northstar.start, end: northstar.end, weeklyHours: 32,
  });
});

test("fully reserved and blocked committed assignments have no additional capacity", () => {
  const sofia = PEOPLE.find(person => person.id === "p4")!;
  assert.equal(recommendMove(sofia, missionFor("m5")), null);
  assert.equal(recommendMove(alex, missionFor("m1")), null);
});

test("recommendation chooses the longest continuous working-day window without bridging a conflict", () => {
  const gap: ScenarioMove = {
    ...alexMove, start: "2026-11-16", end: "2026-11-21", missionId: "m8",
  };
  assert.deepEqual(recommendMove(alex, northstar, [gap]), {
    start: "2026-11-23", end: northstar.end, weeklyHours: 40,
  });
});

test("invalid, inverted, past, out-of-mission, and weekend-only intervals return zero", () => {
  for (const [start, end] of [
    ["", northstar.end], ["2026-02-30", northstar.end], [northstar.end, northstar.start],
    ["2026-10-05", northstar.end], [northstar.start, "2027-02-01"],
    ["2026-11-07", "2026-11-09"],
  ]) assert.equal(availableWeeklyHours(alex, northstar, start, end), 0);
  assert.equal(availableWeeklyHours(alex, missionFor("m1"), "2026-09-01", "2026-09-02"), 0);
  assert.equal(recommendMove(alex, { ...northstar, start: "", end: "2027-01-30" }), null);
  assert.equal(recommendMove(alex, { ...northstar, start: "2026-01-01", end: "2026-02-01" }), null);
});

test("capacity is rounded down to quarter hours and the search is bounded", () => {
  const person = { ...alex, id: "test-person", weeklyHours: 31.9 };
  const mission = { ...northstar, id: "test-mission", start: TODAY, end: "2036-10-05" };
  const recommendation = recommendMove(person, mission)!;
  assert.equal(recommendation.weeklyHours, 31.75);
  assert.ok(daysBetween(recommendation.start, recommendation.end) <= 730);
  assert.equal(availableWeeklyHours(person, mission, TODAY, mission.end), 0);
});

test("every recommendation for the demo matrix passes the authoritative move validation", () => {
  let recommendations = 0;
  for (const person of PEOPLE) for (const mission of MISSIONS) {
    const recommendation = recommendMove(person, mission, [alexMove]);
    if (!recommendation) continue;
    recommendations++;
    const move = { ...recommendation, id: "new", personId: person.id, missionId: mission.id };
    assert.deepEqual(evaluateMove(move, person, mission, [alexMove]), [], `${person.name} / ${mission.name}`);
  }
  assert.ok(recommendations > 10);
});
