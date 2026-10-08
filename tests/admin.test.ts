import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { executeAdmin, loadAdmin } from "../lib/admin/service";
import { adminRequestSchema } from "../lib/admin/validation";
import type { AdminCommand, AdminMember } from "../lib/admin/contracts";
import { executeOperation, loadOperations, type Membership, type OperationsQuery } from "../lib/operations/service";
import { operationsRequestSchema } from "../lib/operations/validation";
import type { OperationsCommand } from "../lib/operations/contracts";
import { getJourneyTemplate } from "../lib/journeys/templates";
import type { EngagementPlan } from "../lib/admin/engagement";

const migrations = new URL("../db/migrations/", import.meta.url);
const issuer = "https://identity.example.test/synthetic";
function code(expected: string) { return (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === expected; }
async function fixture() {
  const db = new PGlite();
  for (const file of (await readdir(migrations)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file, migrations), "utf8"));
  const org = randomUUID(), otherOrg = randomUUID(), resourceId = randomUUID();
  const member = (name: string, role: Membership["role"], extra: Partial<Membership> = {}): Membership => ({ id: randomUUID(), organization_id: org, issuer, subject: randomUUID(), name, role, home_scope: null, resource_id: null, grants: [], active: true, ...extra });
  const admin = member("Synthetic administrator", "administrator");
  const reviewer = member("Synthetic independent reviewer", "mission_owner", { grants: ["asset_access_owner", "administrator"].map(role => ({ role: role as "asset_access_owner" | "administrator", scope: { organizationId: org } })) });
  const worker = member("Synthetic teammate", "resource");
  const foreign = member("Synthetic other organization administrator", "administrator", { organization_id: otherOrg });
  await db.query("INSERT INTO be_organizations(id,name) VALUES($1,'Synthetic operations'),($2,'Synthetic other organization')", [org,otherOrg]);
  await db.query("INSERT INTO be_homes(organization_id,id,code,name) VALUES($1,$3,'Data','Data'),($1,$4,'AI','Artificial Intelligence'),($2,$5,'Data','Other Data')", [org,otherOrg,randomUUID(),randomUUID(),randomUUID()]);
  for (const m of [admin,reviewer,worker,foreign]) await db.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role,grants) VALUES($1,$2,$3,$4,$5,$6,$7)", [m.id,m.organization_id,m.issuer,m.subject,m.name,m.role,JSON.stringify(m.grants)]);
  await db.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES($1,$2,'Synthetic teammate','Data',$3)", [org,resourceId,admin.id]);
  await db.query("UPDATE be_memberships SET resource_id=$2 WHERE id=$1", [worker.id,resourceId]); worker.resource_id = resourceId;
  async function transaction<T>(acting: Membership, work: (query: OperationsQuery) => Promise<T>) {
    return db.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE be_runtime");
      await tx.query("SELECT set_config('bookends.organization_id',$1,true),set_config('bookends.actor_id',$2,true),set_config('bookends.issuer',$3,true),set_config('bookends.subject',$4,true)", [acting.organization_id,acting.id,acting.issuer,acting.subject]);
      return work(tx as unknown as OperationsQuery);
    });
  }
  const load = (acting=admin) => transaction(acting, query => loadAdmin(query,acting));
  const operations = (acting=admin) => transaction(acting, query => loadOperations(query,acting));
  const execute = (command: AdminCommand, key=randomUUID(), acting=admin) => transaction(acting, query => executeAdmin(query,acting,adminRequestSchema.parse({idempotencyKey:key,command})));
  const operation = (command: OperationsCommand, acting=admin) => transaction(acting, query => executeOperation(query,acting,operationsRequestSchema.parse({idempotencyKey:randomUUID(),command})));
  async function client(name="Synthetic client", clientCode="synthetic-client") {
    await execute({type:"save_client",name,code:clientCode,contactName:"Synthetic contact",contactEmail:"synthetic@example.test",notes:"Private synthetic client note"});
    return (await load()).clients.find(c=>c.code===clientCode)!;
  }
  async function playbook() {
    const catalog=getJourneyTemplate("mission_onboarding");
    await execute({type:"save_playbook",kind:catalog.kind,name:"Our welcoming arrival",description:catalog.description,sourceReference:"policy://synthetic/approved-source",requirements:catalog.requirements});
    const draft=(await load()).templates.find(t=>t.persisted)!;
    await execute({type:"approve_playbook",id:draft.id,expectedRevision:draft.revision});
    return (await load()).templates.find(t=>t.id===draft.id)!;
  }
  async function journey() {
    const c=await client(), template=await playbook();
    await execute({type:"save_mission",name:"Synthetic mission",clientId:c.id});
    const mission=(await load()).missions[0];
    await operation({type:"create_journey",resourceId,templateId:template.id,missionId:mission.id,assignmentReference:"assignment://synthetic/approved/1",ownerId:admin.id,fulfillerId:worker.id,verifierId:reviewer.id,openingAt:null,releaseAt:null,closeoutAt:null});
    return {client:c,template,mission,journey:(await operations()).journeys[0]};
  }
  return {db,org,otherOrg,admin,reviewer,worker,foreign,resourceId,transaction,load,operations,execute,operation,client,playbook,journey};
}

