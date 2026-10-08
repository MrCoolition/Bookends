import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLocalAdminCommand, createLocalAdminStore, parseLocalAdminCommand, parseLocalAdminStore, LOCAL_ADMIN_OWNER_ID, MAX_LOCAL_ADMIN_BYTES, type LocalAdminCommand } from "../lib/admin/local";
import type { AdminPlaybook } from "../lib/admin/contracts";
import { adminRequestSchema } from "../lib/admin/validation";

function code(expected: string) { return (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === expected; }
function fixture() {
  let state = createLocalAdminStore();
  const apply = (command: LocalAdminCommand) => { state = applyLocalAdminCommand(state, command); return state; };
  apply({type:"save_home",code:"Data",name:"Data practice",description:"Our local practice"});
  apply({type:"save_client",code:"first-client",name:"First client",contactName:"Client contact",contactEmail:"contact@example.test",notes:"Planning locally"});
  apply({type:"save_resource",name:"First teammate",home:"Data",ownerId:LOCAL_ADMIN_OWNER_ID});
  apply({type:"save_mission",name:"First mission",clientId:state.data.clients[0].id});
  return { get state() { return state; }, apply };
}
function savePlaybook(template: AdminPlaybook): LocalAdminCommand {
  return {type:"save_playbook",...(template.persisted?{id:template.id,expectedRevision:template.revision}:{}),kind:template.kind,name:template.name,description:template.description,sourceReference:template.sourceReference,requirements:template.requirements};
}

test("local administration starts with empty business records and an explicitly local owner", () => {
  const store=createLocalAdminStore();
  assert.equal(store.version,1);assert.equal(store.revision,1);
  for(const records of [store.data.clients,store.data.homes,store.data.resources,store.data.missions]) assert.deepEqual(records,[]);
  assert.equal(store.data.members.length,1);assert.equal(store.data.viewer.id,LOCAL_ADMIN_OWNER_ID);
  assert.equal(store.data.templates.length,4);assert.ok(store.data.templates.every(template=>template.status==="draft"&&!template.persisted));
  const serialized=JSON.stringify(store);
  assert.equal(serialized.includes('"subject"'),false);assert.equal(serialized.includes('"issuer"'),false);assert.equal(serialized.includes('"identityVerified"'),false);
  assert.deepEqual(parseLocalAdminStore(serialized),store);
  const parsed=parseLocalAdminStore(store);parsed.data.organization.name="Detached copy";
  assert.equal(store.data.organization.name,"BOOKENDS workspace");
});

test("local business edits are immutable reductions with stable codes and optimistic revisions", () => {
  const f=fixture(), before=structuredClone(f.state), client=f.state.data.clients[0];
  const edit:LocalAdminCommand={type:"save_client",id:client.id,expectedRevision:client.revision,code:client.code,name:"Client new name",contactName:"",contactEmail:"",notes:"Saved locally"};
  const next=applyLocalAdminCommand(f.state,edit);
  assert.deepEqual(f.state,before);assert.equal(next.revision,before.revision+1);assert.equal(next.data.clients[0].revision,2);
  assert.throws(()=>applyLocalAdminCommand(next,edit),code("conflict"));
  assert.throws(()=>applyLocalAdminCommand(next,{...edit,expectedRevision:2,code:"other-code"}),code("immutable_code"));
  assert.throws(()=>f.apply({type:"save_client",code:client.code,name:"Duplicate",contactName:"",contactEmail:"",notes:""}),code("duplicate"));
  const home=f.state.data.homes[0];
  f.apply({type:"save_home",id:home.id,expectedRevision:home.revision,code:home.code,name:"New display name",description:"Still Data"});
  assert.equal(f.state.data.resources[0].home,"Data");
  f.apply({type:"set_organization",expectedRevision:1,name:"My studio"});assert.equal(f.state.data.organization.name,"My studio");
  assert.throws(()=>f.apply({type:"save_resource",name:"Missing HOME",home:"Other",ownerId:LOCAL_ADMIN_OWNER_ID}),code("invalid_home"));
  assert.throws(()=>f.apply({type:"save_mission",name:"Missing client",clientId:crypto.randomUUID()}),code("invalid_client"));
});

test("planning people can remain ungrouped and unowned through edits and backup round trips", () => {
  const original = createLocalAdminStore();
  const profile = { roles: ["Engineer Lead"], skills: [] };
  let state = applyLocalAdminCommand(original, { type: "save_resource", name: "Ungrouped teammate", home: "", ownerId: "", profile });
  const person = state.data.resources[0];
  assert.deepEqual(state.data.homes, []);
  assert.equal(state.data.members.length, 1);
  assert.equal(person.home, ""); assert.equal(person.ownerId, "");
  assert.deepEqual(person.profile, profile);
  assert.deepEqual(original.data.resources, []);
  const edit: LocalAdminCommand = { type: "save_resource", id: person.id, expectedRevision: person.revision, name: "Updated teammate", home: "", ownerId: "" };
  state = applyLocalAdminCommand(state, edit);
  assert.equal(state.data.resources[0].revision, 2);
  assert.deepEqual(state.data.resources[0].profile, profile);
  assert.throws(() => applyLocalAdminCommand(state, edit), code("conflict"));
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(state)), state);
  state = applyLocalAdminCommand(state, { type: "set_resource_active", id: person.id, expectedRevision: 2, active: false });
  state = applyLocalAdminCommand(state, { type: "set_resource_active", id: person.id, expectedRevision: 3, active: true });
  assert.equal(state.data.resources[0].active, true);
});

