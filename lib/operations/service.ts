import { createHash, randomUUID } from "node:crypto";
import { approveJourneyTemplate, evaluateReadiness, instantiateJourney, transitionObligation } from "../journeys/rules";
import { JOURNEY_TEMPLATE_CATALOG } from "../journeys/templates";
import type { Journey, JourneyActor, JourneyRole, JourneyTemplate, PermissionScope } from "../journeys/types";
import type { OperationsBootstrap, OperationsCommand, OperationsRequest, OperationsResource } from "./contracts";

/** The service is shared by HTTP handlers and database integration tests. It never trusts browser identity. */
export interface OperationsQuery { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> }
export type Membership = { id: string; organization_id: string; issuer: string; subject: string; name: string; role: JourneyRole; resource_id: string | null; home_scope: string | null; active: boolean; grants: JourneyActor["grants"] };
export class OperationsError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
const ROLES: JourneyRole[] = ["resource", "placement_owner", "home_leader", "mission_owner", "client_liaison", "asset_access_owner", "administrator"];
export const coordinates = (member: Membership) => ["administrator", "placement_owner", "home_leader", "mission_owner"].includes(member.role);
const globalAdministrator = (member: Membership) => member.role === "administrator" && member.home_scope === null;
export function actorFor(member: Membership): JourneyActor {
  const scope: PermissionScope = { organizationId: member.organization_id, ...(member.home_scope ? { homeId: member.home_scope } : {}), ...(member.role === "resource" && member.resource_id ? { resourceId: member.resource_id } : {}) };
  const extra = Array.isArray(member.grants) ? member.grants.filter(g => ROLES.includes(g.role) && g.scope?.organizationId === member.organization_id && (g.role !== "resource" || (!!member.resource_id && g.scope.resourceId === member.resource_id))) : [];
  const base = member.role === "resource" && !member.resource_id ? [] : [{ role: member.role, scope }];
  return { userId: member.id, organizationId: member.organization_id, active: member.active, ...(member.resource_id ? { resourceId: member.resource_id } : {}), grants: [...base, ...extra] };
}
function requireActive(member: Membership) { if (!member.active) throw new OperationsError("forbidden", "An active organization membership is required.", 403); }
function requireCoordinator(member: Membership) { if (!coordinates(member)) throw new OperationsError("forbidden", "Your account is not authorized to coordinate journeys.", 403); }
function canSeeResource(member: Membership, resource: OperationsResource) {
  return globalAdministrator(member) || member.resource_id === resource.id || resource.ownerId === member.id || (coordinates(member) && (!member.home_scope || member.home_scope === resource.home));
}
function canSeeJourney(member: Membership, journey: Journey, resource: OperationsResource) {
  return canSeeResource(member, resource) || journey.ownerId === member.id || journey.obligations.some(o => [o.ownerId, o.fulfillerId, o.verifierId].includes(member.id));
}
function projectJourney(journey: Journey, member: Membership): Journey {
  return { ...journey, obligations: journey.obligations.map(o => {
    const evidenceAccess = [o.ownerId, o.fulfillerId, o.verifierId].includes(member.id);
    return evidenceAccess ? o : { ...o, evidence: [], decisions: o.decisions.map(d => ({ ...d, evidenceIds: [], reason: "A scoped decision is recorded. Contact the owner for details." })), helpRequests: [], externalReference: null, resolution: null };
  }) };
}
async function readResources(db: OperationsQuery, organizationId: string, member: Membership): Promise<OperationsResource[]> {
  const result = await db.query<{id: string;name: string;home: string;owner_id: string;linked_member_id: string|null;active:boolean}>(`SELECT r.id,r.name,r.home,r.owner_id,m.id AS linked_member_id,(r.active AND h.active) AS active FROM be_resources r JOIN be_homes h ON h.organization_id=r.organization_id AND h.code=r.home LEFT JOIN be_memberships m ON m.organization_id=r.organization_id AND m.resource_id=r.id AND m.active WHERE r.organization_id=$1 AND ($2::boolean OR r.id=$3::uuid OR r.owner_id=$4::uuid OR ($5::boolean AND ($6::text IS NULL OR r.home=$6)) OR EXISTS(SELECT 1 FROM be_journeys j WHERE j.organization_id=r.organization_id AND j.resource_id=r.id AND (j.owner_id=$4 OR EXISTS(SELECT 1 FROM be_obligations o WHERE o.organization_id=j.organization_id AND o.journey_id=j.id AND $4 IN(o.owner_id,o.fulfiller_id,o.verifier_id))))) ORDER BY r.name LIMIT 1001`, [organizationId,globalAdministrator(member),member.resource_id,member.id,coordinates(member),member.home_scope]);
  return result.rows.map(r => ({ id: r.id, name: r.name, home: r.home, ownerId: r.owner_id, linkedMemberId: r.linked_member_id, active:r.active }));
}
async function readJourneys(db: OperationsQuery, organizationId: string, member: Membership): Promise<Journey[]> {
  const result = await db.query<{body: Omit<Journey,"obligations">; obligations: Journey["obligations"]}>(`SELECT j.body,COALESCE((SELECT jsonb_agg(o.body ORDER BY o.created_at,o.id) FROM be_obligations o WHERE o.organization_id=j.organization_id AND o.journey_id=j.id),'[]'::jsonb) AS obligations FROM be_journeys j JOIN be_resources r ON r.organization_id=j.organization_id AND r.id=j.resource_id WHERE j.organization_id=$1 AND ($2::boolean OR j.resource_id=$3::uuid OR j.owner_id=$4::uuid OR r.owner_id=$4 OR ($5::boolean AND ($6::text IS NULL OR r.home=$6)) OR EXISTS(SELECT 1 FROM be_obligations o WHERE o.organization_id=j.organization_id AND o.journey_id=j.id AND $4 IN(o.owner_id,o.fulfiller_id,o.verifier_id))) ORDER BY j.updated_at DESC,j.id LIMIT 201`, [organizationId,globalAdministrator(member),member.resource_id,member.id,coordinates(member),member.home_scope]);
  return result.rows.map(r => ({ ...r.body, obligations: r.obligations }));
}
export async function loadOperations(db: OperationsQuery, member: Membership): Promise<OperationsBootstrap> {
  requireActive(member);
  const org = member.organization_id;
  const now = new Date().toISOString();
  const organization = (await db.query<{id:string;name:string}>("SELECT id,name FROM be_organizations WHERE id=$1", [org])).rows[0];
  if (!organization) throw new OperationsError("not_found", "This organization is unavailable.", 404);
  const resources = await readResources(db, org, member);
  const allJourneys = await readJourneys(db, org, member);
  const visibleJourneys = allJourneys.filter(j => { const r = resources.find(r => r.id === j.scope.resourceId); return r && canSeeJourney(member, j, r); });
  const referencedPeople = new Set(visibleJourneys.map(j => j.scope.resourceId));
  const visibleResources = resources.filter(r => canSeeResource(member, r) || referencedPeople.has(r.id)).slice(0,1000);
  const relevantMemberIds = new Set([member.id,...visibleResources.map(r => r.ownerId),...visibleJourneys.flatMap(j => [j.ownerId,...j.obligations.flatMap(o => [o.ownerId,o.fulfillerId,o.verifierId])])]);
  const allMembers = (await db.query<{id:string;name:string}>("SELECT id,name FROM be_memberships WHERE organization_id=$1 AND active ORDER BY name LIMIT 1000", [org])).rows;
  const saved = (await db.query<{body:JourneyTemplate}>("SELECT body FROM be_templates WHERE organization_id=$1 ORDER BY kind,version DESC", [org])).rows.map(r => r.body);
  const approved = saved.filter(t => t.status === "approved");
  const templates = approved.filter((t,i,a) => a.findIndex(x => x.kind === t.kind) === i);
  if (globalAdministrator(member)) for (const catalog of JOURNEY_TEMPLATE_CATALOG) if (!templates.some(t => t.kind === catalog.kind)) templates.push(saved.find(t => t.kind === catalog.kind) ?? catalog);
  const missions = (await db.query<{id:string;name:string;client_id:string;client_name:string;active:boolean}>("SELECT m.id,m.name,m.client_id,m.client_name,(m.active AND COALESCE(c.active,false)) AS active FROM be_missions m LEFT JOIN be_clients c ON c.organization_id=m.organization_id AND c.id=m.client_id WHERE m.organization_id=$1 ORDER BY m.name LIMIT 1001", [org])).rows.filter(m => coordinates(member) || visibleJourneys.some(j => j.scope.missionId === m.id)).map(m => ({id:m.id,name:m.name,clientId:m.client_id,clientName:m.client_name,active:m.active}));
  const clients = coordinates(member) ? (await db.query<{id:string;name:string}>("SELECT id,name FROM be_clients WHERE organization_id=$1 AND active ORDER BY name LIMIT 1001", [org])).rows : [];
  const homes = coordinates(member) ? (await db.query<{code:string;name:string}>("SELECT code,name FROM be_homes WHERE organization_id=$1 AND active AND ($2::text IS NULL OR code=$2) ORDER BY name LIMIT 1001", [org,member.home_scope])).rows : [];
  const notices = (await db.query<{id:string;journey_id:string;title:string;body:string;published_at:Date|string;acknowledged_at:Date|string|null;revision:number}>(`SELECT n.id,n.journey_id,n.title,n.body,n.published_at,n.revision,a.acknowledged_at FROM be_notices n LEFT JOIN be_acknowledgments a ON a.organization_id=n.organization_id AND a.notice_id=n.id AND a.actor_id=$2 AND a.notice_revision=n.revision WHERE n.organization_id=$1 AND n.resource_id=$3 ORDER BY n.published_at DESC LIMIT 100`, [org,member.id,member.resource_id])).rows.map(n => ({id:n.id,journeyId:n.journey_id,title:n.title,body:n.body,publishedAt:new Date(n.published_at).toISOString(),acknowledgedAt:n.acknowledged_at?new Date(n.acknowledged_at).toISOString():null,revision:n.revision}));
  return {organization,viewer:{id:member.id,name:member.name,role:member.role,resourceId:member.resource_id,canCoordinate:coordinates(member),canApprovePolicies:globalAdministrator(member)},resources:visibleResources,missions:missions.slice(0,1000),clients:clients.slice(0,1000),homes:homes.slice(0,1000),members:coordinates(member)?allMembers:allMembers.filter(m=>relevantMemberIds.has(m.id)),journeys:visibleJourneys.slice(0,200).map(j=>projectJourney(j,member)),readinessByJourney:Object.fromEntries(visibleJourneys.slice(0,200).map(j=>[j.id,evaluateReadiness(j,{now})])),templates:coordinates(member)?templates:[],notices,asOf:now,hasMore:allJourneys.length>200||resources.length>1000||missions.length>1000||clients.length>1000||homes.length>1000};
}
async function activeMember(db: OperationsQuery, org: string, id: string): Promise<Membership> {
  const m = (await db.query<Membership>("SELECT * FROM be_memberships WHERE organization_id=$1 AND id=$2 AND active", [org,id])).rows[0];
  if (!m) throw new OperationsError("invalid_owner", "Choose an active member of this organization.");
  return m;
}
async function writeEvent(db: OperationsQuery, member: Membership, operation: string, payload: unknown, journeyId: string|null = null) {
  await db.query("INSERT INTO be_events (organization_id,id,actor_id,journey_id,operation,payload) VALUES ($1,$2,$3,$4,$5,$6)", [member.organization_id,randomUUID(),member.id,journeyId,operation,JSON.stringify(payload)]);
}
/** Called inside one database transaction after identity, membership, RLS context and origin checks. */
export async function executeOperation(db: OperationsQuery, member: Membership, request: OperationsRequest): Promise<void> {
  requireActive(member);
  const org = member.organization_id, command = request.command, actor = actorFor(member), now = new Date().toISOString();
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${org}:${member.id}:${request.idempotencyKey}`]);
  const receipt = (await db.query<{request_hash:string}>("SELECT request_hash FROM be_receipts WHERE organization_id=$1 AND actor_id=$2 AND idempotency_key=$3", [org,member.id,request.idempotencyKey])).rows[0];
  if (receipt) { if (receipt.request_hash !== hash) throw new OperationsError("idempotency_conflict", "This retry key was already used for a different change.",409); return; }
  switch (command.type) {
    case "create_resource": {
      requireCoordinator(member);
      if (member.home_scope && member.home_scope !== command.home) throw new OperationsError("forbidden","Choose your authorized HOME.",403);
      if (!(await db.query("SELECT id FROM be_homes WHERE organization_id=$1 AND code=$2 AND active FOR SHARE", [org,command.home])).rows.length) throw new OperationsError("invalid_home","Choose an active configured HOME.");
      const id=randomUUID();
      const owner=actorFor(await activeMember(db,org,command.ownerId));
      const targetScope:PermissionScope={organizationId:org,homeId:command.home,resourceId:id};
      if(!owner.grants.some(grant=>["administrator","placement_owner","home_leader","mission_owner"].includes(grant.role)&&Object.entries(grant.scope).every(([key,value])=>value===undefined||targetScope[key as keyof PermissionScope]===value)))throw new OperationsError("invalid_owner_scope","Choose a staffing coordinator authorized for this teammate's HOME.");
      await db.query("INSERT INTO be_resources (organization_id,id,name,home,owner_id) VALUES ($1,$2,$3,$4,$5)",[org,id,command.name,command.home,command.ownerId]);
      await writeEvent(db,member,command.type,{resourceId:id}); break;
    }
    case "create_mission": {
      if(!globalAdministrator(member))throw new OperationsError("forbidden","An organization administrator must register a mission.",403);
      const client=(await db.query<{name:string}>("SELECT name FROM be_clients WHERE organization_id=$1 AND id=$2 AND active FOR SHARE",[org,command.clientId])).rows[0];
      if(!client)throw new OperationsError("invalid_client","Choose an active client in this organization.");
      const id=randomUUID();await db.query("INSERT INTO be_missions (organization_id,id,name,client_id,client_name) VALUES ($1,$2,$3,$4,$5)",[org,id,command.name,command.clientId,client.name]);
      await writeEvent(db,member,command.type,{missionId:id});break;
    }
    case "approve_template": {
      if(!globalAdministrator(member))throw new OperationsError("forbidden","A named organization policy administrator must approve the playbook.",403);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:template:${command.kind}`]);
      if((await db.query("SELECT id FROM be_templates WHERE organization_id=$1 AND kind=$2 LIMIT 1",[org,command.kind])).rows.length)throw new OperationsError("configured_playbook","This journey kind already has a configured playbook. Review or approve its next version in Administration.");
      const source=JOURNEY_TEMPLATE_CATALOG.find(t=>t.kind===command.kind)!;
      const version=Number((await db.query<{version:number}>("SELECT COALESCE(MAX(version),0)+1 AS version FROM be_templates WHERE organization_id=$1 AND kind=$2",[org,command.kind])).rows[0].version);
      const template=approveJourneyTemplate({...structuredClone(source),id:randomUUID(),version,sourceReference:command.sourceReference,requirements:source.requirements.map(r=>({...r,version,sourceReference:command.sourceReference}))},{actor,scope:{organizationId:org},policyOwnerId:member.id,now});
      await db.query("INSERT INTO be_templates (organization_id,id,kind,version,status,policy_owner_id,body) VALUES ($1,$2,$3,$4,'approved',$5,$6)",[org,template.id,template.kind,version,member.id,JSON.stringify(template)]);
      await writeEvent(db,member,command.type,{templateId:template.id,version});break;
    }
    case "create_journey": {
      requireCoordinator(member);
      const resource=(await readResources(db,org,member)).find(r=>r.id===command.resourceId);
      if(!resource||!canSeeResource(member,resource))throw new OperationsError("not_found","That teammate is not available in your scope.",404);
      const home=(await db.query("SELECT id FROM be_homes WHERE organization_id=$1 AND code=$2 AND active FOR SHARE",[org,resource.home])).rows[0];
      const lockedResource=(await db.query<{name:string;home:string;owner_id:string;active:boolean}>("SELECT name,home,owner_id,active FROM be_resources WHERE organization_id=$1 AND id=$2 FOR SHARE",[org,resource.id])).rows[0];
      if(!home||!lockedResource?.active)throw new OperationsError("inactive_resource","Choose an active teammate in an active HOME.");
      if(lockedResource.home!==resource.home)throw new OperationsError("conflict","This teammate's HOME changed. Reload before creating their journey.",409);
      Object.assign(resource,{name:lockedResource.name,ownerId:lockedResource.owner_id,active:lockedResource.active});
      if(!canSeeResource(member,resource))throw new OperationsError("not_found","That teammate is not available in your scope.",404);
      const template=(await db.query<{body:JourneyTemplate}>("SELECT body FROM be_templates WHERE organization_id=$1 AND id=$2 AND status='approved' FOR SHARE",[org,command.templateId])).rows[0]?.body;
      if(!template)throw new OperationsError("unapproved_template","Choose an approved playbook before creating this journey.");
      const activeRequirements=template.requirements.filter(requirement=>requirement.active);
      if(Object.keys(command.owners??{}).some(id=>!activeRequirements.some(requirement=>requirement.id===id)))throw new OperationsError("invalid_owners","An ownership override must name an active requirement in the approved playbook.");
      const effectiveOwners=Object.fromEntries(activeRequirements.map(requirement=>[requirement.id,command.owners?.[requirement.id]??{ownerId:command.ownerId,fulfillerId:command.fulfillerId,verifierId:command.verifierId}]));
      const participantIds=[...new Set([command.ownerId,...Object.values(effectiveOwners).flatMap(owners=>[owners.ownerId,owners.fulfillerId,owners.verifierId])])];
      const participants=new Map((await Promise.all(participantIds.map(id=>activeMember(db,org,id)))).map(participant=>[participant.id,participant]));
      const scope:Journey["scope"]={organizationId:org,resourceId:resource.id,homeId:resource.home};
      if(template.kind.startsWith("mission")) {
        if(!command.missionId||!command.assignmentReference)throw new OperationsError("invalid_scope","A mission and authoritative assignment reference are required.");
        const identified=(await db.query<{client_id:string}>("SELECT client_id FROM be_missions WHERE organization_id=$1 AND id=$2",[org,command.missionId])).rows[0];
        if(!identified)throw new OperationsError("not_found","That mission is unavailable.",404);
        const client=(await db.query("SELECT id FROM be_clients WHERE organization_id=$1 AND id=$2 AND active FOR SHARE",[org,identified.client_id])).rows[0];
        const mission=(await db.query<{client_id:string;active:boolean}>("SELECT client_id,active FROM be_missions WHERE organization_id=$1 AND id=$2 FOR SHARE",[org,command.missionId])).rows[0];
        if(!client||!mission?.active)throw new OperationsError("not_found","That mission or client is archived.",404);
        if(mission.client_id!==identified.client_id)throw new OperationsError("conflict","This mission's client changed. Reload before creating its journey.",409);
        scope.missionId=command.missionId;
        scope.clientId=mission.client_id;
        scope.assignmentId=(await db.query<{id:string}>("INSERT INTO be_assignment_references (organization_id,id,resource_id,mission_id,source_reference) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id,resource_id,mission_id,source_reference) DO UPDATE SET source_reference=EXCLUDED.source_reference RETURNING id",[org,randomUUID(),resource.id,command.missionId,command.assignmentReference])).rows[0].id;
      } else if(command.missionId||command.assignmentReference)throw new OperationsError("invalid_scope","Company journeys must remain separate from a specific mission.");
      const fits=(s:PermissionScope)=>Object.entries(s).every(([k,v])=>v===undefined||scope[k as keyof PermissionScope]===v);
      const mayOperate=(id:string)=>actorFor(participants.get(id)!).grants.some(grant=>fits(grant.scope));
      if(!mayOperate(command.ownerId))throw new OperationsError("invalid_owner_scope","Choose a journey owner authorized for this teammate's HOME or scope.");
      for(const requirement of activeRequirements){
        const owners=effectiveOwners[requirement.id];
        if(!mayOperate(owners.ownerId))throw new OperationsError("invalid_owner_scope",`${requirement.title}: choose an owner authorized for this teammate's scope.`);
        if(!mayOperate(owners.fulfillerId))throw new OperationsError("invalid_fulfiller_scope",`${requirement.title}: choose the teammate or a fulfiller authorized for this scope.`);
        const verifier=participants.get(owners.verifierId)!;
        if(verifier.resource_id===resource.id||verifier.id===owners.fulfillerId)throw new OperationsError("invalid_verifier",`${requirement.title}: choose a verifier independent from the teammate and fulfiller.`);
        if(!actorFor(verifier).grants.some(grant=>grant.role===requirement.approverRole&&fits(grant.scope)))throw new OperationsError("invalid_verifier",`${requirement.title}: this verifier needs explicit scoped ${requirement.approverRole} authority.`);
      }
      const id=randomUUID();
      const journey=instantiateJourney({id,template,scope,actor,now,ownerId:command.ownerId,owners:effectiveOwners,obligationIds:Object.fromEntries(activeRequirements.map(r=>[r.id,randomUUID()])),triggerOccurrenceId:id,openingAt:command.openingAt,releaseAt:command.releaseAt,closeoutAt:command.closeoutAt});
      const {obligations,...body}=journey;
      await db.query("INSERT INTO be_journeys (organization_id,id,resource_id,mission_id,assignment_id,owner_id,template_id,kind,revision,body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)",[org,id,resource.id,scope.missionId??null,scope.assignmentId??null,command.ownerId,template.id,template.kind,JSON.stringify(body)]);
      for(const o of obligations) await db.query("INSERT INTO be_obligations (organization_id,id,journey_id,owner_id,fulfiller_id,verifier_id,instance_key,revision,status,body) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9)",[org,o.id,id,o.ownerId,o.fulfillerId,o.verifierId,o.instanceKey,o.status,JSON.stringify(o)]);
      await db.query("INSERT INTO be_notices (organization_id,id,resource_id,journey_id,title,body,revision) VALUES ($1,$2,$3,$4,$5,$6,1)",[org,randomUUID(),resource.id,id,`${template.name}: your plan is ready`,`Your journey has a named owner, ${participants.get(command.ownerId)!.name}. Review the preparation and closeout details, and use I need help whenever something is unclear. This notice does not change your employment or staffing.`]);
      await writeEvent(db,member,command.type,{templateId:template.id,templateVersion:template.version,resourceId:resource.id},id);break;
    }
    case "obligation": {
      const row=(await db.query<{body:Omit<Journey,"obligations">}>("SELECT body FROM be_journeys WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,command.journeyId])).rows[0];
      if(!row)throw new OperationsError("not_found","That journey is unavailable.",404);
      const obligations=(await db.query<{body:Journey["obligations"][number]}>("SELECT body FROM be_obligations WHERE organization_id=$1 AND journey_id=$2 FOR UPDATE",[org,command.journeyId])).rows.map(r=>r.body);
      const current=obligations.find(o=>o.id===command.obligationId);
      if(!current)throw new OperationsError("not_found","That requirement is unavailable.",404);
      const {obligation,event}=transitionObligation(current,command.command,{actor,expectedRevision:command.expectedRevision,now,relatedObligations:obligations});
      await db.query("UPDATE be_obligations SET body=$3,status=$4,revision=$5,updated_at=$6 WHERE organization_id=$1 AND id=$2 AND revision=$7",[org,current.id,JSON.stringify(obligation),obligation.status,obligation.revision,now,current.revision]);
      const body={...row.body,revision:row.body.revision+1,updatedAt:now,updatedBy:member.id};
      await db.query("UPDATE be_journeys SET body=$3,revision=$4,updated_at=$5 WHERE organization_id=$1 AND id=$2",[org,command.journeyId,JSON.stringify(body),body.revision,now]);
      await writeEvent(db,member,command.command.type,event,command.journeyId);break;
    }
    case "acknowledge_notice": {
      const notice=(await db.query<{resource_id:string;revision:number;journey_id:string}>("SELECT resource_id,revision,journey_id FROM be_notices WHERE organization_id=$1 AND id=$2 FOR SHARE",[org,command.noticeId])).rows[0];
      if(!notice||notice.resource_id!==member.resource_id)throw new OperationsError("not_found","This notice is not addressed to you.",404);
      if(notice.revision!==command.expectedRevision)throw new OperationsError("conflict","The notice changed. Review its current version before acknowledging.",409);
      await db.query("INSERT INTO be_acknowledgments (organization_id,notice_id,actor_id,notice_revision) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",[org,command.noticeId,member.id,command.expectedRevision]);
      await writeEvent(db,member,command.type,{noticeId:command.noticeId,revision:notice.revision},notice.journey_id);break;
    }
  }
  await db.query("INSERT INTO be_receipts (organization_id,actor_id,idempotency_key,request_hash,response) VALUES ($1,$2,$3,$4,$5)",[org,member.id,request.idempotencyKey,hash,JSON.stringify({accepted:true})]);
}
