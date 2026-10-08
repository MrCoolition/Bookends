import { z } from "zod";
import { approveJourneyTemplate } from "../journeys/rules";
import { JOURNEY_TEMPLATE_CATALOG } from "../journeys/templates";
import type { JourneyActor, JourneyRole, JourneyTemplate, PermissionScope } from "../journeys/types";
import type { AdminBootstrap, AdminCommand, AdminGrant, AdminMember, AdminPlaybook } from "./contracts";
import { adminRequestSchema } from "./validation";
import { capabilityAliasesAfterRename, capabilityNameKey, capabilitySchema, engagementPlanSchema, profileSchema } from "./engagement";
import { plannedTeamReferenceIssues } from "../studio/team";

/** Browser-local configuration only. These records never establish an authenticated identity or permission. */
export type LocalAdminStore = { version: 1; revision: number; clientSeedVersion?: 1; data: AdminBootstrap };
export type LocalAdminCommand = AdminCommand | {
  type: "create_local_member"; name: string; role: JourneyRole; resourceId: string | null;
  homeScope: string | null; grants: AdminGrant[];
};
export const LOCAL_ADMIN_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_ADMIN_OWNER_ID = "00000000-0000-4000-8000-000000000002";
export const MAX_LOCAL_ADMIN_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 1000;
export const MAX_LOCAL_ADMIN_CLIENTS = MAX_RECORDS;
export class LocalAdminError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "LocalAdminError"; }
}
function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new LocalAdminError(code, message);
}
const id = z.uuid(), rev = z.int().positive().max(2_147_483_647);
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !value.includes("\u0000"), "Text cannot contain null characters.");
const optionalText = (max: number) => z.string().trim().max(max).refine(value => !value.includes("\u0000"), "Text cannot contain null characters.");
const role = z.enum(["resource", "placement_owner", "home_leader", "mission_owner", "client_liaison", "asset_access_owner", "administrator"]);
const kind = z.enum(["mission_onboarding", "mission_offboarding", "company_onboarding", "company_offboarding"]);
const scope = z.object({ homeId: text(80).optional(), clientId: id.optional(), missionId: id.optional(), resourceId: id.optional(), assignmentId: id.optional() }).strict();
const grants = z.array(z.object({ role, scope }).strict()).max(30);
const memberFields = { name: text(160), role, resourceId: id.nullable(), homeScope: text(80).nullable(), grants };
const localMemberCommand = z.object({ type: z.literal("create_local_member"), ...memberFields }).strict();
const recordFields = { id, revision: rev, active: z.boolean() };
const templateSchema = z.object({
  id: text(160), kind, version: rev, name: text(200), description: text(3000), status: z.enum(["draft", "approved", "retired"]), sourceReference: text(500),
  policyOwnerId: id.nullable(), approvedBy: id.nullable(), approvedAt: z.iso.datetime().nullable(),
  approvedScope: z.object({ organizationId: id, ...scope.shape }).strict().nullable(),
  requirements: z.array(z.unknown()).min(1).max(50), revision: z.int().min(0).max(2_147_483_647), persisted: z.boolean(),
}).strict();
const storeSchema = z.object({
  version: z.literal(1), revision: rev, clientSeedVersion: z.literal(1).optional(), data: z.object({
    organization: z.object({ id: z.literal(LOCAL_ADMIN_ORGANIZATION_ID), name: text(200), revision: rev }).strict(),
    viewer: z.object({ id: z.literal(LOCAL_ADMIN_OWNER_ID), name: text(160) }).strict(),
    clients: z.array(z.object({ ...recordFields, name: text(160), code: text(80), contactName: optionalText(160), contactEmail: z.union([z.literal(""), z.email().max(254)]), notes: optionalText(4000) }).strict()).max(MAX_RECORDS),
    homes: z.array(z.object({ ...recordFields, code: text(80), name: text(160), description: optionalText(2000) }).strict()).max(MAX_RECORDS),
    resources: z.array(z.object({ ...recordFields, name: text(160), home: text(80), ownerId: id, profile: profileSchema.optional() }).strict()).max(MAX_RECORDS),
    missions: z.array(z.object({ ...recordFields, name: text(160), clientId: id, engagement: engagementPlanSchema.optional() }).strict()).max(MAX_RECORDS),
    capabilities: z.array(capabilitySchema).max(MAX_RECORDS).default([]),
    members: z.array(z.object({ ...recordFields, ...memberFields }).strict()).min(1).max(MAX_RECORDS),
    templates: z.array(templateSchema).min(4).max(200), asOf: z.iso.datetime(), hasMore: z.literal(false).optional(),
  }).strict(),
}).strict();

