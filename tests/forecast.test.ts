import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { analyzeForecast } from "../lib/forecast/analyze";
import { emptyForecast, type ForecastScenario, type PlanningCapacity } from "../lib/forecast/types";
import { forecastWorkspaceSchema } from "../lib/forecast/validation";
import { createLocalAdminStore, applyLocalAdminCommand, parseLocalAdminStore } from "../lib/admin/local";
import { engagementPlanSchema, type EngagementPlan, type EngagementRole } from "../lib/admin/engagement";
import type { AdminBootstrap, AdminMission, AdminResource } from "../lib/admin/contracts";

const role = (patch: Partial<EngagementRole> = {}): EngagementRole => ({ id: randomUUID(), name: "Data Engineer", headcount: 1, allocationPercent: 100, skills: ["SQL"], responsibilities: "", start: "2027-01-01", end: "2027-03-31", ...patch });
function setup() {
  const store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", name: "First client", code: "FIRST", contactName: "", contactEmail: "", notes: "" });
  store.data.forecast = emptyForecast();
  return store;
}
function person(data: AdminBootstrap, name: string, capacity: Partial<PlanningCapacity> | null = {}): AdminResource {
  const resource: AdminResource = { id: randomUUID(), name, active: true, revision: 1, home: "", ownerId: "", profile: { roles: ["Data Engineer"], skills: ["SQL"] } };
  data.resources.push(resource);
  if (capacity) data.forecast!.capacities.push({ resourceId: resource.id, allocationPercent: 100, availableFrom: "2027-01-01", availableUntil: null, notes: "Confirmed", ...capacity });
  return resource;
}
function mission(data: AdminBootstrap, patch: Partial<EngagementPlan> = {}): AdminMission {
  const plan: EngagementPlan = { version: 1, source: "sow", sowReference: "", status: "draft", signedOn: null, start: "2027-01-01", end: "2027-03-31", outcomes: "", pipeline: { stage: "qualified", confidence: 60, expectedClose: "2026-12-15" }, roles: [role()], ...patch };
  const value: AdminMission = { id: randomUUID(), name: `Deal ${data.missions.length + 1}`, clientId: data.clients[0].id, active: true, revision: 1, engagement: plan };
  data.missions.push(value); return value;
}
function scenario(data: AdminBootstrap): ForecastScenario { return { id: randomUUID(), name: "What if they all land", hiringLeadWeeks: 8, selections: data.missions.map(row => ({ missionId: row.id, included: true, shiftDays: 0, teamScale: 1 })) }; }
const forecast = (data: AdminBootstrap, plan = scenario(data)) => analyzeForecast(data, plan, "2027-01-01", 6);

test("potential demand uses whole seats, required skills AND roles, and catalog aliases", () => {
  const { data } = setup(), known = person(data, "SQL fit"), wrongRole = person(data, "Only skill");
  wrongRole.profile!.roles = ["Business Analyst"];
  const missingSkill = person(data, "Only role"); missingSkill.profile!.skills = ["Python"];
  known.profile!.roles = ["Old engineer name"];
  data.capabilities = [{ id: randomUUID(), kind: "role", name: "Data Engineer", aliases: ["Old engineer name"], description: "", active: false, revision: 2 }];
  mission(data, { pipeline: { stage: "exploring", confidence: 1, expectedClose: null }, roles: [role({ headcount: 2 })] });
  const result = forecast(data);
  assert.equal(result.summary.peakDemandFte, 2);
  assert.equal(result.roles[0].confirmedSeats, 1); assert.equal(result.roles[0].hiringGapSeats, 1);
  assert.deepEqual(result.roles[0].candidates.map(row => row.resourceId), [known.id]);
  assert.equal(result.roles[0].hireBy, "2026-11-06");
});

test("concurrent opportunities cannot reuse one scarce person; partial roles share percentages", () => {
  const { data } = setup(); person(data, "One person");
  mission(data, { roles: [role({ allocationPercent: 50 })] }); mission(data, { roles: [role({ allocationPercent: 50 })] });
  let result = forecast(data);
  assert.equal(result.summary.peakHiringGapFte, 0); assert.equal(result.roles.reduce((sum, row) => sum + row.confirmedSeats, 0), 2);
  mission(data, { roles: [role({ allocationPercent: 50 })] }); result = forecast(data);
  assert.equal(result.summary.peakHiringGapFte, 0.5); assert.equal(result.summary.hiringGapSeats, 1);
  // Two half-time positions in a single role require two people, not one full-time person.
  data.missions = [data.missions[0]]; data.missions[0].engagement!.roles[0].headcount = 2;
  result = forecast(data); assert.equal(result.roles[0].confirmedSeats, 1); assert.equal(result.roles[0].hiringGapSeats, 1);
});