test("administration requires the primary unscoped administrator and returns only same-organization safe projections", async t => {
  const f=await fixture();t.after(()=>f.db.close());
  await f.client();
  const data=await f.load();
  assert.equal(data.viewer.id,f.admin.id);
  assert.equal(data.templates.filter(t=>!t.persisted).length,4);
  assert.equal(JSON.stringify(data).includes(issuer),false);
  assert.equal(JSON.stringify(data).includes(f.worker.subject),false);
  assert.deepEqual((await f.load(f.foreign)).clients,[]);
  for(const actor of [f.worker,f.reviewer,{...f.admin,home_scope:"Data"},{...f.admin,active:false}]) {
    await assert.rejects(f.load(actor),code("forbidden"));
    await assert.rejects(f.execute({type:"set_organization",name:"Unauthorized",expectedRevision:1},randomUUID(),actor),code("forbidden"));
  }
  await f.execute({type:"set_organization",name:"Clear new display name",expectedRevision:1});
  assert.equal((await f.load()).organization.name,"Clear new display name");
  await assert.rejects(f.execute({type:"set_organization",name:"Stale",expectedRevision:1}),code("conflict"));
});

test("clients support audited idempotent edits, stable codes, active dependencies, and retained archive history", async t => {
  const f=await fixture();t.after(()=>f.db.close());
  const client=await f.client();
  const edit:AdminCommand={type:"save_client",id:client.id,expectedRevision:1,name:"Renamed client",code:client.code,contactName:"New contact",contactEmail:"new@example.test",notes:"Private updated note"};
  const key=randomUUID();await f.execute(edit,key);await f.execute(edit,key);
  assert.equal((await f.load()).clients[0].revision,2);
  assert.equal((await f.db.query<{count:number}>("SELECT count(*)::int AS count FROM be_events WHERE operation='admin.save_client'")).rows[0].count,2);
  const events=JSON.stringify((await f.db.query("SELECT payload FROM be_events")).rows);
  assert.equal(events.includes("Private"),false);assert.equal(events.includes("new@example"),false);
  await assert.rejects(f.execute(edit),code("conflict"));
  await assert.rejects(f.execute({...edit,name:"Other"},key),code("idempotency_conflict"));
  await assert.rejects(f.execute({...edit,expectedRevision:2,code:"changed"}),code("immutable_code"));
  await f.operation({type:"create_mission",name:"Configured mission",clientId:client.id});
  let mission=(await f.load()).missions[0];
  await assert.rejects(f.execute({type:"set_client_active",id:client.id,expectedRevision:2,active:false}),code("active_dependents"));
  await f.execute({...edit,expectedRevision:2,name:"Client final name"});
  assert.equal((await f.operations()).missions[0].clientName,"Client final name");
  mission=(await f.load()).missions[0];
  await f.execute({type:"set_mission_active",id:mission.id,expectedRevision:mission.revision,active:false});
  await f.execute({type:"set_client_active",id:client.id,expectedRevision:3,active:false});
  assert.equal((await f.load()).clients[0].active,false);
  assert.deepEqual((await f.operations()).clients,[]);
  await assert.rejects(f.operation({type:"create_mission",name:"Archived client mission",clientId:client.id}),code("invalid_client"));
  await assert.rejects(f.execute({type:"set_mission_active",id:mission.id,expectedRevision:mission.revision+1,active:true}),code("invalid_client"));
  await f.execute({type:"set_client_active",id:client.id,expectedRevision:4,active:true});
  await f.execute({type:"set_mission_active",id:mission.id,expectedRevision:mission.revision+1,active:true});
  assert.equal((await f.operations()).missions[0].active,true);
});

