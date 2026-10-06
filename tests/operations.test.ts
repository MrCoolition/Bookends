import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { executeOperation, loadOperations, type Membership, type OperationsQuery } from "../lib/operations/service";
import { operationsRequestSchema } from "../lib/operations/validation";
import type { OperationsCommand, OperationsRequest } from "../lib/operations/contracts";
import type { JourneyKind } from "../lib/journeys/types";

const migrations = new URL("../db/migrations/", import.meta.url);
const issuer = "https://identity.example.test/tenant/v2.0";

async function fixture() {
  const db = new PGlite();
  for (const file of (await readdir(migrations)).filter(file => file.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file, migrations), "utf8"));
  const org = randomUUID(), foreignOrg = randomUUID(), resourceId = randomUUID(), otherResourceId = randomUUID();
  const member = (name: string, role: Membership["role"], extra: Partial<Membership> = {}): Membership => ({ id: randomUUID(), organization_id: org, issuer, subject: randomUUID(), name, role, resource_id: null, home_scope: null, active: true, grants: [], ...extra });
  const admin = member("Synthetic Policy Owner", "administrator");
  const reviewer = member("Synthetic Independent Reviewer", "mission_owner", { grants: ["asset_access_owner", "administrator"].map(role => ({ role: role as "asset_access_owner" | "administrator", scope: { organizationId: org } })) });
  const worker = member("Synthetic Teammate", "resource");
  const outsider = member("Synthetic Other Teammate", "resource");
  const observer = member("Synthetic HOME Lead", "home_leader", { home_scope: "Data" });
  const foreign = member("Synthetic Other Organization", "administrator", { organization_id: foreignOrg });
  await db.query("INSERT INTO be_organizations(id,name) VALUES ($1,'Synthetic organization'),($2,'Synthetic other organization')", [org, foreignOrg]);
  await db.query("INSERT INTO be_homes(organization_id,id,code,name) VALUES($1,$3,'Data','Data'),($1,$4,'AI','AI'),($2,$5,'Data','Data')", [org,foreignOrg,randomUUID(),randomUUID(),randomUUID()]);
  const clientId = randomUUID();
  await db.query("INSERT INTO be_clients(organization_id,id,code,name) VALUES($1,$2,'synthetic-client','Synthetic Client')", [org,clientId]);
  for (const value of [admin, reviewer, worker, outsider, observer, foreign]) {
    await db.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role,home_scope,grants) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [value.id, value.organization_id, issuer, value.subject, value.name, value.role, value.home_scope, JSON.stringify(value.grants)]);
  }
  await db.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES ($1,$2,'Synthetic Teammate','Data',$4),($1,$3,'Synthetic Other Teammate','Data',$4)", [org, resourceId, otherResourceId, admin.id]);
  await db.query("UPDATE be_memberships SET resource_id=$2 WHERE id=$1", [worker.id, resourceId]); worker.resource_id = resourceId;
  await db.query("UPDATE be_memberships SET resource_id=$2 WHERE id=$1", [outsider.id, otherResourceId]); outsider.resource_id = otherResourceId;

  async function transaction<T>(acting: Membership, work: (query: OperationsQuery) => Promise<T>) {
    return db.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE be_runtime");
      await tx.query("SELECT set_config('bookends.organization_id',$1,true),set_config('bookends.issuer',$2,true),set_config('bookends.subject',$3,true),set_config('bookends.actor_id',$4,true)", [acting.organization_id, acting.issuer, acting.subject,acting.id]);
      return work(tx as unknown as OperationsQuery);
    });
  }
  const load = (acting: Membership = admin) => transaction(acting, client => loadOperations(client, acting));
  const request = (acting: Membership, value: OperationsRequest) => {
    const validated = operationsRequestSchema.parse(value);
    return transaction(acting, client => executeOperation(client, acting, validated));
  };
  const execute = (acting: Membership, command: OperationsCommand, idempotencyKey = randomUUID()) => request(acting, { idempotencyKey, command });
  async function createJourney(kind: JourneyKind = "mission_onboarding") {
    await execute(admin, { type: "approve_template", kind, sourceReference: "Approved synthetic policy source v1" });
    const template = (await load()).templates.find(item => item.kind === kind && item.status === "approved")!;
    let missionId: string | undefined;
    if (kind.startsWith("mission")) {
      await execute(admin, { type: "create_mission", name: "Synthetic Mission", clientId });
      missionId = (await load()).missions[0].id;
    }
    await execute(admin, { type: "create_journey", templateId: template.id, resourceId, ...(missionId ? { missionId, assignmentReference: "source://synthetic-approved-assignment/1" } : {}), ownerId: admin.id, fulfillerId: worker.id, verifierId: reviewer.id, openingAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), releaseAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), closeoutAt: new Date(Date.now() + 35 * 86_400_000).toISOString() });
    return (await load()).journeys[0];
  }
  const count = async (table: "be_journeys" | "be_obligations" | "be_events" | "be_receipts" | "be_notices" | "be_acknowledgments" | "be_assignment_references") => Number((await db.query<{count:number}>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
  return { db, org, foreignOrg, admin, reviewer, worker, outsider, observer, foreign, resourceId, otherResourceId, clientId, transaction, load, execute, request, createJourney, count };
}
function code(expected: string) { return (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === expected; }

test("production service persists approved journey, notice, evidence, independent verification, audit, and versioned acknowledgment", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const journey = await f.createJourney();
  assert.equal(journey.kind, "mission_onboarding");
  assert.ok(journey.scope.assignmentId);
  assert.equal(await f.count("be_notices"), 1);
  assert.equal(await f.count("be_obligations"), journey.obligations.length);
  const task = journey.obligations.find(item => item.templateId.endsWith(".access"))!;
  const evidenceId = randomUUID();
  const submitKey = randomUUID();
  const submit: OperationsCommand = { type: "obligation", journeyId: journey.id, obligationId: task.id, expectedRevision: task.revision, command: { type: "submit", evidence: { id: evidenceId, kind: "restricted_reference", reference: "private://synthetic-ticket", summary: "PRIVATE VERIFICATION CONTEXT" } } };
  await f.execute(f.worker, submit, submitKey);
  const afterSubmit = (await f.load(f.worker)).journeys[0].obligations.find(item => item.id === task.id)!;
  assert.equal(afterSubmit.status, "submitted");
  assert.equal(afterSubmit.verifiedAt, null);
  assert.equal(afterSubmit.revision, 2);
  // A retry returns the original success before checking an already-consumed revision.
  await f.execute(f.worker, submit, submitKey);
  const retried = (await f.load(f.worker)).journeys[0].obligations.find(item => item.id === task.id)!;
  assert.equal(retried.evidence.length, 1);
  assert.equal(retried.revision, 2);
  assert.equal((await f.db.query<{count:number}>("SELECT count(*)::int AS count FROM be_events WHERE operation='submit'")).rows[0].count, 1);
  await assert.rejects(f.execute(f.worker, submit), code("conflict"));
  await assert.rejects(f.execute(f.worker, { ...submit, expectedRevision: 2 }, submitKey), code("idempotency_conflict"));
  await assert.rejects(f.execute(f.worker, { type: "obligation", journeyId: journey.id, obligationId: task.id, expectedRevision: 2, command: { type: "verify", evidenceId, resolution: "Self verification is prohibited." } }), code("forbidden"));
  await f.execute(f.reviewer, { type: "obligation", journeyId: journey.id, obligationId: task.id, expectedRevision: 2, command: { type: "verify", evidenceId, resolution: "Independent operational owner verified the ticket." } });
  const accepted = (await f.load(f.worker)).journeys[0].obligations.find(item => item.id === task.id)!;
  assert.equal(accepted.status, "satisfied");
  assert.equal(accepted.evidence[0].verifiedBy, f.reviewer.id);
  const event = (await f.db.query<{payload:{previousStatus:string;nextStatus:string;actorId:string}}>("SELECT payload FROM be_events WHERE operation='verify'")).rows[0].payload;
  assert.equal(event.previousStatus, "submitted"); assert.equal(event.nextStatus, "satisfied"); assert.equal(event.actorId, f.reviewer.id);
  const notice = (await f.load(f.worker)).notices[0];
  assert.equal(notice.acknowledgedAt, null);
  await f.execute(f.worker, { type: "acknowledge_notice", noticeId: notice.id, expectedRevision: 1 });
  assert.ok((await f.load(f.worker)).notices[0].acknowledgedAt);
  assert.equal((await f.load(f.worker)).journeys[0].obligations.find(item => item.id === task.id)!.status, "satisfied");
  // Simulate a new publication from the authoritative publisher, retaining the old acknowledgment.
  await f.db.query("UPDATE be_notices SET revision=2,body='A new synthetic publication.' WHERE id=$1", [notice.id]);
  assert.equal((await f.load(f.worker)).notices[0].acknowledgedAt, null);
  await assert.rejects(f.execute(f.worker, { type: "acknowledge_notice", noticeId: notice.id, expectedRevision: 1 }), code("conflict"));
  await f.execute(f.worker, { type: "acknowledge_notice", noticeId: notice.id, expectedRevision: 2 });
  assert.equal(await f.count("be_acknowledgments"), 2);
});

test("service projections omit unassigned private evidence and help details while retaining scoped readiness", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const journey = await f.createJourney();
  const task = journey.obligations.find(item => item.templateId.endsWith(".access"))!;
  await f.execute(f.worker, { type: "obligation", journeyId: journey.id, obligationId: task.id, expectedRevision: 1, command: { type: "request_help", reason: "PRIVATE HELP CONTEXT" } });
  await f.execute(f.worker, { type: "obligation", journeyId: journey.id, obligationId: task.id, expectedRevision: 2, command: { type: "submit", evidence: { id: randomUUID(), kind: "restricted_reference", reference: "private://restricted-synthetic-evidence", summary: "PRIVATE EVIDENCE CONTEXT" } } });
  const own = await f.load(f.worker);
  assert.ok(JSON.stringify(own).includes("PRIVATE EVIDENCE CONTEXT"));
  const projected = await f.load(f.observer);
  assert.equal(projected.journeys.length, 1);
  assert.ok(projected.readinessByJourney[journey.id]);
  assert.equal(JSON.stringify(projected).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(projected).includes("private://"), false);
  assert.deepEqual(projected.journeys[0].obligations.find(item => item.id === task.id)!.evidence, []);
  assert.equal((await f.load(f.outsider)).journeys.length, 0);
  assert.equal((await f.load(f.outsider)).notices.length, 0);
  await assert.rejects(f.execute(f.outsider, { type: "obligation", journeyId: journey.id, obligationId: task.id, expectedRevision: 3, command: { type: "request_help", reason: "Not assigned to this work." } }), code("forbidden"));
  const notice = own.notices[0];
  await assert.rejects(f.execute(f.outsider, { type: "acknowledge_notice", noticeId: notice.id, expectedRevision: 1 }), code("not_found"));
});

