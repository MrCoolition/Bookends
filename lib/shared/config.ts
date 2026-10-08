export class SharedWorkspaceError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryAfterSeconds?: number) { super(message); this.name = "SharedWorkspaceError"; }
}
export type SharedConfiguration = { workspaceId: string; passcodeHash: string; sessionSecret: string; origin: string; secure: boolean };
export function sharedConfiguration(env: Readonly<Record<string, string | undefined>> = process.env): SharedConfiguration {
  const fail = () => new SharedWorkspaceError("setup_required", "The shared workspace is not configured yet.", 503);
  if (env.BOOKENDS_ADMIN_MODE !== "shared") throw fail();
  const workspaceId = env.BOOKENDS_WORKSPACE_ID ?? "main";
  const passcodeHash = env.BOOKENDS_WORKSPACE_PASSCODE_HASH ?? "", sessionSecret = env.BOOKENDS_WORKSPACE_SESSION_SECRET ?? "";
  if (!/^[a-z0-9-]{1,80}$/.test(workspaceId) || !/^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(passcodeHash) || sessionSecret.length < 32 || sessionSecret.length > 512) throw fail();
  let url: URL;
  try { url = new URL(env.BOOKENDS_WORKSPACE_ORIGIN ?? ""); } catch { throw fail(); }
  const local = env.BOOKENDS_ENV === "development" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.pathname !== "/" || url.username || url.password || url.hash || url.search) throw fail();
  return { workspaceId, passcodeHash, sessionSecret, origin: url.origin, secure: url.protocol === "https:" };
}
export function sharedWorkspaceConfigured() { try { sharedConfiguration(); return !!(process.env.BOOKENDS_SHARED_DATABASE_URL || process.env.DATABASE_URL); } catch { return false; } }
