import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PGlite, type Transaction } from "@electric-sql/pglite";

let database: PGlite;
let runtimeRoleSafetySql: string;
const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const orgA = id(1), orgB = id(2), memberA = id(11), memberB = id(12), resourceA = id(21), resourceB = id(22), missionA = id(31), missionB = id(32), templateA = id(41), templateB = id(42), journeyA = id(51), journeyB = id(52), obligationA = id(61), obligationB = id(62), noticeA = id(71);
const issuer = "https://identity.example.test/tenant";
const code = (expected: string) => (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === expected;

before(async () => {
  const probe = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    // The test process has no client bundle; replace only the package's bundler guard.
    require.cache[require.resolve('server-only')] = { exports: {} };
    const { RUNTIME_ROLE_SAFETY_SQL } = await import('./lib/operations/db.ts');
    process.stdout.write(JSON.stringify(RUNTIME_ROLE_SAFETY_SQL));
  `], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  runtimeRoleSafetySql = JSON.parse(probe.stdout);
  database = new PGlite();
  const migrations = (await readdir(resolve(process.cwd(), "db/migrations"))).filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  for (const migration of migrations) await database.exec(await readFile(resolve(process.cwd(), "db/migrations", migration), "utf8"));
  for (const [organization, member, resource, mission, template, journey, obligation, label] of [[orgA, memberA, resourceA, missionA, templateA, journeyA, obligationA, "A"], [orgB, memberB, resourceB, missionB, templateB, journeyB, obligationB, "B"]]) {
    await database.query("INSERT INTO be_organizations(id,name) VALUES ($1,$2)", [organization, `Organization ${label}`]);
    await database.query("INSERT INTO be_homes(organization_id,id,code,name) VALUES ($1,$2,'Data','Data')", [organization, id(label === "A" ? 201 : 202)]);
    await database.query("INSERT INTO be_clients(organization_id,id,code,name) VALUES ($1,$2,'fixture-client','Fictional client')", [organization, id(label === "A" ? 211 : 212)]);
    await database.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role) VALUES ($1,$2,$3,$4,$5,'administrator')", [member, organization, issuer, `subject-${label}`, `Member ${label}`]);
    await database.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES ($1,$2,$3,'Data',$4)", [organization, resource, `Resource ${label}`, member]);
    await database.query("INSERT INTO be_missions(organization_id,id,name,client_name,client_id) VALUES ($1,$2,$3,'Fictional client',$4)", [organization, mission, `Mission ${label}`, id(label === "A" ? 211 : 212)]);
    await database.query("INSERT INTO be_templates(organization_id,id,kind,version,status,policy_owner_id,body) VALUES ($1,$2,'company_onboarding',1,'approved',$3,'{}')", [organization, template, member]);
    await database.query("INSERT INTO be_journeys(organization_id,id,resource_id,owner_id,template_id,kind,body) VALUES ($1,$2,$3,$4,$5,'company_onboarding','{}')", [organization, journey, resource, member, template]);
    await database.query("INSERT INTO be_obligations(organization_id,id,journey_id,owner_id,fulfiller_id,verifier_id,instance_key,status,body) VALUES ($1,$2,$3,$4,$4,$4,'same-instance','open','{}')", [organization, obligation, journey, member]);
  }
  await database.query("INSERT INTO be_notices(organization_id,id,resource_id,journey_id,title,body) VALUES ($1,$2,$3,$4,'Notice','Test notice')", [orgA, noticeA, resourceA, journeyA]);
});
after(async () => { await database?.close(); });

function runtime<T>(organizationId: string | null, run: (tx: Transaction) => Promise<T>, subject = "") {
  return database.transaction(async transaction => {
    await transaction.exec("SET LOCAL ROLE be_runtime");
    await transaction.query("SELECT set_config('bookends.organization_id',$1,true), set_config('bookends.issuer',$2,true), set_config('bookends.subject',$3,true)", [organizationId ?? "", issuer, subject]);
    return run(transaction);
  });
}
function administrator<T>(organizationId: string, actorId: string, subject: string, run: (tx: Transaction) => Promise<T>) {
  return runtime(organizationId, async tx => {
    await tx.query("SELECT set_config('bookends.actor_id',$1,true)", [actorId]);
    return run(tx);
  }, subject);
}

test("every business table forces RLS and runtime owns no tables or bypass privileges", async () => {
  const roles = await database.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>("SELECT rolsuper,rolbypassrls,rolcanlogin,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='be_runtime'");
  assert.deepEqual(roles.rows[0], { rolsuper: false, rolbypassrls: false, rolcanlogin: false, rolcreatedb: false, rolcreaterole: false });
  const tables = await database.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string }>("SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relkind='r' AND relname LIKE 'be_%' AND relname <> 'be_schema_migrations'");
  assert.equal(tables.rows.length, 18);
  assert.ok(tables.rows.every(table => table.relrowsecurity && table.relforcerowsecurity && table.owner !== "be_runtime"));
  await assert.rejects(runtime(orgA, tx => tx.query("SELECT * FROM be_schema_migrations")), code("42501"));
});

test("runtime defaults deny and organization context isolates both reads and writes", async () => {
  assert.deepEqual((await runtime(null, tx => tx.query("SELECT id FROM be_resources"))).rows, []);
  assert.deepEqual((await runtime(orgA, tx => tx.query<{ id: string }>("SELECT id FROM be_resources"))).rows, [{ id: resourceA }]);
  assert.deepEqual((await runtime(orgB, tx => tx.query<{ id: string }>("SELECT id FROM be_resources"))).rows, [{ id: resourceB }]);
  assert.equal((await runtime(orgA, tx => tx.query("UPDATE be_resources SET name='forbidden' WHERE id=$1 RETURNING id", [resourceB]))).rows.length, 0);
  await assert.rejects(runtime(orgA, tx => tx.query("INSERT INTO be_missions(organization_id,id,name,client_name) VALUES ($1,$2,'Wrong org','Test')", [orgB, id(90)])), code("42501"));
  // Transaction-local context and role must not leak into the next request.
  assert.deepEqual((await runtime(null, tx => tx.query("SELECT id FROM be_resources"))).rows, []);
});

test("verified identity can find only its membership before organization authorization", async () => {
  assert.deepEqual((await runtime(null, tx => tx.query<{ id: string }>("SELECT id FROM be_memberships"), "subject-A")).rows, [{ id: memberA }]);
  assert.deepEqual((await runtime(null, tx => tx.query("SELECT id FROM be_memberships"), "wrong-subject")).rows, []);
  await assert.rejects(runtime(null, tx => tx.query("UPDATE be_memberships SET role='asset_access_owner' WHERE id=$1 RETURNING id", [memberA]), "subject-A"), code("42501"));
  await assert.rejects(runtime(orgA, tx => tx.query("UPDATE be_memberships SET grants='[{\"role\":\"administrator\"}]' WHERE id=$1", [memberA]), "subject-A"), code("42501"));
  await assert.rejects(runtime(orgA, tx => tx.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role) VALUES ($1,$2,$3,'self-created','Invalid','administrator')", [id(180), orgA, issuer]), "subject-A"), code("42501"));
  await assert.rejects(runtime(orgA, tx => tx.query("UPDATE be_organizations SET name='Changed' WHERE id=$1", [orgA])), code("42501"));
  await assert.rejects(runtime(orgA, tx => tx.query("DELETE FROM be_resources WHERE id=$1", [resourceA])), code("42501"));
});

test("runtime safety check rejects table owners and logins with extra membership privileges", async () => {
  assert.equal((await database.query<{ unsafe: boolean }>(runtimeRoleSafetySql)).rows[0].unsafe, true);
  assert.equal((await runtime(orgA, tx => tx.query<{ unsafe: boolean }>(runtimeRoleSafetySql))).rows[0].unsafe, false);
  assert.equal((await database.query<{ unsafe: boolean }>(runtimeRoleSafetySql.replaceAll("current_user", "$1::name"), ["be_runtime"])).rows[0].unsafe, false, "Activation can inspect a new runtime login without SET ROLE privileges");
  await database.exec("CREATE ROLE unsafe_application INHERIT; GRANT be_runtime TO unsafe_application; GRANT UPDATE(grants) ON be_memberships TO unsafe_application");
  await database.transaction(async tx => {
    await tx.exec("SET LOCAL ROLE unsafe_application");
    assert.equal((await tx.query<{ unsafe: boolean }>(runtimeRoleSafetySql)).rows[0].unsafe, true);
  });
});

test("composite foreign keys reject cross-organization ownership and resource links", async () => {
  await assert.rejects(database.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES ($1,$2,'Invalid','Data',$3)", [orgA, id(91), memberB]), code("23503"));
  await assert.rejects(database.transaction(async tx => {
    await tx.query("UPDATE be_memberships SET resource_id=$1 WHERE id=$2", [resourceB, memberA]);
  }), code("23503"));
  await assert.rejects(database.query("INSERT INTO be_assignment_references(organization_id,id,resource_id,mission_id,source_reference) VALUES ($1,$2,$3,$4,'source')", [orgA, id(92), resourceA, missionB]), code("23503"));
  await assert.rejects(database.query("INSERT INTO be_acknowledgments(organization_id,notice_id,actor_id,notice_revision) VALUES ($1,$2,$3,1)", [orgA, noticeA, memberB]), code("23503"));
});

test("deferred resource links can be established atomically within their organization", async () => {
  await database.transaction(async tx => {
    await tx.query("UPDATE be_memberships SET resource_id=$1 WHERE id=$2", [id(93), memberA]);
    await tx.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES ($1,$2,'Linked later','Data',$3)", [orgA, id(93), memberA]);
  });
  assert.equal((await database.query<{ resource_id: string }>("SELECT resource_id FROM be_memberships WHERE id=$1", [memberA])).rows[0].resource_id, id(93));
});

test("only one active corporate membership may link to a resource", async () => {
  await assert.rejects(database.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role,resource_id) VALUES ($1,$2,$3,'duplicate-active','Invalid','resource',$4)", [id(181), orgA, issuer, id(93)]), code("23505"));
  await database.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role,resource_id,active) VALUES ($1,$2,$3,'historical-inactive','Former member','resource',$4,false)", [id(182), orgA, issuer, id(93)]);
  await assert.rejects(database.query("UPDATE be_memberships SET active=true WHERE id=$1", [id(182)]), code("23505"));
});

test("obligation instance and template versions prevent duplicate instantiation", async () => {
  await assert.rejects(runtime(orgA, tx => tx.query("INSERT INTO be_obligations(organization_id,id,journey_id,owner_id,fulfiller_id,verifier_id,instance_key,status,body) VALUES ($1,$2,$3,$4,$4,$4,'same-instance','open','{}')", [orgA, id(94), journeyA, memberA])), code("23505"));
  await assert.rejects(database.query("INSERT INTO be_templates(organization_id,id,kind,version,status,policy_owner_id,body) VALUES ($1,$2,'company_onboarding',1,'approved',$3,'{}')", [orgA, id(95), memberA]), code("23505"));
  assert.equal((await database.query<{ count: number }>("SELECT count(*)::int AS count FROM be_obligations WHERE instance_key='same-instance'")).rows[0].count, 2);
});

test("receipts are actor-scoped, unique, and immutable for command retry safety", async () => {
  const key = id(100), hash = "a".repeat(64);
  await runtime(orgA, tx => tx.query("INSERT INTO be_receipts(organization_id,actor_id,idempotency_key,request_hash,response) VALUES ($1,$2,$3,$4,$5)", [orgA, memberA, key, hash, { result: "original" }]));
  await assert.rejects(runtime(orgA, tx => tx.query("INSERT INTO be_receipts(organization_id,actor_id,idempotency_key,request_hash,response) VALUES ($1,$2,$3,$4,$5)", [orgA, memberA, key, "b".repeat(64), { result: "replacement" }])), code("23505"));
  await assert.rejects(runtime(orgA, tx => tx.query("UPDATE be_receipts SET response='{}'")), code("42501"));
  await assert.rejects(database.query("DELETE FROM be_receipts WHERE organization_id=$1", [orgA]), code("55000"));
  assert.deepEqual((await runtime(orgA, tx => tx.query<{ response: unknown }>("SELECT response FROM be_receipts WHERE idempotency_key=$1", [key]))).rows[0].response, { result: "original" });
  await runtime(orgB, tx => tx.query("INSERT INTO be_receipts(organization_id,actor_id,idempotency_key,request_hash,response) VALUES ($1,$2,$3,$4,'{}')", [orgB, memberB, key, hash]));
});

test("audit events remain append-only even for their table owner", async () => {
  await runtime(orgA, tx => tx.query("INSERT INTO be_events(organization_id,id,actor_id,journey_id,operation,payload) VALUES ($1,$2,$3,$4,'test','{}')", [orgA, id(101), memberA, journeyA]));
  await assert.rejects(runtime(orgA, tx => tx.query("DELETE FROM be_events")), code("42501"));
  await assert.rejects(database.query("UPDATE be_events SET operation='changed'"), code("55000"));
});

test("expected revisions prevent lost updates while acknowledgments remain version-specific", async () => {
  const update = () => runtime(orgA, tx => tx.query<{ revision: number }>("UPDATE be_obligations SET revision=revision+1,status='in_progress',body=jsonb_build_object('revision',revision+1) WHERE organization_id=$1 AND id=$2 AND revision=1 RETURNING revision", [orgA, obligationA]));
  assert.deepEqual((await update()).rows, [{ revision: 2 }]);
  assert.deepEqual((await update()).rows, []);
  await runtime(orgA, tx => tx.query("INSERT INTO be_acknowledgments(organization_id,notice_id,actor_id,notice_revision) VALUES ($1,$2,$3,1)", [orgA, noticeA, memberA]));
  await assert.rejects(runtime(orgA, tx => tx.query("INSERT INTO be_acknowledgments(organization_id,notice_id,actor_id,notice_revision) VALUES ($1,$2,$3,1)", [orgA, noticeA, memberA])), code("23505"));
});

test("administrative scripts reject an unspecified environment and unconfirmed production before connecting", () => {
  const fixtureConnection = "postgresql://fixture:never-print-this@example.invalid/bookends?sslmode=require";
  for (const script of ["scripts/migrate.ts", "scripts/bootstrap.ts"]) {
    for (const [environment, expected] of [["invalid", "Set BOOKENDS_ENV explicitly"], ["production", "explicit --production flag"]]) {
      const result = spawnSync(process.execPath, ["--import", "tsx", script], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, BOOKENDS_ENV: environment, MIGRATION_DATABASE_URL: fixtureConnection } });
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(expected));
      assert.ok(!`${result.stdout}${result.stderr}`.includes("never-print-this"));
    }
  }
  const scopedFirstAdministrator = spawnSync(process.execPath, ["--import", "tsx", "scripts/bootstrap.ts", "--organization-name", "Test organization", "--issuer", issuer, "--subject", "verified-subject", "--name", "Administrator", "--roles", "administrator,home_leader", "--home-scope", "Data"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, BOOKENDS_ENV: "preview", MIGRATION_DATABASE_URL: fixtureConnection, AUTH_OIDC_ISSUER: issuer } });
  assert.equal(scopedFirstAdministrator.status, 1);
  assert.ok(scopedFirstAdministrator.stderr.includes("administrator must be unscoped"));
  assert.ok(!`${scopedFirstAdministrator.stdout}${scopedFirstAdministrator.stderr}`.includes("never-print-this"));
});

test("runtime and administrative URL parsing reject endpoint overrides and enforce verified remote TLS", () => {
  const probe = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    require.cache[require.resolve('server-only')] = { exports: {} };
    const { runtimeDatabaseOptions } = await import('./lib/operations/db.ts');
    const { migrationClient } = await import('./scripts/migrate.ts');
    const invalid = ['?sslmode=disable','?sslmode=no-verify','?host=other.invalid','?options=-crole=postgres','?sslrootcert=local-file','#fragment'];
    const results = invalid.map(suffix => {
      const url = 'postgresql://fixture:secret@example.invalid/bookends' + suffix;
      let runtime = false, migration = false;
      try { runtimeDatabaseOptions({ BOOKENDS_ENV: 'preview', DATABASE_URL: url }); } catch { runtime = true; }
      process.env.BOOKENDS_ENV = 'preview'; process.env.MIGRATION_DATABASE_URL = url;
      try { migrationClient([]); } catch { migration = true; }
      return { runtime, migration };
    });
    let remoteLocalRejected = false;
    try { runtimeDatabaseOptions({ BOOKENDS_ENV: 'production', DATABASE_URL: 'postgresql://fixture:secret@localhost/bookends' }); } catch { remoteLocalRejected = true; }
    const options = runtimeDatabaseOptions({ BOOKENDS_ENV: 'preview', DATABASE_URL: 'postgresql://fixture:secret@example.invalid/bookends?sslmode=require' });
    process.stdout.write(JSON.stringify({ results, remoteLocalRejected, ssl: options.ssl, urlStillHasSslOverride: options.connectionString.includes('sslmode') }));
  `], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const result = JSON.parse(probe.stdout);
  assert.ok(result.results.every((value: { runtime: boolean; migration: boolean }) => value.runtime && value.migration));
  assert.equal(result.remoteLocalRejected, true);
  assert.deepEqual(result.ssl, { rejectUnauthorized: true });
  assert.equal(result.urlStillHasSslOverride, false);
});