test("planning's optional references still reject missing or archived selections and retain edit identity checks", () => {
  const f = fixture(), existing = f.state.data.resources[0];
  f.apply({ type: "save_resource", id: existing.id, expectedRevision: 1, name: existing.name, home: "", ownerId: "" });
  assert.equal(f.state.data.resources[0].home, ""); assert.equal(f.state.data.resources[0].ownerId, "");
  const command = { type: "save_resource" as const, name: "Ungrouped teammate", home: "", ownerId: "" };
  assert.throws(() => f.apply({ ...command, home: "missing" }), code("invalid_home"));
  assert.throws(() => f.apply({ ...command, ownerId: crypto.randomUUID() }), code("invalid_owner"));
  f.apply({ type: "set_home_active", id: f.state.data.homes[0].id, expectedRevision: 1, active: false });
  assert.throws(() => f.apply({ ...command, home: "Data" }), code("invalid_home"));
  f.apply({ type: "create_local_member", name: "Prior owner", role: "placement_owner", resourceId: null, homeScope: null, grants: [] });
  const owner = f.state.data.members[1];
  f.apply({ type: "update_member", id: owner.id, expectedRevision: 1, name: owner.name, role: owner.role, resourceId: null, homeScope: null, grants: [], active: false });
  assert.throws(() => f.apply({ ...command, ownerId: owner.id }), code("invalid_owner"));
  for (const patch of [{ home: "missing" }, { ownerId: crypto.randomUUID() }]) {
    const broken = structuredClone(f.state); Object.assign(broken.data.resources[0], patch);
    assert.throws(() => parseLocalAdminStore(broken), code("invalid_reference"));
  }
  for (const patch of [{ home: "Data" }, { ownerId: owner.id }]) {
    const broken = structuredClone(f.state); Object.assign(broken.data.resources[0], patch);
    assert.throws(() => parseLocalAdminStore(broken), code("active_dependents"));
  }
  assert.throws(() => parseLocalAdminCommand({ ...command, id: existing.id }));
  assert.throws(() => parseLocalAdminCommand({ ...command, expectedRevision: 1 }));
  assert.throws(() => parseLocalAdminCommand({ ...command, ownerId: "not-an-id" }));
  assert.throws(() => parseLocalAdminCommand({ ...command, home: "\u0000" }));
  assert.throws(() => parseLocalAdminCommand({ ...command, unexpected: true }));
});

test("operational person schema still requires HOME and owner independently of planning", () => {
  const command = { type: "save_resource" as const, name: "Operational teammate", home: "Data", ownerId: LOCAL_ADMIN_OWNER_ID };
  assert.equal(adminRequestSchema.safeParse({ idempotencyKey: LOCAL_ADMIN_OWNER_ID, command }).success, true);
  for (const patch of [{ home: "" }, { ownerId: "" }, { home: "", ownerId: "" }]) {
    assert.equal(adminRequestSchema.safeParse({ idempotencyKey: LOCAL_ADMIN_OWNER_ID, command: { ...command, ...patch } }).success, false);
    assert.doesNotThrow(() => parseLocalAdminCommand({ ...command, ...patch }));
  }
});

