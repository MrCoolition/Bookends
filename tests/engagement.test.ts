import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { engagementDuration, engagementPlanSchema, findRoleMatches, isEngagementDate, profileSchema, summarizeEngagement, type EngagementPlan, type EngagementRole } from "../lib/admin/engagement";
import { applyLocalAdminCommand, createLocalAdminStore, LOCAL_ADMIN_OWNER_ID, parseLocalAdminStore } from "../lib/admin/local";
import type { AdminResource } from "../lib/admin/contracts";

const role = (patch: Partial<EngagementRole> = {}): EngagementRole => ({ id: randomUUID(), name: "Data engineer", headcount: 2, allocationPercent: 100, skills: ["SQL", "Python"], responsibilities: "Build ingestion and reliable data models.", start: "2027-01-01", end: "2027-06-30", ...patch });
const plan = (patch: Partial<EngagementPlan> = {}): EngagementPlan => ({ version: 1, sowReference: "SOW-2027-001", status: "signed", signedOn: "2026-12-12", start: "2027-01-01", end: "2027-06-30", outcomes: "Launch the client's application.", roles: [role(), role({ name: "Full stack developer", headcount: 3, skills: ["React", "TypeScript"] }), role({ name: "BA / PM", headcount: 1, allocationPercent: 50, skills: ["Requirements", "Agile facilitation"], responsibilities: "Own boards, ceremonies, requirements and light testing." })], ...patch });
function localFixture() {
  let store = createLocalAdminStore();
  store = applyLocalAdminCommand(store, { type: "save_client", name: "Client", code: "CLIENT", contactName: "", contactEmail: "", notes: "" });
  store = applyLocalAdminCommand(store, { type: "save_home", name: "Engineering", code: "ENG", description: "" });
  return store;
}

test("an SOW describes multi-role demand across months with headcount separate from FTE", () => {
  const parsed = engagementPlanSchema.parse(plan());
  assert.deepEqual(summarizeEngagement(parsed), { roleCount: 3, totalSeats: 6, peakHeadcount: 6, peakFte: 5.5, days: 181, months: 6 });
  const long = plan({ start: "2027-01-01", end: "2030-12-31", roles: [role({ start: "2027-01-01", end: "2030-12-31" })] });
  assert.equal(engagementPlanSchema.safeParse(long).success, true);
  assert.deepEqual(engagementDuration(long.start, long.end), { days: 1461, months: 48 });
  assert.equal(engagementPlanSchema.safeParse(plan({ end: "2037-01-01" })).success, false);
});

test("phase boundaries count inclusive dates and do not double-count sequential role demand", () => {
  const phased = plan({ roles: [role({ headcount: 3, allocationPercent: 50, end: "2027-03-31" }), role({ headcount: 2, start: "2027-04-01" })] });
  assert.equal(summarizeEngagement(phased).totalSeats, 5);
  assert.equal(summarizeEngagement(phased).peakHeadcount, 3);
  assert.equal(summarizeEngagement(phased).peakFte, 2);
  phased.roles[1].start = "2027-03-31";
  assert.equal(summarizeEngagement(phased).peakHeadcount, 5);
  assert.equal(summarizeEngagement(phased).peakFte, 3.5);
  assert.deepEqual(engagementDuration("2028-02-29", "2028-02-29"), { days: 1, months: 0.1 });
  assert.deepEqual(engagementDuration("2026-10-07", "2027-04-06"), { days: 182, months: 6 });
  assert.deepEqual(engagementDuration("2027-01-31", "2027-02-27"), { days: 28, months: 1 });
  assert.deepEqual(engagementDuration("2028-01-31", "2028-02-28"), { days: 29, months: 1 });
  assert.deepEqual(engagementDuration("2027-01-31", "2027-02-01"), { days: 2, months: 0.1 });
});

