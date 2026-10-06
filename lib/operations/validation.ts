import { z } from "zod";

const id = z.uuid();
const text = (max = 2000) => z.string().trim().min(1).max(max).refine(value => !value.includes("\u0000"), "Text cannot contain null characters.");
const instant = z.iso.datetime({ offset: false }).nullable();
const scope = z.object({ organizationId: id, resourceId: id, homeId: text(80).optional(), clientId: id.optional(), missionId: id.optional(), assignmentId: id.optional() }).strict();
const action = z.enum(["confirm_assignment", "start_assignment", "release_capacity", "reuse_asset", "transfer_asset", "close_mission", "grant_access", "revoke_access", "open_journey", "close_journey"]);
const owners = z.record(z.string().min(1).max(160), z.object({ ownerId: id, fulfillerId: id, verifierId: id }).strict()).refine(value => Object.keys(value).length <= 50, "Choose owners for at most 50 requirements.");
const revision = z.int().positive().max(2_147_483_647);
const obligationCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.enum(["wait_external", "request_help", "reject", "reopen", "expire"]), reason: text() }).strict(),
  z.object({ type: z.literal("submit"), evidence: z.object({ id, kind: z.enum(["attestation", "restricted_reference", "accepted_receipt", "shipment_label", "acceptance"]), reference: text(500).nullable().optional(), summary: text() }).strict() }).strict(),
  z.object({ type: z.literal("verify"), evidenceId: id, resolution: text(), verificationExpiresAt: instant.optional() }).strict(),
  z.object({ type: z.enum(["waive", "accept_risk"]), decisionId: id, targetAction: action, scope, reason: text(), expiresAt: z.iso.datetime({ offset: false }), evidenceIds: z.array(id).max(20) }).strict(),
  z.object({ type: z.literal("cancel"), reason: text(), requirementInapplicable: z.boolean() }).strict(),
  z.object({ type: z.literal("supersede"), reason: text(), replacementId: id }).strict(),
]);
export const operationsRequestSchema = z.object({
  idempotencyKey: id,
  command: z.discriminatedUnion("type", [
    z.object({ type: z.literal("create_resource"), name: text(160), home: text(80), ownerId: id }).strict(),
    z.object({ type: z.literal("create_mission"), name: text(160), clientId: id }).strict(),
    z.object({ type: z.literal("approve_template"), kind: z.enum(["mission_onboarding", "mission_offboarding", "company_onboarding", "company_offboarding"]), sourceReference: text(500) }).strict(),
    z.object({ type: z.literal("create_journey"), templateId: id, resourceId: id, missionId: id.optional(), assignmentReference: text(500).optional(), ownerId: id, fulfillerId: id, verifierId: id, owners: owners.optional(), openingAt: instant, releaseAt: instant, closeoutAt: instant }).strict(),
    z.object({ type: z.literal("obligation"), journeyId: id, obligationId: id, expectedRevision: revision, command: obligationCommand }).strict(),
    z.object({ type: z.literal("acknowledge_notice"), noticeId: id, expectedRevision: revision }).strict(),
  ]),
}).strict();
