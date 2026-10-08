import { createHash, createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import type { SharedConfiguration } from "./config";

export const SHARED_SESSION_SECONDS = 12 * 60 * 60;
const hash = (passcode: string, salt: string) => new Promise<Buffer>((resolve, reject) => nodeScrypt(passcode, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
export async function hashWorkspacePasscode(passcode: string) {
  if (passcode.length < 12 || passcode.length > 256) throw new Error("Use a workspace passcode of 12 to 256 characters.");
  const salt = randomBytes(16).toString("hex");
  return `scrypt$32768$8$1$${salt}$${(await hash(passcode, salt)).toString("hex")}`;
}
export async function verifyWorkspacePasscode(passcode: string, encoded: string) {
  if (passcode.length > 256 || !/^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded)) return false;
  const parts = encoded.split("$");
  return timingSafeEqual(await hash(passcode, parts[4]), Buffer.from(parts[5], "hex"));
}
function signature(payload: string, config: SharedConfiguration) {
  return createHmac("sha256", config.sessionSecret).update(`${config.workspaceId}|${config.passcodeHash}|${payload}`).digest("hex");
}
export function issueSharedSession(config: SharedConfiguration, now = Date.now()) {
  const payload = `v1.${Math.floor(now / 1000) + SHARED_SESSION_SECONDS}.${randomBytes(24).toString("hex")}`;
  return `${payload}.${signature(payload, config)}`;
}
export type SharedSession = { workspaceId: string; sessionId: string };
export function verifySharedSession(value: string | undefined, config: SharedConfiguration, now = Date.now()): SharedSession | null {
  if (!value || !/^v1\.\d{10}\.[a-f0-9]{48}\.[a-f0-9]{64}$/.test(value)) return null;
  const parts = value.split("."), expires = Number(parts[1]), seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + SHARED_SESSION_SECONDS || !timingSafeEqual(Buffer.from(parts[3], "hex"), Buffer.from(signature(parts.slice(0, 3).join("."), config), "hex"))) return null;
  return { workspaceId: config.workspaceId, sessionId: createHash("sha256").update(value).digest("hex") };
}
export function privateBucket(value: string, config: SharedConfiguration) { return createHmac("sha256", config.sessionSecret).update(value).digest("hex"); }
