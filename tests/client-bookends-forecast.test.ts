import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { analyzeForecast } from "../lib/forecast/analyze";
import { createLocalAdminStore, applyLocalAdminCommand } from "../lib/admin/local";
import type { ClientBookend } from "../lib/scheduling/client-bookends";
import type { ForecastScenario } from "../lib/forecast/types";

function setup() {
  const bookend: ClientBookend = { id: randomUUID(), name: "Client intake", purpose: "onboarding", phase: "start", enforcement: "required", cadence: "weeks", every: 2, anchorDate: "2027-01-04", windowDays: 1, noticeDays: 3, until: null, active: true, notes: "" };
  let store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", name: "Timing client", code: "TC", contactName: "", contactEmail: "", notes: "", bookends: [bookend] });
  store = applyLocalAdminCommand(store, { type: "save_resource", name: "Available later", home: "", ownerId: "", profile: { roles: ["Data Engineer"], skills: ["SQL"] } });
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Potential team", clientId: store.data.clients[0].id, engagement: { version: 1, source: "sow", status: "draft", sowReference: "", signedOn: null, start: "2027-01-05", end: "2027-03-31", outcomes: "", pipeline: { stage: "proposal", confidence: 70, expectedClose: "2027-01-01" }, roles: [{ id: randomUUID(), name: "Data Engineer", headcount: 2, skills: ["SQL"], allocationPercent: 100, responsibilities: "", start: "2027-01-05", end: "2027-03-31" }] } });
  store.data.forecast = { version: 1, revision: 1, scenarios: [], commitments: [], capacities: [{ resourceId: store.data.resources[0].id, allocationPercent: 100, availableFrom: "2027-01-18", availableUntil: null, notes: "" }] };
  const scenario: ForecastScenario = { id: randomUUID(), name: "Timing test", hiringLeadWeeks: 4, selections: [{ missionId: store.data.missions[0].id, included: true, shiftDays: 0, teamScale: 1 }] };
  return { data: store.data, scenario, bookend };
}

test("client wait stays visible without erasing demand; an explicit scenario shift recalculates availability and hiring", () => {
  const { data, scenario } = setup(), before = structuredClone(data);
  const requested = analyzeForecast(data, scenario, "2027-01-01", 6);
  assert.equal(requested.roles[0].clientTiming?.start.eligibleDate, "2027-01-18");
  assert.equal(requested.roles[0].clientTiming?.start.delayDays, 13);
  assert.equal(requested.roles[0].start, "2027-01-05");
  assert.equal(requested.roles[0].hiringGapSeats, 2);
  scenario.selections[0].shiftDays = 13;
  const shifted = analyzeForecast(data, scenario, "2027-01-01", 6);
  assert.equal(shifted.roles[0].clientTiming?.start.status, "clear");
  assert.equal(shifted.roles[0].start, "2027-01-18");
  assert.equal(shifted.roles[0].end, "2027-04-13");
  assert.equal(shifted.roles[0].hiringGapSeats, 1);
  assert.equal(shifted.roles[0].hireBy, "2026-12-21");
  assert.deepEqual(data, before);
});

test("signed demand and commitments keep dates even when the client window cannot be met", () => {
  const { data, scenario } = setup(), mission = data.missions[0];
  Object.assign(mission.engagement!, { status: "signed", signedOn: "2026-12-01", sowReference: "SOW1", pipeline: undefined });
  data.clients[0].bookends![0].cadence = "once";
  scenario.selections[0].shiftDays = 13;
  data.forecast!.commitments.push({ id: randomUUID(), resourceId: data.resources[0].id, missionId: mission.id, name: "Booked", start: "2027-01-05", end: "2027-03-31", allocationPercent: 100 });
  const before = structuredClone(data), result = analyzeForecast(data, scenario, "2027-01-01", 6);
  assert.equal(result.roles[0].clientTiming?.start.status, "blocked");
  assert.equal(result.roles[0].start, "2027-01-05");
  assert.equal(result.summary.peakDemandFte, 2);
  assert.ok(result.warnings.some(warning => warning.includes("client timing needs review")));
  assert.deepEqual(data, before);
});

test("expected close controls notice and phased role dates get their own entry and exit checks", () => {
  const { data, scenario, bookend } = setup();
  data.missions[0].engagement!.pipeline!.expectedClose = "2027-01-16";
  data.clients[0].bookends!.push({ ...bookend, id: randomUUID(), name: "Client exit", phase: "end", purpose: "offboarding", cadence: "months", every: 1, anchorDate: "2027-01-30", noticeDays: 0 });
  data.missions[0].engagement!.roles.push({ ...data.missions[0].engagement!.roles[0], id: randomUUID(), start: "2027-02-02", end: "2027-03-30" });
  const result = analyzeForecast(data, scenario, "2027-01-01", 6);
  assert.equal(result.roles.find(role => role.start === "2027-01-05")!.clientTiming?.start.eligibleDate, "2027-02-01");
  assert.equal(result.roles.find(role => role.start === "2027-02-02")!.clientTiming?.start.eligibleDate, "2027-02-15");
  assert.equal(result.roles.find(role => role.end === "2027-03-31")!.clientTiming?.end.eligibleDate, "2027-04-30");
  assert.equal(result.roles.find(role => role.end === "2027-03-30")!.clientTiming?.end.status, "clear");
});

test("advisory and paused rules never shift forecast demand or create a required-window warning", () => {
  const { data, scenario, bookend } = setup();
  data.clients[0].bookends = [{ ...bookend, enforcement: "advisory" }, { ...bookend, id: randomUUID(), active: false, cadence: "once" }];
  const result = analyzeForecast(data, scenario, "2027-01-01", 6);
  assert.equal(result.roles[0].clientTiming?.start.status, "clear");
  assert.equal(result.roles[0].clientTiming?.start.checks[0].delayDays, 13);
  assert.equal(result.roles[0].start, "2027-01-05");
  assert.ok(!result.warnings.some(warning => warning.includes("client timing needs review")));
});