test("plan validation rejects invalid calendars, outside phases, duplicated roles and unrecorded signing", () => {
  assert.equal(isEngagementDate("2027-02-29"), false);
  assert.equal(isEngagementDate("2028-02-29"), true);
  assert.equal(isEngagementDate("2027-01-01T00:00:00Z"), false);
  for (const invalid of [plan({ sowReference: "" }), plan({ signedOn: null }), plan({ roles: [] }), plan({ end: "2026-12-31" }), plan({ start: "2027-02-30" }), plan({ roles: [role({ start: "2026-12-31" })] }), plan({ roles: [role({ end: "2027-07-01" })] }), plan({ roles: [role({ headcount: 1.5 })] }), plan({ roles: [role({ allocationPercent: 101 })] }), plan({ roles: [role({ skills: ["SQL", "sql"] })] })]) assert.equal(engagementPlanSchema.safeParse(invalid).success, false);
  const duplicate = role();
  assert.equal(engagementPlanSchema.safeParse(plan({ roles: [duplicate, duplicate] })).success, false);
  assert.equal(engagementPlanSchema.safeParse(plan({ status: "draft", sowReference: "", signedOn: null })).success, true);
  assert.equal(engagementPlanSchema.safeParse(plan({ status: "complete", signedOn: null })).success, false);
});

test("local legacy backups remain valid and omitted engagement/profile fields preserve recorded detail", () => {
  let store = localFixture();
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Application build", clientId: store.data.clients[0].id });
  store = applyLocalAdminCommand(store, { type: "save_resource", name: "Sam", home: "ENG", ownerId: LOCAL_ADMIN_OWNER_ID });
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(store)), store);
  const legacy = structuredClone(store), mission = store.data.missions[0], person = store.data.resources[0], engagement = plan(), profile = { roles: ["Data engineer"], skills: ["SQL", "Python"] };
  store = applyLocalAdminCommand(store, { type: "save_mission", id: mission.id, expectedRevision: 1, name: mission.name, clientId: mission.clientId, engagement });
  store = applyLocalAdminCommand(store, { type: "save_resource", id: person.id, expectedRevision: 1, name: person.name, home: person.home, ownerId: person.ownerId, profile });
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(store)), store);
  store = applyLocalAdminCommand(store, { type: "save_mission", id: mission.id, expectedRevision: 2, name: "Renamed build", clientId: mission.clientId });
  store = applyLocalAdminCommand(store, { type: "save_resource", id: person.id, expectedRevision: 2, name: "Sam Newname", home: person.home, ownerId: person.ownerId });
  assert.deepEqual(store.data.missions[0].engagement, engagement);
  assert.deepEqual(store.data.resources[0].profile, profile);
  assert.equal(store.data.missions[0].revision, 3);
  assert.equal(store.data.resources[0].revision, 3);
  assert.equal(legacy.data.missions[0].engagement, undefined);
  assert.equal(legacy.data.resources[0].profile, undefined);
  assert.throws(() => applyLocalAdminCommand(store, { type: "save_mission", id: mission.id, expectedRevision: 2, name: "Stale", clientId: mission.clientId, engagement }), /record changed/);
  const broken = structuredClone(store); broken.data.missions[0].engagement!.roles[0].end = "2029-01-01";
  assert.throws(() => parseLocalAdminStore(broken));
});

test("role matches use recorded business skills and roles without inventing availability or permission", () => {
  const person = (name: string, profile?: AdminResource["profile"], active = true): AdminResource => ({ id: randomUUID(), name, home: "ENG", ownerId: LOCAL_ADMIN_OWNER_ID, active, revision: 1, profile });
  const people = [person("Partial", { roles: ["Data engineer"], skills: ["SQL"] }), person("Full", { roles: ["data ENGINEER"], skills: ["sql", "Python"] }), person("Skill-aligned", { roles: ["Analyst"], skills: ["SQL", "Python"] }), person("Role only", { roles: ["Data engineer"], skills: [] }), person("Unprofiled"), person("Other", { roles: ["Administrator"], skills: ["HR"] }), person("Archived", { roles: ["Data engineer"], skills: ["SQL", "Python"] }, false)];
  const matches = findRoleMatches(role(), people);
  assert.deepEqual(matches.map(item => item.resource.name), ["Full", "Skill-aligned", "Partial", "Role only"]);
  assert.equal(matches[0].roleMatch, true); assert.deepEqual(matches[0].missingSkills, []);
  assert.equal(matches[1].roleMatch, false); assert.deepEqual(matches[1].matchedSkills, ["SQL", "Python"]);
  assert.equal(matches[3].skillsKnown, false); assert.deepEqual(matches[3].missingSkills, ["SQL", "Python"]);
  assert.equal(profileSchema.safeParse({ roles: ["BA", " ba "], skills: [] }).success, false);
  assert.equal(profileSchema.safeParse({ roles: [], skills: [], grants: ["administrator"] }).success, false);
});