test("HOME and client scope cannot rewrite existing journey history, while archived journeys stay visible", async t => {
  const f=await fixture();t.after(()=>f.db.close());
  const current=await f.journey();
  assert.equal(current.journey.scope.clientId,current.client.id);
  const otherClient=await f.client("Other client","other-client");
  await assert.rejects(f.execute({type:"save_mission",id:current.mission.id,expectedRevision:1,name:"Moved mission",clientId:otherClient.id}),code("historical_scope"));
  await assert.rejects(f.execute({type:"save_resource",id:f.resourceId,expectedRevision:1,name:"Moved teammate",home:"AI",ownerId:f.admin.id}),code("historical_scope"));
  await assert.rejects(f.operation({type:"create_resource",name:"Unknown HOME",home:"Unconfigured",ownerId:f.admin.id}),code("invalid_home"));
  await assert.rejects(f.execute({type:"save_resource",name:"Wrong owner",home:"Data",ownerId:f.worker.id}),code("invalid_owner_scope"));
  const dataHome=(await f.load()).homes.find(h=>h.code==="Data")!;
  await assert.rejects(f.execute({type:"set_home_active",id:dataHome.id,expectedRevision:1,active:false}),code("active_dependents"));
  await f.execute({type:"set_resource_active",id:f.resourceId,expectedRevision:1,active:false});
  const retained=await f.operations();
  assert.equal(retained.resources.find(r=>r.id===f.resourceId)!.active,false);
  assert.deepEqual(retained.journeys[0],current.journey);
  await assert.rejects(f.operation({type:"create_journey",resourceId:f.resourceId,templateId:current.template.id,missionId:current.mission.id,assignmentReference:"another",ownerId:f.admin.id,fulfillerId:f.worker.id,verifierId:f.reviewer.id,openingAt:null,releaseAt:null,closeoutAt:null}),code("inactive_resource"));
  await f.execute({type:"save_home",code:"New",name:"A new HOME",description:"A new practice"});
  const newHome=(await f.load()).homes.find(h=>h.code==="New")!;
  await f.execute({type:"save_home",id:newHome.id,expectedRevision:1,code:"New",name:"Renamed HOME",description:"Clear description"});
  await f.execute({type:"set_home_active",id:newHome.id,expectedRevision:2,active:false});
  assert.equal((await f.operations()).homes.some(h=>h.code==="New"),false);
});

test("playbook edits produce reviewed versions without changing accepted instances or silently restoring retired policy", async t => {
  const f=await fixture();t.after(()=>f.db.close());
  const original=await f.journey();
  const requirements=structuredClone(original.template.requirements);
  requirements[0].title="A warmer welcome";
  requirements[0].overridePolicy={allowed:false,approverRoles:[],evidenceRequired:false};
  await f.execute({type:"save_playbook",id:original.template.id,expectedRevision:original.template.revision,kind:original.template.kind,name:"New welcoming experience",description:original.template.description,sourceReference:"policy://synthetic/v2",requirements});
  let data=await f.load();
  const draft=data.templates.find(t=>t.kind===original.template.kind&&t.status==="draft")!;
  assert.equal(draft.version,2);assert.equal(draft.approvedBy,null);
  assert.equal((await f.operations()).templates.find(t=>t.kind===draft.kind)!.version,1);
  await assert.rejects(f.operation({type:"approve_template",kind:draft.kind,sourceReference:"catalog reset"}),code("configured_playbook"));
  await f.execute({type:"approve_playbook",id:draft.id,expectedRevision:draft.revision});
  data=await f.load();
  assert.equal(data.templates.find(t=>t.id===original.template.id)!.status,"retired");
  assert.equal((await f.operations()).templates.find(t=>t.kind===draft.kind)!.version,2);
  assert.deepEqual((await f.operations()).journeys[0],original.journey);
  const approved=data.templates.find(t=>t.id===draft.id)!;
  await f.execute({type:"retire_playbook",id:approved.id,expectedRevision:approved.revision});
  assert.equal((await f.operations()).templates.find(t=>t.kind===draft.kind)!.status,"retired");
  await assert.rejects(f.operation({type:"create_journey",resourceId:f.resourceId,templateId:original.template.id,missionId:original.mission.id,assignmentReference:"another",ownerId:f.admin.id,fulfillerId:f.worker.id,verifierId:f.reviewer.id,openingAt:null,releaseAt:null,closeoutAt:null}),code("unapproved_template"));
});

