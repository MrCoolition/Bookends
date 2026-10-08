import { authorizeSharedSetup, provisionSharedWorkspace } from "@/lib/shared/setup";
import { sharedFailure, SHARED_PRIVATE_HEADERS } from "@/lib/shared/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    authorizeSharedSetup(request);
    return Response.json(await provisionSharedWorkspace(), { headers: SHARED_PRIVATE_HEADERS });
  } catch (error) { return sharedFailure(error); }
}