test("person designations are optional, explicit and independent of delivery roles and skills", () => {
  const legacy = { roles: ["Data Engineer"], skills: ["SQL"] };
  assert.deepEqual(profileSchema.parse(legacy), legacy);
  for (const affiliation of ["impower", "contractor"] as const) assert.deepEqual(profileSchema.parse({ ...legacy, affiliation }), { ...legacy, affiliation });
  for (const affiliation of ["W2", "1099", "manager", "", null]) assert.equal(profileSchema.safeParse({ ...legacy, affiliation }).success, false);
  let store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_resource", name: "Taylor Example", home: "", ownerId: "", profile: { ...legacy, affiliation: "contractor" } });
  const person = store.data.resources[0];
  store = applyLocalAdminCommand(store, { type: "save_resource", id: person.id, expectedRevision: person.revision, name: "Taylor Updated", home: "", ownerId: "" });
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(store)).data.resources[0].profile, { ...legacy, affiliation: "contractor" });
});

test("configurable roles and skills retain rename history, reject ambiguous names and import legacy backups", () => {
  const legacy = localFixture(); delete legacy.data.capabilities;
  assert.deepEqual(parseLocalAdminStore(legacy).data.capabilities, []);
  let store = applyLocalAdminCommand(legacy, { type: "save_capability", kind: "role", name: "Business analyst", description: "Requirements and delivery" });
  store = applyLocalAdminCommand(store, { type: "save_capability", kind: "skill", name: "SQL", description: "Relational querying" });
  const capability = store.data.capabilities![0];
  const edit = { type: "save_capability" as const, kind: "role" as const, id: capability.id, expectedRevision: 1, name: "BA / PM", description: capability.description };
  store = applyLocalAdminCommand(store, edit);
  assert.deepEqual(store.data.capabilities![0].aliases, ["Business analyst"]);
  assert.throws(() => applyLocalAdminCommand(store, edit), /record changed/);
  assert.throws(() => applyLocalAdminCommand(store, { type: "save_capability", kind: "role", name: " business ANALYST ", description: "Duplicate old name" }), /already used/);
  assert.throws(() => applyLocalAdminCommand(store, { ...edit, expectedRevision: 2, kind: "skill" }), /different capability kind/);
  store = applyLocalAdminCommand(store, { type: "set_capability_active", id: capability.id, expectedRevision: 2, active: false });
  assert.throws(() => applyLocalAdminCommand(store, { type: "save_capability", kind: "role", name: "BA / PM", description: "Duplicate archived name" }), /already used/);
  store = applyLocalAdminCommand(store, { ...edit, expectedRevision: 3, name: "Business analyst" });
  assert.deepEqual(store.data.capabilities![0].aliases, ["BA / PM"]);
  assert.equal(store.data.capabilities![0].active, false);
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(store)), store);
  const bad = structuredClone(store); bad.data.capabilities![1].aliases = ["sql"];
  assert.throws(() => parseLocalAdminStore(bad));
});

test("role and skill catalog aliases keep earlier profiles aligned after rename and retirement", () => {
  const person: AdminResource = { id: randomUUID(), name: "Alex", home: "Data", ownerId: LOCAL_ADMIN_OWNER_ID, active: true, revision: 1, profile: { roles: ["Data engineer"], skills: ["SQL"] } };
  const demand = role({ name: "Analytics engineer", skills: ["Database querying", "Python"] });
  const capabilities = [{ id: randomUUID(), kind: "role" as const, name: "Analytics engineer", aliases: ["Data engineer"], description: "", active: false, revision: 3 }, { id: randomUUID(), kind: "skill" as const, name: "Database querying", aliases: ["SQL"], description: "", active: true, revision: 2 }];
  assert.deepEqual(findRoleMatches(demand, [person]), []);
  const match = findRoleMatches(demand, [person], capabilities)[0];
  assert.equal(match.roleMatch, true); assert.deepEqual(match.matchedSkills, ["Database querying"]); assert.deepEqual(match.missingSkills, ["Python"]);
  assert.deepEqual(person.profile, { roles: ["Data engineer"], skills: ["SQL"] }, "Historical profile strings remain unchanged.");
});