test("archive and reactivate retain references and require active business dependencies", () => {
  const f=fixture(), client=f.state.data.clients[0], home=f.state.data.homes[0], resource=f.state.data.resources[0], mission=f.state.data.missions[0];
  assert.throws(()=>f.apply({type:"set_client_active",id:client.id,expectedRevision:1,active:false}),/active mission needs an active client/);
  assert.throws(()=>f.apply({type:"set_home_active",id:home.id,expectedRevision:1,active:false}),code("active_dependents"));
  f.apply({type:"set_mission_active",id:mission.id,expectedRevision:1,active:false});
  f.apply({type:"set_client_active",id:client.id,expectedRevision:1,active:false});
  assert.throws(()=>f.apply({type:"set_mission_active",id:mission.id,expectedRevision:2,active:true}),/active mission needs an active client/);
  f.apply({type:"set_client_active",id:client.id,expectedRevision:2,active:true});
  f.apply({type:"set_mission_active",id:mission.id,expectedRevision:2,active:true});
  f.apply({type:"set_resource_active",id:resource.id,expectedRevision:1,active:false});
  f.apply({type:"set_home_active",id:home.id,expectedRevision:1,active:false});
  assert.throws(()=>f.apply({type:"set_resource_active",id:resource.id,expectedRevision:2,active:true}),code("active_dependents"));
  f.apply({type:"set_home_active",id:home.id,expectedRevision:2,active:true});
  f.apply({type:"set_resource_active",id:resource.id,expectedRevision:2,active:true});
  assert.equal(f.state.data.resources.length,1);assert.equal(f.state.data.missions.length,1);
  assert.equal(f.state.data.resources[0].id,resource.id);assert.equal(f.state.data.missions[0].clientId,client.id);
});

test("local members configure roles without sign-in identities and local owner access can be edited", () => {
  const f=fixture(), resource=f.state.data.resources[0];
  f.apply({type:"create_local_member",name:"Teammate local profile",role:"resource",resourceId:resource.id,homeScope:null,grants:[]});
  assert.equal(f.state.data.members.length,2);
  assert.throws(()=>f.apply({type:"create_local_member",name:"Duplicate teammate link",role:"resource",resourceId:resource.id,homeScope:null,grants:[]}),code("invalid_import"));
  assert.throws(()=>f.apply({type:"create_local_member",name:"No HOME",role:"home_leader",resourceId:null,homeScope:null,grants:[]}),code("invalid_reference"));
  assert.throws(()=>f.apply({type:"create_local_member",name:"Unscoped extra HOME role",role:"mission_owner",resourceId:null,homeScope:null,grants:[{role:"home_leader",scope:{}}]}),code("invalid_reference"));
  assert.throws(()=>f.apply({type:"create_member",name:"No verified accounts",role:"administrator",resourceId:null,homeScope:null,grants:[],subject:"claimed-subject",identityVerified:true}),code("local_identity"));
  const owner=f.state.data.members[0];
  f.apply({type:"update_member",id:owner.id,expectedRevision:owner.revision,name:"My local name",role:"asset_access_owner",homeScope:"Data",resourceId:null,grants:[],active:true});
  assert.equal(f.state.data.viewer.name,"My local name");assert.equal(f.state.data.members[0].role,"asset_access_owner");
  // Locally configured roles do not act as authentication gates for this local editor.
  f.apply({type:"set_organization",expectedRevision:1,name:"Free local setup"});
  f.apply({type:"set_resource_active",id:resource.id,expectedRevision:1,active:false});
  const local=f.state.data.members[1];
  f.apply({type:"update_member",id:local.id,expectedRevision:1,name:local.name,role:local.role,resourceId:resource.id,homeScope:null,grants:[],active:false});
  assert.equal(f.state.data.members[1].active,false);
});

