import { test } from "node:test";
import assert from "node:assert/strict";
import { approveJourneyTemplate, evaluateReadiness, instantiateJourney, JourneyRuleError, obligationInstanceKey, transitionObligation } from "../lib/journeys/rules";
import { getJourneyTemplate, JOURNEY_TEMPLATE_CATALOG } from "../lib/journeys/templates";
import type { BaggageObligation, Journey, JourneyActor, JourneyKind, JourneyRole, ObligationCommand } from "../lib/journeys/types";

const NOW = "2026-10-06T12:00:00.000Z";
const OPENING = "2026-10-12T13:00:00.000Z";
const RELEASE = "2026-10-30T21:00:00.000Z";
const CLOSEOUT = "2026-11-02T21:00:00.000Z";
const roles: JourneyRole[] = ["administrator", "mission_owner", "home_leader", "asset_access_owner", "placement_owner"];
const admin: JourneyActor = { userId: "policy-owner", organizationId: "org", active: true, grants: roles.map(role => ({ role, scope: { organizationId: "org" } })) };
const reviewer: JourneyActor = { ...admin, userId: "verifier" };
const worker: JourneyActor = { userId: "worker", organizationId: "org", resourceId: "person", active: true, grants: [{ role: "resource", scope: { organizationId: "org", resourceId: "person" } }] };

test("policy validation handles a dense 50-step prerequisite graph and still rejects cycles", () => {
  const template = getJourneyTemplate("mission_onboarding");
  const source = template.requirements[0];
  template.requirements = Array.from({ length: 50 }, (_, index) => ({ ...structuredClone(source), id: `step-${index}`, prerequisiteTemplateIds: Array.from({ length: index }, (_, earlier) => `step-${earlier}`) }));
  const approved = approveJourneyTemplate(template, { actor: admin, scope: { organizationId: "org" }, policyOwnerId: admin.userId, now: NOW });
  assert.equal(approved.requirements.length, 50);
  template.requirements[0].prerequisiteTemplateIds = ["step-49"];
  assert.throws(() => approveJourneyTemplate(template, { actor: admin, scope: { organizationId: "org" }, policyOwnerId: admin.userId, now: NOW }), /cannot form a cycle/);
});

function journey(kind: JourneyKind = "mission_onboarding", suffix = "one"): Journey {
  const template = approveJourneyTemplate(getJourneyTemplate(kind), { actor: admin, scope: { organizationId: "org" }, policyOwnerId: admin.userId, now: NOW });
  return instantiateJourney({
    id: `journey-${suffix}`, template, scope: { organizationId: "org", resourceId: "person", ...(kind.startsWith("mission") ? { missionId: `mission-${suffix}`, assignmentId: `assignment-${suffix}`, clientId: `client-${suffix}` } : {}) },
    ownerId: admin.userId, owners: Object.fromEntries(template.requirements.map(item => [item.id, { ownerId: admin.userId, fulfillerId: worker.userId, verifierId: reviewer.userId }])),
    obligationIds: Object.fromEntries(template.requirements.map(item => [item.id, `${suffix}-${item.id}`])),
    triggerOccurrenceId: "approved-source-revision-1", openingAt: OPENING, releaseAt: RELEASE, closeoutAt: CLOSEOUT, actor: admin, now: NOW,
  });
}
function step(value: Journey, key: string) { return value.obligations.find(item => item.templateId.endsWith(`.${key}`))!; }
function apply(value: BaggageObligation, command: ObligationCommand, actor = worker, relatedObligations: BaggageObligation[] = []) {
  return transitionObligation(value, command, { actor, now: NOW, expectedRevision: value.revision, relatedObligations }).obligation;
}
function verified(value: BaggageObligation, relatedObligations: BaggageObligation[] = []) {
  const evidenceId = `${value.id}-evidence`;
  const submitted = apply(value, { type: "submit", evidence: { id: evidenceId, kind: value.evidencePolicy.acceptedKinds[0], summary: "Owner can verify completion against the approved source.", reference: "restricted://approved-source" } });
  return apply(submitted, { type: "verify", evidenceId, resolution: "Verified by the independent accountable reviewer." }, reviewer, relatedObligations);
}
function ready(value: Journey) {
  const copy = structuredClone(value);
  for (let index = 0; index < copy.obligations.length; index++) copy.obligations[index] = verified(copy.obligations[index], copy.obligations);
  return copy;
}
function throwsCode(action: () => unknown, code: JourneyRuleError["code"]) {
  assert.throws(action, error => error instanceof JourneyRuleError && error.code === code);
}

