import type {
  ActionReadiness, BaggageObligation, BlockedAction, InstantiateJourneyInput, Journey,
  JourneyActor, JourneyAuditEvent, JourneyReadiness, JourneyRole, JourneyScope, JourneyTemplate,
  ObligationCommand, PermissionScope, ReadinessReason,
} from "./types";

export class JourneyRuleError extends Error {
  constructor(public readonly code: "forbidden" | "conflict" | "invalid" | "invalid_transition" | "unapproved_template", message: string) {
    super(message); this.name = "JourneyRuleError";
  }
}
const ACTIONS: BlockedAction[] = ["confirm_assignment", "start_assignment", "release_capacity", "reuse_asset", "transfer_asset", "close_mission", "grant_access", "revoke_access", "open_journey", "close_journey"];
const MANAGERS: JourneyRole[] = ["administrator", "home_leader", "mission_owner", "asset_access_owner", "placement_owner"];
function assert(condition: unknown, code: JourneyRuleError["code"], message: string): asserts condition {
  if (!condition) throw new JourneyRuleError(code, message);
}
function timestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function requireTime(value: string) { assert(timestamp(value), "invalid", "Use a valid UTC event timestamp."); }
function requiredText(value: string, label: string) { assert(typeof value === "string" && value.trim().length > 0, "invalid", `${label} is required.`); }
function covers(grant: PermissionScope, scope: PermissionScope) {
  return grant.organizationId === scope.organizationId && Object.entries(grant).every(([key, value]) => value === undefined || scope[key as keyof PermissionScope] === value);
}
function exactScope(left: PermissionScope, right: PermissionScope) { return covers(left, right) && covers(right, left); }
function hasRole(actor: JourneyActor, scope: PermissionScope, roles: JourneyRole[]) {
  return actor.active && actor.organizationId === scope.organizationId
    && actor.grants.some(grant => roles.includes(grant.role) && covers(grant.scope, scope));
}
function baseActor(actor: JourneyActor, scope: PermissionScope) {
  assert(actor.active && actor.organizationId === scope.organizationId, "forbidden", "An active member of this organization is required.");
}

/** Approve a fresh template version explicitly; this does not edit any existing instance. */
export function approveJourneyTemplate(template: JourneyTemplate, context: {
  actor: JourneyActor; scope: PermissionScope; policyOwnerId: string; now: string;
}): JourneyTemplate {
  const { actor, scope, policyOwnerId, now } = context;
  requireTime(now); baseActor(actor, scope);
  assert(template.status === "draft", "invalid_transition", "Only a draft template version can be approved.");
  assert(actor.userId === policyOwnerId && hasRole(actor, scope, MANAGERS), "forbidden", "The named policy owner must approve this scope.");
  requiredText(template.sourceReference, "Policy source");
  assert(template.version > 0 && Number.isInteger(template.version), "invalid", "A positive template version is required.");
  const ids = new Set(template.requirements.map(item => item.id));
  const activeIds = new Set(template.requirements.filter(item => item.active).map(item => item.id));
  assert(ids.size === template.requirements.length, "invalid", "Requirement template IDs must be unique.");
  for (const item of template.requirements) {
    requiredText(item.sourceReference, "Requirement source");
    assert(item.prerequisiteTemplateIds.every(id => ids.has(id) && id !== item.id), "invalid", "A prerequisite must name another requirement in this template.");
    assert(!item.active || item.prerequisiteTemplateIds.every(id => activeIds.has(id)), "invalid", "Active requirements cannot depend on inactive requirements.");
    assert(item.dueRule.offsetDays === null || Number.isInteger(item.dueRule.offsetDays), "invalid", "A due-date offset must use whole days.");
    assert(item.severity !== "information" || item.blockedActions.length === 0, "invalid", "An informational requirement cannot block an action.");
    assert(!template.kind.startsWith("company") || item.blockedActions.every(action => !["confirm_assignment", "start_assignment", "release_capacity", "close_mission"].includes(action)), "invalid", "Company journeys cannot govern assignment, mission, or capacity actions.");
  }
  // Visit each edge once; shared predecessors in a dense graph must not expand every path.
  const graph = new Map(template.requirements.map(item => [item.id, item.prerequisiteTemplateIds]));
  const visiting = new Set<string>(), completed = new Set<string>();
  const visit = (id: string) => {
    if (completed.has(id)) return;
    assert(!visiting.has(id), "invalid", "Requirement prerequisites cannot form a cycle.");
    visiting.add(id);
    graph.get(id)!.forEach(visit);
    visiting.delete(id); completed.add(id);
  };
  ids.forEach(visit);
  return { ...structuredClone(template), status: "approved", policyOwnerId, approvedBy: actor.userId, approvedAt: now, approvedScope: { ...scope } };
}