test("the service enforces operational roles, scoped owners, and organization-consistent foreign keys", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  await assert.rejects(f.execute(f.worker, { type: "create_resource", name: "Forbidden", home: "Data", ownerId: f.admin.id }), code("forbidden"));
  await assert.rejects(f.execute(f.worker, { type: "approve_template", kind: "company_onboarding", sourceReference: "Unapproved self policy" }), code("forbidden"));
  await assert.rejects(f.execute(f.observer, { type: "create_resource", name: "Wrong HOME", home: "AI", ownerId: f.admin.id }), code("forbidden"));
  await assert.rejects(f.execute(f.admin, { type: "create_resource", name: "Foreign owner", home: "Data", ownerId: f.foreign.id }), code("invalid_owner"));
  await assert.rejects(f.transaction(f.admin, client => client.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES($1,$2,'Cross-org fixture','Data',$3)", [f.org, randomUUID(), f.foreign.id])), code("23503"));
  await f.createJourney();
  const otherOrganization = await f.load(f.foreign);
  assert.equal(otherOrganization.organization.id, f.foreignOrg);
  assert.equal(otherOrganization.resources.length, 0);
  assert.equal(otherOrganization.journeys.length, 0);
  assert.equal(otherOrganization.missions.length, 0);
  const foreignResource = randomUUID();
  await f.db.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES($1,$2,'Foreign synthetic resource','Data',$3)", [f.foreignOrg, foreignResource, f.foreign.id]);
  const missionId = (await f.load()).missions[0].id;
  await assert.rejects(f.transaction(f.admin, client => client.query("INSERT INTO be_assignment_references(organization_id,id,resource_id,mission_id,source_reference) VALUES($1,$2,$3,$4,'source://cross-org-attempt')", [f.org, randomUUID(), foreignResource, missionId])), code("23503"));
  assert.equal((await f.load()).resources.some(item => item.id === foreignResource), false);
});

test("invalid verifier grants roll the whole journey transaction back", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  await f.execute(f.admin, { type: "approve_template", kind: "mission_onboarding", sourceReference: "Synthetic approved policy" });
  await f.execute(f.admin, { type: "create_mission", name: "Synthetic Mission", clientId:f.clientId });
  const state = await f.load();
  const command: OperationsCommand = { type: "create_journey", templateId: state.templates.find(item => item.status === "approved")!.id, resourceId: f.resourceId, missionId: state.missions[0].id, assignmentReference: "source://fixture", ownerId: f.admin.id, fulfillerId: f.worker.id, verifierId: f.observer.id, openingAt: null, releaseAt: null, closeoutAt: null };
  const events = await f.count("be_events"), receipts = await f.count("be_receipts");
  await assert.rejects(f.execute(f.admin, command), code("invalid_verifier"));
  assert.equal(await f.count("be_journeys"), 0);
  assert.equal(await f.count("be_obligations"), 0);
  assert.equal(await f.count("be_notices"), 0);
  assert.equal(await f.count("be_assignment_references"), 0);
  assert.equal(await f.count("be_events"), events);
  assert.equal(await f.count("be_receipts"), receipts);
});

