import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import type { OperationsQuery } from "../../lib/operations/service";

async function main() {
const moduleRequire = createRequire(`${process.cwd()}/package.json`);
moduleRequire.cache[moduleRequire.resolve("server-only")] = { exports: {} } as NodeJS.Module;
const { provisionSharedDatabase } = await import("../../lib/shared/setup");
const database = new PGlite();
const db: OperationsQuery = {
  async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]) {
    if (values?.length) return database.query<T>(sql, values);
    const results = await database.exec(sql);
    return { rows: (results.at(-1)?.rows ?? []) as T[] };
  },
};
const login = "bookends_shared_app_v1", password = "isolated_test_password_that_is_not_a_real_credential_1234";
try {
  let checks = 0;
  const applied = await provisionSharedDatabase(db, password, async () => { checks++; });
  assert.ok(applied.includes("0004_shared_workspace.sql"));
  assert.equal(checks, 0);
  const flags = await database.query("SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1", [login]);
  assert.deepEqual(flags.rows[0], { rolcanlogin: true, rolinherit: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
  const memberships = await database.query("SELECT role.rolname FROM pg_auth_members membership JOIN pg_roles role ON role.oid=membership.roleid JOIN pg_roles member ON member.oid=membership.member WHERE member.rolname=$1", [login]);
  assert.deepEqual(memberships.rows, [{ rolname: "be_runtime" }]);
  const storedPassword = (await database.query("SELECT rolpassword FROM pg_authid WHERE rolname=$1", [login])).rows[0];
  assert.deepEqual(await provisionSharedDatabase(db, password, async () => { checks++; }), []);
  assert.equal(checks, 1);
  assert.deepEqual((await database.query("SELECT rolpassword FROM pg_authid WHERE rolname=$1", [login])).rows[0], storedPassword);
  await assert.rejects(provisionSharedDatabase(db, "different_isolated_password_not_a_real_credential_5678", async () => { throw new Error("Existing password did not match"); }), /did not match/);
  assert.deepEqual((await database.query("SELECT rolpassword FROM pg_authid WHERE rolname=$1", [login])).rows[0], storedPassword);
  await database.exec(`ALTER ROLE ${login} CREATEDB`);
  await assert.rejects(provisionSharedDatabase(db, password, async () => {}), /unexpected privileges/);
  await database.exec(`ALTER ROLE ${login} NOCREATEDB`);
  await database.exec(`CREATE ROLE unrelated_role; GRANT unrelated_role TO ${login}`);
  await assert.rejects(provisionSharedDatabase(db, password, async () => {}), /unrelated database memberships/);
  await database.exec(`REVOKE unrelated_role FROM ${login}`);
  await database.query("UPDATE be_schema_migrations SET checksum=$1 WHERE version='0004_shared_workspace.sql'", ["0".repeat(64)]);
  await assert.rejects(provisionSharedDatabase(db, password, async () => {}), /applied migration differs/);
  await database.transaction(async tx => {
    await tx.exec(`SET LOCAL ROLE ${login}`);
    assert.deepEqual((await tx.query("SELECT * FROM be_shared_workspaces")).rows, []);
    assert.deepEqual((await tx.query("SELECT * FROM be_memberships")).rows, []);
    await assert.rejects(tx.query("DELETE FROM be_shared_audit"), error => (error as { code?: string }).code === "42501");
  });
  process.stdout.write("provisioning-passed");
} finally { await database.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
