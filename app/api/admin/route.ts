import { withMember } from "@/lib/operations/db";
import { loadAdmin, executeAdmin } from "@/lib/admin/service";
import { adminRequestSchema } from "@/lib/admin/validation";
import { checkMutationOrigin, readOperationBody, operationFailure, PRIVATE_HEADERS, MAX_ADMIN_BYTES } from "@/lib/operations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json(await withMember(loadAdmin), { headers: PRIVATE_HEADERS }); }
  catch (error) { return operationFailure(error); }
}

export async function POST(request: Request) {
  try {
    checkMutationOrigin(request);
    const command = adminRequestSchema.parse(await readOperationBody(request, MAX_ADMIN_BYTES));
    const data = await withMember(async (db, member) => {
      await executeAdmin(db, member, command);
      return loadAdmin(db, member);
    });
    return Response.json(data, { headers: PRIVATE_HEADERS });
  } catch (error) { return operationFailure(error); }
}
