import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hashWorkspacePasscode } from "../lib/shared/crypto";

async function main() {
  const output = resolve(process.cwd(), ".tmp/shared-workspace-secrets.json");
  const passcode = randomBytes(18).toString("base64url");
  const values = { passcode, BOOKENDS_WORKSPACE_PASSCODE_HASH: await hashWorkspacePasscode(passcode), BOOKENDS_WORKSPACE_SESSION_SECRET: randomBytes(48).toString("base64url") };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(values, null, 2), { flag: "wx", mode: 0o600 });
  console.log(`Workspace credentials written to ${output}. Keep this ignored file private. No secret has been printed.`);
}
main().catch(() => { console.error("Could not create the private credentials file. Existing credentials are never replaced."); process.exitCode = 1; });