test("local playbooks require explicit save and approval, then preserve older versions", () => {
  const f=fixture(), starter=f.state.data.templates[0];
  f.apply(savePlaybook(starter));
  let template=f.state.data.templates.find(template=>template.kind===starter.kind)!;
  assert.equal(template.version,1);assert.equal(template.revision,1);assert.equal(template.approvedBy,null);
  const firstId=template.id;
  f.apply({...savePlaybook(template),name:"A thoughtful arrival"} as LocalAdminCommand);
  template=f.state.data.templates.find(template=>template.id===firstId)!;
  assert.equal(template.revision,2);assert.equal(template.version,1);
  f.apply({type:"approve_playbook",id:template.id,expectedRevision:2});
  template=f.state.data.templates.find(template=>template.id===firstId)!;
  assert.equal(template.status,"approved");assert.equal(template.approvedBy,LOCAL_ADMIN_OWNER_ID);
  f.apply({...savePlaybook(template),name:"The next local version"} as LocalAdminCommand);
  let next=f.state.data.templates.find(template=>template.kind===starter.kind&&template.status==="draft")!;
  assert.equal(next.version,2);assert.notEqual(next.id,firstId);assert.equal(next.approvedBy,null);
  f.apply({type:"approve_playbook",id:next.id,expectedRevision:1});
  assert.equal(f.state.data.templates.find(template=>template.id===firstId)!.status,"retired");
  assert.equal(f.state.data.templates.filter(template=>template.kind===starter.kind&&template.status==="approved").length,1);
  next=f.state.data.templates.find(template=>template.id===next.id)!;
  f.apply({type:"retire_playbook",id:next.id,expectedRevision:next.revision});
  assert.equal(f.state.data.templates.filter(template=>template.kind===starter.kind&&template.status==="approved").length,0);
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(f.state)),f.state);
});

test("local playbook graph failures roll back and invalid imported approvals are rejected", () => {
  const f=fixture(), before=structuredClone(f.state), template=structuredClone(f.state.data.templates[0]);
  template.requirements[0].prerequisiteTemplateIds=[template.requirements[1].id];
  template.requirements[1].prerequisiteTemplateIds=[template.requirements[0].id];
  assert.throws(()=>f.apply(savePlaybook(template)),/cannot form a cycle/);assert.deepEqual(f.state,before);
  f.apply(savePlaybook(f.state.data.templates[0]));
  const corrupt=structuredClone(f.state), saved=corrupt.data.templates.find(template=>template.persisted)!;
  saved.status="approved";
  assert.throws(()=>parseLocalAdminStore(corrupt),code("invalid_import"));
  saved.status="draft";saved.requirements[0].version=999;
  assert.throws(()=>parseLocalAdminStore(corrupt),code("invalid_import"));
});

test("backup import rejects missing links, identity claims, malformed JSON and oversized or executable objects", () => {
  const f=fixture();
  const missingClient=structuredClone(f.state);missingClient.data.clients=[];
  assert.throws(()=>parseLocalAdminStore(missingClient),code("invalid_reference"));
  const missingOwner=structuredClone(f.state);missingOwner.data.members=[];
  assert.throws(()=>parseLocalAdminStore(missingOwner));
  const claimed=structuredClone(f.state) as unknown as {data:{members:Record<string,unknown>[]}};
  claimed.data.members[0].subject="fake-verified-subject";
  assert.throws(()=>parseLocalAdminStore(claimed));
  assert.throws(()=>parseLocalAdminStore("{"),code("invalid_import"));
  assert.throws(()=>parseLocalAdminStore(" ".repeat(MAX_LOCAL_ADMIN_BYTES+1)),code("too_large"));
  assert.throws(()=>parseLocalAdminStore({get data(){throw new Error("A getter must never run.");}}),code("invalid_import"));
  assert.throws(()=>parseLocalAdminStore(new Date()),code("invalid_import"));
  const polluted=JSON.parse(JSON.stringify(f.state));polluted.data.members[0]=JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(()=>parseLocalAdminStore(polluted),code("invalid_import"));
  assert.throws(()=>parseLocalAdminStore(JSON.stringify(polluted)),code("invalid_import"));
  const deep='['.repeat(30)+'null'+']'.repeat(30);
  assert.throws(()=>parseLocalAdminStore(deep),code("invalid_import"));
  assert.equal((Object.prototype as {polluted?:boolean}).polluted,undefined);
  const version=structuredClone(f.state);version.version=2 as 1;
  assert.throws(()=>parseLocalAdminStore(version));
});
