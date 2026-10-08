import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { engagementPlanSchema, type EngagementPlan, type EngagementRole } from "../lib/admin/engagement";
import { applyLocalAdminCommand, createLocalAdminStore, LOCAL_ADMIN_OWNER_ID, parseLocalAdminStore } from "../lib/admin/local";
import { applySpreadsheetImport, planSpreadsheetImport, type SpreadsheetWorkbook } from "../lib/admin/spreadsheet";
import { plannedTeamReferenceIssues, summarizePlannedTeam } from "../lib/studio/team";

const role = (patch: Partial<EngagementRole> = {}): EngagementRole => ({ id: randomUUID(), name: "Data engineer", headcount: 2, allocationPercent: 100, skills: ["SQL", "Python"], responsibilities: "Reliable data delivery", start: "2027-01-01", end: "2027-06-30", ...patch });
const direct = (patch: Partial<EngagementPlan> = {}): EngagementPlan => ({ version: 1, source: "direct", sowReference: "", signedOn: null, status: "draft", start: "2027-01-01", end: "2027-06-30", outcomes: "Launch the platform", roles: [role()], ...patch });
function fixture() {
  let store = createLocalAdminStore();
  store = applyLocalAdminCommand(store, { type: "save_client", name: "Client", code: "CLIENT", contactName: "", contactEmail: "", notes: "" });
  store = applyLocalAdminCommand(store, { type: "save_home", name: "Engineering", code: "ENG", description: "" });
  for (const name of ["Alex", "Blair"]) store = applyLocalAdminCommand(store, { type: "save_resource", name, home: "ENG", ownerId: LOCAL_ADMIN_OWNER_ID, profile: { roles: ["Data engineer"], skills: name === "Alex" ? ["SQL", "Python"] : ["SQL"] } });
  const engagement = direct({ roles: [role({ selectedResourceIds: [store.data.resources[0].id] })] });
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Platform", clientId: store.data.clients[0].id, engagement });
  return store;
}

test("direct plans need no SOW and legacy signed SOW requirements remain enforced", () => {
  assert.equal(engagementPlanSchema.safeParse(direct()).success, true);
  assert.equal(engagementPlanSchema.safeParse(direct({ status: "complete" })).success, true);
  assert.equal(engagementPlanSchema.safeParse(direct({ status: "signed" })).success, false);
  for (const source of [undefined, "sow"] as const) {
    assert.equal(engagementPlanSchema.safeParse(direct({ source, status: "signed" })).success, false);
    assert.equal(engagementPlanSchema.safeParse(direct({ source, status: "complete" })).success, false);
    assert.equal(engagementPlanSchema.safeParse(direct({ source, status: "signed", sowReference: "SOW-1", signedOn: "2026-12-01" })).success, true);
  }
});

test("team selections are bounded UUIDs, unique per role and cannot silently overfill headcount", () => {
  const id = randomUUID();
  for (const selected of [[id, id], [id, id.toUpperCase()], ["Alex"]]) assert.equal(engagementPlanSchema.safeParse(direct({ roles: [role({ selectedResourceIds: selected })] })).success, false);
  assert.equal(engagementPlanSchema.safeParse(direct({ roles: [role({ headcount: 1, selectedResourceIds: [id, randomUUID()] })] })).success, false);
  assert.equal(engagementPlanSchema.safeParse(direct({ roles: [role({ headcount: 1000, selectedResourceIds: Array.from({ length: 1001 }, () => randomUUID()) })] })).success, false);
  assert.equal(engagementPlanSchema.safeParse(direct({ roles: [role({ selectedResourceIds: [id] }), role({ selectedResourceIds: [id] })] })).success, true, "The same person can hold separate phased roles.");
});

