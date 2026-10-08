import "server-only";
import { cookies } from "next/headers";
import { sharedConfiguration, SharedWorkspaceError } from "./config";
import { verifySharedSession } from "./crypto";
export const SHARED_COOKIE_NAME = "bookends_workspace";
export async function sharedWorkspaceSession() {
  try { return verifySharedSession((await cookies()).get(SHARED_COOKIE_NAME)?.value, sharedConfiguration()); }
  catch (error) { if (error instanceof SharedWorkspaceError) return null; throw error; }
}
export async function requireSharedWorkspaceSession() {
  const session = await sharedWorkspaceSession();
  if (!session) throw new SharedWorkspaceError("unauthenticated", "Enter the workspace passcode to continue.", 401);
  return session;
}