test("verified membership links preserve exact subject and allow revocation after a teammate is archived", async t => {
  const f=await fixture();t.after(()=>f.db.close());
  const subject=" exact-verified-subject ";
  await f.execute({type:"create_member",subject,identityVerified:true,name:"New HOME leader",role:"home_leader",homeScope:"Data",resourceId:null,grants:[]});
  const created=(await f.load()).members.find(m=>m.name==="New HOME leader")!;
  const identity=(await f.db.query<{issuer:string;subject:string}>("SELECT issuer,subject FROM be_memberships WHERE id=$1",[created.id])).rows[0];
  assert.deepEqual(identity,{issuer,subject});
  const modify=(m:AdminMember,patch:Partial<AdminMember>={}):AdminCommand=>({type:"update_member",id:m.id,expectedRevision:m.revision,name:m.name,role:m.role,resourceId:m.resourceId,homeScope:m.homeScope,grants:m.grants,active:m.active,...patch});
  const own=(await f.load()).members.find(m=>m.id===f.admin.id)!;
  await assert.rejects(f.execute(modify(own,{active:false})),code("forbidden"));
  await assert.rejects(f.execute(modify(created,{homeScope:"NotConfigured"})),code("invalid_home"));
  await f.execute({type:"set_resource_active",id:f.resourceId,expectedRevision:1,active:false});
  const worker=(await f.load()).members.find(m=>m.id===f.worker.id)!;
  const key=randomUUID(), revoke=modify(worker,{active:false});
  await f.execute(revoke,key);await f.execute(revoke,key);
  assert.equal((await f.load()).members.find(m=>m.id===f.worker.id)!.active,false);
  await assert.rejects(f.execute(revoke),code("conflict"));
  await assert.rejects(f.execute(modify({...worker,revision:2},{active:true})),code("invalid_resource"));
});

test("admin request validation rejects invented authority and malformed changes while preserving safe editor defaults", () => {
  const valid={idempotencyKey:randomUUID(),command:{type:"save_home",code:"Data",name:"Data",description:""}};
  for(const command of [{...valid.command,expectedRevision:1},{...valid.command,id:randomUUID()},{...valid.command,organizationId:randomUUID()},{...valid.command,name:"bad\u0000name"},{...valid.command,id:randomUUID(),expectedRevision:2_147_483_648}]) assert.equal(adminRequestSchema.safeParse({...valid,command}).success,false);
  const member={type:"create_member",subject:"exact",identityVerified:true,name:"New identity",role:"administrator",resourceId:null,homeScope:null,grants:[]};
  for(const patch of [{issuer:"https://attacker.example"},{identityVerified:false},{subject:"invalid\nsubject"}]) assert.equal(adminRequestSchema.safeParse({...valid,command:{...member,...patch}}).success,false);
  const catalog=getJourneyTemplate("mission_onboarding");
  const command={type:"save_playbook",kind:catalog.kind,name:catalog.name,description:catalog.description,sourceReference:catalog.sourceReference,requirements:catalog.requirements};
  command.requirements[0].overridePolicy={allowed:false,approverRoles:[],evidenceRequired:false};
  assert.equal(adminRequestSchema.safeParse({...valid,command}).success,true);
  command.requirements[0].overridePolicy.allowed=true;
  assert.equal(adminRequestSchema.safeParse({...valid,command}).success,false);
});

test("playbook approval rejects inactive prerequisites before a policy can become binding", async t => {
  const f=await fixture();t.after(()=>f.db.close());
  const catalog=getJourneyTemplate("mission_onboarding");
  catalog.requirements[0].active=false;
  catalog.requirements[1].prerequisiteTemplateIds=[catalog.requirements[0].id];
  await assert.rejects(f.execute({type:"save_playbook",kind:catalog.kind,name:catalog.name,description:catalog.description,sourceReference:catalog.sourceReference,requirements:catalog.requirements}),code("invalid"));
  assert.equal((await f.load()).templates.some(t=>t.persisted),false);
});

test("admin bootstrap announces capped configuration lists", async t => {
  const f=await fixture();t.after(()=>f.db.close());
  await f.db.query("INSERT INTO be_clients(organization_id,id,code,name) SELECT $1,gen_random_uuid(),'synthetic-'||n,'Synthetic '||n FROM generate_series(1,1001) n",[f.org]);
  const data=await f.load();assert.equal(data.clients.length,1000);assert.equal(data.hasMore,true);
});