/** Persist this key with a unique constraint; generating it alone does not provide transactional idempotency. */
export function obligationInstanceKey(input: {
  organizationId: string; templateId: string; templateVersion: number; assignmentId?: string; missionId?: string;
  resourceId: string; trigger: string; triggerOccurrenceId: string;
}) {
  return JSON.stringify([input.organizationId, input.templateId, input.templateVersion, input.assignmentId ? `assignment:${input.assignmentId}` : input.missionId ? `mission:${input.missionId}:resource:${input.resourceId}` : `resource:${input.resourceId}`, input.trigger, input.triggerOccurrenceId]);
}

export function instantiateJourney(input: InstantiateJourneyInput): Journey {
  const { template, scope, actor, now } = input;
  requireTime(now); baseActor(actor, scope);
  assert(hasRole(actor, scope, MANAGERS), "forbidden", "Journey creation requires a scoped operational owner.");
  assert(template.status === "approved" && template.policyOwnerId && template.approvedAt && template.approvedBy
    && template.approvedScope && covers(template.approvedScope, scope), "unapproved_template", "An owner-approved template for this scope is required.");
  requiredText(input.id, "Journey ID"); requiredText(input.ownerId, "Journey owner"); requiredText(scope.resourceId, "Resource");
  requiredText(input.triggerOccurrenceId, "Trigger occurrence");
  if (template.kind.startsWith("mission")) assert(scope.missionId, "invalid", "Mission journeys require a mission scope.");
  for (const date of [input.openingAt, input.releaseAt, input.closeoutAt]) if (date !== null) requireTime(date);
  const active = template.requirements.filter(item => item.active);
  const ids = active.map(item => input.obligationIds[item.id]);
  assert(ids.every(Boolean) && new Set(ids).size === ids.length, "invalid", "Every obligation needs a distinct allocated ID.");
  const obligations: BaggageObligation[] = active.map(item => {
    const owners = input.owners[item.id];
    assert(owners?.ownerId && owners.fulfillerId && owners.verifierId, "invalid", "Every requirement needs named owner, fulfiller, and verifier identities.");
    assert(owners.fulfillerId !== owners.verifierId, "invalid", "The verifier must be independent from the fulfiller.");
    assert(item.prerequisiteTemplateIds.every(id => active.some(parent => parent.id === id)), "invalid", "Active requirements cannot depend on inactive requirements.");
    const anchor = item.dueRule.anchor === "opening" ? input.openingAt : item.dueRule.anchor === "release" ? input.releaseAt : item.dueRule.anchor === "closeout" ? input.closeoutAt : null;
    const dueAt = anchor && item.dueRule.offsetDays !== null ? new Date(Date.parse(anchor) + item.dueRule.offsetDays * 86_400_000).toISOString() : null;
    return {
      id: input.obligationIds[item.id], organizationId: scope.organizationId, revision: 1,
      createdAt: now, createdBy: actor.userId, updatedAt: now, updatedBy: actor.userId,
      journeyId: input.id, instanceKey: obligationInstanceKey({ organizationId: scope.organizationId, templateId: item.id, templateVersion: item.version, assignmentId: scope.assignmentId, missionId: scope.missionId, resourceId: scope.resourceId, trigger: item.trigger, triggerOccurrenceId: input.triggerOccurrenceId }),
      templateId: item.id, templateVersion: item.version, trigger: item.trigger, triggerOccurrenceId: input.triggerOccurrenceId,
      scope: { ...scope }, category: item.category, title: item.title, description: item.description,
      sourceReference: item.sourceReference, policyOwnerId: template.policyOwnerId!, ...owners, approverRole: item.approverRole,
      effectiveFrom: now, effectiveUntil: null, dueAt, status: "open", blockedActions: [...item.blockedActions], severity: item.severity,
      evidencePolicy: structuredClone(item.evidencePolicy), overridePolicy: structuredClone(item.overridePolicy),
      prerequisiteIds: item.prerequisiteTemplateIds.map(id => input.obligationIds[id]),
      verificationExpiresAt: null, verifiedAt: null, sourceVerifiedAt: template.approvedAt, sourceFreshness: "current",
      externalReference: null, resolution: null, evidence: [], decisions: [], helpRequests: [], cancellationReason: null, supersededBy: null,
    };
  });
  return {
    id: input.id, organizationId: scope.organizationId, revision: 1, createdAt: now, createdBy: actor.userId, updatedAt: now, updatedBy: actor.userId,
    kind: template.kind, name: template.name, templateId: template.id, templateVersion: template.version,
    scope: { ...scope }, ownerId: input.ownerId, openingAt: input.openingAt, releaseAt: input.releaseAt, closeoutAt: input.closeoutAt, obligations,
  };
}

