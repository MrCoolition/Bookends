import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AdminBootstrap, AdminCapability, AdminResource } from "../lib/admin/contracts";
import { engagementPlanSchema, findRoleMatches, type EngagementPlan, type EngagementRole } from "../lib/admin/engagement";
import { applyLocalAdminCommand, createLocalAdminStore, parseLocalAdminStore } from "../lib/admin/local";
import { applySpreadsheetImport, planSpreadsheetImport } from "../lib/admin/spreadsheet";
import { workspaceSpreadsheetData } from "../lib/admin/spreadsheet-export";
import { analyzeForecast } from "../lib/forecast/analyze";
import { emptyForecast, type ForecastScenario } from "../lib/forecast/types";

function capability(kind: AdminCapability["kind"], name: string, aliases: string[] = []): AdminCapability {
  return { id: randomUUID(), kind, name, aliases, description: "", active: true, revision: 1 };
}
function person(name: string, roles: string[], skills: string[] = []): AdminResource {
  return { id: randomUUID(), name, home: "", ownerId: "", active: true, revision: 1, profile: { roles, skills } };
}
function role(patch: Partial<EngagementRole> = {}): EngagementRole {
  return { id: randomUUID(), name: "Business Analyst (BA)", headcount: 1, allocationPercent: 100, skills: [], responsibilities: "", start: "2027-01-01", end: "2027-06-30", ...patch };
}
function plan(demand: EngagementRole): EngagementPlan {
  return { version: 1, source: "sow", sowReference: "", status: "draft", signedOn: null, start: demand.start, end: demand.end, outcomes: "", pipeline: { stage: "qualified", confidence: 60, expectedClose: null }, roles: [demand] };
}
function forecastFixture(demand: EngagementRole, people: AdminResource[], capabilities: AdminCapability[]) {
  const store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", name: "Client", code: "CLIENT", contactName: "", contactEmail: "", notes: "" });
  const data: AdminBootstrap = store.data;
  data.resources = people;
  data.capabilities = capabilities;
  data.missions = [{ id: randomUUID(), name: "Potential data platform", clientId: data.clients[0].id, active: true, revision: 1, engagement: plan(demand) }];
  data.forecast = emptyForecast();
  const scenario: ForecastScenario = { id: randomUUID(), name: "If the SOW lands", hiringLeadWeeks: 8, selections: [{ missionId: data.missions[0].id, included: true, shiftDays: 0, teamScale: 1 }] };
  return { data, scenario, run: () => analyzeForecast(data, scenario, "2027-01-01", 6) };
}
function confirmCapacity(data: AdminBootstrap, resource: AdminResource, allocationPercent = 100) {
  data.forecast!.capacities.push({ resourceId: resource.id, allocationPercent, availableFrom: "2027-01-01", availableUntil: null, notes: "Confirmed planning capacity" });
}

test("SOW acronym suffix aligns to the configured role without changing source or person records", () => {
  const demand = role(), analyst = person("Avery", ["Business Analyst"]);
  const catalog = [capability("role", "Business Analyst")];
  const before = structuredClone({ demand, analyst, catalog });
  const matches = findRoleMatches(demand, [analyst], catalog);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].roleMatch, true);
  assert.deepEqual(matches[0].matchedSkills, []);
  assert.deepEqual(matches[0].missingSkills, []);
  assert.equal(matches[0].skillsKnown, false, "A role-only fit does not invent a person's skills.");
  assert.deepEqual({ demand, analyst, catalog }, before);
});

test("Data Lead is not silently promoted to a configured engineering lead; explicit alignment works", () => {
  const lead = person("Blair", ["Data Engineering Lead"]);
  const engineer = person("Casey", ["Data Engineer"]);
  const catalog = [capability("role", "Data Engineering Lead"), capability("role", "Data Engineer")];
  assert.deepEqual(findRoleMatches(role({ name: "Data Lead" }), [lead, engineer], catalog), []);
  const aligned = findRoleMatches(role({ name: "Data Engineering Lead", sourceName: "Data Lead" }), [lead, engineer], catalog);
  assert.deepEqual(aligned.map(match => match.resource.id), [lead.id]);
  assert.equal(aligned[0].roleMatch, true);
});

test("matching keeps role identities separate from skill aliases and reports partial evidence honestly", () => {
  const catalog = [
    capability("role", "Business Analyst"),
    capability("skill", "Requirements discovery", ["Requirements"]),
    capability("skill", "SQL"),
    capability("role", "Requirements"),
  ];
  const full = person("Full fit", ["Business Analyst"], ["Requirements", "SQL"]);
  const partial = person("Partial fit", ["Business Analyst"], ["SQL"]);
  const skillOnly = person("Skill overlap", ["Data Engineer"], ["Requirements", "SQL"]);
  const wrongKind = person("Role is not a skill", ["Business Analyst", "Requirements"], []);
  const demand = role({ skills: ["Requirements discovery", "SQL"] });
  const matches = findRoleMatches(demand, [full, partial, skillOnly, wrongKind], catalog);
  const byId = new Map(matches.map(match => [match.resource.id, match]));
  assert.equal(byId.get(full.id)?.roleMatch, true);
  assert.deepEqual(byId.get(full.id)?.missingSkills, []);
  assert.equal(byId.get(partial.id)?.roleMatch, true);
  assert.deepEqual(byId.get(partial.id)?.matchedSkills, ["SQL"]);
  assert.deepEqual(byId.get(partial.id)?.missingSkills, ["Requirements discovery"]);
  assert.equal(byId.get(skillOnly.id)?.roleMatch, false);
  assert.deepEqual(byId.get(skillOnly.id)?.matchedSkills, demand.skills);
  assert.deepEqual(byId.get(wrongKind.id)?.matchedSkills, []);
  assert.deepEqual(byId.get(wrongKind.id)?.missingSkills, demand.skills);
  assert.equal(byId.get(wrongKind.id)?.skillsKnown, false);
});

