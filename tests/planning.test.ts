import { test } from "node:test";
import assert from "node:assert/strict";
import { MISSIONS, PEOPLE, TODAY } from "../lib/data";
import { daysBetween, evaluateMove, missionFor } from "../lib/domain";
import { availableWeeklyHours, getMoveGuidance, recommendMove } from "../lib/planning";
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

test("Solstice explains funded demand separately from Alex's personal availability and keeps dates on a suitable alternative", () => {
  const solstice=missionFor("m10"), selected={start:"2026-11-30",end:"2027-01-03",weeklyHours:40};
  const guidance=getMoveGuidance(alex,solstice,selected);
  assert.equal(guidance.availableHours,0);assert.equal(guidance.personAvailableHours,40);assert.equal(guidance.missionAvailableHours,0);
  assert.deepEqual(guidance.blockers.map(blocker=>blocker.kind),["mission_capacity"]);
  const blocker=guidance.blockers[0];
  assert.match(blocker.message,/Solstice.*0 funded h\/week/);assert.match(blocker.message,/Liam Davis/);
  assert.deepEqual(blocker.reservations.map(reservation=>({person:reservation.personName,source:reservation.source,start:reservation.start,end:reservation.end,hours:reservation.weeklyHours})),[{person:"Liam Davis",source:"committed",start:"2026-11-23",end:"2027-03-06",hours:40}]);
  const recovery=guidance.options[0];
  assert.equal(recovery.kind,"change_mission");assert.equal(recovery.missionId,northstar.id);
  assert.equal(recovery.client,"Northstar");assert.equal(recovery.missionName,"Analytics engine");
  assert.deepEqual({start:recovery.start,end:recovery.end,weeklyHours:recovery.weeklyHours},selected);
  assert.deepEqual(recovery.missingSkills,[]);assert.equal(recovery.commercial,"authorized");
});

test("guidance offers one-click lower hours with the scenario reservation that caused the limit", () => {
  const reserved={...alexMove,id:"other-mission",missionId:"m8",weeklyHours:25};
  const guidance=getMoveGuidance(alex,northstar,alexMove,[reserved]);
  assert.equal(guidance.availableHours,15);assert.equal(guidance.personAvailableHours,15);assert.equal(guidance.missionAvailableHours,40);
  assert.equal(guidance.blockers[0].kind,"person_capacity");
  assert.equal(guidance.blockers[0].reservations[0].source,"scenario");
  assert.equal(guidance.blockers[0].reservations[0].missionName,"Platform evolution");
  assert.match(guidance.blockers[0].message,/this scenario/);
  assert.equal(guidance.options[0].kind,"reduce_hours");assert.equal(guidance.options[0].weeklyHours,15);
  assert.equal(guidance.options[0].start,alexMove.start);assert.equal(guidance.options[0].end,alexMove.end);
});

test("guidance excludes the edited move but keeps other people's draft demand visible", () => {
  const other={...alexMove,id:"james-draft",personId:"p3",weeklyHours:32};
  const guidance=getMoveGuidance(alex,northstar,alexMove,[alexMove,other],alexMove.id);
  assert.equal(guidance.personAvailableHours,40);assert.equal(guidance.missionAvailableHours,8);
  assert.deepEqual(guidance.blockers.map(blocker=>blocker.kind),["mission_capacity"]);
  assert.ok(guidance.blockers[0].reservations.some(reservation=>reservation.personName==="James Okafor"&&reservation.source==="scenario"));
  assert.ok(guidance.blockers[0].reservations.every(reservation=>reservation.id!==alexMove.id));
  assert.equal(guidance.options[0].weeklyHours,8);
  assert.equal(getMoveGuidance(alex,northstar,alexMove,[alexMove],alexMove.id).blockers.length,0);
});

test("earlier part-time and later full-time windows are both real choices with commercial caveats", () => {
  const best=recommendMove(ethan,aperture)!;
  const guidance=getMoveGuidance(ethan,aperture,best);
  const earlier=guidance.options.find(option=>option.missionId===aperture.id&&option.start===TODAY)!;
  assert.ok(earlier);assert.equal(earlier.weeklyHours,20);assert.equal(earlier.end,aperture.end);
  assert.equal(earlier.commercial,"contingent");assert.match(earlier.reason,/Commercial approval is still pending/);
  const blocked=getMoveGuidance(ethan,aperture,{start:TODAY,end:aperture.end,weeklyHours:40});
  assert.ok(blocked.options.some(option=>option.kind==="reduce_hours"&&option.weeklyHours===20));
  assert.ok(blocked.options.some(option=>option.kind==="change_dates"&&option.start===best.start&&option.weeklyHours===40));
});

test("date and input problems stay distinct from actual reserved capacity", () => {
  const inverted=getMoveGuidance(alex,northstar,{start:"2027-01-30",end:"2026-11-02",weeklyHours:40});
  assert.deepEqual(inverted.blockers.map(blocker=>blocker.kind),["invalid_dates"]);
  const weekend=getMoveGuidance(alex,northstar,{start:"2026-11-07",end:"2026-11-09",weeklyHours:40});
  assert.deepEqual(weekend.blockers.map(blocker=>blocker.kind),["no_working_days"]);
  const invalidHours=getMoveGuidance(alex,northstar,{...alexMove,weeklyHours:NaN});
  assert.deepEqual(invalidHours.blockers.map(blocker=>blocker.kind),["invalid_hours"]);
  assert.ok(invalidHours.options.every(option=>Number.isFinite(option.weeklyHours)));
  const tooLong=getMoveGuidance(alex,northstar,{start:TODAY,end:"9999-12-31",weeklyHours:40});
  assert.ok(tooLong.blockers.some(blocker=>blocker.kind==="span_too_long"));
  const sofia=PEOPLE.find(person=>person.id==="p4")!,helix=missionFor("m5");
  const reserved=getMoveGuidance(sofia,helix,{start:helix.start,end:helix.end,weeklyHours:40});
  assert.equal(reserved.personAvailableHours,0);
  assert.ok(reserved.blockers.some(blocker=>blocker.reservations.some(reservation=>reservation.id==="a6"&&reservation.source==="committed")));
});

test("all guidance actions fit authoritative capacity, carry explicit review flags, and preserve inputs", () => {
  const drafts=[alexMove], before=structuredClone(drafts);
  for(const person of PEOPLE)for(const mission of MISSIONS){
    const selected={start:mission.start<TODAY?TODAY:mission.start,end:mission.end,weeklyHours:person.weeklyHours};
    const guidance=getMoveGuidance(person,mission,selected,drafts);
    assert.ok(guidance.options.length<=3);
    for(const option of guidance.options){
      const target=missionFor(option.missionId);
      assert.deepEqual(evaluateMove({...option,id:"new-guidance",personId:person.id},person,target,drafts),[],`${person.name} / ${option.client} / ${option.start}`);
      assert.deepEqual(option.missingSkills,target.skills.filter(skill=>!person.skills.includes(skill)));
      assert.equal(option.commercial,target.commercial);
      assert.ok(daysBetween(option.start,option.end)<=730);
    }
  }
  assert.deepEqual(drafts,before);
});
