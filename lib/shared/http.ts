import { ZodError } from "zod";
import { LocalAdminError } from "../admin/local";
import { OperationsError } from "../operations/service";
import { SharedWorkspaceError, sharedConfiguration } from "./config";
export const SHARED_PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export function checkSharedOrigin(request: Request) {
  if (request.headers.get("origin") !== sharedConfiguration().origin || request.headers.get("sec-fetch-site") === "cross-site") throw new SharedWorkspaceError("forbidden", "Open this change from your BOOKENDS workspace.", 403);
}
export function checkSharedMutationOrigin(request: Request) {
  checkSharedOrigin(request);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new SharedWorkspaceError("invalid", "Send a JSON request.", 415);
}
export function sharedFailure(error: unknown) {
  let status = 503, code = "unavailable", message = "The shared workspace could not be reached. Your changes have not been discarded; please try again.";
  let retryAfter: number | undefined;
  if (error instanceof SharedWorkspaceError || error instanceof OperationsError) { status = error.status; code = error.code; message = error.message; if (error instanceof SharedWorkspaceError) retryAfter = error.retryAfterSeconds; }
  else if (error instanceof LocalAdminError) { status = error.code === "conflict" ? 409 : 422; code = error.code; message = error.message; }
  else if (error instanceof ZodError) { status = 422; code = "invalid"; message = error.issues[0]?.message ?? "Check the submitted values."; }
  else if (error instanceof SyntaxError) { status = 400; code = "invalid"; message = "This request could not be read."; }
  else console.error("BOOKENDS shared workspace request failed.");
  return Response.json({ error: { code, message } }, { status, headers: { ...SHARED_PRIVATE_HEADERS, ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}