test("SOW plans and delivery profiles persist with revisions, safe legacy edits and idempotent audit", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const client = await f.client();
  const engagement: EngagementPlan = { version: 1, sowReference: "SOW-2030", status: "signed", signedOn: "2029-11-10", start: "2030-01-01", end: "2032-06-30", outcomes: "Private application delivery outcome", roles: [{ id: randomUUID(), name: "BA / PM", headcount: 1, allocationPercent: 50, skills: ["Agile", "Requirements"], responsibilities: "Boards, ceremonies and light testing", start: "2030-01-01", end: "2032-06-30" }] };
  const key = randomUUID(), create: AdminCommand = { type: "save_mission", name: "Application build", clientId: client.id, engagement };
  await f.execute(create, key); await f.execute(create, key);
  let mission = (await f.load()).missions[0];
  assert.equal((await f.load()).missions.length, 1); assert.equal(mission.revision, 1);
  assert.deepEqual(mission.engagement, engagement);
  await f.execute({ type: "save_mission", id: mission.id, expectedRevision: 1, name: "Renamed build", clientId: client.id });
  mission = (await f.load()).missions[0];
  assert.deepEqual(mission.engagement, engagement); assert.equal(mission.revision, 2);
  await assert.rejects(f.execute({ type: "save_mission", id: mission.id, expectedRevision: 1, name: "Stale", clientId: client.id, engagement }), code("conflict"));
  const profile = { roles: ["BA / PM"], skills: ["Agile", "Requirements", "Testing"] };
  await f.execute({ type: "save_resource", id: f.resourceId, expectedRevision: 1, name: "Synthetic teammate", home: "Data", ownerId: f.admin.id, profile });
  await f.execute({ type: "save_resource", id: f.resourceId, expectedRevision: 2, name: "Renamed teammate", home: "Data", ownerId: f.admin.id });
  const resource = (await f.load()).resources[0];
  assert.equal(resource.revision, 3); assert.deepEqual(resource.profile, profile);
  const events = JSON.stringify((await f.db.query("SELECT payload FROM be_events")).rows);
  assert.equal(events.includes(engagement.outcomes), false); assert.equal(events.includes("Requirements"), false);
  assert.deepEqual((await f.load(f.foreign)).missions, []); assert.deepEqual((await f.load(f.foreign)).resources, []);
  assert.equal((await f.operations()).journeys.length, 0, "Demand and skill changes never create staffing or journeys.");
});

test("engagement and profile storage retains organization isolation and rejects malformed bodies", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const client = await f.client();
  await f.execute({ type: "save_mission", name: "Existing legacy mission", clientId: client.id });
  const mission = (await f.load()).missions[0];
  assert.equal(mission.engagement, undefined); assert.equal((await f.load()).resources[0].profile, undefined);
  await assert.rejects(f.execute({ type: "save_mission", id: mission.id, expectedRevision: 1, name: "Foreign", clientId: client.id }, randomUUID(), f.foreign), code("invalid_client"));
  await assert.rejects(f.execute({ type: "save_resource", id: f.resourceId, expectedRevision: 1, name: "Foreign", home: "Data", ownerId: f.foreign.id, profile: { roles: [], skills: [] } }, randomUUID(), f.foreign), code("not_found"));
  await assert.rejects(f.execute({ type: "save_mission", name: "No authority", clientId: client.id }, randomUUID(), f.reviewer), code("forbidden"));
  const foreignUpdate = await f.transaction(f.foreign, db => db.query("UPDATE be_missions SET engagement=$1 WHERE id=$2 RETURNING id", [JSON.stringify({ version: 1, status: "draft", roles: [{}] }), mission.id]));
  assert.deepEqual(foreignUpdate.rows, []);
  await assert.rejects(f.db.query("UPDATE be_missions SET engagement='{}'::jsonb WHERE id=$1", [mission.id]), code("23514"));
  await assert.rejects(f.db.query("UPDATE be_resources SET profile='{}'::jsonb WHERE id=$1", [f.resourceId]), code("23514"));
});