test("local team plans retain names across reload, legacy edits and archived teammate history", () => {
  let store = fixture();
  const mission = store.data.missions[0], person = store.data.resources[0];
  const before = structuredClone(mission.engagement!);
  store = applyLocalAdminCommand(store, { type: "save_mission", id: mission.id, expectedRevision: 1, name: "Platform refreshed", clientId: mission.clientId });
  assert.deepEqual(store.data.missions[0].engagement, before);
  store = applyLocalAdminCommand(store, { type: "set_resource_active", id: person.id, expectedRevision: person.revision, active: false });
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(store)), store);
  store = applyLocalAdminCommand(store, { type: "save_mission", id: mission.id, expectedRevision: 2, name: "Platform refreshed", clientId: mission.clientId, engagement: { ...before, outcomes: "Revised delivery outcome" } });
  const updated = store.data.missions[0];
  assert.deepEqual(updated.engagement!.roles[0].selectedResourceIds, [person.id]);
  assert.throws(() => applyLocalAdminCommand(store, { type: "save_mission", name: "New plan", clientId: mission.clientId, engagement: before }), /active teammate/);
  assert.throws(() => applyLocalAdminCommand(store, { type: "save_mission", id: mission.id, expectedRevision: updated.revision, name: updated.name, clientId: mission.clientId, engagement: { ...before, roles: [role({ selectedResourceIds: [person.id] })] } }), /active teammate/, "Moving an archived person to another role is a new selection.");
  const broken = structuredClone(store);
  broken.data.missions[0].engagement!.roles[0].selectedResourceIds = [randomUUID()];
  assert.throws(() => parseLocalAdminStore(broken), /existing person/);
  assert.throws(() => applyLocalAdminCommand(store, { type: "save_mission", name: "Missing teammate", clientId: mission.clientId, engagement: broken.data.missions[0].engagement }), /existing person/);
});

test("coverage reports skill evidence and overlapping role review without claiming assignment or capacity", () => {
  const store = fixture(), [alex, blair] = store.data.resources;
  const first = role({ selectedResourceIds: [alex.id, blair.id] });
  const second = role({ name: "Technical lead", headcount: 1, skills: [], selectedResourceIds: [alex.id] });
  const engagement = direct({ roles: [first, second, role({ headcount: 1 })] });
  const coverage = summarizePlannedTeam(engagement, store.data.resources);
  assert.equal(coverage.totalSeats, 4); assert.equal(coverage.namedSeats, 3); assert.equal(coverage.openSeats, 1); assert.equal(coverage.uniquePeople, 2);
  assert.deepEqual(coverage.roles[0].selections[0].matchedSkills, ["SQL", "Python"]);
  assert.deepEqual(coverage.roles[0].selections[1].missingSkills, ["Python"]);
  assert.deepEqual(coverage.warnings.map(warning => warning.code), ["overlapping_roles"]);
  assert.equal("availableHours" in coverage, false); assert.equal("assignments" in coverage, false);
  engagement.roles[0].end = "2027-03-31"; engagement.roles[1].start = "2027-04-01";
  assert.deepEqual(summarizePlannedTeam(engagement, store.data.resources).warnings, []);
  alex.active = false;
  assert.deepEqual(plannedTeamReferenceIssues(engagement, store.data.resources, engagement), []);
  assert.equal(summarizePlannedTeam(engagement, store.data.resources).warnings.filter(warning => warning.code === "inactive_resource").length, 2);
});

test("spreadsheet edits preserve direct source and named team, and reducing occupied headcount blocks the batch", () => {
  const store = fixture(), before = store.data.missions[0].engagement!;
  const workbook: SpreadsheetWorkbook = { sheets: [
    { name: "Engagements", rows: [[], [], [], ["Engagement name", "Client code", "Start date", "End date", "Outcomes"], ["Platform", "CLIENT", "2027-01-01", "2027-06-30", "Updated outcome"]] },
    { name: "Engagement roles", rows: [[], [], [], ["Engagement name", "Client code", "Role name", "Headcount", "Allocation %"], ["Platform", "CLIENT", "Data engineer", 2, 75]] },
  ] };
  const preview = planSpreadsheetImport(store, workbook);
  assert.deepEqual(preview.errors, []);
  const imported = applySpreadsheetImport(store, preview), plan = imported.data.missions[0].engagement!;
  assert.equal(plan.source, "direct"); assert.equal(plan.roles[0].id, before.roles[0].id);
  assert.deepEqual(plan.roles[0].selectedResourceIds, before.roles[0].selectedResourceIds);
  assert.equal(plan.roles[0].allocationPercent, 75);
  const fullyNamed = applyLocalAdminCommand(imported, { type: "save_mission", id: imported.data.missions[0].id, expectedRevision: imported.data.missions[0].revision, name: "Platform", clientId: imported.data.clients[0].id, engagement: { ...plan, roles: [{ ...plan.roles[0], selectedResourceIds: imported.data.resources.map(resource => resource.id) }] } });
  workbook.sheets[1].rows[4][3] = 1;
  const bad = planSpreadsheetImport(fullyNamed, workbook);
  assert.ok(bad.errors.some(error => error.message.includes("headcount")));
  assert.throws(() => applySpreadsheetImport(fullyNamed, bad));
  assert.equal(fullyNamed.data.missions[0].engagement!.roles[0].selectedResourceIds!.length, 2);
});