test("unknown capacity remains an unconfirmed possibility and is not double-counted", () => {
  const { data } = setup(); person(data, "Unconfirmed", null);
  mission(data); mission(data);
  const result = forecast(data);
  assert.equal(result.roles.reduce((sum, row) => sum + row.confirmedSeats, 0), 0);
  assert.equal(result.roles.reduce((sum, row) => sum + row.unknownSeats, 0), 1);
  assert.equal(result.summary.hiringGapSeats, 1);
  assert.equal(result.summary.unknownCapacityPeople, 1);
  assert.ok(result.warnings.some(value => value.includes("optimistic")));
  const single = forecast({ ...data, missions: [data.missions[0]] });
  assert.equal(single.summary.hiringGapSeats, 0); assert.equal(single.roles[0].unknownSeats, 1);
});

test("inclusive boundaries expose a one-day overlap; shifts change the scenario only", () => {
  const { data } = setup(); person(data, "One person");
  mission(data, { end: "2027-01-31", roles: [role({ end: "2027-01-31" })] });
  mission(data, { start: "2027-01-31", end: "2027-02-28", roles: [role({ start: "2027-01-31", end: "2027-02-28" })] });
  const before = structuredClone(data), plan = scenario(data);
  assert.equal(forecast(data, plan).summary.hiringGapSeats, 1);
  plan.selections[1].shiftDays = 1;
  assert.equal(forecast(data, plan).summary.hiringGapSeats, 0);
  assert.deepEqual(data, before);
  plan.selections[1].teamScale = 1.01;
  assert.equal(forecast(data, plan).roles.find(row => row.missionId === data.missions[1].id)!.seats, 2);
});

test("signed baseline is immutable and matching linked commitments fill seats exactly once", () => {
  const { data } = setup(), avery = person(data, "Avery"), morgan = person(data, "Morgan");
  const signed = mission(data, { status: "signed", signedOn: "2026-12-01", sowReference: "SOW1", pipeline: undefined, roles: [role({ selectedResourceIds: [avery.id] })] });
  const potential = mission(data, { roles: [role({ headcount: 2, selectedResourceIds: [morgan.id] })] });
  data.forecast!.commitments.push({ id: randomUUID(), name: "Signed work", resourceId: avery.id, missionId: signed.id, start: "2027-01-01", end: "2027-03-31", allocationPercent: 100 });
  const plan = scenario(data); Object.assign(plan.selections[0], { included: false, shiftDays: 90, teamScale: 3 });
  let result = forecast(data, plan), baseline = result.roles.find(row => row.baseline)!;
  assert.equal(baseline.start, "2027-01-01"); assert.equal(baseline.seats, 1); assert.equal(baseline.confirmedSeats, 1);
  assert.equal(result.roles.find(row => row.missionId === potential.id)!.confirmedSeats, 1);
  assert.equal(result.summary.hiringGapSeats, 1);
  plan.selections[1].shiftDays = 90; result = forecast(data, plan);
  assert.equal(result.summary.hiringGapSeats, 0);
});

test("proposed selections do not reserve people, unmatched commitments do, and overbooking is visible", () => {
  const { data } = setup(), avery = person(data, "Avery");
  const potential = mission(data, { roles: [role({ selectedResourceIds: [avery.id] })] });
  assert.equal(forecast(data).summary.hiringGapSeats, 0);
  data.forecast!.commitments.push({ id: randomUUID(), resourceId: avery.id, missionId: potential.id, name: "Existing reservation", start: "2027-01-01", end: "2027-03-31", allocationPercent: 100 });
  assert.equal(forecast(data).summary.hiringGapSeats, 1);
  data.forecast!.commitments.push({ id: randomUUID(), resourceId: avery.id, missionId: null, name: "Other reservation", start: "2027-02-01", end: "2027-02-28", allocationPercent: 20 });
  assert.ok(forecast(data).warnings.some(value => value.includes("Avery has commitments above")));
});