test("request validation rejects fabricated organization, authority, privileged status, and malformed dates", () => {
  const request = { idempotencyKey: randomUUID(), command: { type: "create_resource", name: "Synthetic", home: "Data", ownerId: randomUUID() } };
  for (const value of [
    { ...request, organizationId: randomUUID() },
    { ...request, role: "administrator" },
    { ...request, command: { ...request.command, organizationId: randomUUID() } },
    { ...request, command: { ...request.command, grants: [{ role: "administrator" }] } },
    { ...request, command: { type: "obligation", journeyId: randomUUID(), obligationId: randomUUID(), expectedRevision: 1, command: { type: "satisfied", verifiedBy: randomUUID() } } },
    { ...request, command: { type: "create_journey", templateId: randomUUID(), resourceId: randomUUID(), ownerId: randomUUID(), fulfillerId: randomUUID(), verifierId: randomUUID(), openingAt: "2026-02-30T12:00:00Z", releaseAt: null, closeoutAt: null } },
  ]) assert.equal(operationsRequestSchema.safeParse(value).success, false);
  assert.equal(operationsRequestSchema.safeParse(request).success, true);
});

test("company journeys stay separate from mission assignment references and email delivery", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const journey = await f.createJourney("company_offboarding");
  assert.equal(journey.scope.assignmentId, undefined);
  assert.equal(journey.scope.missionId, undefined);
  assert.equal(await f.count("be_assignment_references"), 0);
  assert.equal(await f.count("be_notices"), 1);
  const state = await f.load(f.worker);
  assert.match(state.notices[0].body, /does not change your employment or staffing/);
  assert.equal("emailDelivery" in state.notices[0], false);
});