/** This actor is used only to validate/mark a local policy draft; it is never sent to a server. */
function localPolicyContext(now: string) {
  const scope: PermissionScope = { organizationId: LOCAL_ADMIN_ORGANIZATION_ID };
  const actor: JourneyActor = { userId: LOCAL_ADMIN_OWNER_ID, organizationId: LOCAL_ADMIN_ORGANIZATION_ID, active: true, grants: [{ role: "administrator", scope }] };
  return { actor, scope, policyOwnerId: LOCAL_ADMIN_OWNER_ID, now };
}
function validatePolicy(template: JourneyTemplate, now: string) {
  approveJourneyTemplate({ ...template, status: "draft", policyOwnerId: null, approvedBy: null, approvedAt: null, approvedScope: null }, localPolicyContext(now));
}
function unique(values: string[], label: string) {
  ensure(new Set(values).size === values.length, "invalid_import", `${label} must be unique.`);
}
function jsonValue(input: unknown): unknown {
  let count = 0;
  const parents = new WeakSet<object>();
  const walk = (value: unknown, depth: number) => {
    ensure(++count <= 150_000 && depth <= 24, "invalid_import", "This backup is too complex.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") { ensure(Number.isFinite(value), "invalid_import", "Backups require finite JSON numbers."); return; }
    ensure(typeof value === "object", "invalid_import", "Import a plain JSON backup.");
    ensure(!parents.has(value), "invalid_import", "A backup cannot contain circular references.");
    ensure(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "invalid_import", "Import a plain JSON backup.");
    parents.add(value);
    for (const key of Object.keys(value)) {
      ensure(!["__proto__", "constructor", "prototype"].includes(key), "invalid_import", "This backup contains an unsupported object key.");
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      ensure("value" in property, "invalid_import", "Backups cannot contain executable properties.");
      walk(property.value, depth + 1);
    }
    parents.delete(value);
  };
  let serialized: string;
  if (typeof input === "string") serialized = input;
  else {
    walk(input, 0); serialized = JSON.stringify(input);
  }
  ensure(new TextEncoder().encode(serialized).byteLength <= MAX_LOCAL_ADMIN_BYTES, "too_large", "This local workspace exceeds the 4 MiB backup limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new LocalAdminError("invalid_import", "Choose a valid BOOKENDS JSON backup."); }
  count = 0; walk(parsed, 0);
  return parsed;
}
function validateLinks(data: AdminBootstrap) {
  for (const [label, records] of Object.entries({ clients: data.clients, HOMEs: data.homes, people: data.resources, missions: data.missions, capabilities: data.capabilities ?? [], members: data.members, playbooks: data.templates })) unique(records.map(record => record.id), `${label} IDs`);
  unique((data.capabilities ?? []).flatMap(capability => [capability.name, ...(capability.aliases ?? [])].map(name => `${capability.kind}:${capabilityNameKey(name)}`)), "Role and skill names, including former names");
  unique(data.clients.map(client => client.code), "Client codes"); unique(data.homes.map(home => home.code), "HOME codes");
  unique(data.templates.filter(template => template.persisted).map(template => `${template.kind}:${template.version}`), "Playbook versions");
  unique(data.members.filter(member => member.active && member.resourceId).map(member => member.resourceId!), "Active teammate links");
  const owner = data.members.find(member => member.id === LOCAL_ADMIN_OWNER_ID);
  ensure(owner && owner.name === data.viewer.name, "invalid_import", "The local workspace owner and display name must be preserved.");
  for (const resource of data.resources) {
    const home = data.homes.find(home => home.code === resource.home), member = data.members.find(member => member.id === resource.ownerId);
    ensure(home && member, "invalid_reference", "Every person needs an existing HOME and local owner.");
    ensure(!resource.active || (home.active && member.active), "active_dependents", "An active person needs an active HOME and local owner.");
  }
  for (const mission of data.missions) {
    const client = data.clients.find(client => client.id === mission.clientId);
    ensure(client && (!mission.active || client.active), "invalid_reference", "Every active mission needs an active client.");
    if (mission.engagement) {
      // A backup may retain an archived teammate's history, but cannot reference
      // a teammate that does not exist in the restored workspace.
      const issue = plannedTeamReferenceIssues(mission.engagement, data.resources, mission.engagement)[0];
      ensure(!issue, "invalid_reference", issue?.message ?? "A proposed teammate is missing.");
    }
  }
  for (const member of data.members) {
    ensure(!member.resourceId || data.resources.some(resource => resource.id === member.resourceId), "invalid_reference", "A local teammate link is missing.");
    ensure(!member.homeScope || data.homes.some(home => home.code === member.homeScope && (!member.active || home.active)), "invalid_reference", "A local HOME scope is missing or archived.");
    ensure(member.role !== "resource" || member.resourceId, "invalid_reference", "A resource role needs a linked teammate.");
    ensure(member.role !== "home_leader" || member.homeScope, "invalid_reference", "A HOME leader needs a HOME scope.");
    for (const grant of member.grants) {
      ensure(grant.role !== "home_leader" || grant.scope.homeId, "invalid_reference", "A local HOME leader role needs an explicit HOME scope.");
      ensure(!grant.scope.assignmentId, "invalid_reference", "Assignment scopes require a connected workspace; they cannot be configured locally.");
      const home = grant.scope.homeId && data.homes.find(home => home.code === grant.scope.homeId);
      ensure(!grant.scope.homeId || (home && (!member.active || home.active)), "invalid_reference", "A local role references a missing or archived HOME.");
      ensure(!grant.scope.clientId || data.clients.some(client => client.id === grant.scope.clientId), "invalid_reference", "A local role references a missing client.");
      const mission = grant.scope.missionId && data.missions.find(mission => mission.id === grant.scope.missionId);
      ensure(!grant.scope.missionId || mission, "invalid_reference", "A local role references a missing mission.");
      const resource = grant.scope.resourceId && data.resources.find(resource => resource.id === grant.scope.resourceId);
      ensure(!grant.scope.resourceId || resource, "invalid_reference", "A local role references a missing person.");
      ensure(!mission || !grant.scope.clientId || mission.clientId === grant.scope.clientId, "invalid_reference", "The mission and client role scopes must agree.");
      ensure(!resource || !grant.scope.homeId || resource.home === grant.scope.homeId, "invalid_reference", "The person and HOME role scopes must agree.");
      ensure(grant.role !== "resource" || (!!member.resourceId && grant.scope.resourceId === member.resourceId), "invalid_reference", "A resource role must name that member's linked teammate.");
    }
  }
  for (const catalog of JOURNEY_TEMPLATE_CATALOG) {
    const templates = data.templates.filter(template => template.kind === catalog.kind);
    ensure(templates.length > 0, "invalid_import", "Keep a playbook for each of the four journey kinds.");
    ensure(templates.filter(template => template.status === "approved").length <= 1, "invalid_import", "Only one version of each playbook can be approved.");
    ensure(templates.filter(template => !template.persisted).length <= 1 && !(templates.some(template => template.persisted) && templates.some(template => !template.persisted)), "invalid_import", "A saved playbook replaces its starter placeholder.");
  }
}

/** Accept a JSON string or plain JSON value; return a detached, fully validated local workspace. */
export function parseLocalAdminStore(input: unknown): LocalAdminStore {
  const parsed = storeSchema.parse(jsonValue(input));
  const templates: AdminPlaybook[] = parsed.data.templates.map(template => {
    const checked = adminRequestSchema.parse({ idempotencyKey: LOCAL_ADMIN_OWNER_ID, command: { type: "save_playbook", kind: template.kind, name: template.name, description: template.description, sourceReference: template.sourceReference, requirements: template.requirements } }).command;
    ensure(checked.type === "save_playbook", "invalid_import", "This playbook is invalid.");
    const result = { ...template, requirements: checked.requirements };
    if (template.persisted) ensure(id.safeParse(template.id).success && template.revision > 0, "invalid_import", "Saved playbooks need a stable ID and revision.");
    else ensure(template.id === JOURNEY_TEMPLATE_CATALOG.find(catalog => catalog.kind === template.kind)?.id && template.revision === 0 && template.version === 1 && template.status === "draft", "invalid_import", "This starter playbook is invalid.");
    ensure(result.requirements.every(requirement => requirement.version === template.version), "invalid_import", "Requirement versions must match their playbook.");
    if (template.status === "draft") ensure(template.policyOwnerId === null && template.approvedBy === null && template.approvedAt === null && template.approvedScope === null, "invalid_import", "A draft cannot contain approval metadata.");
    else if (template.status === "approved" || template.approvedAt !== null) ensure(template.policyOwnerId === LOCAL_ADMIN_OWNER_ID && template.approvedBy === LOCAL_ADMIN_OWNER_ID && !!template.approvedAt && JSON.stringify(template.approvedScope) === JSON.stringify({ organizationId: LOCAL_ADMIN_ORGANIZATION_ID }), "invalid_import", "Local approval must remain linked to this local workspace owner.");
    else ensure(template.policyOwnerId === null && template.approvedBy === null && template.approvedScope === null, "invalid_import", "Retired draft metadata is inconsistent.");
    validatePolicy(result, parsed.data.asOf);
    return result;
  });
  const data: AdminBootstrap = { ...parsed.data, templates, hasMore: false };
  validateLinks(data);
  return { version: 1, revision: parsed.revision, ...(parsed.clientSeedVersion ? { clientSeedVersion: parsed.clientSeedVersion } : {}), data };
}

export function createLocalAdminStore(): LocalAdminStore {
  const owner: AdminMember = { id: LOCAL_ADMIN_OWNER_ID, name: "Workspace owner", role: "administrator", resourceId: null, homeScope: null, active: true, revision: 1, grants: [] };
  return { version: 1, revision: 1, data: { organization: { id: LOCAL_ADMIN_ORGANIZATION_ID, name: "BOOKENDS workspace", revision: 1 }, viewer: { id: owner.id, name: owner.name }, clients: [], homes: [], resources: [], missions: [], capabilities: [], members: [owner], templates: JOURNEY_TEMPLATE_CATALOG.map(template => ({ ...structuredClone(template), revision: 0, persisted: false })), asOf: new Date().toISOString(), hasMore: false } };
}
function current<T extends { id: string; revision: number }>(records: T[], recordId: string, expected: number | undefined): T {
  const record = records.find(record => record.id === recordId);
  ensure(record, "not_found", "That local record is no longer available.");
  ensure(record.revision === expected, "conflict", "This record changed. Reload its current values before saving.");
  return record;
}
function activeHome(data: AdminBootstrap, code: string) { ensure(data.homes.some(home => home.code === code && home.active), "invalid_home", "Choose an active HOME."); }
function activeClient(data: AdminBootstrap, clientId: string) { ensure(data.clients.some(client => client.id === clientId && client.active), "invalid_client", "Choose an active client."); }

/** Pure local reducer: the caller owns persistence, cross-tab revision checks, and backup storage. */
export function applyLocalAdminCommand(input: LocalAdminStore, raw: LocalAdminCommand): LocalAdminStore {
  const store = parseLocalAdminStore(input), data = store.data;
  const command = raw.type === "create_local_member" ? localMemberCommand.parse(raw) : adminRequestSchema.parse({ idempotencyKey: LOCAL_ADMIN_OWNER_ID, command: raw }).command;
  const now = new Date().toISOString();
  switch (command.type) {
    case "set_organization":
      ensure(data.organization.revision === command.expectedRevision, "conflict", "The workspace name changed. Reload before saving.");
      data.organization = { ...data.organization, name: command.name, revision: data.organization.revision + 1 }; break;
    case "save_client": {
      const record = command.id ? current(data.clients, command.id, command.expectedRevision) : null;
      ensure(!record || record.code === command.code, "immutable_code", "Keep the stable client code; edit its display name instead.");
      ensure(!data.clients.some(client => client.code === command.code && client.id !== record?.id), "duplicate", "That client code already exists.");
      const value = { id: record?.id ?? crypto.randomUUID(), name: command.name, code: command.code, contactName: command.contactName, contactEmail: command.contactEmail, notes: command.notes, active: record?.active ?? true, revision: (record?.revision ?? 0) + 1 };
      if (record) Object.assign(record, value); else data.clients.push(value); break;
    }
    case "save_home": {
      const record = command.id ? current(data.homes, command.id, command.expectedRevision) : null;
      ensure(!record || record.code === command.code, "immutable_code", "Keep the stable HOME code; edit its display name instead.");
      ensure(!data.homes.some(home => home.code === command.code && home.id !== record?.id), "duplicate", "That HOME code already exists.");
      const value = { id: record?.id ?? crypto.randomUUID(), code: command.code, name: command.name, description: command.description, active: record?.active ?? true, revision: (record?.revision ?? 0) + 1 };
      if (record) Object.assign(record, value); else data.homes.push(value); break;
    }
    case "save_resource": {
      activeHome(data, command.home);
      ensure(data.members.some(member => member.id === command.ownerId && member.active), "invalid_owner", "Choose an active local owner.");
      const record = command.id ? current(data.resources, command.id, command.expectedRevision) : null;
      const profile = command.profile ?? record?.profile;
      const value = { id: record?.id ?? crypto.randomUUID(), name: command.name, home: command.home, ownerId: command.ownerId, active: record?.active ?? true, revision: (record?.revision ?? 0) + 1, ...(profile ? { profile } : {}) };
      if (record) Object.assign(record, value); else data.resources.push(value); break;
    }
    case "save_mission": {
      activeClient(data, command.clientId);
      const record = command.id ? current(data.missions, command.id, command.expectedRevision) : null;
      const engagement = command.engagement ?? record?.engagement;
      if (engagement) {
        const issue = plannedTeamReferenceIssues(engagement, data.resources, record?.engagement)[0];
        ensure(!issue, issue?.code ?? "invalid_reference", issue?.message ?? "Review the proposed team.");
      }
      const value = { id: record?.id ?? crypto.randomUUID(), name: command.name, clientId: command.clientId, active: record?.active ?? true, revision: (record?.revision ?? 0) + 1, ...(engagement ? { engagement } : {}) };
      if (record) Object.assign(record, value); else data.missions.push(value); break;
    }
    case "save_capability": {
      const capabilities = data.capabilities ??= [];
      const record = command.id ? current(capabilities, command.id, command.expectedRevision) : null;
      ensure(!record || record.kind === command.kind, "immutable_kind", "Create a separate catalog entry for a different capability kind.");
      ensure(!capabilities.some(other => other.id !== record?.id && other.kind === command.kind && [other.name, ...(other.aliases ?? [])].some(name => capabilityNameKey(name) === capabilityNameKey(command.name))), "duplicate", "That role or skill name is already used, including its former names.");
      const aliases = capabilityAliasesAfterRename(record, command.name);
      ensure(aliases.length <= 50, "rename_limit", "This entry has 50 former names. Keep its current name or create a distinct new catalog entry.");
      const value = { id: record?.id ?? crypto.randomUUID(), kind: command.kind, name: command.name, description: command.description, aliases, active: record?.active ?? true, revision: (record?.revision ?? 0) + 1 };
      if (record) Object.assign(record, value); else capabilities.push(value); break;
    }
    case "set_client_active": case "set_home_active": case "set_resource_active": case "set_mission_active": case "set_capability_active": {
      const records = command.type === "set_client_active" ? data.clients : command.type === "set_home_active" ? data.homes : command.type === "set_resource_active" ? data.resources : command.type === "set_capability_active" ? data.capabilities ?? [] : data.missions;
      const record = current<{id:string;revision:number;active:boolean}>(records, command.id, command.expectedRevision);
      record.active = command.active; record.revision++; break;
    }
    case "create_member": throw new LocalAdminError("local_identity", "Local members do not create sign-in accounts. Use the local member form.");
    case "create_local_member":
      data.members.push({ id: crypto.randomUUID(), name: command.name, role: command.role, resourceId: command.resourceId, homeScope: command.homeScope, grants: command.grants, active: true, revision: 1 }); break;
    case "update_member": {
      const record = current(data.members, command.id, command.expectedRevision);
      Object.assign(record, { name: command.name, role: command.role, resourceId: command.resourceId, homeScope: command.homeScope, grants: command.grants, active: command.active, revision: record.revision + 1 });
      if (record.id === LOCAL_ADMIN_OWNER_ID) data.viewer.name = record.name; break;
    }
    case "save_playbook": {
      const record = command.id ? current(data.templates, command.id, command.expectedRevision) : null;
      ensure(!record || record.kind === command.kind, "immutable_kind", "Create a separate playbook for a different journey kind.");
      const editing = record?.persisted && record.status === "draft";
      const version = editing ? record.version : Math.max(0, ...data.templates.filter(template => template.persisted && template.kind === command.kind).map(template => template.version)) + 1;
      const value: AdminPlaybook = { id: editing ? record.id : crypto.randomUUID(), kind: command.kind, version, name: command.name, description: command.description, sourceReference: command.sourceReference, requirements: command.requirements.map(requirement => ({ ...requirement, version })), status: "draft", policyOwnerId: null, approvedBy: null, approvedAt: null, approvedScope: null, persisted: true, revision: editing ? record.revision + 1 : 1 };
      validatePolicy(value, now);
      if (editing) Object.assign(record, value); else { data.templates = data.templates.filter(template => template.persisted || template.kind !== command.kind); data.templates.push(value); } break;
    }
    case "approve_playbook": {
      const record = current(data.templates, command.id, command.expectedRevision);
      ensure(record.persisted, "invalid_transition", "Save the starter playbook before approving a local version.");
      const approved = approveJourneyTemplate(record, localPolicyContext(now));
      for (const template of data.templates) if (template.kind === record.kind && template.status === "approved") { template.status = "retired"; template.revision++; }
      Object.assign(record, approved, { revision: record.revision + 1 }); break;
    }
    case "retire_playbook": {
      const record = current(data.templates, command.id, command.expectedRevision);
      ensure(record.persisted && record.status !== "retired", "invalid_transition", "Choose a saved playbook version that is not already archived.");
      record.status = "retired"; record.revision++; break;
    }
  }
  store.revision++; data.asOf = now;
  return parseLocalAdminStore(store);
}