test("all four journey kinds have draft, separately approved arrival/departure policies", () => {
  assert.deepEqual(JOURNEY_TEMPLATE_CATALOG.map(item => item.kind), ["mission_onboarding", "mission_offboarding", "company_onboarding", "company_offboarding"]);
  for (const template of JOURNEY_TEMPLATE_CATALOG) {
    assert.equal(template.status, "draft");
    assert.equal(template.policyOwnerId, null);
    assert.ok(template.requirements.length >= 7);
    assert.ok(template.requirements.some(item => item.severity === "information" && item.blockedActions.length === 0));
    assert.ok(template.requirements.every(item => item.sourceReference.includes("approval required")));
  }
  for (const kind of ["company_onboarding", "company_offboarding"] as const) {
    const value = journey(kind);
    assert.equal(value.kind, kind);
    assert.equal(value.scope.assignmentId, undefined);
    assert.equal("employmentStatus" in value, false);
    assert.equal("capacity" in value, false);
  }
});

test("draft templates cannot instantiate binding obligations and approval requires the named scoped policy owner", () => {
  const approved = journey();
  const draft = getJourneyTemplate("mission_onboarding");
  throwsCode(() => instantiateJourney({ id: "j", template: draft, scope: approved.scope, ownerId: "owner", owners: {}, obligationIds: {}, triggerOccurrenceId: "event", openingAt: null, releaseAt: null, closeoutAt: null, actor: admin, now: NOW }), "unapproved_template");
  throwsCode(() => approveJourneyTemplate(draft, { actor: worker, scope: { organizationId: "org" }, policyOwnerId: worker.userId, now: NOW }), "forbidden");
  throwsCode(() => approveJourneyTemplate(draft, { actor: admin, scope: { organizationId: "org" }, policyOwnerId: "someone-else", now: NOW }), "forbidden");
  const changed = getJourneyTemplate("mission_onboarding");
  changed.requirements[0].blockedActions = ["start_assignment"];
  throwsCode(() => approveJourneyTemplate(changed, { actor: admin, scope: { organizationId: "org" }, policyOwnerId: admin.userId, now: NOW }), "invalid");
});

test("BG01/BG05 domain-only: old returns and final-time closeout do not implicitly block a new landing or release", () => {
  const ending = journey("mission_offboarding");
  const landing = ready(journey("mission_onboarding", "new"));
  assert.equal(step(ending, "equipment").status, "open");
  assert.equal(step(ending, "time_expense").status, "open");
  const endReadiness = evaluateReadiness(ending, { now: NOW });
  assert.equal(endReadiness.closeout.status, "blocked");
  assert.equal(endReadiness.release.status, "not_applicable");
  assert.equal(endReadiness.opening.status, "not_applicable");
  assert.equal(evaluateReadiness(landing, { now: NOW }).opening.status, "ready");
});

test("BG04 domain-only: mandatory prerequisites block only their explicit actions", () => {
  const value = journey();
  const before = structuredClone(value);
  const result = evaluateReadiness(value, { now: NOW });
  assert.equal(result.actions.start_assignment.status, "blocked");
  assert.equal(result.release.status, "not_applicable");
  assert.equal(result.closeout.status, "not_applicable");
  assert.deepEqual(value, before);
  assert.ok(result.actions.start_assignment.reasons.every(item => item.ownerId && item.sourceReference));
});