test("journey owners and fulfillers must have authority covering the chosen teammate", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  await f.execute(f.admin, { type: "approve_template", kind: "company_onboarding", sourceReference: "Synthetic scoped policy" });
  const template = (await f.load()).templates.find(item => item.status === "approved")!;
  const command: OperationsCommand = { type: "create_journey", templateId: template.id, resourceId: f.resourceId, ownerId: f.admin.id, fulfillerId: f.worker.id, verifierId: f.reviewer.id, openingAt: null, releaseAt: null, closeoutAt: null };
  await assert.rejects(f.execute(f.admin, { ...command, ownerId: f.outsider.id }), code("invalid_owner_scope"));
  await assert.rejects(f.execute(f.admin, { ...command, fulfillerId: f.outsider.id }), code("invalid_fulfiller_scope"));
  await f.db.query("UPDATE be_memberships SET resource_id=NULL WHERE id=$1", [f.outsider.id]);
  await assert.rejects(f.execute(f.admin, { ...command, fulfillerId: f.outsider.id }), code("invalid_fulfiller_scope"));
  assert.equal(await f.count("be_journeys"), 0);
  assert.equal(await f.count("be_notices"), 0);
  await f.execute(f.admin, command);
  const created = (await f.load(f.worker)).journeys[0];
  const task = created.obligations[0];
  await f.execute(f.worker, { type: "obligation", journeyId: created.id, obligationId: task.id, expectedRevision: 1, command: { type: "start" } });
  assert.equal((await f.load(f.worker)).journeys[0].obligations.find(item => item.id === task.id)!.status, "in_progress");
});