test("administration backfills legacy client and HOME references without rewriting journey snapshots", async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(await readFile(resolve(process.cwd(), "db/migrations/0001_journeys.sql"), "utf8"));
    await legacy.query("INSERT INTO be_organizations(id,name) VALUES ($1,'Legacy organization')", [orgA]);
    await legacy.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role,home_scope) VALUES ($1,$2,$3,'legacy-admin','Legacy admin','administrator','Legacy home without resource')", [memberA, orgA, issuer]);
    await legacy.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES ($1,$2,'Legacy teammate','Data and insights',$3)", [orgA, resourceA, memberA]);
    await legacy.query("INSERT INTO be_missions(organization_id,id,name,client_name) VALUES ($1,$2,'Legacy mission','Legacy client')", [orgA, missionA]);
    const snapshot = { scope: { organizationId: orgA, homeId: "Data and insights", resourceId: resourceA, missionId: missionA }, sourceReference: "Original policy snapshot", revision: 1 };
    await legacy.query("INSERT INTO be_templates(organization_id,id,kind,version,status,body) VALUES ($1,$2,'mission_onboarding',1,'draft','{}')", [orgA, templateA]);
    await legacy.query("INSERT INTO be_journeys(organization_id,id,resource_id,mission_id,owner_id,template_id,kind,body) VALUES ($1,$2,$3,$4,$5,$6,'mission_onboarding',$7)", [orgA, journeyA, resourceA, missionA, memberA, templateA, JSON.stringify(snapshot)]);
    await legacy.exec(await readFile(resolve(process.cwd(), "db/migrations/0002_administration.sql"), "utf8"));
    assert.deepEqual((await legacy.query<{ code: string }>("SELECT code FROM be_homes ORDER BY code")).rows.map(row => row.code), ["Data and insights", "Legacy home without resource"]);
    const mission = (await legacy.query<{ client_name: string; name: string }>("SELECT m.client_name,c.name FROM be_missions m JOIN be_clients c ON c.organization_id=m.organization_id AND c.id=m.client_id")).rows[0];
    assert.deepEqual(mission, { client_name: "Legacy client", name: "Legacy client" });
    assert.equal((await legacy.query<{ home: string }>("SELECT home FROM be_resources")).rows[0].home, "Data and insights");
    assert.deepEqual((await legacy.query<{ body: unknown }>("SELECT body FROM be_journeys")).rows[0].body, snapshot);
    assert.ok((await legacy.query<{ forced: boolean }>("SELECT bool_and(relforcerowsecurity) AS forced FROM pg_class WHERE relname IN('be_organizations','be_memberships','be_resources','be_missions','be_clients','be_homes')")).rows[0].forced);
  } finally { await legacy.close(); }
});