test("BG05 domain-only: a past closeout deadline stays outstanding when recorded after the deadline", () => {
  const value = journey("mission_offboarding");
  value.closeoutAt = "2026-10-02T21:00:00.000Z";
  const finalTime = step(value, "time_expense");
  finalTime.dueAt = value.closeoutAt;
  value.obligations = [finalTime];
  const result = evaluateReadiness(value, { now: NOW });
  assert.equal(result.closeout.status, "blocked");
  assert.equal(result.release.status, "not_applicable");
  assert.deepEqual(result.closeout.blockingObligationIds, [finalTime.id]);
});

test("BG09 domain-only: submitting evidence remains submitted until independent scoped verification", () => {
  const value = step(journey(), "access");
  const submitted = apply(value, { type: "submit", evidence: { id: "evidence", kind: "attestation", summary: "Provisioning ticket is ready for review." } });
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.verifiedAt, null);
  assert.equal(submitted.evidence[0].verificationStatus, "pending");
  throwsCode(() => apply(submitted, { type: "verify", evidenceId: "evidence", resolution: "Self approval" }, worker), "forbidden");
  throwsCode(() => apply(submitted, { type: "verify", evidenceId: "evidence", resolution: "No operational role" }, { ...reviewer, grants: [{ role: "administrator", scope: { organizationId: "org" } }] }), "forbidden");
  const accepted = apply(submitted, { type: "verify", evidenceId: "evidence", resolution: "Access owner verified the scoped entitlement." }, reviewer);
  assert.equal(accepted.status, "satisfied");
  assert.equal(accepted.evidence[0].verifiedBy, reviewer.userId);
  assert.equal(value.status, "open");
});

test("a shipping label cannot satisfy an accepted-receipt requirement", () => {
  const value = step(journey("mission_offboarding"), "equipment");
  const submitted = apply(value, { type: "submit", evidence: { id: "label", kind: "shipment_label", summary: "Courier label created." } });
  throwsCode(() => apply(submitted, { type: "verify", evidenceId: "label", resolution: "Label is not receipt." }, reviewer), "invalid");
  assert.equal(submitted.status, "submitted");
});

test("BG10 domain-only: waivers are independent, action-scoped, evidenced, expiring, and never completion", () => {
  const value = journey();
  let item = step(value, "equipment");
  item = { ...item, blockedActions: ["start_assignment", "release_capacity"] };
  item = apply(item, { type: "submit", evidence: { id: "evidence", kind: "restricted_reference", summary: "Owner exception request with approved alternate equipment." } });
  const command: ObligationCommand = { type: "waive", decisionId: "decision", targetAction: "start_assignment", scope: item.scope, reason: "Approved alternate equipment is available for this start.", expiresAt: "2026-10-13T12:00:00.000Z", evidenceIds: ["evidence"] };
  throwsCode(() => apply(item, command, worker), "forbidden");
  throwsCode(() => apply(item, { ...command, scope: { ...item.scope, missionId: "another-mission" } }, reviewer), "invalid");
  throwsCode(() => apply(item, { ...command, reason: " " }, reviewer), "invalid");
  throwsCode(() => apply(item, { ...command, evidenceIds: [] }, reviewer), "invalid");
  const waived = apply(item, command, reviewer);
  assert.equal(waived.status, "waived");
  assert.equal(waived.verifiedAt, null);
  const scoped = { ...value, obligations: [waived] };
  assert.equal(evaluateReadiness(scoped, { now: NOW }).actions.start_assignment.status, "conditional");
  assert.equal(evaluateReadiness(scoped, { now: NOW }).release.status, "blocked");
  assert.equal(evaluateReadiness(scoped, { now: "2026-10-14T12:00:00.000Z" }).actions.start_assignment.status, "blocked");
  assert.equal(waived.decisions.length, 1);
  const learning = step(value, "learning");
  throwsCode(() => apply(learning, { ...command, scope: learning.scope, evidenceIds: [] }, reviewer), "forbidden");
});