test("inactive membership cannot read or mutate through the shared service", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const inactive = { ...f.admin, active: false };
  await assert.rejects(f.load(inactive), code("forbidden"));
  await assert.rejects(f.execute(inactive, { type: "create_resource", name: "No inactive write", home: "Data", ownerId: f.admin.id }), code("forbidden"));
});

test("a primary administrator scoped to one HOME cannot read another HOME's people or journeys", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const dataJourney = await f.createJourney();
  const scoped: Membership = { ...f.admin, id: randomUUID(), subject: randomUUID(), name: "Synthetic Data Administrator", home_scope: "Data" };
  await f.db.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role,home_scope) VALUES($1,$2,$3,$4,$5,'administrator','Data')", [scoped.id,f.org,issuer,scoped.subject,scoped.name]);
  await f.execute(f.admin,{type:"create_resource",name:"Synthetic AI Teammate",home:"AI",ownerId:f.admin.id});
  const aiResource = (await f.load()).resources.find(resource=>resource.home==="AI")!;
  const otherCommand: Extract<OperationsCommand,{type:"create_journey"}> = {type:"create_journey",resourceId:aiResource.id,templateId:dataJourney.templateId,missionId:dataJourney.scope.missionId!,assignmentReference:"source://synthetic-ai-assignment/1",ownerId:f.admin.id,fulfillerId:f.admin.id,verifierId:f.reviewer.id,openingAt:null,releaseAt:null,closeoutAt:null};
  await f.execute(f.admin,otherCommand);
  assert.equal((await f.load()).journeys.length,2);
  const visible = await f.load(scoped);
  assert.equal(visible.viewer.canCoordinate,true);
  assert.equal(visible.viewer.canApprovePolicies,false);
  assert.ok(visible.resources.length>0);
  assert.ok(visible.resources.every(resource=>resource.home==="Data"));
  assert.deepEqual(visible.journeys.map(journey=>journey.id),[dataJourney.id]);
  assert.deepEqual(Object.keys(visible.readinessByJourney),[dataJourney.id]);
  assert.deepEqual(visible.homes.map(home=>home.code),["Data"]);
  assert.ok(visible.templates.every(template=>template.status==="approved"));
  await assert.rejects(f.execute(scoped,otherCommand),code("not_found"));
  await assert.rejects(f.execute(scoped,{type:"create_mission",name:"No global mission registration",clientId:f.clientId}),code("forbidden"));
  await assert.rejects(f.execute(scoped,{type:"approve_template",kind:"company_onboarding",sourceReference:"No organization-wide policy approval"}),code("forbidden"));
});