test("partial linked commitment combines with remaining confirmed capacity, not a second charge", () => {
  const { data } = setup(), avery = person(data, "Avery");
  const signed = mission(data, { status: "signed", signedOn: "2026-12-01", sowReference: "SOW1", pipeline: undefined });
  data.forecast!.commitments.push({ id: randomUUID(), resourceId: avery.id, missionId: signed.id, name: "Confirmed half", start: "2027-01-01", end: "2027-03-31", allocationPercent: 50 });
  assert.equal(forecast(data).roles[0].confirmedSeats, 1);
  data.forecast!.capacities = [];
  const unknown = forecast(data); assert.equal(unknown.roles[0].confirmedSeats, 0); assert.equal(unknown.roles[0].unknownSeats, 1);
});

test("lost, complete, inactive, direct and unmarked legacy drafts stay outside the forecast", () => {
  const { data } = setup();
  mission(data, { pipeline: { stage: "lost", confidence: 0, expectedClose: null } });
  mission(data, { status: "complete", pipeline: undefined, sowReference: "DONE", signedOn: "2026-12-01" });
  mission(data).active = false;
  mission(data, { source: "direct", pipeline: undefined });
  mission(data, { pipeline: undefined });
  assert.equal(forecast(data).roles.length, 0);
  const old = person(data, "Archived"); old.active = false;
  mission(data); assert.equal(forecast(data).roles[0].hiringGapSeats, 1);
});

test("capacity windows and bounded horizon are explicit; no role profile produces a caveat", () => {
  const { data } = setup(), avery = person(data, "Avery", { availableFrom: "2027-02-01", availableUntil: "2027-02-28" });
  avery.profile = undefined; mission(data);
  let result = forecast(data);
  assert.ok(result.warnings.some(value => value.includes("no delivery roles")));
  avery.profile = { roles: ["Data Engineer"], skills: ["SQL"] }; result = forecast(data);
  assert.equal(result.roles[0].hiringGapSeats, 1); assert.equal(result.months.find(row => row.month === "2027-02")!.hiringGapFte, 0);
  assert.equal(analyzeForecast(data, scenario(data), "2027-04-01", 1).roles.length, 0);
  assert.throws(() => analyzeForecast(data, scenario(data), "2027-02-30"));
  assert.throws(() => analyzeForecast(data, scenario(data), "2027-01-01", 37));
});

test("forecast saves have their own stale guard, retain source plans, and restore through JSON", () => {
  const store = setup(); const avery = person(store.data, "Avery"); mission(store.data);
  const plan = { ...scenario(store.data), asOf: "2027-01-01", horizonMonths: 6 }, before = structuredClone(store.data.missions), proposed = { ...store.data.forecast!, scenarios: [plan] };
  const saved = applyLocalAdminCommand(store, { type: "save_forecast", expectedRevision: 0, forecast: proposed });
  assert.equal(saved.data.forecast!.revision, 1); assert.deepEqual(saved.data.missions, before);
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(saved)), saved);
  assert.equal(saved.data.forecast!.scenarios[0].asOf, "2027-01-01"); assert.equal(saved.data.forecast!.scenarios[0].horizonMonths, 6);
  assert.throws(() => applyLocalAdminCommand(saved, { type: "save_forecast", expectedRevision: 0, forecast: proposed }), /forecast changed/);
  assert.throws(() => applyLocalAdminCommand(saved, { type: "save_forecast", expectedRevision: 1, forecast: proposed }), /forecast changed/);
  const invalid = structuredClone(saved.data.forecast!); invalid.capacities[0].resourceId = randomUUID();
  assert.throws(() => applyLocalAdminCommand(saved, { type: "save_forecast", expectedRevision: 1, forecast: invalid }), /saved teammate/);
  const duplicate = { ...proposed, capacities: [proposed.capacities[0], { ...proposed.capacities[0], resourceId: avery.id }] };
  assert.equal(forecastWorkspaceSchema.safeParse(duplicate).success, false);
  assert.equal(forecastWorkspaceSchema.safeParse({ ...proposed, capacities: [{ ...proposed.capacities[0], allocationPercent: 101 }] }).success, false);
  assert.equal(forecastWorkspaceSchema.safeParse({ ...proposed, scenarios: [{ ...plan, selections: [{ ...plan.selections[0], teamScale: 0 }] }] }).success, false);
  const legacy = createLocalAdminStore(); assert.equal(parseLocalAdminStore(legacy).data.forecast, undefined);
});

