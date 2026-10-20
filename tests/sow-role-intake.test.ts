import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdminCapability } from "../lib/admin/contracts";
import type { SowDraft } from "../lib/ai/contracts";
import { alignSowRoles } from "../lib/studio/intake";

type DraftRole = SowDraft["roles"][number];
const capability = (id: string, name: string, patch: Partial<AdminCapability> = {}): AdminCapability => ({
  id, name, kind: "role", description: "", active: true, revision: 1, ...patch,
});
const role = (patch: Partial<DraftRole> = {}): DraftRole => ({
  name: "Business Analyst (BA)", headcount: 2, allocationPercent: 75,
  skills: [], responsibilities: "Run boards, ceremonies, requirements, and light testing.",
  start: "2027-02-15", end: "2027-10-31", ...patch,
});

test("SOW intake aligns an evidenced BA title to the configured role and retains the original title", () => {
  const [aligned] = alignSowRoles([role()], [capability("ba", "Business Analyst")]);
  assert.equal(aligned.name, "Business Analyst");
  assert.equal(aligned.sourceName, "Business Analyst (BA)");
  assert.match(aligned.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.deepEqual(aligned.selectedResourceIds, []);
});

test("ambiguous or merely similar SOW role names remain unchanged for manual alignment", () => {
  const catalog = [
    capability("lead", "Data Engineering Lead"),
    capability("engineer", "Data Engineer"),
    capability("architect", "Architect", { aliases: ["Technical Lead"] }),
    capability("tech", "Technical Lead"),
  ];
  const [dataLead, technicalLead] = alignSowRoles([role({ name: "Data Lead" }), role({ name: "Technical Lead" })], catalog);
  assert.equal(dataLead.name, "Data Lead");
  assert.equal(dataLead.sourceName, "Data Lead");
  assert.equal(technicalLead.name, "Technical Lead");
  assert.equal(technicalLead.sourceName, "Technical Lead");
});

test("SOW intake canonicalizes only recorded skill names and aliases and never infers expertise from the role", () => {
  const catalog = [
    capability("engineer", "Data Engineer", { description: "Build pipelines using SQL, Python, and Snowflake." }),
    capability("dbt", "dbt", { kind: "skill", aliases: ["data build tool"] }),
    capability("python", "Python", { kind: "skill" }),
    capability("sql", "SQL", { kind: "skill" }),
  ];
  const [empty, evidenced] = alignSowRoles([
    role({ name: "Data Engineer", skills: [] }),
    role({ name: "Data Engineer", skills: ["data build tool", "DBT", "Custom source platform"] }),
  ], catalog);
  assert.deepEqual(empty.skills, []);
  assert.deepEqual(evidenced.skills, ["dbt", "Custom source platform"]);
  assert.equal(evidenced.skills.includes("SQL"), false);
  assert.equal(evidenced.skills.includes("Python"), false);
});

test("SOW intake uses active catalog mappings only and preserves unsupported retired wording", () => {
  const catalog = [
    capability("archived-role", "Data Platform Engineer", { active: false, aliases: ["Engineering Specialist"] }),
    capability("archived-skill", "Legacy SQL Platform", { kind: "skill", active: false, aliases: ["Legacy Warehouse"] }),
    capability("active-role", "Business Analyst", { aliases: ["BA"] }),
    capability("active-skill", "Python", { kind: "skill", aliases: ["CPython"] }),
  ];
  const [retired, current] = alignSowRoles([
    role({ name: "Engineering Specialist", skills: ["Legacy Warehouse"] }),
    role({ name: "BA", skills: ["CPython"] }),
  ], catalog);
  assert.equal(retired.name, "Engineering Specialist");
  assert.deepEqual(retired.skills, ["Legacy Warehouse"]);
  assert.equal(current.name, "Business Analyst");
  assert.equal(current.sourceName, "BA");
  assert.deepEqual(current.skills, ["Python"]);
});

test("role alignment preserves all evidenced demand and date fields without changing their commercial meaning", () => {
  const original = role({
    headcount: 6, allocationPercent: 35,
    start: "2027-03-17", end: "2028-09-30",
    skills: ["Requirements"], responsibilities: "Own requirements during the launch phase only.",
  });
  const [aligned] = alignSowRoles([original], [capability("ba", "Business Analyst")]);
  for (const field of ["headcount", "allocationPercent", "start", "end", "skills", "responsibilities"] as const) {
    assert.deepEqual(aligned[field], original[field]);
  }
});

test("missing SOW facts remain visibly incomplete rather than becoming assumed staffing or dates", () => {
  const [aligned] = alignSowRoles([role({
    name: null, headcount: null, allocationPercent: null, responsibilities: null, start: null, end: null,
  })], [capability("ba", "Business Analyst")]);
  assert.equal(aligned.name, "");
  assert.equal("sourceName" in aligned, false);
  assert.equal(aligned.headcount, 0);
  assert.equal(aligned.allocationPercent, 0);
  assert.equal(aligned.responsibilities, "");
  assert.equal(aligned.start, "");
  assert.equal(aligned.end, "");
  assert.deepEqual(aligned.selectedResourceIds, []);
});

test("SOW intake keeps roles and skills separate even when the other catalog has an identical name or alias", () => {
  const [aligned] = alignSowRoles([role({ name: "Warehouse Builder", skills: ["Business Analysis"] })], [
    capability("skill", "SQL", { kind: "skill", aliases: ["Warehouse Builder"] }),
    capability("role", "Business Analyst", { aliases: ["Business Analysis"] }),
  ]);
  assert.equal(aligned.name, "Warehouse Builder");
  assert.deepEqual(aligned.skills, ["Business Analysis"]);
});

test("intake alignment does not mutate source evidence or catalog data and gives each role a fresh identity", () => {
  const input = [role(), role({ name: "Data Lead" })];
  const catalog = [capability("ba", "Business Analyst")];
  const snapshot = structuredClone({ input, catalog });
  const first = alignSowRoles(input, catalog), second = alignSowRoles(input, catalog);
  assert.deepEqual({ input, catalog }, snapshot);
  assert.equal(new Set([...first, ...second].map(item => item.id)).size, 4);
  first[0].skills.push("Changed copy");
  assert.deepEqual(input[0].skills, []);
});
