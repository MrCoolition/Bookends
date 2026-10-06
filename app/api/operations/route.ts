import { withMember } from "@/lib/operations/db";
import { executeOperation, loadOperations } from "@/lib/operations/service";
import { operationsRequestSchema } from "@/lib/operations/validation";
import { checkMutationOrigin, readOperationBody, operationFailure, PRIVATE_HEADERS } from "@/lib/operations/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await withMember(loadOperations), { headers: PRIVATE_HEADERS }); }
  catch (error) { return operationFailure(error); }
}
export async function POST(request: Request) {
  try {
    checkMutationOrigin(request);
    const command = operationsRequestSchema.parse(await readOperationBody(request));
    const data = await withMember(async (db, member) => { await executeOperation(db,member,command); return loadOperations(db,member); });
    return Response.json(data, { headers: PRIVATE_HEADERS });
  } catch (error) { return operationFailure(error); }
}