test("an ambiguous catalog alias cannot turn the same free-text title into a verified fit", () => {
  const catalog = [capability("role", "Business Analyst", ["BA"]), capability("role", "Benefits Advisor", ["BA"])];
  const unknown = person("Ambiguous profile", ["BA"]);
  const analyst = person("Known analyst", ["Business Analyst"]);
  const demand = role({ name: "BA" });
  assert.deepEqual(findRoleMatches(demand, [unknown, analyst], catalog), []);
  const forecast = forecastFixture(demand, [unknown, analyst], catalog);
  confirmCapacity(forecast.data, unknown);
  confirmCapacity(forecast.data, analyst);
  const result = forecast.run();
  assert.deepEqual(result.roles[0].candidates, []);
  assert.equal(result.roles[0].confirmedSeats, 0);
  assert.equal(result.roles[0].hiringGapSeats, 1);
});

test("What if shares SOW role alignment and still requires every skill plus real capacity", () => {
  const catalog = [capability("role", "Business Analyst"), capability("skill", "Requirements discovery", ["Requirements"]), capability("skill", "SQL")];
  const available = person("Available analyst", ["Business Analyst"], ["Requirements", "SQL"]);
  const unknown = person("Capacity unknown", ["Business Analyst"], ["Requirements discovery", "SQL"]);
  const partial = person("Missing required skill", ["Business Analyst"], ["SQL"]);
  const wrongRole = person("Skills but wrong role", ["Data Engineer"], ["Requirements", "SQL"]);
  const demand = role({ headcount: 3, skills: ["Requirements discovery", "SQL"] });
  const fixture = forecastFixture(demand, [available, unknown, partial, wrongRole], catalog);
  for (const resource of [available, partial, wrongRole]) confirmCapacity(fixture.data, resource);
  const result = fixture.run(), row = result.roles[0];
  assert.deepEqual(new Set(row.candidates.map(candidate => candidate.resourceId)), new Set([available.id, unknown.id]));
  assert.equal(row.confirmedSeats, 1);
  assert.equal(row.unknownSeats, 1);
  assert.equal(row.hiringGapSeats, 1);
  assert.equal(row.candidates.find(candidate => candidate.resourceId === unknown.id)?.status, "unknown");
  const studioFullFits = findRoleMatches(demand, fixture.data.resources, catalog).filter(match => match.roleMatch && !match.missingSkills.length);
  assert.deepEqual(new Set(studioFullFits.map(match => match.resource.id)), new Set(row.candidates.map(candidate => candidate.resourceId)));
  fixture.data.forecast!.commitments.push({ id: randomUUID(), resourceId: available.id, missionId: null, name: "Another engagement", start: demand.start, end: demand.end, allocationPercent: 100 });
  const committed = fixture.run().roles[0];
  assert.equal(committed.confirmedSeats, 0);
  assert.equal(committed.unknownSeats, 1);
  assert.equal(committed.hiringGapSeats, 2);
  assert.equal(committed.candidates.find(candidate => candidate.resourceId === available.id)?.status, "busy");
});

test("unspecified SOW skills leave a role-only forecast; they are not inferred from catalog or teammates", () => {
  const analyst = person("Analyst with unrecorded skills", ["Business Analyst"]);
  const demand = role({ skills: [] });
  const fixture = forecastFixture(demand, [analyst], [capability("role", "Business Analyst"), capability("skill", "SQL")]);
  confirmCapacity(fixture.data, analyst);
  const result = fixture.run();
  assert.equal(result.roles[0].confirmedSeats, 1);
  assert.deepEqual(result.roles[0].skills, []);
  assert.deepEqual(analyst.profile!.skills, []);
  assert.ok(result.warnings.some(warning => /no skills recorded/i.test(warning)));
});

test("original SOW title and quotations survive canonical role selection, JSON reload and Excel updates", () => {
  const demand = role({ name: "Business Analyst", sourceName: "Business Analyst (BA)" });
  const engagement = plan(demand);
  engagement.intake = { sourceName: "Data platform brief.txt", sourceKind: "text", evidence: [{ field: "roles.0.name", quote: "One Business Analyst (BA) will support delivery.", verified: true }], uncertainties: [] };
  assert.equal(engagementPlanSchema.parse(engagement).roles[0].sourceName, "Business Analyst (BA)");
  let store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", name: "Client", code: "CLIENT", contactName: "", contactEmail: "", notes: "" });
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Data platform", clientId: store.data.clients[0].id, engagement });
  const reloaded = parseLocalAdminStore(JSON.stringify(store));
  assert.equal(reloaded.data.missions[0].engagement!.roles[0].sourceName, demand.sourceName);
  const workbook = workspaceSpreadsheetData(reloaded);
  const sheet = workbook.sheets.find(item => item.name === "Engagement roles")!;
  sheet.rows[4][sheet.rows[3].indexOf("Responsibilities")] = "Facilitate requirements workshops.";
  const preview = planSpreadsheetImport(reloaded, workbook);
  assert.deepEqual(preview.errors, []);
  const edited = applySpreadsheetImport(reloaded, preview).data.missions[0].engagement!;
  assert.equal(edited.roles[0].name, "Business Analyst");
  assert.equal(edited.roles[0].sourceName, "Business Analyst (BA)");
  assert.equal(edited.roles[0].responsibilities, "Facilitate requirements workshops.");
  assert.deepEqual(edited.intake, engagement.intake);
});