test("migrations and bounded admin functions work with a genuine non-BYPASSRLS owner", async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec("CREATE ROLE be_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; CREATE ROLE be_migration_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT USAGE,CREATE ON SCHEMA public TO be_migration_owner; SET ROLE be_migration_owner");
    await isolated.exec(await readFile(resolve(process.cwd(), "db/migrations/0001_journeys.sql"), "utf8"));
    await isolated.query("SELECT set_config('bookends.organization_id',$1,false)", [orgA]);
    await isolated.query("INSERT INTO be_organizations(id,name) VALUES ($1,'Restricted owner organization')", [orgA]);
    await isolated.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role) VALUES ($1,$2,$3,'owner-test-admin','Administrator','administrator')", [memberA, orgA, issuer]);
    await isolated.query("INSERT INTO be_resources(organization_id,id,name,home,owner_id) VALUES ($1,$2,'Teammate','Data',$3)", [orgA, resourceA, memberA]);
    await isolated.query("INSERT INTO be_missions(organization_id,id,name,client_name) VALUES ($1,$2,'Mission','Legacy client')", [orgA, missionA]);
    await isolated.query("SELECT set_config('bookends.organization_id','',false)");
    await isolated.exec(await readFile(resolve(process.cwd(), "db/migrations/0002_administration.sql"), "utf8"));
    await isolated.exec(await readFile(resolve(process.cwd(), "db/migrations/0003_engagement_planning.sql"), "utf8"));
    assert.equal((await isolated.query("SELECT id FROM be_resources")).rows.length, 0, "FORCE RLS applies even to the migration owner after backfill");
    assert.deepEqual((await isolated.query<{ rolsuper: boolean; rolbypassrls: boolean }>("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows, [{ rolsuper: false, rolbypassrls: false }]);
    await isolated.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE be_runtime");
      await tx.query("SELECT set_config('bookends.organization_id',$1,true),set_config('bookends.actor_id',$2,true),set_config('bookends.issuer',$3,true),set_config('bookends.subject','owner-test-admin',true)", [orgA, memberA, issuer]);
      assert.equal((await tx.query<{ unsafe: boolean }>(runtimeRoleSafetySql)).rows[0].unsafe, false);
      assert.deepEqual((await tx.query<{ name: string; revision: number }>("SELECT name,revision FROM be_admin_update_organization(1,'Configured with least privilege')")).rows, [{ name: "Configured with least privilege", revision: 2 }]);
      assert.equal((await tx.query("SELECT id FROM be_admin_create_membership($1,'new-verified-subject','New member','asset_access_owner','[]',NULL,NULL)", [issuer])).rows.length, 1);
    });
    assert.equal((await isolated.query("SELECT id FROM be_memberships")).rows.length, 0, "Transaction identity context did not leak back to the owner");
  } finally { await isolated.close(); }
});

