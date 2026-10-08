import "server-only";
import { Pool } from "pg";
import { RUNTIME_ROLE_SAFETY_SQL, runtimeDatabaseOptions } from "../operations/db";
import type { OperationsQuery } from "../operations/service";
import { sharedConfiguration, SharedWorkspaceError } from "./config";
import type { SharedSession } from "./crypto";
import { consumeBudget, loadSharedStore, saveSharedStore, type SharedBudget } from "./service";
import { requireSharedWorkspaceSession } from "./session";

let pool: Pool | undefined;
function sharedPool() {
  sharedConfiguration();
  if (!pool) {
    pool = new Pool({ ...runtimeDatabaseOptions({ ...process.env, DATABASE_URL: process.env.BOOKENDS_SHARED_DATABASE_URL || process.env.DATABASE_URL }), application_name: "bookends-shared-workspace" });
    pool.on("error", () => console.error("BOOKENDS shared database connection failed."));
  }
  return pool;
}
async function withSharedDatabase<T>(workspaceId: string, operation: (db: OperationsQuery) => Promise<T>): Promise<T> {
  if (workspaceId !== sharedConfiguration().workspaceId) throw new SharedWorkspaceError("forbidden", "This session belongs to another workspace.", 403);
  const client = await sharedPool().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('bookends.organization_id','',true),set_config('bookends.actor_id','',true),set_config('bookends.issuer','',true),set_config('bookends.subject','',true),set_config('bookends.shared_workspace_id',$1,true)", [workspaceId]);
    const safe = (await client.query<{ unsafe: boolean }>(RUNTIME_ROLE_SAFETY_SQL)).rows[0];
    if (!safe || safe.unsafe) throw new SharedWorkspaceError("setup_required", "The shared workspace requires a restricted database login.", 503);
    const result = await operation(client as OperationsQuery);
    await client.query("COMMIT");
    return result;
  } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
  finally { client.release(discard); }
}
export async function sharedAdminStore() {
  const session = await requireSharedWorkspaceSession();
  return withSharedDatabase(session.workspaceId, db => loadSharedStore(db, session.workspaceId));
}
export async function updateSharedAdmin(input: unknown, kind: "command" | "snapshot") {
  const session = await requireSharedWorkspaceSession();
  return withSharedDatabase(session.workspaceId, db => saveSharedStore(db, session, input, kind));
}
export async function consumeSharedBudget(session: Pick<SharedSession, "workspaceId">, input: SharedBudget) {
  const result = await withSharedDatabase(session.workspaceId, db => consumeBudget(db, session.workspaceId, input));
  if (!result.allowed) throw new SharedWorkspaceError("rate_limited", "Give this workspace a moment before trying again.", 429, result.retryAfterSeconds);
}
