/** Journey policy is independent from staffing, custody, and employment records. */
export type JourneyKind = "mission_onboarding" | "mission_offboarding" | "company_onboarding" | "company_offboarding";
export type ObligationStatus = "open" | "in_progress" | "waiting_external" | "submitted" | "rejected" | "satisfied" | "waived" | "expired" | "cancelled" | "superseded";
/** Company journey actions coordinate operational steps; they never authorize employment decisions. */
export type BlockedAction = "confirm_assignment" | "start_assignment" | "release_capacity" | "reuse_asset" | "transfer_asset" | "close_mission" | "grant_access" | "revoke_access" | "open_journey" | "close_journey";
export type ReadinessStatus = "ready" | "conditional" | "blocked" | "needs_verification" | "not_applicable";
export type BaggageCategory = "physical_custody" | "access_and_licensing" | "eligibility" | "constraints" | "transition" | "data_disposition";
export type RequirementTrigger = "before_open" | "before_release" | "after_close" | "expiry" | "manual";
export type JourneyRole = "resource" | "placement_owner" | "home_leader" | "mission_owner" | "client_liaison" | "asset_access_owner" | "administrator";
export type EvidenceKind = "attestation" | "restricted_reference" | "accepted_receipt" | "shipment_label" | "acceptance";

export type PermissionScope = {
  organizationId: string;
  homeId?: string;
  clientId?: string;
  missionId?: string;
  assignmentId?: string;
  resourceId?: string;
};
export type JourneyScope = PermissionScope & { resourceId: string };
/** Populate exclusively from authenticated membership; never from a request body's role claims. */
export type JourneyActor = {
  userId: string;
  organizationId: string;
  active: boolean;
  resourceId?: string;
  grants: { role: JourneyRole; scope: PermissionScope }[];
};
export type AuditFields = {
  id: string;
  organizationId: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};
export type RequirementTemplate = {
  id: string;
  version: number;
  title: string;
  description: string;
  category: BaggageCategory;
  sourceReference: string;
  applicableScope: "organization" | "home" | "client" | "mission" | "assignment" | "person";
  trigger: RequirementTrigger;
  leadTimeDays: number | null;
  dueRule: { anchor: "opening" | "release" | "closeout" | "manual"; offsetDays: number | null };
  approverRole: JourneyRole;
  evidencePolicy: { required: boolean; acceptedKinds: EvidenceKind[]; independentVerification: true };
  blockedActions: BlockedAction[];
  severity: "hard" | "soft" | "information";
  overridePolicy: { allowed: boolean; approverRoles: JourneyRole[]; evidenceRequired: boolean };
  prerequisiteTemplateIds: string[];
  active: boolean;
};
export type JourneyTemplate = {
  id: string;
  kind: JourneyKind;
  version: number;
  name: string;
  description: string;
  status: "draft" | "approved" | "retired";
  sourceReference: string;
  policyOwnerId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedScope: PermissionScope | null;
  requirements: RequirementTemplate[];
};
export type BaggageEvidence = {
  id: string;
  kind: EvidenceKind;
  reference: string | null;
  summary: string;
  submittedBy: string;
  submittedAt: string;
  verificationStatus: "pending" | "verified" | "rejected";
  verifiedBy: string | null;
  verifiedAt: string | null;
};
export type BaggageDecision = {
  id: string;
  kind: "waiver" | "risk_acceptance";
  targetAction: BlockedAction;
  scope: JourneyScope;
  decisionMakerId: string;
  reason: string;
  expiresAt: string;
  evidenceIds: string[];
  decidedAt: string;
  status: "approved" | "revoked";
};
export type BaggageObligation = AuditFields & {
  journeyId: string;
  instanceKey: string;
  templateId: string;
  templateVersion: number;
  trigger: RequirementTrigger;
  triggerOccurrenceId: string;
  scope: JourneyScope;
  category: BaggageCategory;
  title: string;
  description: string;
  sourceReference: string;
  policyOwnerId: string;
  ownerId: string;
  fulfillerId: string;
  verifierId: string;
  approverRole: JourneyRole;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  dueAt: string | null;
  status: ObligationStatus;
  blockedActions: BlockedAction[];
  severity: "hard" | "soft" | "information";
  evidencePolicy: RequirementTemplate["evidencePolicy"];
  overridePolicy: RequirementTemplate["overridePolicy"];
  prerequisiteIds: string[];
  verificationExpiresAt: string | null;
  verifiedAt: string | null;
  sourceVerifiedAt: string | null;
  sourceFreshness: "current" | "stale" | "unknown";
  externalReference: string | null;
  resolution: string | null;
  evidence: BaggageEvidence[];
  decisions: BaggageDecision[];
  helpRequests: { by: string; at: string; reason: string }[];
  cancellationReason: string | null;
  supersededBy: string | null;
};
export type Journey = AuditFields & {
  kind: JourneyKind;
  name: string;
  templateId: string;
  templateVersion: number;
  scope: JourneyScope;
  ownerId: string;
  openingAt: string | null;
  releaseAt: string | null;
  closeoutAt: string | null;
  obligations: BaggageObligation[];
};
export type ObligationOwners = { ownerId: string; fulfillerId: string; verifierId: string };
export type InstantiateJourneyInput = {
  id: string;
  template: JourneyTemplate;
  scope: JourneyScope;
  ownerId: string;
  owners: Record<string, ObligationOwners>;
  obligationIds: Record<string, string>;
  triggerOccurrenceId: string;
  openingAt: string | null;
  releaseAt: string | null;
  closeoutAt: string | null;
  actor: JourneyActor;
  now: string;
};
export type ObligationCommand =
  | { type: "start" }
  | { type: "wait_external" | "request_help" | "reject" | "reopen" | "expire"; reason: string }
  | { type: "submit"; evidence: { id: string; kind: EvidenceKind; reference?: string | null; summary: string } }
  | { type: "verify"; evidenceId: string; resolution: string; verificationExpiresAt?: string | null }
  | { type: "waive" | "accept_risk"; decisionId: string; targetAction: BlockedAction; scope: JourneyScope; reason: string; expiresAt: string; evidenceIds: string[] }
  | { type: "cancel"; reason: string; requirementInapplicable: boolean }
  | { type: "supersede"; reason: string; replacementId: string };
export type JourneyAuditEvent = {
  organizationId: string;
  journeyId: string;
  obligationId: string;
  actorId: string;
  occurredAt: string;
  operation: ObligationCommand["type"];
  previousStatus: ObligationStatus;
  nextStatus: ObligationStatus;
  previousRevision: number;
  revision: number;
  reason: string | null;
};
export type ReadinessReason = {
  obligationId: string;
  title: string;
  ownerId: string;
  message: string;
  sourceReference: string;
  sourceVerifiedAt: string | null;
};
export type ActionReadiness = {
  status: ReadinessStatus;
  reasons: ReadinessReason[];
  blockingObligationIds: string[];
  unknownObligationIds: string[];
  earliestFeasibleActionAt: string | null;
};
export type JourneyReadiness = {
  evaluatedAt: string;
  rulesVersion: "journeys-v1";
  opening: ActionReadiness;
  release: ActionReadiness;
  closeout: ActionReadiness;
  actions: Record<BlockedAction, ActionReadiness>;
};