test("configuration rows remain scoped, use immutable codes, and retain historical references when inactive", async () => {
  assert.equal((await runtime(orgA, tx => tx.query("SELECT id FROM be_clients"))).rows.length, 1);
  assert.equal((await runtime(null, tx => tx.query("SELECT id FROM be_homes"))).rows.length, 0);
  await assert.rejects(runtime(orgA, tx => tx.query("UPDATE be_homes SET code='new-code' WHERE code='Data'")), code("22023"));
  await assert.rejects(runtime(orgA, tx => tx.query("DELETE FROM be_clients")), code("42501"));
  await assert.rejects(database.query("UPDATE be_missions SET client_id=$1 WHERE organization_id=$2", [id(212), orgA]), code("23503"));
  await assert.rejects(database.query("UPDATE be_resources SET home='Missing HOME' WHERE organization_id=$1", [orgA]), code("23503"));
  await runtime(orgA, tx => tx.query("UPDATE be_clients SET name='Renamed client',active=false,revision=revision+1 WHERE id=$1 AND revision=1", [id(211)]));
  assert.equal((await database.query<{ client_id: string }>("SELECT client_id FROM be_missions WHERE id=$1", [missionA])).rows[0].client_id, id(211));
  assert.deepEqual((await runtime(orgA, tx => tx.query("UPDATE be_clients SET name='Lost update' WHERE id=$1 AND revision=1 RETURNING id", [id(211)]))).rows, []);
});

