import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sharedConfiguration } from "../lib/shared/config";
import { hashWorkspacePasscode, issueSharedSession, SHARED_SESSION_SECONDS, verifySharedSession, verifyWorkspacePasscode } from "../lib/shared/crypto";
import { consumeBudget, loadSharedStore, saveSharedStore } from "../lib/shared/service";
import { checkSharedMutationOrigin } from "../lib/shared/http";
import type { OperationsQuery } from "../lib/operations/service";
import { applyLocalAdminCommand } from "../lib/admin/local";
import { emptyForecast } from "../lib/forecast/types";

const env = { BOOKENDS_ADMIN_MODE: "shared", BOOKENDS_ENV: "production", BOOKENDS_WORKSPACE_ORIGIN: "https://bookends.example", BOOKENDS_WORKSPACE_SESSION_SECRET: "fixture-secret-at-least-32-characters", BOOKENDS_WORKSPACE_PASSCODE_HASH: `scrypt$32768$8$1$${"a".repeat(32)}$${"b".repeat(64)}` };
const config = sharedConfiguration(env), session = { workspaceId: "main", sessionId: "a".repeat(64) };
let db: PGlite;
before(async () => {
  db = new PGlite();
  const directory = resolve(process.cwd(), "db/migrations");
  for (const file of (await readdir(directory)).filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort()) await db.exec(await readFile(resolve(directory, file), "utf8"));
});
after(async () => { await db?.close(); });
const status = (value: number) => (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === value;
const sqlCode = (value: string) => (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === value;
function scoped<T>(workspaceId: string, run: (query: OperationsQuery) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.exec("SET LOCAL ROLE be_runtime");
    await tx.query("SELECT set_config('bookends.shared_workspace_id',$1,true)", [workspaceId]);
    return run(tx as OperationsQuery);
  });
}

test("passcode hash is salted, verifies exact values, and session forgery, expiry and credential rotation are rejected", async () => {
  const encoded = await hashWorkspacePasscode("fixture-passcode-only");
  assert.notEqual(encoded, await hashWorkspacePasscode("fixture-passcode-only"));
  assert.equal(await verifyWorkspacePasscode("fixture-passcode-only", encoded), true);
  assert.equal(await verifyWorkspacePasscode("wrong-passcode-only", encoded), false);
  assert.equal(await verifyWorkspacePasscode("fixture-passcode-only", "invalid"), false);
  const now = 1_791_388_800_000, token = issueSharedSession(config, now);
  assert.equal(verifySharedSession(token, config, now)?.workspaceId, "main");
  assert.equal(verifySharedSession(`${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`, config, now), null);
  assert.equal(verifySharedSession(token, config, now + SHARED_SESSION_SECONDS * 1000), null);
  assert.equal(verifySharedSession(token, { ...config, passcodeHash: encoded }, now), null);
  assert.equal(verifySharedSession(token, { ...config, workspaceId: "other" }, now), null);
});

