import { sowCapability } from "@/lib/ai/config";
import { generateSowDraft } from "@/lib/ai/generate";
import { handleSowPost, SOW_PRIVATE_HEADERS, sowHttpFailure } from "@/lib/ai/http";
import { consumeSharedBudget } from "@/lib/shared/db";
import { checkSharedOrigin } from "@/lib/shared/http";
import { requireSharedWorkspaceSession } from "@/lib/shared/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  try { await requireSharedWorkspaceSession(); return Response.json(sowCapability(), { headers: SOW_PRIVATE_HEADERS }); }
  catch (error) { return sowHttpFailure(error); }
}
export async function POST(request: Request) {
  return handleSowPost(request, { checkOrigin: checkSharedOrigin, authenticate: requireSharedWorkspaceSession, capability: sowCapability, consumeBudget: consumeSharedBudget, generate: generateSowDraft });
}