test("administrative functions require a matching verified administrator and never expose private helpers", async () => {
  await assert.rejects(runtime(orgA, tx => tx.query("SELECT * FROM be_admin_update_organization(1,'Unauthorized')")), code("42501"));
  await assert.rejects(administrator(orgA, memberA, "wrong-subject", tx => tx.query("SELECT * FROM be_admin_update_organization(1,'Unauthorized')")), code("42501"));
  await assert.rejects(administrator(orgB, memberA, "subject-A", tx => tx.query("SELECT * FROM be_admin_update_organization(1,'Cross org')")), code("42501"));
  await assert.rejects(runtime(orgA, tx => tx.query("SELECT be_admin_authorize()")), code("42501"));
  await database.exec("CREATE ROLE public_only_caller");
  await assert.rejects(database.transaction(async tx => {
    await tx.exec("SET LOCAL ROLE public_only_caller");
    await tx.query("SELECT * FROM be_admin_update_organization(1,'Public caller')");
  }), code("42501"));
  const updated = await administrator(orgA, memberA, "subject-A", tx => tx.query<{ name: string; revision: number }>("SELECT name,revision FROM be_admin_update_organization(1,'Renamed organization')"));
  assert.deepEqual(updated.rows, [{ name: "Renamed organization", revision: 2 }]);
  await assert.rejects(administrator(orgA, memberA, "subject-A", tx => tx.query("SELECT * FROM be_admin_update_organization(1,'Stale')")), code("40001"));
});

