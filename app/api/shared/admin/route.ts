import { MAX_LOCAL_ADMIN_BYTES } from "@/lib/admin/local";
import { readOperationBody } from "@/lib/operations/http";
import { sharedAdminStore, updateSharedAdmin } from "@/lib/shared/db";
import { checkSharedMutationOrigin, sharedFailure, SHARED_PRIVATE_HEADERS } from "@/lib/shared/http";
import { requireSharedWorkspaceSession } from "@/lib/shared/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await sharedAdminStore(), { headers: SHARED_PRIVATE_HEADERS }); }
  catch (error) { return sharedFailure(error); }
}
async function save(request: Request, kind: "command" | "snapshot") {
  try {
    checkSharedMutationOrigin(request);
    await requireSharedWorkspaceSession();
    const input = await readOperationBody(request, MAX_LOCAL_ADMIN_BYTES + 1024);
    return Response.json(await updateSharedAdmin(input, kind), { headers: SHARED_PRIVATE_HEADERS });
  } catch (error) { return sharedFailure(error); }
}
export const POST = (request: Request) => save(request, "command");
export const PUT = (request: Request) => save(request, "snapshot");
