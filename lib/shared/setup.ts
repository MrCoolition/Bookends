import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { RUNTIME_ROLE_SAFETY_SQL } from "../operations/db";
import type { OperationsQuery } from "../operations/service";
import { SharedWorkspaceError } from "./config";

const RUNTIME_LOGIN = "bookends_shared_app_v1";
/** Temporary operator-only activation; no request may supply SQL or credentials. */
export function authorizeSharedSetup(request: Request, env: Readonly<Record<string, string | undefined>> = process.env) {
  const expected = env.BOOKENDS_SETUP_TOKEN ?? "", provided = /^Bearer ([a-zA-Z0-9_-]{48,128})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (env.BOOKENDS_SETUP_ENABLED !== "1" || !/^[a-zA-Z0-9_-]{48,128}$/.test(expected) || !timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(provided).digest())) throw new SharedWorkspaceError("not_found", "Not found.", 404);
}
function setupConnection() {
  const failure = () => new SharedWorkspaceError("setup_required", "The existing database integration is unavailable for activation.", 503);
  const source = process.env.neon_connect;
  if (!source || source === "[SENSITIVE]" || process.env.BOOKENDS_ENV !== "production") throw failure();
  let url: URL;
  try { url = new URL(source); } catch { throw failure(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password || !url.pathname.slice(1) || !url.hostname.endsWith(".neon.tech") || url.hash || [...url.searchParams.keys()].some(key => !["sslmode", "channel_binding"].includes(key))) throw failure();
  url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  url.searchParams.delete("sslmode");
  return url;
}
function clientFor(url: URL) {
  return new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, statement_timeout: 120000, application_name: "bookends-shared-activation" });
}
export async function provisionSharedWorkspace() {
  const password = process.env.BOOKENDS_SETUP_RUNTIME_PASSWORD ?? "";
  if (!/^[a-zA-Z0-9_-]{48,128}$/.test(password)) throw new SharedWorkspaceError("setup_required", "A generated runtime password is required for activation.", 503);
  const source = setupConnection(), runtime = new URL(source);
  runtime.username = RUNTIME_LOGIN; runtime.password = password;
  const db = clientFor(source);
  await db.connect();
  try {
    const applied = await provisionSharedDatabase(db as OperationsQuery, password, async () => {
      const probe = clientFor(runtime);
      try { await probe.connect(); } finally { await probe.end(); }
    });
    return { applied, runtime: { host: source.hostname, port: source.port || "5432", database: decodeURIComponent(source.pathname.slice(1)), username: RUNTIME_LOGIN, sslmode: "verify-full" } };
  } finally { await db.end(); }
}

/** Transactional activation core, also exercised against an isolated PostgreSQL engine. */
export async function provisionSharedDatabase(db: OperationsQuery, password: string, verifyExistingPassword: () => Promise<void>) {
  if (!/^[a-zA-Z0-9_-]{48,128}$/.test(password)) throw new SharedWorkspaceError("setup_required", "A generated runtime password is required for activation.", 503);
  const appliedNow: string[] = [];
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('bookends:migrations'))");
    await db.query("CREATE TABLE IF NOT EXISTS be_schema_migrations (version text PRIMARY KEY, checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())");
    await db.query("REVOKE ALL ON be_schema_migrations FROM PUBLIC");
    const directory = resolve(process.cwd(), "db/migrations"), files = (await readdir(directory)).filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
    if (!files.includes("0004_shared_workspace.sql")) throw new SharedWorkspaceError("setup_required", "The reviewed shared-workspace migration is missing.", 503);
    const applied = (await db.query<{ version: string; checksum: string }>("SELECT version,checksum FROM be_schema_migrations ORDER BY version")).rows;
    if (applied.some(row => !files.includes(row.version))) throw new SharedWorkspaceError("setup_required", "This deployment does not contain the complete migration history.", 503);
    for (const file of files) {
      const body = (await readFile(resolve(directory, file), "utf8")).replace(/\r\n/g, "\n");
      const checksum = createHash("sha256").update(body).digest("hex"), existing = applied.find(row => row.version === file);
      if (existing) {
        if (existing.checksum !== checksum) throw new SharedWorkspaceError("setup_required", "An applied migration differs from the reviewed source.", 503);
        continue;
      }
      await db.query(body);
      await db.query("INSERT INTO be_schema_migrations(version,checksum) VALUES($1,$2)", [file, checksum]);
      appliedNow.push(file);
    }
    const base = (await db.query<{ safe: boolean }>("SELECT NOT(rolsuper OR rolbypassrls OR rolcanlogin OR rolcreatedb OR rolcreaterole) AS safe FROM pg_roles WHERE rolname='be_runtime'")).rows[0];
    if (!base?.safe) throw new SharedWorkspaceError("setup_required", "The runtime privilege role does not meet the required limits.", 503);
    const existing = (await db.query<{ safe: boolean }>("SELECT rolcanlogin AND rolinherit AND NOT(rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AS safe FROM pg_roles WHERE rolname=$1", [RUNTIME_LOGIN])).rows[0];
    if (existing) {
      if (!existing.safe) throw new SharedWorkspaceError("setup_required", "An existing runtime login has unexpected privileges; it has not been modified.", 503);
      // Verify the already-provisioned password without changing it or taking over an existing login.
      await verifyExistingPassword();
    } else {
      // Password is strictly generated base64url above, never a request value or SQL fragment.
      await db.query(`CREATE ROLE ${RUNTIME_LOGIN} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    }
    const memberships = await db.query<{ role: string }>("SELECT role.rolname AS role FROM pg_auth_members membership JOIN pg_roles role ON role.oid=membership.roleid JOIN pg_roles member ON member.oid=membership.member WHERE member.rolname=$1", [RUNTIME_LOGIN]);
    if (memberships.rows.some(row => row.role !== "be_runtime")) throw new SharedWorkspaceError("setup_required", "The runtime login has unrelated database memberships; it has not been modified.", 503);
    await db.query(`GRANT be_runtime TO ${RUNTIME_LOGIN}`);
    // Inspect the login directly: modern Postgres role creators need not have SET ROLE.
    const safety = (await db.query<{ unsafe: boolean }>(RUNTIME_ROLE_SAFETY_SQL.replaceAll("current_user", "$1::name"), [RUNTIME_LOGIN])).rows[0];
    if (!safety || safety.unsafe) throw new SharedWorkspaceError("setup_required", "The runtime login failed the least-privilege check.", 503);
    await db.query("COMMIT");
    return appliedNow;
  } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
}
