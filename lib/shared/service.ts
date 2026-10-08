import { z } from "zod";
import { createHash } from "node:crypto";
import { applyLocalAdminCommand, createLocalAdminStore, parseLocalAdminStore, type LocalAdminCommand, type LocalAdminStore } from "../admin/local";
import { seedLocalAdminClients } from "../admin/client-seed";
import type { OperationsQuery } from "../operations/service";
import { SharedWorkspaceError } from "./config";
import type { SharedSession } from "./crypto";

const revision = z.int().positive().max(2_147_483_646);
export const sharedCommandSchema = z.object({ expectedRevision: revision, idempotencyKey: z.uuid().optional(), command: z.unknown() }).strict();
export const sharedSnapshotSchema = z.object({ expectedRevision: revision, idempotencyKey: z.uuid().optional(), store: z.unknown() }).strict();

/** Call within a transaction after setting the workspace scope; all writes hold its row lock. */
export async function loadSharedStore(db: OperationsQuery, workspaceId: string, forUpdate = false): Promise<LocalAdminStore> {
  const seed = seedLocalAdminClients(createLocalAdminStore());
  await db.query("INSERT INTO be_shared_workspaces(workspace_id,revision,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(workspace_id) DO NOTHING", [workspaceId, seed.revision, JSON.stringify(seed)]);
  const result = await db.query<{ revision: number; body: unknown }>(`SELECT revision,body FROM be_shared_workspaces WHERE workspace_id=$1${forUpdate ? " FOR UPDATE" : ""}`, [workspaceId]);
  const row = result.rows[0];
  if (!row) throw new SharedWorkspaceError("unavailable", "This workspace could not be opened.", 503);
  const store = parseLocalAdminStore(row.body);
  if (store.revision !== row.revision) throw new SharedWorkspaceError("unavailable", "This workspace needs recovery before editing.", 503);
  return store;
}
export async function saveSharedStore(db: OperationsQuery, session: SharedSession, input: unknown, kind: "command" | "snapshot") {
  const request = kind === "command" ? sharedCommandSchema.parse(input) : sharedSnapshotSchema.parse(input);
  const current = await loadSharedStore(db, session.workspaceId, true);
  const requestHash = createHash("sha256").update(JSON.stringify({ kind, payload: "command" in request ? request.command : request.store })).digest("hex");
  if (request.idempotencyKey) {
    const prior = (await db.query<{ request_hash: string }>("SELECT request_hash FROM be_shared_audit WHERE workspace_id=$1 AND request_id=$2", [session.workspaceId, request.idempotencyKey])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw new SharedWorkspaceError("conflict", "This retry refers to a different change. Refresh the workspace and review your draft before saving.", 409);
      return current;
    }
  }
  if (request.expectedRevision !== current.revision) throw new SharedWorkspaceError("conflict", "Someone saved a change while you were editing. Refresh the workspace, then review and save your draft again.", 409);
  let next: LocalAdminStore, action: string;
  if ("command" in request) {
    if (!request.command || typeof request.command !== "object" || !("type" in request.command) || typeof request.command.type !== "string") throw new SharedWorkspaceError("invalid", "Choose a valid workspace change.", 422);
    next = applyLocalAdminCommand(current, request.command as LocalAdminCommand);
    action = request.command.type;
  } else {
    const imported = seedLocalAdminClients(parseLocalAdminStore(request.store));
    next = parseLocalAdminStore({ ...imported, revision: current.revision + 1, data: { ...imported.data, asOf: new Date().toISOString() } });
    action = "replace_reviewed_setup";
  }
  await db.query("UPDATE be_shared_workspaces SET revision=$2,body=$3::jsonb,updated_at=now() WHERE workspace_id=$1", [session.workspaceId, next.revision, JSON.stringify(next)]);
  await db.query("INSERT INTO be_shared_audit(workspace_id,revision,session_id,action,request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6)", [session.workspaceId, next.revision, session.sessionId, action, request.idempotencyKey ?? null, request.idempotencyKey ? requestHash : null]);
  return next;
}
export type SharedBudget = { scope: string; limit: number; windowSeconds: number };
/** Return the result instead of throwing: rejection must commit the counter too. */
export async function consumeBudget(db: OperationsQuery, workspaceId: string, input: SharedBudget, now = Date.now()) {
  const budget = z.object({ scope: z.string().regex(/^[a-zA-Z0-9:-]{1,180}$/), limit: z.int().min(1).max(10000), windowSeconds: z.int().min(1).max(86400) }).parse(input);
  const seconds = Math.floor(now / 1000), start = Math.floor(seconds / budget.windowSeconds) * budget.windowSeconds;
  const row = (await db.query<{ attempts: number }>(`INSERT INTO be_shared_limits(workspace_id,bucket,window_start,attempts) VALUES($1,$2,$3,1)
    ON CONFLICT(workspace_id,bucket) DO UPDATE SET window_start=EXCLUDED.window_start,
    attempts=CASE WHEN be_shared_limits.window_start=EXCLUDED.window_start THEN least(be_shared_limits.attempts+1,$4) ELSE 1 END RETURNING attempts`, [workspaceId, budget.scope, start, budget.limit + 1])).rows[0];
  return { allowed: !!row && row.attempts <= budget.limit, retryAfterSeconds: start + budget.windowSeconds - seconds };
}