test("BG11 domain-only: two clients retain separate obligations and histories", () => {
  const first = journey("mission_offboarding", "client-a");
  const second = journey("mission_offboarding", "client-b");
  const preserved = structuredClone(second);
  const completed = ready(first);
  assert.equal(evaluateReadiness(completed, { now: NOW }).closeout.status, "ready");
  assert.equal(evaluateReadiness(second, { now: NOW }).closeout.status, "blocked");
  assert.deepEqual(second, preserved);
  assert.ok(first.obligations.every(item => !second.obligations.some(other => other.instanceKey === item.instanceKey)));
});

test("BG14 domain-only: missing onboarding timing remains owned and never invents a landing date", () => {
  const value = journey();
  value.openingAt = null;
  value.obligations = value.obligations.map(item => ({ ...item, dueAt: null }));
  const result = evaluateReadiness(value, { now: NOW });
  assert.equal(result.opening.status, "needs_verification");
  assert.equal(result.opening.earliestFeasibleActionAt, null);
  assert.ok(result.opening.unknownObligationIds.length >= 3);
  assert.ok(result.opening.reasons.every(item => item.ownerId));
});

test("known hard blockers take precedence while unknown inputs remain visible", () => {
  const value = journey();
  step(value, "access").sourceFreshness = "stale";
  const result = evaluateReadiness(value, { now: NOW });
  assert.equal(result.opening.status, "blocked");
  assert.ok(result.opening.unknownObligationIds.includes(step(value, "access").id));
  assert.ok(result.opening.blockingObligationIds.includes(step(value, "equipment").id));
});

test("expired verification is not silently reusable and snapshots stay unchanged", () => {
  const value = ready(journey());
  step(value, "learning").verificationExpiresAt = "2026-10-11T12:00:00.000Z";
  const before = structuredClone(value);
  const result = evaluateReadiness(value, { now: NOW });
  assert.equal(result.actions.start_assignment.status, "needs_verification");
  assert.deepEqual(value, before);
});

test("asking for help and waiting on an external owner preserve work without fabricating completion", () => {
  const value = step(journey(), "access");
  const waiting = apply(value, { type: "wait_external", reason: "Waiting on the client access owner; support requested." });
  const helped = apply(waiting, { type: "request_help", reason: "Please help coordinate an accessible first-day setup." });
  assert.equal(helped.status, "waiting_external");
  assert.equal(helped.helpRequests[0].by, worker.userId);
  assert.equal(helped.ownerId, value.ownerId);
  assert.equal(helped.verifiedAt, null);
  const working = apply(helped, { type: "start" });
  assert.equal(working.status, "in_progress");
});

test("optimistic revisions, active identities, and organization boundaries fail closed", () => {
  const item = step(journey(), "welcome");
  throwsCode(() => transitionObligation(item, { type: "start" }, { actor: worker, now: NOW, expectedRevision: 0 }), "conflict");
  throwsCode(() => apply(item, { type: "start" }, { ...worker, active: false }), "forbidden");
  throwsCode(() => apply(item, { type: "start" }, { ...worker, organizationId: "other" }), "forbidden");
  throwsCode(() => apply(item, { type: "start" }, { ...worker, grants: [{ role: "resource", scope: { organizationId: "org", resourceId: "other-person" } }] }), "forbidden");
  throwsCode(() => apply(item, { type: "satisfied" } as unknown as ObligationCommand), "invalid");
});

test("cancellation and supersession cannot conceal incomplete obligations", () => {
  const item = step(journey(), "access");
  throwsCode(() => apply(item, { type: "cancel", reason: "Still incomplete", requirementInapplicable: false }, reviewer), "invalid");
  throwsCode(() => apply(item, { type: "supersede", reason: "Policy changed", replacementId: "missing" }, reviewer), "invalid");
  const cancelled = apply(item, { type: "cancel", reason: "The system was removed from this approved mission scope.", requirementInapplicable: true }, reviewer);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancellationReason);
});