test("shared config fails closed and same-origin writes cannot use arbitrary hosts", () => {
  for (const patch of [{ BOOKENDS_ADMIN_MODE: "local" }, { BOOKENDS_WORKSPACE_ORIGIN: "http://bookends.example" }, { BOOKENDS_WORKSPACE_SESSION_SECRET: "short" }, { BOOKENDS_WORKSPACE_PASSCODE_HASH: "plaintext" }, { BOOKENDS_WORKSPACE_ORIGIN: "https://bookends.example/path" }]) assert.throws(() => sharedConfiguration({ ...env, ...patch }), status(503));
  const originals = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const request = (origin: string, site?: string) => new Request("https://bookends.example/api/shared/admin", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(site ? { "Sec-Fetch-Site": site } : {}) }, body: "{}" });
    assert.doesNotThrow(() => checkSharedMutationOrigin(request(config.origin)));
    assert.throws(() => checkSharedMutationOrigin(request("https://attacker.example")), status(403));
    assert.throws(() => checkSharedMutationOrigin(request(config.origin, "cross-site")), status(403));
  } finally { for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("one persistent seeded workspace is visible across sessions; stale edits do not overwrite shared data", async () => {
  const first = await scoped("main", query => loadSharedStore(query, "main"));
  assert.equal(first.data.clients.length, 9);
  const edited = await scoped("main", query => saveSharedStore(query, session, { expectedRevision: first.revision, command: { type: "save_home", name: "Engineering", code: "ENG", description: "Shared HOME" } }, "command"));
  const another = await scoped("main", query => loadSharedStore(query, "main"));
  assert.deepEqual(another, edited);
  await assert.rejects(scoped("main", query => saveSharedStore(query, { ...session, sessionId: "b".repeat(64) }, { expectedRevision: first.revision, command: { type: "save_client", name: "Stale", code: "STALE", contactName: "", contactEmail: "", notes: "" } }, "command")), status(409));
  assert.equal((await scoped("main", query => loadSharedStore(query, "main"))).revision, edited.revision);
  const audit = await scoped("main", query => query.query("SELECT action,session_id FROM be_shared_audit"));
  assert.deepEqual(audit.rows, [{ action: "save_home", session_id: session.sessionId }]);
});

test("reviewed import is atomic, validates references, and retains shared revision monotonicity", async () => {
  const current = await scoped("main", query => loadSharedStore(query, "main"));
  const next = applyLocalAdminCommand(current, { type: "save_client", code: "IMPORT", name: "Imported client", contactName: "", contactEmail: "", notes: "" });
  const saved = await scoped("main", query => saveSharedStore(query, session, { expectedRevision: current.revision, store: { ...next, revision: 200 } }, "snapshot"));
  assert.equal(saved.revision, current.revision + 1);
  assert.ok(saved.data.clients.some(client => client.code === "IMPORT"));
  await assert.rejects(scoped("main", query => saveSharedStore(query, session, { expectedRevision: saved.revision, store: { ...saved, data: { ...saved.data, clients: [] }, clientSeedVersion: 1, arbitrary: true } }, "snapshot")));
  assert.deepEqual(await scoped("main", query => loadSharedStore(query, "main")), saved);
});

test("shared planning persists individual people without assigning HOME or owner and rejects invalid references atomically", async () => {
  const first = await scoped("main", query => loadSharedStore(query, "main"));
  const command = { type: "save_resource", name: "Independent teammate", home: "", ownerId: "", profile: { roles: ["Engineer"], skills: [] } };
  const request = { expectedRevision: first.revision, idempotencyKey: randomUUID(), command };
  let saved = await scoped("main", query => saveSharedStore(query, session, request, "command"));
  const person = saved.data.resources.find(resource => resource.name === command.name)!;
  assert.equal(person.home, ""); assert.equal(person.ownerId, "");
  assert.deepEqual(saved.data.homes, first.data.homes);
  assert.deepEqual(saved.data.members, first.data.members);
  assert.deepEqual(await scoped("main", query => saveSharedStore(query, session, request, "command")), saved);
  assert.deepEqual(await scoped("main", query => loadSharedStore(query, "main")), saved);
  saved = await scoped("main", query => saveSharedStore(query, session, {
    expectedRevision: saved.revision, command: { ...command, id: person.id, expectedRevision: person.revision, profile: { roles: ["Engineer Lead"], skills: [] } },
  }, "command"));
  assert.equal(saved.data.resources.find(resource => resource.id === person.id)!.revision, 2);
  assert.deepEqual(saved.data.resources.find(resource => resource.id === person.id)!.profile, { roles: ["Engineer Lead"], skills: [] });
  for (const patch of [{ home: "missing" }, { ownerId: randomUUID() }]) {
    await assert.rejects(scoped("main", query => saveSharedStore(query, session, { expectedRevision: saved.revision, command: { ...command, ...patch } }, "command")));
    assert.deepEqual(await scoped("main", query => loadSharedStore(query, "main")), saved);
  }
  const roundTrip = JSON.parse(JSON.stringify(saved));
  const restored = await scoped("main", query => saveSharedStore(query, session, { expectedRevision: saved.revision, store: roundTrip }, "snapshot"));
  assert.equal(restored.revision, saved.revision + 1);
  assert.deepEqual(restored.data.resources, saved.data.resources);
  assert.deepEqual(await scoped("main", query => loadSharedStore(query, "main")), restored);
});

test("shared person designation persists across sessions and backup restore, and can be changed or cleared", async () => {
  let saved = await scoped("main", query => loadSharedStore(query, "main"));
  const command = { type: "save_resource", name: "Designation teammate", home: "", ownerId: "", profile: { roles: ["Data Engineer"], skills: ["SQL"], affiliation: "impower" } };
  saved = await scoped("main", query => saveSharedStore(query, session, { expectedRevision: saved.revision, command }, "command"));
  const resourceId = saved.data.resources.find(person => person.name === command.name)!.id;
  const reloaded = await scoped("main", query => loadSharedStore(query, "main"));
  assert.equal(reloaded.data.resources.find(person => person.id === resourceId)!.profile!.affiliation, "impower");
  const roundTrip = JSON.parse(JSON.stringify(saved));
  saved = await scoped("main", query => saveSharedStore(query, session, { expectedRevision: saved.revision, store: roundTrip }, "snapshot"));
  assert.equal(saved.data.resources.find(person => person.id === resourceId)!.profile!.affiliation, "impower");
  for (const affiliation of ["contractor", undefined] as const) {
    const person = saved.data.resources.find(resource => resource.id === resourceId)!;
    const profile = { roles: ["Data Engineer", "Data Modeler"], skills: ["SQL", "Python"], ...(affiliation ? { affiliation } : {}) };
    saved = await scoped("main", query => saveSharedStore(query, session, { expectedRevision: saved.revision, command: { ...command, id: person.id, expectedRevision: person.revision, profile } }, "command"));
    assert.deepEqual((await scoped("main", query => loadSharedStore(query, "main"))).data.resources.find(resource => resource.id === resourceId)!.profile, profile);
  }
  await assert.rejects(scoped("main", query => saveSharedStore(query, session, { expectedRevision: saved.revision, command: { ...command, profile: { ...command.profile, affiliation: "W2" } } }, "command")));
  assert.deepEqual(await scoped("main", query => loadSharedStore(query, "main")), saved);
});

test("shared tables deny missing and foreign scope, deletes, audit edits and identity access", async () => {
  assert.deepEqual((await scoped("", query => query.query("SELECT workspace_id FROM be_shared_workspaces"))).rows, []);
  assert.deepEqual((await scoped("other", query => query.query("SELECT workspace_id FROM be_shared_workspaces"))).rows, []);
  assert.equal((await scoped("other", query => query.query("UPDATE be_shared_workspaces SET workspace_id='other' WHERE workspace_id='main' RETURNING workspace_id"))).rows.length, 0);
  await assert.rejects(scoped("main", query => query.query("DELETE FROM be_shared_workspaces")), sqlCode("42501"));
  await assert.rejects(scoped("main", query => query.query("UPDATE be_shared_audit SET action='changed'")), sqlCode("42501"));
  await assert.rejects(scoped("main", query => query.query("INSERT INTO be_shared_limits(workspace_id,bucket,window_start,attempts) VALUES('other','forbidden',0,1)")), sqlCode("42501"));
  await assert.rejects(db.query("UPDATE be_shared_audit SET action='changed'"), sqlCode("55000"));
  assert.deepEqual((await scoped("main", query => query.query("SELECT id FROM be_memberships"))).rows, []);
});

test("rate limits persist across requests and denied attempts; next window resets the same bucket", async () => {
  const budget = { scope: "test-intake", limit: 2, windowSeconds: 60 }, now = 1_791_388_800_000;
  assert.equal((await scoped("main", query => consumeBudget(query, "main", budget, now))).allowed, true);
  assert.equal((await scoped("main", query => consumeBudget(query, "main", budget, now))).allowed, true);
  assert.equal((await scoped("main", query => consumeBudget(query, "main", budget, now))).allowed, false);
  assert.equal((await scoped("main", query => consumeBudget(query, "main", budget, now))).allowed, false);
  assert.equal((await scoped("other", query => consumeBudget(query, "other", budget, now))).allowed, true);
  assert.equal((await scoped("main", query => consumeBudget(query, "main", budget, now + 60_000))).allowed, true);
});

test("acknowledged retry after a lost response never creates a duplicate, and request keys cannot change payloads", async () => {
  const current = await scoped("main", query => loadSharedStore(query, "main"));
  const command = { type: "save_mission", name: "Retry-safe workstream", clientId: current.data.clients[0].id };
  const request = { expectedRevision: current.revision, idempotencyKey: randomUUID(), command };
  const saved = await scoped("main", query => saveSharedStore(query, session, request, "command"));
  const replay = await scoped("main", query => saveSharedStore(query, session, request, "command"));
  assert.deepEqual(replay, saved);
  const refreshedReplay = await scoped("main", query => saveSharedStore(query, session, { ...request, expectedRevision: saved.revision }, "command"));
  assert.deepEqual(refreshedReplay, saved);
  assert.equal(saved.data.missions.filter(mission => mission.name === command.name).length, 1);
  await assert.rejects(scoped("main", query => saveSharedStore(query, session, { ...request, command: { ...command, name: "Changed request" } }, "command")), status(409));
  const snapshot = { expectedRevision: saved.revision, idempotencyKey: randomUUID(), store: saved };
  const replaced = await scoped("main", query => saveSharedStore(query, session, snapshot, "snapshot"));
  assert.deepEqual(await scoped("main", query => saveSharedStore(query, session, snapshot, "snapshot")), replaced);
  await assert.rejects(scoped("main", query => saveSharedStore(query, session, { ...snapshot, store: { ...saved, data: { ...saved.data, organization: { ...saved.data.organization, name: "Changed" } } } }, "snapshot")), status(409));
});

test("potential SOWs and forecast scenarios persist together without changing source demand, and reject stale or foreign references", async () => {
  const workspaceId = "forecast-test", forecastSession = { ...session, workspaceId };
  let current = await scoped(workspaceId, query => loadSharedStore(query, workspaceId));
  const mutate = async (command: unknown) => {
    current = await scoped(workspaceId, query => saveSharedStore(query, forecastSession, { expectedRevision: current.revision, idempotencyKey: randomUUID(), command }, "command"));
    return current;
  };
  await mutate({ type: "save_resource", name: "Forecast teammate", home: "", ownerId: "", profile: { roles: ["Data Engineer"], skills: ["SQL"] } });
  await mutate({ type: "save_mission", name: "Potential platform", clientId: current.data.clients[0].id, engagement: {
    version: 1, source: "sow", status: "draft", sowReference: "", signedOn: null, start: "2027-01-01", end: "2027-06-30", outcomes: "Potential platform delivery",
    pipeline: { stage: "proposal", confidence: 65, expectedClose: "2026-12-15" },
    roles: [{ id: randomUUID(), name: "Data Engineer", headcount: 2, allocationPercent: 100, skills: ["SQL"], responsibilities: "Build pipelines", start: "2027-01-01", end: "2027-06-30", selectedResourceIds: [] }],
  } });
  const sourceMission = structuredClone(current.data.missions[0]), person = current.data.resources[0];
  const forecast = emptyForecast();
  forecast.capacities = [{ resourceId: person.id, allocationPercent: 80, availableFrom: "2027-01-01", availableUntil: null, notes: "Explicit planning capacity" }];
  forecast.commitments = [{ id: randomUUID(), resourceId: person.id, missionId: null, name: "Other client work", allocationPercent: 40, start: "2027-01-01", end: "2027-03-31" }];
  forecast.scenarios = [{ id: randomUUID(), name: "Growth case", hiringLeadWeeks: 8, selections: [{ missionId: sourceMission.id, included: true, shiftDays: 90, teamScale: 1.5 }] }];
  const beforeRevision = current.revision;
  await mutate({ type: "save_forecast", expectedRevision: 0, forecast });
  const reloaded = await scoped(workspaceId, query => loadSharedStore(query, workspaceId));
  assert.deepEqual(reloaded, current);
  assert.equal(reloaded.revision, beforeRevision + 1);
  assert.deepEqual(reloaded.data.forecast, { ...forecast, revision: 1 });
  assert.deepEqual(reloaded.data.missions[0], sourceMission, "Hypothetical shifts and scaling must not edit the potential SOW.");
  await assert.rejects(mutate({ type: "save_forecast", expectedRevision: 0, forecast }), /forecast changed/);
  const broken = structuredClone(current.data.forecast!);
  broken.capacities[0].resourceId = randomUUID();
  await assert.rejects(mutate({ type: "save_forecast", expectedRevision: 1, forecast: broken }), /saved teammate/);
  assert.deepEqual(await scoped(workspaceId, query => loadSharedStore(query, workspaceId)), reloaded);
  const events = await scoped(workspaceId, query => query.query<{ action: string }>("SELECT action FROM be_shared_audit ORDER BY revision"));
  assert.deepEqual(events.rows.map(row => row.action), ["save_resource", "save_mission", "save_forecast"]);
});
