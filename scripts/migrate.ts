import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

export class SetupError extends Error {}

/** These tools never fall back to DATABASE_URL or fetch production credentials. */
export function migrationClient(args: string[] = process.argv.slice(2)): { client: Client; environment: string } {
  loadEnvConfig(process.cwd(), process.env.BOOKENDS_ENV === "development", { info() {}, error() {} });
  const environment = process.env.BOOKENDS_ENV;
  if (!environment || !["development", "preview", "production"].includes(environment)) throw new SetupError("Set BOOKENDS_ENV explicitly to development, preview, or production.");
  if (environment === "production" && !args.includes("--production")) throw new SetupError("Production database changes require the explicit --production flag.");
  if (environment !== "production" && args.includes("--production")) throw new SetupError("The --production flag requires BOOKENDS_ENV=production.");
  if (!process.env.MIGRATION_DATABASE_URL) throw new SetupError("MIGRATION_DATABASE_URL is required; runtime credentials are never used for migrations.");
  let url: URL;
  try { url = new URL(process.env.MIGRATION_DATABASE_URL); } catch { throw new SetupError("MIGRATION_DATABASE_URL is not a valid PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1) || url.hash) throw new SetupError("MIGRATION_DATABASE_URL must identify a PostgreSQL database and migration login.");
  if (url.hostname.split(".")[0].endsWith("-pooler") || url.searchParams.get("pgbouncer") === "true") throw new SetupError("Migrations require a direct database endpoint, not a pooled endpoint.");
  if ([...url.searchParams.keys()].some(key => !["sslmode", "channel_binding"].includes(key))) throw new SetupError("Database URL options may specify only sslmode and channel_binding; endpoint, credentials, role, and TLS overrides are not permitted.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (local && environment !== "development") throw new SetupError("Local database endpoints are permitted only for development.");
  const sslMode = url.searchParams.get("sslmode");
  if (!local && sslMode && !["require", "verify-ca", "verify-full"].includes(sslMode)) throw new SetupError("Remote database connections require verified TLS.");
  // pg parses URL TLS options after constructor options; remove them to enforce certificate verification.
  url.searchParams.delete("sslmode");
  return { environment, client: new Client({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 10_000, statement_timeout: 120_000, application_name: "bookends-administration" }) };
}

export function reportSetupFailure(error: unknown) {
  if (error instanceof SetupError) console.error(error.message);
  else {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,16}$/.test(error.code) ? error.code : "UNAVAILABLE";
    console.error(`Database operation failed (${code}). Credentials and record values have not been logged.`);
  }
  process.exitCode = 1;
}

export async function migrate() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--production")) throw new SetupError("Supported migration option: --production.");
  const { client, environment } = migrationClient(args);
  const directory = resolve(process.cwd(), "db/migrations");
  const files = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!files.length) throw new SetupError("No reviewed SQL migration files were found.");
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('bookends:migrations'))");
    await client.query("CREATE TABLE IF NOT EXISTS be_schema_migrations (version text PRIMARY KEY, checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())");
    await client.query("REVOKE ALL ON be_schema_migrations FROM PUBLIC");
    const applied = await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM be_schema_migrations ORDER BY version");
    if (applied.rows.some(row => !files.includes(row.version))) throw new SetupError("An applied migration is missing from this checkout; use the complete reviewed migration history.");
    const pending: string[] = [];
    for (const file of files) {
      const body = (await readFile(resolve(directory, file), "utf8")).replace(/\r\n/g, "\n");
      const checksum = createHash("sha256").update(body).digest("hex");
      const prior = applied.rows.find(row => row.version === file);
      if (prior) {
        if (prior.checksum !== checksum) throw new SetupError(`Applied migration checksum differs: ${file}. Add a new migration instead of editing history.`);
        continue;
      }
      await client.query(body);
      await client.query("INSERT INTO be_schema_migrations(version,checksum) VALUES ($1,$2)", [file, checksum]);
      pending.push(file);
    }
    const runtime = await client.query("SELECT 1 FROM pg_roles WHERE rolname='be_runtime' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolcreatedb AND NOT rolcreaterole");
    if (!runtime.rowCount) throw new SetupError("A database administrator must create the least-privilege NOLOGIN be_runtime role before migration can complete.");
    await client.query("COMMIT");
    console.log(JSON.stringify({ environment, applied: pending, alreadyApplied: applied.rowCount }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) migrate().catch(reportSetupFailure);