test("pipeline metadata cannot leak onto direct, signed or completed agreements", () => {
  const { data } = setup(), draft = mission(data).engagement!;
  assert.equal(engagementPlanSchema.safeParse(draft).success, true);
  for (const patch of [{ source: "direct" }, { status: "signed", signedOn: "2026-12-01", sowReference: "SIGNED" }, { status: "complete", signedOn: "2026-12-01", sowReference: "DONE" }]) assert.equal(engagementPlanSchema.safeParse({ ...draft, ...patch }).success, false);
  const { pipeline: _pipeline, ...won } = draft;
  assert.equal(engagementPlanSchema.safeParse({ ...won, status: "signed", signedOn: "2026-12-01", sowReference: "SIGNED" }).success, true);
});

test("monthly uncertainty stays visible and peak demand is measured independently of the gap snapshot", () => {
  const { data } = setup(), avery = person(data, "Avery", null);
  const signed = mission(data, { status: "signed", signedOn: "2026-12-01", sowReference: "SOW1", pipeline: undefined, end: "2027-01-31", roles: [role({ end: "2027-01-31" })] });
  data.forecast!.commitments.push({ id: randomUUID(), resourceId: avery.id, missionId: signed.id, name: "January opening", start: "2027-01-01", end: "2027-01-15", allocationPercent: 100 });
  const result = forecast(data);
  assert.equal(result.months[0].unknownCoverageFte, 1); assert.equal(result.months[0].confirmedCoverageFte, 0);
  assert.equal(result.roles[0].candidates[0].status, "unknown");
  const separate = setup().data;
  for (let i = 0; i < 10; i++) person(separate, `Person ${i}`, { availableUntil: "2027-01-15" });
  mission(separate, { end: "2027-01-15", roles: [role({ headcount: 10, end: "2027-01-15" })] });
  mission(separate, { start: "2027-01-16", end: "2027-01-31", roles: [role({ headcount: 2, start: "2027-01-16", end: "2027-01-31" })] });
  const peaks = forecast(separate); assert.equal(peaks.summary.peakDemandFte, 10); assert.equal(peaks.months[0].demandFte, 2); assert.equal(peaks.summary.peakHiringGapFte, 2);
});

test("usable capacity excludes external bookings and a full signed commitment confirms its own candidate", () => {
  const { data } = setup(), avery = person(data, "Avery");
  mission(data, { roles: [role({ allocationPercent: 50 })] });
  data.forecast!.commitments.push({ id: randomUUID(), resourceId: avery.id, missionId: null, name: "Other work", start: "2027-01-01", end: "2027-03-31", allocationPercent: 50 });
  assert.equal(forecast(data).months[0].capacityFte, 0.5);
  data.missions = []; data.forecast!.capacities = []; data.forecast!.commitments = [];
  const signed = mission(data, { status: "signed", signedOn: "2026-12-01", sowReference: "SOW1", pipeline: undefined });
  data.forecast!.commitments.push({ id: randomUUID(), resourceId: avery.id, missionId: signed.id, name: "Signed work", start: "2027-01-01", end: "2027-03-31", allocationPercent: 100 });
  const result = forecast(data); assert.equal(result.roles[0].confirmedSeats, 1); assert.equal(result.roles[0].candidates[0].status, "available");
  assert.match(result.roles[0].candidates[0].reason, /confirmed commitment/);
});

test("new commitments cannot reserve potential SOWs; unchanged historical entries remain recoverable", () => {
  const store = setup(), avery = person(store.data, "Avery"), potential = mission(store.data);
  const commitment = { id: randomUUID(), resourceId: avery.id, missionId: potential.id, name: "Potential reservation", start: "2027-01-01", end: "2027-03-31", allocationPercent: 100 };
  const proposed = { ...store.data.forecast!, commitments: [commitment] };
  assert.throws(() => applyLocalAdminCommand(store, { type: "save_forecast", expectedRevision: 0, forecast: proposed }), /Keep potential SOWs in scenarios/);
  store.data.forecast!.commitments.push(commitment);
  assert.equal(applyLocalAdminCommand(store, { type: "save_forecast", expectedRevision: 0, forecast: proposed }).data.forecast!.commitments.length, 1);
});

test("large forecasts stop with a useful message instead of partial or frozen results", () => {
  const { data } = setup();
  for (let i = 0; i < 1000; i++) person(data, `Person ${i}`);
  for (let i = 0; i < 5; i++) mission(data, { end: "2029-12-31", roles: Array.from({ length: 100 }, () => role({ end: "2029-12-31" })) });
  assert.throws(() => analyzeForecast(data, scenario(data), "2027-01-01", 36), /Shorten the horizon or include fewer/);
});
