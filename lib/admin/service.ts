import { createHash, randomUUID } from "node:crypto";
import { approveJourneyTemplate } from "../journeys/rules";
import { JOURNEY_TEMPLATE_CATALOG } from "../journeys/templates";
import type { JourneyTemplate, PermissionScope } from "../journeys/types";
import { actorFor, OperationsError, type Membership, type OperationsQuery } from "../operations/service";
import type { AdminBootstrap, AdminCommand, AdminGrant, AdminMember, AdminRequest } from "./contracts";

function requireAdmin(member: Membership) {
  if (!member.active || member.role !== "administrator" || member.home_scope !== null) throw new OperationsError("forbidden", "An active organization administrator is required.", 403);
}
function conflict() { return new OperationsError("conflict", "This record changed. Reload its current values before saving.", 409); }
function revision(actual: number, expected: number | undefined) { if (actual !== expected) throw conflict(); }
type Table = "be_clients" | "be_homes" | "be_resources" | "be_missions" | "be_templates";
async function lock(db: OperationsQuery, org: string, table: Table, id: string) {
  const row = (await db.query(`SELECT * FROM ${table} WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [org, id])).rows[0];
  if (!row) throw new OperationsError("not_found", "That record is unavailable in this organization.", 404);
  return row;
}
async function activeHome(db: OperationsQuery, org: string, code: string) {
  if (!(await db.query("SELECT id FROM be_homes WHERE organization_id=$1 AND code=$2 AND active FOR SHARE", [org, code])).rows.length) throw new OperationsError("invalid_home", "Choose an active configured HOME.");
}
async function activeClient(db: OperationsQuery, org: string, id: string) {
  const row = (await db.query<{id:string;name:string}>("SELECT id,name FROM be_clients WHERE organization_id=$1 AND id=$2 AND active FOR SHARE", [org, id])).rows[0];
  if (!row) throw new OperationsError("invalid_client", "Choose an active client in this organization.");
  return row;
}
async function validOwner(db: OperationsQuery, org: string, ownerId: string, home: string, resourceId: string) {
  const member = (await db.query<Membership>("SELECT * FROM be_memberships WHERE organization_id=$1 AND id=$2 AND active", [org, ownerId])).rows[0];
  const scope: PermissionScope = { organizationId: org, homeId: home, resourceId };
  if (!member || !actorFor(member).grants.some(grant => ["administrator", "placement_owner", "home_leader", "mission_owner"].includes(grant.role) && Object.entries(grant.scope).every(([key, value]) => value === undefined || scope[key as keyof PermissionScope] === value))) throw new OperationsError("invalid_owner_scope", "Choose an active staffing owner authorized for this HOME.");
}
function grantsForStorage(grants: AdminGrant[], org: string) { return grants.map(grant => ({ role: grant.role, scope: { ...grant.scope, organizationId: org } })); }
function safeGrants(value: Membership["grants"], org: string): AdminGrant[] {
  return Array.isArray(value) ? value.filter(grant => grant.scope?.organizationId === org).map(grant => {
    const { organizationId: _organizationId, ...scope } = grant.scope;
    return { role: grant.role, scope };
  }) : [];
}
export async function loadAdmin(db: OperationsQuery, member: Membership): Promise<AdminBootstrap> {
  requireAdmin(member);
  const org = member.organization_id;
  const organization = (await db.query<{id:string;name:string;revision:number}>("SELECT id,name,revision FROM be_organizations WHERE id=$1", [org])).rows[0];
  if (!organization) throw new OperationsError("not_found", "This organization is unavailable.", 404);
  const clients = (await db.query<{id:string;name:string;code:string;contact_name:string|null;contact_email:string|null;notes:string;active:boolean;revision:number}>("SELECT id,name,code,contact_name,contact_email,notes,active,revision FROM be_clients WHERE organization_id=$1 ORDER BY name,id LIMIT 1001", [org])).rows.map(row => ({ id: row.id, name: row.name, code: row.code, contactName: row.contact_name ?? "", contactEmail: row.contact_email ?? "", notes: row.notes, active: row.active, revision: row.revision }));
  const homes = (await db.query<{id:string;code:string;name:string;description:string;active:boolean;revision:number}>("SELECT id,code,name,description,active,revision FROM be_homes WHERE organization_id=$1 ORDER BY name,id LIMIT 1001", [org])).rows;
  const resources = (await db.query<{id:string;name:string;home:string;owner_id:string;active:boolean;revision:number}>("SELECT id,name,home,owner_id,active,revision FROM be_resources WHERE organization_id=$1 ORDER BY name,id LIMIT 1001", [org])).rows.map(row => ({ id: row.id, name: row.name, home: row.home, ownerId: row.owner_id, active: row.active, revision: row.revision }));
  const missions = (await db.query<{id:string;name:string;client_id:string;active:boolean;revision:number}>("SELECT id,name,client_id,active,revision FROM be_missions WHERE organization_id=$1 ORDER BY name,id LIMIT 1001", [org])).rows.map(row => ({ id: row.id, name: row.name, clientId: row.client_id, active: row.active, revision: row.revision }));
  const members: AdminMember[] = (await db.query<Membership & {revision:number}>("SELECT id,name,role,resource_id,home_scope,active,revision,grants FROM be_memberships WHERE organization_id=$1 ORDER BY name,id LIMIT 1001", [org])).rows.map(row => ({ id: row.id, name: row.name, role: row.role, resourceId: row.resource_id, homeScope: row.home_scope, active: row.active, revision: row.revision, grants: safeGrants(row.grants, org) }));
  const templates = (await db.query<{body:JourneyTemplate;revision:number}>("SELECT body,revision FROM be_templates WHERE organization_id=$1 ORDER BY kind,version DESC LIMIT 1001", [org])).rows.map(row => ({ ...row.body, revision: row.revision, persisted: true }));
  templates.push(...JOURNEY_TEMPLATE_CATALOG.filter(template => !templates.some(row => row.kind === template.kind)).map(template => ({ ...structuredClone(template), revision: 0, persisted: false })));
  const hasMore = [clients, homes, resources, missions, members, templates].some(rows => rows.length > 1000);
  return { organization, viewer: { id: member.id, name: member.name }, clients: clients.slice(0, 1000), homes: homes.slice(0, 1000), resources: resources.slice(0, 1000), missions: missions.slice(0, 1000), members: members.slice(0, 1000), templates: templates.slice(0, 1000), asOf: new Date().toISOString(), hasMore };
}
async function audit(db: OperationsQuery, member: Membership, operation: string, payload: Record<string, unknown>) {
  await db.query("INSERT INTO be_events(organization_id,id,actor_id,operation,payload) VALUES($1,$2,$3,$4,$5)", [member.organization_id, randomUUID(), member.id, `admin.${operation}`, JSON.stringify(payload)]);
}
async function validateMemberReferences(db: OperationsQuery, org: string, command: Extract<AdminCommand, {type:"create_member"|"update_member"}>) {
  // Revoking access must remain possible after its referenced configuration is archived.
  // The reviewed database function still checks organization ownership and reference existence.
  if (command.type === "update_member" && !command.active) return;
  if (command.homeScope) await activeHome(db, org, command.homeScope);
  const resources = [command.resourceId, ...command.grants.map(grant => grant.scope.resourceId)].filter(Boolean) as string[];
  for (const id of new Set(resources)) if (!(await db.query("SELECT id FROM be_resources WHERE organization_id=$1 AND id=$2 AND active", [org, id])).rows.length) throw new OperationsError("invalid_resource", "Choose an active teammate in this organization.");
  for (const grant of command.grants) {
    if (grant.scope.homeId) await activeHome(db, org, grant.scope.homeId);
    if (grant.scope.clientId) await activeClient(db, org, grant.scope.clientId);
    if (grant.scope.missionId && !(await db.query("SELECT id FROM be_missions WHERE organization_id=$1 AND id=$2 AND active", [org, grant.scope.missionId])).rows.length) throw new OperationsError("invalid_mission", "A role grant must name an active mission in this organization.");
    if (grant.scope.assignmentId && !(await db.query("SELECT id FROM be_assignment_references WHERE organization_id=$1 AND id=$2", [org, grant.scope.assignmentId])).rows.length) throw new OperationsError("invalid_assignment", "A role grant must name an assignment reference in this organization.");
  }
}
async function applyAdmin(db: OperationsQuery, member: Membership, command: AdminCommand) {
  const org = member.organization_id;
  switch (command.type) {
    case "set_organization": {
      await db.query("SELECT * FROM be_admin_update_organization($1,$2)", [command.expectedRevision, command.name]);
      await audit(db, member, command.type, { revision: command.expectedRevision + 1 }); return;
    }
    case "save_client": {
      const id = command.id ?? randomUUID();
      if (command.id) {
        const current = await lock(db, org, "be_clients", id); revision(Number(current.revision), command.expectedRevision);
        if (current.code !== command.code) throw new OperationsError("immutable_code", "The client code stays stable. Change its display name instead.");
        await db.query("UPDATE be_clients SET name=$3,contact_name=$4,contact_email=$5,notes=$6,revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, id, command.name, command.contactName, command.contactEmail, command.notes]);
        await db.query("UPDATE be_missions SET client_name=$3,revision=revision+1 WHERE organization_id=$1 AND client_id=$2 AND client_name<>$3", [org, id, command.name]);
      } else await db.query("INSERT INTO be_clients(organization_id,id,code,name,contact_name,contact_email,notes) VALUES($1,$2,$3,$4,$5,$6,$7)", [org, id, command.code, command.name, command.contactName, command.contactEmail, command.notes]);
      await audit(db, member, command.type, { clientId: id }); return;
    }
    case "save_home": {
      const id = command.id ?? randomUUID();
      if (command.id) {
        const current = await lock(db, org, "be_homes", id); revision(Number(current.revision), command.expectedRevision);
        if (current.code !== command.code) throw new OperationsError("immutable_code", "The HOME code stays stable so existing scopes keep their meaning.");
        await db.query("UPDATE be_homes SET name=$3,description=$4,revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, id, command.name, command.description]);
      } else await db.query("INSERT INTO be_homes(organization_id,id,code,name,description) VALUES($1,$2,$3,$4,$5)", [org, id, command.code, command.name, command.description]);
      await audit(db, member, command.type, { homeId: id }); return;
    }
    case "save_resource": {
      const id = command.id ?? randomUUID();
      await activeHome(db, org, command.home); await validOwner(db, org, command.ownerId, command.home, id);
      if (command.id) {
        const current = await lock(db, org, "be_resources", id); revision(Number(current.revision), command.expectedRevision);
        if (current.home !== command.home && (await db.query("SELECT id FROM be_journeys WHERE organization_id=$1 AND resource_id=$2 LIMIT 1", [org, id])).rows.length) throw new OperationsError("historical_scope", "This teammate has journey history in their current HOME. A HOME migration needs a separate reviewed change; their name and owner can still be updated.");
        await db.query("UPDATE be_resources SET name=$3,home=$4,owner_id=$5,revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, id, command.name, command.home, command.ownerId]);
      } else await db.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES($1,$2,$3,$4,$5)", [org, id, command.name, command.home, command.ownerId]);
      await audit(db, member, command.type, { resourceId: id }); return;
    }
    case "save_mission": {
      const id = command.id ?? randomUUID(), client = await activeClient(db, org, command.clientId);
      if (command.id) {
        const current = await lock(db, org, "be_missions", id); revision(Number(current.revision), command.expectedRevision);
        if (current.client_id !== command.clientId && (await db.query("SELECT 1 FROM be_assignment_references WHERE organization_id=$1 AND mission_id=$2 UNION ALL SELECT 1 FROM be_journeys WHERE organization_id=$1 AND mission_id=$2 LIMIT 1", [org, id])).rows.length) throw new OperationsError("historical_scope", "This mission has assignment or journey history. Create a new mission for a different client.");
        await db.query("UPDATE be_missions SET name=$3,client_id=$4,client_name=$5,revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, id, command.name, command.clientId, client.name]);
      } else await db.query("INSERT INTO be_missions(organization_id,id,name,client_id,client_name) VALUES($1,$2,$3,$4,$5)", [org, id, command.name, command.clientId, client.name]);
      await audit(db, member, command.type, { missionId: id }); return;
    }
    case "set_client_active": case "set_home_active": case "set_resource_active": case "set_mission_active": {
      const table: Table = command.type === "set_client_active" ? "be_clients" : command.type === "set_home_active" ? "be_homes" : command.type === "set_resource_active" ? "be_resources" : "be_missions";
      // Parent configuration locks precede child locks, matching the edit paths.
      if (command.active && table === "be_missions") {
        const identified = (await db.query<{client_id:string}>("SELECT client_id FROM be_missions WHERE organization_id=$1 AND id=$2", [org, command.id])).rows[0];
        if (!identified) throw new OperationsError("not_found", "That mission is unavailable.", 404);
        await activeClient(db, org, identified.client_id);
      }
      if (command.active && table === "be_resources") {
        const identified = (await db.query<{home:string}>("SELECT home FROM be_resources WHERE organization_id=$1 AND id=$2", [org, command.id])).rows[0];
        if (!identified) throw new OperationsError("not_found", "That teammate is unavailable.", 404);
        await activeHome(db, org, identified.home);
      }
      const current = await lock(db, org, table, command.id); revision(Number(current.revision), command.expectedRevision);
      if (!command.active && table === "be_clients" && (await db.query("SELECT id FROM be_missions WHERE organization_id=$1 AND client_id=$2 AND active LIMIT 1", [org, command.id])).rows.length) throw new OperationsError("active_dependents", "Archive this client's active missions first. Existing journey history will stay available.");
      if (!command.active && table === "be_homes" && (await db.query("SELECT 1 FROM be_resources WHERE organization_id=$1 AND home=$2 AND active UNION ALL SELECT 1 FROM be_memberships WHERE organization_id=$1 AND active AND (home_scope=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(grants) g WHERE g->'scope'->>'homeId'=$2)) LIMIT 1", [org, current.code])).rows.length) throw new OperationsError("active_dependents", "This HOME still has active people or access scopes. Reassign or archive those records first.");
      if (command.active && table === "be_resources") await validOwner(db, org, String(current.owner_id), String(current.home), command.id);
      await db.query(`UPDATE ${table} SET active=$3,revision=revision+1 WHERE organization_id=$1 AND id=$2`, [org, command.id, command.active]);
      await audit(db, member, command.type, { id: command.id, active: command.active }); return;
    }
    case "save_playbook": {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${org}:template:${command.kind}`]);
      const current = command.id ? await lock(db, org, "be_templates", command.id) : null;
      if (current) { revision(Number(current.revision), command.expectedRevision); if (current.kind !== command.kind) throw new OperationsError("immutable_kind", "Create a separate playbook for a different journey kind."); }
      const editingDraft = current?.status === "draft";
      const version = editingDraft ? Number(current.version) : Number((await db.query<{version:number}>("SELECT COALESCE(MAX(version),0)+1 AS version FROM be_templates WHERE organization_id=$1 AND kind=$2", [org, command.kind])).rows[0].version);
      const id = editingDraft ? command.id! : randomUUID();
      const template: JourneyTemplate = { id, kind: command.kind, version, name: command.name, description: command.description, sourceReference: command.sourceReference, status: "draft", policyOwnerId: null, approvedBy: null, approvedAt: null, approvedScope: null, requirements: command.requirements.map(item => ({ ...structuredClone(item), version })) };
      // Validate the policy graph using the shared pure rules; the stored record remains an unapproved draft.
      approveJourneyTemplate(template, { actor: actorFor(member), scope: { organizationId: org }, policyOwnerId: member.id, now: new Date().toISOString() });
      if (editingDraft) await db.query("UPDATE be_templates SET body=$3,revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, id, JSON.stringify(template)]);
      else await db.query("INSERT INTO be_templates(organization_id,id,kind,version,status,body) VALUES($1,$2,$3,$4,'draft',$5)", [org, id, template.kind, version, JSON.stringify(template)]);
      await audit(db, member, command.type, { templateId: id, version }); return;
    }
    case "approve_playbook": case "retire_playbook": {
      const identified = (await db.query<{kind:string}>("SELECT kind FROM be_templates WHERE organization_id=$1 AND id=$2", [org, command.id])).rows[0];
      if (!identified) throw new OperationsError("not_found", "That playbook is unavailable.", 404);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${org}:template:${identified.kind}`]);
      const current = await lock(db, org, "be_templates", command.id); revision(Number(current.revision), command.expectedRevision);
      const template = current.body as JourneyTemplate;
      if (command.type === "approve_playbook") {
        const approved = approveJourneyTemplate(template, { actor: actorFor(member), scope: { organizationId: org }, policyOwnerId: member.id, now: new Date().toISOString() });
        await db.query("UPDATE be_templates SET status='retired',body=jsonb_set(body,'{status}','\"retired\"'::jsonb),revision=revision+1 WHERE organization_id=$1 AND kind=$2 AND status='approved'", [org, template.kind]);
        await db.query("UPDATE be_templates SET status='approved',policy_owner_id=$3,body=$4,revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, command.id, member.id, JSON.stringify(approved)]);
      } else {
        if (template.status === "retired") throw new OperationsError("invalid_transition", "This playbook version is already archived.");
        await db.query("UPDATE be_templates SET status='retired',body=$3,revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, command.id, JSON.stringify({ ...template, status: "retired" })]);
      }
      await audit(db, member, command.type, { templateId: command.id, version: template.version }); return;
    }
    case "create_member": case "update_member": {
      await validateMemberReferences(db, org, command);
      const grants = JSON.stringify(grantsForStorage(command.grants, org));
      const result = command.type === "create_member"
        ? await db.query<{id:string;revision:number}>("SELECT id,revision FROM be_admin_create_membership($1,$2,$3,$4,$5,$6,$7)", [member.issuer, command.subject, command.name, command.role, grants, command.resourceId, command.homeScope])
        : await db.query<{id:string;revision:number}>("SELECT id,revision FROM be_admin_update_membership($1,$2,$3,$4,$5,$6,$7,$8)", [command.id, command.expectedRevision, command.name, command.role, grants, command.resourceId, command.homeScope, command.active]);
      await audit(db, member, command.type, { memberId: result.rows[0].id, revision: result.rows[0].revision }); return;
    }
  }
}
/** Execute inside the authenticated transaction. Actor/org come from Membership, never AdminRequest. */
export async function executeAdmin(db: OperationsQuery, member: Membership, request: AdminRequest): Promise<void> {
  requireAdmin(member);
  const hash = createHash("sha256").update(JSON.stringify({ surface: "admin", command: request.command })).digest("hex");
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${member.organization_id}:${member.id}:${request.idempotencyKey}`]);
    const previous = (await db.query<{request_hash:string}>("SELECT request_hash FROM be_receipts WHERE organization_id=$1 AND actor_id=$2 AND idempotency_key=$3", [member.organization_id, member.id, request.idempotencyKey])).rows[0];
    if (previous) { if (previous.request_hash !== hash) throw new OperationsError("idempotency_conflict", "This retry key belongs to a different change.", 409); return; }
    await applyAdmin(db, member, request.command);
    await db.query("INSERT INTO be_receipts(organization_id,actor_id,idempotency_key,request_hash,response) VALUES($1,$2,$3,$4,$5)", [member.organization_id, member.id, request.idempotencyKey, hash, JSON.stringify({ accepted: true })]);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "23505") throw new OperationsError("duplicate", "That stable code, verified identity, or active teammate link already exists.", 409);
    if (code === "23503") throw new OperationsError("invalid_reference", "A referenced record is unavailable in this organization.");
    if (code === "40001") throw conflict();
    if (code === "42501") throw new OperationsError("forbidden", "This access change is not allowed. Another administrator must change your own access.", 403);
    if (code === "22023") throw new OperationsError("invalid", "Check the selected roles, linked teammate, and explicit scopes.");
    throw error;
  }
}
