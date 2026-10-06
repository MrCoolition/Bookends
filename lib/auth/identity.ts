import { auth } from "@/auth";
import { getAuthConfigurationStatus, type CorporateIdentity } from "./config";

export type { CorporateIdentity } from "./config";

/** Verified identity is not authorization: callers must load active scoped membership from the database. */
export async function readIdentity(): Promise<CorporateIdentity | null> {
  const config = getAuthConfigurationStatus();
  if (!config.configured) return null;
  const session = await auth();
  const identity = session?.identity;
  if (!identity || identity.issuer !== config.issuer || !identity.subject || !identity.name) return null;
  return { issuer: identity.issuer, subject: identity.subject, name: identity.name, ...(identity.email ? { email: identity.email } : {}) };
}
