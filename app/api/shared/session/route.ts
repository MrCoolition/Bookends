import { cookies } from "next/headers";
import { z } from "zod";
import { readOperationBody } from "@/lib/operations/http";
import { sharedConfiguration, sharedWorkspaceConfigured, SharedWorkspaceError } from "@/lib/shared/config";
import { issueSharedSession, privateBucket, SHARED_SESSION_SECONDS, verifyWorkspacePasscode } from "@/lib/shared/crypto";
import { consumeSharedBudget } from "@/lib/shared/db";
import { checkSharedMutationOrigin, sharedFailure, SHARED_PRIVATE_HEADERS } from "@/lib/shared/http";
import { SHARED_COOKIE_NAME, sharedWorkspaceSession } from "@/lib/shared/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ configured: sharedWorkspaceConfigured(), authenticated: !!(await sharedWorkspaceSession()) }, { headers: SHARED_PRIVATE_HEADERS }); }
  catch (error) { return sharedFailure(error); }
}
export async function POST(request: Request) {
  try {
    checkSharedMutationOrigin(request);
    const config = sharedConfiguration();
    const { passcode } = z.object({ passcode: z.string().min(1).max(256) }).strict().parse(await readOperationBody(request, 2048));
    // Vercel overwrites x-forwarded-for at its trusted proxy. No raw IP is persisted.
    const address = process.env.VERCEL ? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown" : "development";
    await consumeSharedBudget(config, { scope: "sign-in-global", limit: 500, windowSeconds: 3600 });
    await consumeSharedBudget(config, { scope: `sign-in:${privateBucket(address, config)}`, limit: 12, windowSeconds: 900 });
    if (!(await verifyWorkspacePasscode(passcode, config.passcodeHash))) throw new SharedWorkspaceError("invalid_passcode", "That passcode doesn’t match. Please try again.", 401);
    (await cookies()).set(SHARED_COOKIE_NAME, issueSharedSession(config), { httpOnly: true, secure: config.secure, sameSite: "strict", path: "/", maxAge: SHARED_SESSION_SECONDS });
    return Response.json({ authenticated: true }, { headers: SHARED_PRIVATE_HEADERS });
  } catch (error) { return sharedFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    checkSharedMutationOrigin(request);
    const config = sharedConfiguration();
    (await cookies()).set(SHARED_COOKIE_NAME, "", { httpOnly: true, secure: config.secure, sameSite: "strict", path: "/", maxAge: 0 });
    return Response.json({ authenticated: false }, { headers: SHARED_PRIVATE_HEADERS });
  } catch (error) { return sharedFailure(error); }
}