test("shared role and skill catalogs preserve aliases with scoped revision-checked administration", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const key = randomUUID(), create: AdminCommand = { type: "save_capability", kind: "role", name: "Business analyst", description: "Requirements" };
  await f.execute(create, key); await f.execute(create, key);
  let item = (await f.load()).capabilities![0];
  assert.equal(item.revision, 1); assert.deepEqual(item.aliases, []);
  await f.execute({ type: "save_capability", id: item.id, expectedRevision: 1, kind: "role", name: "BA / PM", description: "Requirements and delivery" });
  item = (await f.load()).capabilities![0];
  assert.equal(item.revision, 2); assert.deepEqual(item.aliases, ["Business analyst"]);
  await assert.rejects(f.execute({ type: "save_capability", kind: "role", name: "BUSINESS ANALYST", description: "Duplicate former name" }), code("duplicate"));
  await assert.rejects(f.execute({ type: "save_capability", id: item.id, expectedRevision: 2, kind: "skill", name: "BA / PM", description: "Changed kind" }), code("immutable_kind"));
  await assert.rejects(f.execute({ type: "save_capability", id: item.id, expectedRevision: 1, kind: "role", name: "Stale", description: "" }), code("conflict"));
  await f.execute({ type: "set_capability_active", id: item.id, expectedRevision: 2, active: false });
  await assert.rejects(f.execute(create), code("duplicate"));
  await f.execute({ type: "save_capability", id: item.id, expectedRevision: 3, kind: "role", name: "Business analyst", description: "Rename back" });
  item = (await f.load()).capabilities![0];
  assert.equal(item.active, false); assert.deepEqual(item.aliases, ["BA / PM"]);
  await f.execute({ type: "save_capability", kind: "skill", name: "Business analyst", description: "A separate skill identity" });
  assert.equal((await f.load()).capabilities!.length, 2);
  assert.deepEqual((await f.load(f.foreign)).capabilities, []);
  await assert.rejects(f.execute({ type: "set_capability_active", id: item.id, expectedRevision: 4, active: true }, randomUUID(), f.foreign), code("not_found"));
  await assert.rejects(f.execute(create, randomUUID(), f.reviewer), code("forbidden"));
  await assert.rejects(f.transaction(f.admin, db => db.query("DELETE FROM be_capabilities WHERE id=$1", [item.id])), code("42501"));
  await assert.rejects(f.db.query("UPDATE be_capabilities SET kind='skill' WHERE id=$1", [item.id]), code("22023"));
});

test("proposed team choices persist without assignments, reject foreign or inactive additions and retain archived history", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const client = await f.client(), foreignId = randomUUID();
  await f.db.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES($1,$2,'Foreign teammate','Data',$3)", [f.otherOrg, foreignId, f.foreign.id]);
  const engagement: EngagementPlan = { version: 1, source: "direct", sowReference: "", signedOn: null, status: "draft", start: "2030-01-01", end: "2030-12-31", outcomes: "Known team", roles: [{ id: randomUUID(), name: "Data engineer", headcount: 1, allocationPercent: 75, skills: [], responsibilities: "Delivery", start: "2030-01-01", end: "2030-12-31", selectedResourceIds: [f.resourceId] }] };
  const create: AdminCommand = { type: "save_mission", name: "Direct workstream", clientId: client.id, engagement };
  for (const unknown of [randomUUID(), foreignId]) await assert.rejects(f.execute({ ...create, engagement: { ...engagement, roles: [{ ...engagement.roles[0], selectedResourceIds: [unknown] }] } }), code("missing_resource"));
  await f.execute(create);
  let mission = (await f.load()).missions[0];
  assert.deepEqual(mission.engagement, engagement);
  await f.execute({ type: "set_resource_active", id: f.resourceId, expectedRevision: 1, active: false });
  await f.execute({ type: "save_mission", id: mission.id, expectedRevision: 1, name: "Retained plan", clientId: client.id });
  mission = (await f.load()).missions[0];
  assert.deepEqual(mission.engagement, engagement);
  await f.execute({ type: "save_mission", id: mission.id, expectedRevision: mission.revision, name: mission.name, clientId: client.id, engagement: { ...engagement, outcomes: "Updated brief" } });
  mission = (await f.load()).missions[0];
  await assert.rejects(f.execute(create), code("inactive_resource"));
  await assert.rejects(f.execute({ type: "save_mission", id: mission.id, expectedRevision: mission.revision, name: mission.name, clientId: client.id, engagement: { ...engagement, roles: [{ ...engagement.roles[0], id: randomUUID() }] } }), code("inactive_resource"));
  assert.deepEqual((await f.load(f.foreign)).missions, []);
  assert.equal((await f.operations()).journeys.length, 0);
  assert.equal((await f.db.query<{ count: number }>("SELECT count(*)::int AS count FROM be_assignment_references")).rows[0].count, 0);
});