function requireWorkActor(actor: JourneyActor, obligation: BaggageObligation) {
  assert((actor.userId === obligation.fulfillerId || actor.userId === obligation.ownerId)
    && actor.grants.some(grant => covers(grant.scope, obligation.scope)), "forbidden", "Only this requirement's assigned fulfiller or owner can submit work.");
}
function requireReviewer(actor: JourneyActor, obligation: BaggageObligation) {
  assert(actor.userId === obligation.verifierId && actor.userId !== obligation.fulfillerId && actor.resourceId !== obligation.scope.resourceId
    && hasRole(actor, obligation.scope, [obligation.approverRole]), "forbidden", "Verification requires the independent named verifier with scoped authority.");
}

/** Pure transition only. The server must authorize records, lock revisions, and persist event + state atomically. */
export function transitionObligation(obligation: BaggageObligation, command: ObligationCommand, context: {
  actor: JourneyActor; expectedRevision: number; now: string; relatedObligations?: BaggageObligation[];
}): { obligation: BaggageObligation; event: JourneyAuditEvent } {
  const { actor, now } = context;
  requireTime(now); baseActor(actor, obligation.scope);
  assert(obligation.organizationId === obligation.scope.organizationId, "invalid", "The obligation scope must belong to its organization.");
  assert(context.expectedRevision === obligation.revision, "conflict", "This requirement changed. Reload its current revision before trying again.");
  const next = structuredClone(obligation);
  let reason: string | null = "reason" in command && typeof command.reason === "string" ? command.reason.trim() : null;
  if ("reason" in command) requiredText(command.reason, "A reason");
  const canWork = ["open", "in_progress", "waiting_external", "rejected", "expired"].includes(obligation.status);
  if (["start", "wait_external", "request_help", "submit"].includes(command.type)) {
    requireWorkActor(actor, obligation);
    assert(canWork || (command.type === "request_help" && obligation.status === "submitted"), "invalid_transition", "This requirement is not open for work.");
  }
  switch (command.type) {
    case "start": next.status = "in_progress"; break;
    case "wait_external": next.status = "waiting_external"; next.resolution = command.reason; break;
    case "request_help": next.helpRequests.push({ by: actor.userId, at: now, reason: command.reason }); break;
    case "submit": {
      requiredText(command.evidence.id, "Evidence ID"); requiredText(command.evidence.summary, "A short evidence summary");
      assert(!next.evidence.some(item => item.id === command.evidence.id), "conflict", "This evidence ID is already recorded.");
      next.evidence.push({ ...command.evidence, reference: command.evidence.reference ?? null, submittedBy: actor.userId, submittedAt: now, verificationStatus: "pending", verifiedBy: null, verifiedAt: null });
      next.status = "submitted"; next.verifiedAt = null; next.resolution = null; break;
    }
    case "verify": {
      requireReviewer(actor, obligation);
      assert(obligation.status === "submitted", "invalid_transition", "Only submitted work can be verified.");
      const evidence = next.evidence.find(item => item.id === command.evidenceId);
      assert(evidence && evidence.submittedBy !== actor.userId, "forbidden", "A reviewer cannot verify their own evidence.");
      assert(next.evidencePolicy.acceptedKinds.includes(evidence.kind), "invalid", "This evidence does not meet the requirement's accepted evidence policy.");
      const related = context.relatedObligations ?? [];
      assert(next.prerequisiteIds.every(id => related.some(item => item.id === id && item.organizationId === next.organizationId && item.journeyId === next.journeyId && exactScope(item.scope, next.scope)
        && item.status === "satisfied" && !!item.verifiedAt && Date.parse(item.verifiedAt) <= Date.parse(now)
        && item.sourceFreshness === "current" && !!item.sourceVerifiedAt && Date.parse(item.sourceVerifiedAt) <= Date.parse(now)
        && (!item.verificationExpiresAt || Date.parse(item.verificationExpiresAt) > Date.parse(now)))), "invalid_transition", "Verify or renew the preceding requirements before accepting this one.");
      requiredText(command.resolution, "Verification outcome");
      if (command.verificationExpiresAt) { requireTime(command.verificationExpiresAt); assert(Date.parse(command.verificationExpiresAt) > Date.parse(now), "invalid", "Verification expiry must be in the future."); }
      evidence.verificationStatus = "verified"; evidence.verifiedBy = actor.userId; evidence.verifiedAt = now;
      next.status = "satisfied"; next.verifiedAt = now; next.verificationExpiresAt = command.verificationExpiresAt ?? null;
      next.sourceFreshness = "current"; next.sourceVerifiedAt = now; next.resolution = command.resolution; reason = command.resolution; break;
    }
    case "reject":
      requireReviewer(actor, obligation); assert(obligation.status === "submitted", "invalid_transition", "Only submitted work can be rejected.");
      next.status = "rejected"; next.resolution = command.reason;
      next.evidence.filter(item => item.verificationStatus === "pending").forEach(item => { item.verificationStatus = "rejected"; item.verifiedBy = actor.userId; item.verifiedAt = now; }); break;
    case "waive": case "accept_risk": {
      assert(actor.userId !== obligation.fulfillerId && actor.resourceId !== obligation.scope.resourceId
        && (actor.userId === obligation.ownerId || actor.userId === obligation.verifierId || actor.userId === obligation.policyOwnerId)
        && hasRole(actor, obligation.scope, obligation.overridePolicy.approverRoles), "forbidden", "This decision requires the designated independent owner and scoped approval role.");
      assert(!["cancelled", "superseded", "satisfied"].includes(obligation.status), "invalid_transition", "This requirement cannot receive a new exception.");
      assert(command.type === "accept_risk" ? obligation.severity === "soft" : obligation.overridePolicy.allowed, "forbidden", "This requirement does not allow that exception.");
      assert(obligation.blockedActions.includes(command.targetAction) && exactScope(command.scope, obligation.scope), "invalid", "A decision must name an affected action and the exact requirement scope.");
      requireTime(command.expiresAt); assert(Date.parse(command.expiresAt) > Date.parse(now), "invalid", "A decision must have a future expiry.");
      requiredText(command.decisionId, "Decision ID");
      assert(!next.decisions.some(item => item.id === command.decisionId), "conflict", "This decision ID is already recorded.");
      assert(command.evidenceIds.every(id => next.evidence.some(item => item.id === id)), "invalid", "Decision evidence must belong to this requirement.");
      assert(!obligation.overridePolicy.evidenceRequired || command.evidenceIds.length > 0, "invalid", "This decision requires evidence references.");
      next.decisions.push({ id: command.decisionId, kind: command.type === "waive" ? "waiver" : "risk_acceptance", targetAction: command.targetAction, scope: { ...command.scope }, reason: command.reason, expiresAt: command.expiresAt, evidenceIds: [...command.evidenceIds], decisionMakerId: actor.userId, decidedAt: now, status: "approved" });
      if (command.type === "waive") next.status = "waived";
      break;
    }
    case "cancel":
      requireReviewer(actor, obligation); assert(command.requirementInapplicable, "invalid", "Cancellation requires an inapplicable requirement, not unfinished work.");
      assert(!["satisfied", "cancelled", "superseded"].includes(obligation.status), "invalid_transition", "This requirement cannot be cancelled.");
      next.status = "cancelled"; next.cancellationReason = command.reason; break;
    case "reopen":
      requireReviewer(actor, obligation); assert(["satisfied", "expired", "waived", "cancelled"].includes(obligation.status), "invalid_transition", "This requirement cannot be reopened.");
      next.status = "open"; next.verifiedAt = null; next.resolution = command.reason;
      next.decisions = next.decisions.map(item => ({ ...item, status: "revoked" })); break;
    case "expire":
      requireReviewer(actor, obligation); assert(["satisfied", "waived"].includes(obligation.status) && obligation.verificationExpiresAt && Date.parse(obligation.verificationExpiresAt) <= Date.parse(now), "invalid_transition", "An accepted verification must have expired.");
      next.status = "expired"; next.resolution = command.reason; break;
    case "supersede":
      requireReviewer(actor, obligation); requiredText(command.replacementId, "Replacement obligation");
      assert(command.replacementId !== obligation.id && obligation.status !== "superseded", "invalid_transition", "Supersession requires a different replacement obligation.");
      assert(context.relatedObligations?.some(item => item.id === command.replacementId && item.organizationId === obligation.organizationId && item.journeyId === obligation.journeyId && exactScope(item.scope, obligation.scope) && item.templateId === obligation.templateId && item.templateVersion > obligation.templateVersion && !["cancelled", "superseded"].includes(item.status)), "invalid", "Supersession must reference a live, recorded newer version of this scoped requirement.");
      next.status = "superseded"; next.supersededBy = command.replacementId; next.resolution = command.reason; break;
    default: throw new JourneyRuleError("invalid", "Unknown obligation command.");
  }
  next.revision++; next.updatedAt = now; next.updatedBy = actor.userId;
  return { obligation: next, event: { organizationId: next.organizationId, journeyId: next.journeyId, obligationId: next.id, actorId: actor.userId, occurredAt: now, operation: command.type, previousStatus: obligation.status, nextStatus: next.status, previousRevision: obligation.revision, revision: next.revision, reason } };
}

