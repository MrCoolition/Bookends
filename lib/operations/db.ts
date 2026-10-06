import "server-only";
import { Pool, type PoolConfig } from "pg";
import { readIdentity } from "../auth/identity";
import { OperationsError, type Membership, type OperationsQuery } from "./service";

let pool: Pool | undefined;
export function runtimeDatabaseOptions(env: Readonly<Record<string, string | undefined>> = process.env): PoolConfig {
  const fail = () => new OperationsError("setup_required", "A valid restricted PostgreSQL runtime connection with verified TLS is required.", 503);
  if (!env.DATABASE_URL || env.DATABASE_URL === "[SENSITIVE]" || !["development", "preview", "production"].includes(env.BOOKENDS_ENV ?? "")) throw fail();
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw fail(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1) || url.hash) throw fail();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (local && env.BOOKENDS_ENV !== "development") throw fail();
  // Reject options that could override the parsed host, credentials, TLS, search path, or role.
  if ([...url.searchParams.keys()].some(key => !["sslmode", "channel_binding"].includes(key))) throw fail();
  const sslMode = url.searchParams.get("sslmode");
  if (!local && sslMode && !["require", "verify-ca", "verify-full"].includes(sslMode)) throw fail();
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true }, max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000, statement_timeout: 10_000, query_timeout: 12_000, application_name: "bookends-journeys" };
}
export function databaseConfigured() { try { runtimeDatabaseOptions(); return true; } catch { return false; } }

export const RUNTIME_ROLE_SAFETY_SQL = `SELECT
  EXISTS (SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole))
  OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'be_%' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'MEMBER'))
  OR has_table_privilege(current_user,'be_memberships','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_any_column_privilege(current_user,'be_memberships','INSERT,UPDATE')
  OR has_table_privilege(current_user,'be_organizations','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_any_column_privilege(current_user,'be_organizations','INSERT,UPDATE') AS unsafe`;
function getPool() {
  if (!databaseConfigured()) throw new OperationsError("setup_required", "The production database connection has not been configured.", 503);
  if (!pool) {
    pool = new Pool(runtimeDatabaseOptions());
    pool.on("error", () => { console.error("BOOKENDS database pool connection failed."); });
  }
  return pool;
}
export async function withMember<T>(operation: (db: OperationsQuery, member: Membership) => Promise<T>): Promise<T> {
  const identity = await readIdentity();
  if (!identity) throw new OperationsError("unauthenticated", "Sign in to your organization to continue.", 401);
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('bookends.organization_id','',true),set_config('bookends.actor_id','',true),set_config('bookends.issuer','',true),set_config('bookends.subject','',true)");
    const role = (await client.query<{unsafe:boolean}>(RUNTIME_ROLE_SAFETY_SQL)).rows[0];
    if (!role || role.unsafe) throw new OperationsError("setup_required", "The application requires a restricted database runtime role.", 503);
    await client.query("SELECT set_config('bookends.issuer',$1,true),set_config('bookends.subject',$2,true)", [identity.issuer,identity.subject]);
    // Fresh authorization every request; no membership mutation or UPDATE privilege is available to this login.
    const member = (await client.query<Membership>("SELECT * FROM be_memberships WHERE issuer=$1 AND subject=$2 AND active", [identity.issuer,identity.subject])).rows[0];
    if (!member) throw new OperationsError("membership_required", "Your identity is verified. An administrator still needs to grant workspace access.", 403);
    await client.query("SELECT set_config('bookends.organization_id',$1,true),set_config('bookends.actor_id',$2,true)", [member.organization_id,member.id]);
    const result = await operation(client as OperationsQuery, member);
    await client.query("COMMIT");
    return result;
  } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
  finally { client.release(discard); }
}
