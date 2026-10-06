import { ZodError } from "zod";
import { JourneyRuleError } from "../journeys/rules";
import { OperationsError } from "./service";
import { getAuthConfigurationStatus } from "../auth/config";

export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie" };
export const MAX_OPERATION_BYTES = 32_768;
export const MAX_ADMIN_BYTES = 1_048_576;
export function checkMutationOrigin(request: Request) {
  const origin = getAuthConfigurationStatus().origin;
  if (!origin || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new OperationsError("forbidden", "This change must be made from your signed-in BOOKENDS workspace.", 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new OperationsError("invalid", "Send a JSON request.", 415);
}
export async function readOperationBody(request: Request, maxBytes = MAX_OPERATION_BYTES): Promise<unknown> {
  const tooLarge = () => new OperationsError("invalid", "This update is too large. Shorten the content or save a smaller change; your entered details are still in the form.", 413);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) throw new OperationsError("invalid", "The request length is invalid.", 400);
  if (declared !== null && Number(declared) > maxBytes) throw tooLarge();
  if (!request.body) throw new SyntaxError("Missing JSON request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch { throw new SyntaxError("Request body must contain valid UTF-8 JSON."); }
  return JSON.parse(text);
}
export function operationFailure(error: unknown) {
  let status = 500, code = "unavailable", message = "We couldn’t complete that request. Your inputs are still here; please try again.";
  if (error instanceof OperationsError) { status = error.status; code = error.code; message = error.message; }
  else if (error instanceof JourneyRuleError) { code = error.code; message = error.message; status = error.code === "forbidden" ? 403 : error.code === "conflict" ? 409 : 422; }
  else if (error instanceof ZodError) { status = 422; code = "invalid"; message = error.issues[0]?.message ?? "Check the highlighted values."; }
  else if (error instanceof SyntaxError) { status = 400; code = "invalid"; message = "This request could not be read. Please reload and try again."; }
  else {
    const diagnostic = typeof error === "object" && error && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,16}$/.test(error.code) ? error.code : "unknown";
    console.error("BOOKENDS operation failed", { code: diagnostic });
  }
  return Response.json({ error: { code, message } }, { status, headers: PRIVATE_HEADERS });
}