function emptyReadiness(): ActionReadiness { return { status: "not_applicable", reasons: [], blockingObligationIds: [], unknownObligationIds: [], earliestFeasibleActionAt: null }; }
function reasonFor(obligation: BaggageObligation, message: string): ReadinessReason {
  return { obligationId: obligation.id, title: obligation.title, ownerId: obligation.ownerId, message, sourceReference: obligation.sourceReference, sourceVerifiedAt: obligation.sourceVerifiedAt };
}
function mergeReadiness(values: ActionReadiness[]): ActionReadiness {
  const applicable = values.filter(value => value.status !== "not_applicable");
  if (!applicable.length) return emptyReadiness();
  const status = (["blocked", "needs_verification", "conditional", "ready"] as const).find(candidate => applicable.some(value => value.status === candidate))!;
  return { status, reasons: [...new Map(applicable.flatMap(value => value.reasons).map(reason => [`${reason.obligationId}:${reason.message}`, reason])).values()], blockingObligationIds: [...new Set(applicable.flatMap(value => value.blockingObligationIds))], unknownObligationIds: [...new Set(applicable.flatMap(value => value.unknownObligationIds))], earliestFeasibleActionAt: null };
}

/** Read-only derivation; never releases hours, edits assignments, closes custody, or changes employment. */
export function evaluateReadiness(journey: Journey, context: {
  now: string; actionDates?: Partial<Record<BlockedAction, string | null>>;
}): JourneyReadiness {
  requireTime(context.now);
  const actions = Object.fromEntries(ACTIONS.map(action => {
    const date = context.actionDates && action in context.actionDates ? context.actionDates[action] ?? null
      : action === "release_capacity" ? journey.releaseAt : ["close_mission", "revoke_access", "close_journey"].includes(action) ? journey.closeoutAt : journey.openingAt;
    if (date !== null) requireTime(date);
    const at = date ? Math.max(Date.parse(date), Date.parse(context.now)) : Date.parse(context.now);
    const items = journey.obligations.filter(item => item.organizationId === journey.organizationId && exactScope(item.scope, journey.scope)
      && item.severity !== "information" && item.blockedActions.includes(action) && !["cancelled", "superseded"].includes(item.status)
      && !(item.effectiveFrom && at < Date.parse(item.effectiveFrom))
      && !(item.effectiveUntil && at >= Date.parse(item.effectiveUntil)));
    const states = items.map((item): ActionReadiness => {
      const state: ActionReadiness = { ...emptyReadiness(), status: "ready" };
      const decision = item.decisions.find(value => value.status === "approved" && value.targetAction === action && exactScope(value.scope, item.scope)
        && Date.parse(value.decidedAt) <= Date.parse(context.now) && Date.parse(value.expiresAt) > at);
      const missing = !date || !item.dueAt || item.sourceFreshness !== "current" || !item.sourceVerifiedAt
        || (!!item.sourceVerifiedAt && Date.parse(item.sourceVerifiedAt) > Date.parse(context.now))
        || (item.verificationExpiresAt !== null && Date.parse(item.verificationExpiresAt) <= at)
        || (item.status === "satisfied" && (!item.verifiedAt || (item.evidencePolicy.required && !item.evidence.some(evidence => evidence.verificationStatus === "verified" && !!evidence.verifiedAt && evidence.verifiedBy !== evidence.submittedBy && item.evidencePolicy.acceptedKinds.includes(evidence.kind)))));
      if (missing) state.unknownObligationIds.push(item.id);
      if (decision) { state.status = "conditional"; state.reasons.push(reasonFor(item, `A scoped ${decision.kind === "waiver" ? "waiver" : "risk acceptance"} applies until ${decision.expiresAt}.`)); return state; }
      if (missing) { state.status = "needs_verification"; state.reasons.push(reasonFor(item, !date || !item.dueAt ? "Timing is not verified. The owner must confirm it; no feasible action date is promised." : "Required source or verification is missing, stale, or expired.")); return state; }
      const unresolvedPredecessor = item.prerequisiteIds.some(id => !journey.obligations.some(parent => parent.id === id && parent.organizationId === item.organizationId && parent.status === "satisfied" && !!parent.verifiedAt && parent.sourceFreshness === "current" && (!parent.verificationExpiresAt || Date.parse(parent.verificationExpiresAt) > at)));
      if (item.status === "satisfied" && !unresolvedPredecessor) return state;
      state.status = "blocked"; state.blockingObligationIds.push(item.id);
      state.reasons.push(reasonFor(item, item.status === "submitted" ? "Submitted work is awaiting independent verification." : item.severity === "soft" ? "A scoped owner must record acceptance of this risk." : unresolvedPredecessor ? "A preceding requirement still needs verification." : "This requirement must be resolved for the named action."));
      return state;
    });
    return [action, mergeReadiness(states)];
  })) as Record<BlockedAction, ActionReadiness>;
  return { evaluatedAt: context.now, rulesVersion: "journeys-v1", actions,
    opening: journey.kind.startsWith("company") ? mergeReadiness([actions.open_journey, actions.grant_access]) : mergeReadiness([actions.confirm_assignment, actions.start_assignment, actions.grant_access]),
    release: actions.release_capacity, closeout: journey.kind.startsWith("company") ? mergeReadiness([actions.close_journey, actions.revoke_access]) : actions.close_mission };
}