test("membership commands validate role scopes, preserve identity, and reject self-escalation", async () => {
  const create = (subject: string, role: string, grants: unknown = [], resource: string | null = null, home: string | null = null) => administrator(orgA, memberA, "subject-A", tx => tx.query<{ id: string; revision: number }>("SELECT id,revision FROM be_admin_create_membership($1,$2,'New teammate',$3,$4,$5,$6)", [issuer, subject, role, JSON.stringify(grants), resource, home]));
  await assert.rejects(create("unknown-role", "superuser"), code("22023"));
  await assert.rejects(create("foreign-grant", "asset_access_owner", [{ role: "administrator", scope: { organizationId: orgB } }]), code("22023"));
  await assert.rejects(create("arbitrary-grant", "asset_access_owner", [{ role: "administrator", scope: { organizationId: orgA }, arbitrary: true }]), code("22023"));
  await assert.rejects(create("foreign-resource", "resource", [], resourceB), code("23503"));
  await assert.rejects(create("missing-home", "home_leader"), code("22023"));
  await assert.rejects(create("foreign-client", "client_liaison", [{ role: "client_liaison", scope: { organizationId: orgA, clientId: id(212) } }]), code("23503"));
  const created = (await create("admin-created-member", "asset_access_owner")).rows[0];
  assert.equal(created.revision, 1);
  const verifier = (await create("verification-only-admin", "asset_access_owner", [{ role: "administrator", scope: { organizationId: orgA } }])).rows[0];
  await assert.rejects(administrator(orgA, verifier.id, "verification-only-admin", tx => tx.query("SELECT * FROM be_admin_update_organization(2,'Extra grants cannot administer')")), code("42501"));
  const scopedAdministrator = (await create("home-scoped-admin", "administrator", [], null, "Data")).rows[0];
  await assert.rejects(administrator(orgA, scopedAdministrator.id, "home-scoped-admin", tx => tx.query("SELECT * FROM be_admin_update_organization(2,'Scoped administrators cannot administer')")), code("42501"));
  await assert.rejects(administrator(orgA, created.id, "admin-created-member", tx => tx.query("SELECT * FROM be_admin_update_membership($1,1,'Escalation','administrator','[]',NULL,NULL,true)", [created.id])), code("42501"));
  await assert.rejects(administrator(orgA, memberA, "subject-A", tx => tx.query("SELECT * FROM be_admin_update_membership($1,1,'Self','administrator',$2,$3,NULL,true)", [memberA, JSON.stringify([{ role: "asset_access_owner", scope: { organizationId: orgA } }]), id(93)])), code("42501"));
  await assert.rejects(administrator(orgA, memberA, "subject-A", tx => tx.query("SELECT * FROM be_admin_update_membership($1,1,'Self','administrator','[]',$2,NULL,false)", [memberA, id(93)])), code("42501"));
  await assert.rejects(administrator(orgA, memberA, "subject-A", tx => tx.query("SELECT * FROM be_admin_update_membership($1,1,'Other organization','administrator','[]',NULL,NULL,true)", [memberB])), code("23503"));
  const updated = await administrator(orgA, memberA, "subject-A", tx => tx.query<{ revision: number; active: boolean }>("SELECT revision,active FROM be_admin_update_membership($1,1,'Disabled teammate','asset_access_owner','[]',NULL,NULL,false)", [created.id]));
  assert.deepEqual(updated.rows, [{ revision: 2, active: false }]);
  await assert.rejects(administrator(orgA, memberA, "subject-A", tx => tx.query("SELECT * FROM be_admin_update_membership($1,1,'Stale','asset_access_owner','[]',NULL,NULL,true)", [created.id])), code("40001"));
  await assert.rejects(database.query("UPDATE be_memberships SET subject='changed-identity' WHERE id=$1", [created.id]), code("22023"));
});