test("SOW source notes survive saved edits, JSON reload, and Excel updates without changing the original extraction", () => {
  let store = fixture();
  const mission = store.data.missions[0];
  const intake: NonNullable<EngagementPlan["intake"]> = {
    sourceName: "Client workstream brief.txt", sourceKind: "text",
    evidence: [{ field: "roles.0.headcount", quote: "Two data engineers will deliver the platform.", verified: true }, { field: "start", quote: "Target launch window begins in January.", verified: false }],
    uncertainties: ["Confirm the specific starting day."],
  };
  store = applyLocalAdminCommand(store, { type: "save_mission", id: mission.id, expectedRevision: mission.revision, name: mission.name, clientId: mission.clientId, engagement: { ...mission.engagement!, source: "sow", sowReference: "SOW-REVIEW", intake } });
  intake.evidence[0].quote = "Caller-side mutation must not change saved evidence.";
  const savedNotes = structuredClone(store.data.missions[0].engagement!.intake!);
  assert.equal(savedNotes.evidence[0].quote, "Two data engineers will deliver the platform.");
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(store)).data.missions[0].engagement!.intake, savedNotes);
  const workbook: SpreadsheetWorkbook = { sheets: [{ name: "Engagements", rows: [[], [], [], ["Engagement name", "Client code", "Start date", "End date", "Outcomes"], ["Platform", "CLIENT", "2027-01-01", "2027-06-30", "Launch the revised platform"]] }] };
  const preview = planSpreadsheetImport(store, workbook);
  assert.deepEqual(preview.errors, []);
  const edited = applySpreadsheetImport(store, preview);
  assert.equal(edited.data.missions[0].engagement!.outcomes, "Launch the revised platform");
  assert.equal(edited.data.missions[0].engagement!.source, "sow");
  assert.deepEqual(edited.data.missions[0].engagement!.intake, savedNotes);
  assert.deepEqual(store.data.missions[0].engagement!.intake, savedNotes);
});

test("stored source notes have bounded metadata and do not accept original uploads or executable extra fields", () => {
  const intake: NonNullable<EngagementPlan["intake"]> = { sourceName: "brief.pdf", sourceKind: "pdf", evidence: [{ field: "name", quote: "Platform delivery", verified: false }], uncertainties: ["Check the PDF source."] };
  assert.equal(engagementPlanSchema.safeParse(direct({ source: "sow", intake })).success, true);
  for (const candidate of [
    { ...intake, sourceName: "x".repeat(256) },
    { ...intake, evidence: Array.from({ length: 221 }, () => intake.evidence[0]) },
    { ...intake, evidence: [{ ...intake.evidence[0], quote: "x".repeat(601) }] },
    { ...intake, uncertainties: Array.from({ length: 41 }, () => "Needs review") },
    { ...intake, uncertainties: ["x".repeat(501)] },
    { ...intake, originalUpload: "data:application/pdf;base64,unrequested" },
    { ...intake, evidence: [{ ...intake.evidence[0], verified: "yes" }] },
  ]) assert.equal(engagementPlanSchema.safeParse({ ...direct({ source: "sow" }), intake: candidate }).success, false);
});
