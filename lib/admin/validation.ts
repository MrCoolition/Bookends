import { z } from "zod";
import { engagementPlanSchema, profileSchema } from "./engagement";

const id = z.uuid();
const text = (max = 2000) => z.string().trim().min(1).max(max).refine(value => !value.includes("\u0000"), "Text cannot contain null characters.");
const optionalText = (max = 2000) => z.string().trim().max(max).refine(value => !value.includes("\u0000"), "Text cannot contain null characters.");
const revision = z.int().positive().max(2_147_483_647);
const role = z.enum(["resource", "placement_owner", "home_leader", "mission_owner", "client_liaison", "asset_access_owner", "administrator"]);
const kind = z.enum(["mission_onboarding", "mission_offboarding", "company_onboarding", "company_offboarding"]);
const action = z.enum(["confirm_assignment", "start_assignment", "release_capacity", "reuse_asset", "transfer_asset", "close_mission", "grant_access", "revoke_access", "open_journey", "close_journey"]);
const evidenceKind = z.enum(["attestation", "restricted_reference", "accepted_receipt", "shipment_label", "acceptance"]);
const grant = z.object({ role, scope: z.object({ homeId: text(80).optional(), clientId: id.optional(), missionId: id.optional(), assignmentId: id.optional(), resourceId: id.optional() }).strict() }).strict();
const requirement = z.object({
  id: text(160), version: revision, title: text(200), description: text(3000),
  category: z.enum(["physical_custody", "access_and_licensing", "eligibility", "constraints", "transition", "data_disposition"]),
  sourceReference: text(500), applicableScope: z.enum(["organization", "home", "client", "mission", "assignment", "person"]),
  trigger: z.enum(["before_open", "before_release", "after_close", "expiry", "manual"]), leadTimeDays: z.int().min(0).max(730).nullable(),
  dueRule: z.object({ anchor: z.enum(["opening", "release", "closeout", "manual"]), offsetDays: z.int().min(-730).max(730).nullable() }).strict(),
  approverRole: role, evidencePolicy: z.object({ required: z.boolean(), acceptedKinds: z.array(evidenceKind).min(1).max(5), independentVerification: z.literal(true) }).strict(),
  blockedActions: z.array(action).max(10), severity: z.enum(["hard", "soft", "information"]),
  overridePolicy: z.object({ allowed: z.boolean(), approverRoles: z.array(role).max(7), evidenceRequired: z.boolean() }).strict().refine(value => !value.allowed || value.approverRoles.length > 0, "An enabled override needs an authorized reviewer role."),
  prerequisiteTemplateIds: z.array(text(160)).max(50), active: z.boolean(),
}).strict();
const identity = { id: id.optional(), expectedRevision: revision.optional() };
const toggle = { id, expectedRevision: revision, active: z.boolean() };
const member = { name: text(160), role, resourceId: id.nullable(), homeScope: text(80).nullable(), grants: z.array(grant).max(30) };
export const adminRequestSchema = z.object({
  idempotencyKey: id,
  command: z.discriminatedUnion("type", [
    z.object({ type: z.literal("set_organization"), name: text(200), expectedRevision: revision }).strict(),
    z.object({ type: z.literal("save_client"), ...identity, name: text(160), code: text(80), contactName: optionalText(160), contactEmail: z.union([z.literal(""), z.email().max(254)]), notes: optionalText(4000) }).strict(),
    z.object({ type: z.literal("set_client_active"), ...toggle }).strict(),
    z.object({ type: z.literal("save_home"), ...identity, code: text(80), name: text(160), description: optionalText(2000) }).strict(),
    z.object({ type: z.literal("set_home_active"), ...toggle }).strict(),
    z.object({ type: z.literal("save_resource"), ...identity, name: text(160), home: text(80), ownerId: id, profile: profileSchema.optional() }).strict(),
    z.object({ type: z.literal("set_resource_active"), ...toggle }).strict(),
    z.object({ type: z.literal("save_mission"), ...identity, name: text(160), clientId: id, engagement: engagementPlanSchema.optional() }).strict(),
    z.object({ type: z.literal("set_mission_active"), ...toggle }).strict(),
    z.object({ type: z.literal("save_capability"), ...identity, kind: z.enum(["role", "skill"]), name: text(160), description: optionalText(2000) }).strict().refine(value => value.kind !== "skill" || value.name.length <= 100, { message: "Skill names must be 100 characters or fewer.", path: ["name"] }),
    z.object({ type: z.literal("set_capability_active"), ...toggle }).strict(),
    z.object({ type: z.literal("save_playbook"), ...identity, kind, name: text(200), description: text(3000), sourceReference: text(500), requirements: z.array(requirement).min(1).max(50) }).strict(),
    z.object({ type: z.enum(["approve_playbook", "retire_playbook"]), id, expectedRevision: revision }).strict(),
    z.object({ type: z.literal("create_member"), ...member, subject: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/, "Use the exact verified identity subject without control characters."), identityVerified: z.literal(true) }).strict(),
    z.object({ type: z.literal("update_member"), ...member, id, expectedRevision: revision, active: z.boolean() }).strict(),
  ]).superRefine((command, ctx) => {
    if (command.type.startsWith("save_") && (("id" in command && !!command.id) !== ("expectedRevision" in command && !!command.expectedRevision))) ctx.addIssue({ code: "custom", message: "Editing requires both an ID and its current revision.", path: ["expectedRevision"] });
  }),
}).strict();
