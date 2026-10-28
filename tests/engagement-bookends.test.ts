import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AdminClient } from "../lib/admin/contracts";
import type { EngagementPlan, EngagementRole } from "../lib/admin/engagement";
import { applyRoleBookendDate, assessEngagementBookends, needsTimingChange } from "../lib/scheduling/engagement-bookends";
import type { ClientBookend } from "../lib/scheduling/client-bookends";

const bookend = (patch: Partial<ClientBookend> = {}): ClientBookend => ({ id: randomUUID(), name: "Client intake", purpose: "onboarding", phase: "start", enforcement: "required", cadence: "weeks", every: 2, anchorDate: "2027-01-04", windowDays: 1, noticeDays: 0, until: null, active: true, notes: "", ...patch });
const role = (patch: Partial<EngagementRole> = {}): EngagementRole => ({ id: randomUUID(), name: "Data Engineer", headcount: 2, allocationPercent: 100, skills: ["SQL"], responsibilities: "Build the platform", start: "2027-01-05", end: "2027-03-31", selectedResourceIds: [randomUUID()], ...patch });
const plan = (patch: Partial<EngagementPlan> = {}): EngagementPlan => ({ version: 1, source: "sow", sowReference: "", status: "draft", signedOn: null, start: "2027-01-01", end: "2027-06-30", outcomes: "Delivery", roles: [role(), role({ name: "Business Analyst", start: "2027-02-02", end: "2027-06-30" })], ...patch });
const client = (bookends: ClientBookend[] = [bookend()]): AdminClient => ({ id: randomUUID(), name: "Example client", code: "EXAMPLE", contactName: "", contactEmail: "", notes: "", active: true, revision: 1, bookends });

test("engagement timing evaluates phased roles and entry/exit windows independently", () => {
  const draft = plan(), before = structuredClone(draft);
  const assessment = assessEngagementBookends(client([bookend(), bookend({ phase: "end", purpose: "offboarding", anchorDate: "2027-03-31", cadence: "months", every: 1 })]), draft, "2026-12-01");
  assert.equal(assessment.length, 2);
  assert.equal(assessment[0].start.eligibleDate, "2027-01-18"); assert.equal(assessment[1].start.eligibleDate, "2027-02-15");
  assert.equal(assessment[0].end.status, "clear"); assert.equal(assessment[1].end.status, "clear");
  assert.equal(needsTimingChange(assessment[0].start), true); assert.equal(needsTimingChange(assessment[0].end), false);
  assert.deepEqual(draft, before);
});

test("an explicit start edit preserves duration and the rest of a phased team", () => {
  const draft = plan(), before = structuredClone(draft);
  const moved = applyRoleBookendDate(draft, draft.roles[0].id, "start", "2027-01-18");
  assert.equal(moved.roles[0].start, "2027-01-18"); assert.equal(moved.roles[0].end, "2027-04-13");
  assert.deepEqual(moved.roles[0].selectedResourceIds, draft.roles[0].selectedResourceIds);
  assert.deepEqual(moved.roles[1], draft.roles[1]); assert.equal(moved.start, "2027-01-01"); assert.equal(moved.end, "2027-06-30");
  assert.deepEqual(draft, before);
});

test("a later exit extends only the selected role and the engagement envelope", () => {
  const draft = plan(), before = structuredClone(draft);
  const moved = applyRoleBookendDate(draft, draft.roles[1].id, "end", "2027-07-07");
  assert.equal(moved.roles[1].start, "2027-02-02"); assert.equal(moved.roles[1].end, "2027-07-07"); assert.equal(moved.end, "2027-07-07");
  assert.deepEqual(moved.roles[0], draft.roles[0]); assert.deepEqual(draft, before);
});

test("timing changes reject signed or completed work and never mutate it", () => {
  for (const status of ["signed", "complete"] as const) {
    const saved = plan({ status, sowReference: "SOW-1", signedOn: "2026-12-01" }), before = structuredClone(saved);
    assert.throws(() => applyRoleBookendDate(saved, saved.roles[0].id, "start", "2027-01-18"), /engagement owner/);
    assert.deepEqual(saved, before);
  }
});

test("invalid, earlier and unrecognized date edits are rejected", () => {
  const draft = plan(), before = structuredClone(draft);
  assert.throws(() => applyRoleBookendDate(draft, draft.roles[0].id, "start", "2027-01-01"), /on or after/);
  assert.throws(() => applyRoleBookendDate(draft, draft.roles[0].id, "end", "2027-02-30"), /valid/);
  assert.throws(() => applyRoleBookendDate(draft, "missing", "start", "2027-01-18"), /no longer/);
  assert.throws(() => applyRoleBookendDate(draft, draft.roles[0].id, "end", "2037-01-01"), /ten-year/);
  assert.deepEqual(draft, before);
});

test("a draft without roles previews and moves its engagement dates", () => {
  const draft = plan({ start: "2027-01-05", end: "2027-03-31", roles: [] });
  const assessment = assessEngagementBookends(client(), draft, "2026-12-01");
  assert.equal(assessment[0].roleId, "engagement"); assert.equal(assessment[0].start.eligibleDate, "2027-01-18");
  const moved = applyRoleBookendDate(draft, "engagement", "start", "2027-01-18");
  assert.equal(moved.start, "2027-01-18"); assert.equal(moved.end, "2027-04-13"); assert.equal(moved.roles.length, 0);
  assert.throws(() => applyRoleBookendDate(draft, "engagement", "end", "2037-01-18"), /ten-year/);
});

test("date shifts near the supported calendar boundary cannot save an invalid year", () => {
  const draft = plan({ start: "9999-11-01", end: "9999-12-31", roles: [role({ start: "9999-11-01", end: "9999-12-31" })] }), before = structuredClone(draft);
  assert.throws(() => applyRoleBookendDate(draft, draft.roles[0].id, "start", "9999-11-02"));
  assert.deepEqual(draft, before);
});

test("unconfigured clients and invalid ready dates produce no misleading timing preview", () => {
  assert.deepEqual(assessEngagementBookends(undefined, plan(), "2026-12-01"), []);
  assert.deepEqual(assessEngagementBookends(client([]), plan(), "2026-12-01"), []);
  assert.deepEqual(assessEngagementBookends(client([bookend({ active: false })]), plan(), "2026-12-01"), []);
  assert.deepEqual(assessEngagementBookends(client(), plan(), "invalid"), []);
});