test("BG17 domain-only: stable instance keys enable database deduplication without claiming transactional exactly-once behavior", () => {
  const input = { organizationId: "org", resourceId: "person", missionId: "mission", assignmentId: "assignment", templateId: "template", templateVersion: 1, trigger: "before_open", triggerOccurrenceId: "source-event-1" };
  assert.equal(obligationInstanceKey(input), obligationInstanceKey({ ...input }));
  assert.notEqual(obligationInstanceKey(input), obligationInstanceKey({ ...input, templateVersion: 2 }));
  assert.notEqual(obligationInstanceKey(input), obligationInstanceKey({ ...input, triggerOccurrenceId: "source-event-2" }));
  assert.notEqual(obligationInstanceKey({ ...input, assignmentId: undefined }), obligationInstanceKey({ ...input, assignmentId: undefined, missionId: "another" }));
  const first = journey();
  const retry = journey();
  assert.deepEqual(first.obligations.map(item => item.instanceKey), retry.obligations.map(item => item.instanceKey));
});

test("company readiness governs operational journeys without binding assignment or mission actions", () => {
  for (const kind of ["company_onboarding", "company_offboarding"] as const) {
    const value = journey(kind);
    const actions = value.obligations.flatMap(item => item.blockedActions);
    assert.equal(actions.some(action => ["confirm_assignment", "start_assignment", "release_capacity", "close_mission"].includes(action)), false);
    const result = evaluateReadiness(value, { now: NOW });
    assert.equal(result.actions.start_assignment.status, "not_applicable");
    assert.equal(result.actions.close_mission.status, "not_applicable");
    assert.equal(result.release.status, "not_applicable");
    assert.equal(kind === "company_onboarding" ? result.opening.status : result.closeout.status, "blocked");
  }
});

test("supersession requires a live, recorded newer requirement in the same scope", () => {
  const original = step(journey(), "access");
  const replacement = { ...structuredClone(original), id: "replacement", templateVersion: original.templateVersion + 1 };
  const command: ObligationCommand = { type: "supersede", reason: "A newly approved policy version replaces this requirement.", replacementId: replacement.id };
  throwsCode(() => apply(original, command, reviewer, [{ ...replacement, scope: { ...replacement.scope, missionId: "another" } }]), "invalid");
  throwsCode(() => apply(original, command, reviewer, [{ ...replacement, status: "cancelled", cancellationReason: "Inapplicable." }]), "invalid");
  throwsCode(() => apply(original, command, reviewer, [{ ...replacement, status: "superseded", supersededBy: "third" }]), "invalid");
  const replaced = apply(original, command, reviewer, [replacement]);
  assert.equal(replaced.status, "superseded");
  assert.equal(replaced.supersededBy, replacement.id);
  assert.equal(original.status, "open");
});

test("independent acceptance cannot reuse an expired or stale prerequisite verification", () => {
  const value = journey("mission_offboarding");
  const handoff = verified(step(value, "handoff"));
  const knowledge = apply(step(value, "knowledge"), { type: "submit", evidence: { id: "knowledge-evidence", kind: "acceptance", summary: "The receiving owner is ready to review the handoff." } });
  const command: ObligationCommand = { type: "verify", evidenceId: "knowledge-evidence", resolution: "Receiving owner independently accepted the handoff." };
  throwsCode(() => apply(knowledge, command, reviewer, [{ ...handoff, verificationExpiresAt: "2026-10-05T12:00:00.000Z" }]), "invalid_transition");
  throwsCode(() => apply(knowledge, command, reviewer, [{ ...handoff, sourceFreshness: "stale" }]), "invalid_transition");
  throwsCode(() => apply(knowledge, command, reviewer, [{ ...handoff, sourceFreshness: "unknown" }]), "invalid_transition");
  assert.equal(apply(knowledge, command, reviewer, [handoff]).status, "satisfied");
});
