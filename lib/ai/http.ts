import { SharedWorkspaceError } from "../shared/config";
import { SowIntakeError, type SowCapability, type SowIntakeResult } from "./contracts";
import { readSowRequest, type SowInput } from "./input";
import { sowGenerationFailure } from "./generate";

export const SOW_PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export function sowHttpFailure(error: unknown): Response {
  const failure = error instanceof SowIntakeError || error instanceof SharedWorkspaceError ? error : new SowIntakeError("workspace_unavailable", "SOW reading could not reach the workspace. Please try again shortly.", 503);
  const retryAfter = error instanceof SharedWorkspaceError ? error.retryAfterSeconds : undefined;
  return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers: { ...SOW_PRIVATE_HEADERS, ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}
type SowDependencies<Session> = {
  checkOrigin(request: Request): void;
  authenticate(): Promise<Session>;
  capability(): SowCapability;
  consumeBudget(session: Session, input: { scope: string; limit: number; windowSeconds: number }): Promise<void>;
  generate(input: SowInput, signal: AbortSignal): Promise<SowIntakeResult>;
};
/** The ordering is deliberate: auth and validation precede paid work and quota consumption. */
export async function handleSowPost<Session>(request: Request, deps: SowDependencies<Session>): Promise<Response> {
  try {
    deps.checkOrigin(request);
    const session = await deps.authenticate(), capability = deps.capability();
    if (!capability.available) throw new SowIntakeError("ai_unavailable", capability.reason ?? "SOW reading is not connected yet.", 503);
    const input = await readSowRequest(request);
    await deps.consumeBudget(session, { scope: "sow-intake-minute", limit: 3, windowSeconds: 60 });
    await deps.consumeBudget(session, { scope: "sow-intake", limit: 20, windowSeconds: 86400 });
    let result: SowIntakeResult;
    try { result = await deps.generate(input, request.signal); } catch (error) { throw sowGenerationFailure(error); }
    return Response.json(result, { headers: SOW_PRIVATE_HEADERS });
  } catch (error) { return sowHttpFailure(error); }
}