test("per-step ownership uses the real mission and IT reviewers without granting either blanket authority", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  f.reviewer.grants = [];
  await f.db.query("UPDATE be_memberships SET grants='[]'::jsonb WHERE id=$1", [f.reviewer.id]);
  const assetReviewer: Membership = { ...f.reviewer, id: randomUUID(), subject: randomUUID(), name: "Synthetic IT Owner", role: "asset_access_owner", grants: [], home_scope: "Data" };
  await f.db.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role,home_scope) VALUES($1,$2,$3,$4,$5,$6,$7)", [assetReviewer.id, f.org, issuer, assetReviewer.subject, assetReviewer.name, assetReviewer.role, assetReviewer.home_scope]);
  await f.execute(f.admin, { type: "approve_template", kind: "mission_onboarding", sourceReference: "Synthetic split-responsibility policy" });
  await f.execute(f.admin, { type: "create_mission", name: "Synthetic Split Team", clientId:f.clientId });
  const state = await f.load();
  const template = state.templates.find(item => item.status === "approved")!;
  const overrides = Object.fromEntries(template.requirements.filter(item => item.approverRole === "asset_access_owner").map(item => [item.id, { ownerId: assetReviewer.id, fulfillerId: f.worker.id, verifierId: assetReviewer.id }]));
  const command: Extract<OperationsCommand, {type:"create_journey"}> = { type: "create_journey", templateId: template.id, resourceId: f.resourceId, missionId: state.missions[0].id, assignmentReference: "source://split-team/1", ownerId: f.admin.id, fulfillerId: f.worker.id, verifierId: f.reviewer.id, owners: overrides, openingAt: null, releaseAt: null, closeoutAt: null };
  await assert.rejects(f.execute(f.admin, { ...command, owners: { ...overrides, "unknown-requirement": { ownerId: f.admin.id, fulfillerId: f.worker.id, verifierId: f.reviewer.id } } }), code("invalid_owners"));
  const assetRequirement = template.requirements.find(item => item.id.endsWith(".access"))!;
  await assert.rejects(f.execute(f.admin, { ...command, owners: { ...overrides, [assetRequirement.id]: { ...overrides[assetRequirement.id], fulfillerId: f.outsider.id } } }), code("invalid_fulfiller_scope"));
  assert.equal(await f.count("be_journeys"), 0);
  await f.execute(f.admin, command);
  const created = (await f.load(f.worker)).journeys[0];
  const access = created.obligations.find(item => item.templateId === assetRequirement.id)!;
  const brief = created.obligations.find(item => item.templateId.endsWith(".brief"))!;
  assert.equal(access.ownerId, assetReviewer.id); assert.equal(access.verifierId, assetReviewer.id);
  assert.equal(brief.verifierId, f.reviewer.id);
  const evidenceId = randomUUID();
  await f.execute(f.worker, { type: "obligation", journeyId: created.id, obligationId: access.id, expectedRevision: 1, command: { type: "submit", evidence: { id: evidenceId, kind: "attestation", summary: "Synthetic access ticket is ready for the actual IT owner." } } });
  await assert.rejects(f.execute(f.reviewer, { type: "obligation", journeyId: created.id, obligationId: access.id, expectedRevision: 2, command: { type: "verify", evidenceId, resolution: "A mission owner cannot replace the designated IT reviewer." } }), code("forbidden"));
  await f.execute(assetReviewer, { type: "obligation", journeyId: created.id, obligationId: access.id, expectedRevision: 2, command: { type: "verify", evidenceId, resolution: "The named IT owner independently verified the access." } });
  assert.equal((await f.load(f.worker)).journeys[0].obligations.find(item => item.id === access.id)!.status, "satisfied");
});

test("registering a teammate cannot grant owner visibility to an unscoped resource or IT account", async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const command: Extract<OperationsCommand, {type:"create_resource"}> = { type: "create_resource", name: "Synthetic New Teammate", home: "Data", ownerId: f.outsider.id };
  await assert.rejects(f.execute(f.observer, command), code("invalid_owner_scope"));
  await f.db.query("UPDATE be_memberships SET role='asset_access_owner',grants='[]'::jsonb,home_scope='Data' WHERE id=$1", [f.reviewer.id]);
  await assert.rejects(f.execute(f.observer, { ...command, ownerId: f.reviewer.id }), code("invalid_owner_scope"));
  await f.db.query("UPDATE be_memberships SET role='home_leader',home_scope='AI' WHERE id=$1", [f.reviewer.id]);
  await assert.rejects(f.execute(f.observer, { ...command, ownerId: f.reviewer.id }), code("invalid_owner_scope"));
  assert.equal((await f.load()).resources.length, 2);
  assert.equal((await f.load(f.outsider)).resources.length, 1);
  await f.execute(f.observer, { ...command, ownerId: f.observer.id });
  const created = (await f.load(f.observer)).resources.find(item => item.name === command.name)!;
  assert.equal(created.ownerId, f.observer.id);
  assert.equal((await f.load(f.outsider)).resources.some(item => item.id === created.id), false);
});
