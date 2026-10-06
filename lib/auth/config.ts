export type AuthEnvironment = Readonly<Record<string, string | undefined>>;
export type CorporateIdentity = { issuer: string; subject: string; name: string; email?: string };
export type AuthConfigurationStatus = { configured: boolean; issues: string[]; issuer?: string; origin?: string };
export type AuthConfiguration = {
  issuer: string; origin: string; clientId: string; clientSecret: string; secret: string;
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post";
};

const MICROSOFT_HOSTS = new Set([
  "login.microsoftonline.com", "login.microsoftonline.us", "login.microsoftonline.de",
  "login.partner.microsoftonline.cn", "sts.windows.net",
]);
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secureUrl(value: string | undefined): URL | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

/** Safe to display to an operator: this result never contains credentials or their values. */
export function getAuthConfigurationStatus(env: AuthEnvironment = process.env): AuthConfigurationStatus {
  const issues: string[] = [];
  const issuer = secureUrl(env.AUTH_OIDC_ISSUER);
  const origin = secureUrl(env.AUTH_URL);
  if (!issuer) issues.push("AUTH_OIDC_ISSUER must be an HTTPS issuer URL without credentials, query, or fragment.");
  else if (MICROSOFT_HOSTS.has(issuer.hostname)) {
    const segments = issuer.pathname.split("/").filter(Boolean);
    const tenantPath = TENANT_ID.test(segments[0] ?? "");
    const issuerPath = issuer.hostname === "sts.windows.net" ? segments.length === 1 : segments.length === 2 && segments[1] === "v2.0";
    if (!tenantPath || !issuerPath) issues.push("AUTH_OIDC_ISSUER must identify one Microsoft tenant by its tenant UUID; shared common, organizations, and consumers issuers are not allowed.");
  }
  if (!origin || origin.pathname !== "/") issues.push("AUTH_URL must be the fixed HTTPS application origin without a path, credentials, query, or fragment.");
  if (!env.AUTH_OIDC_CLIENT_ID?.trim()) issues.push("AUTH_OIDC_CLIENT_ID is required.");
  if (!env.AUTH_OIDC_CLIENT_SECRET?.trim()) issues.push("AUTH_OIDC_CLIENT_SECRET is required.");
  if (!env.AUTH_SECRET || env.AUTH_SECRET.trim().length < 32) issues.push("AUTH_SECRET must contain at least 32 characters from a securely generated random secret.");
  return {
    configured: issues.length === 0, issues,
    ...(issuer ? { issuer: env.AUTH_OIDC_ISSUER } : {}),
    ...(origin && origin.pathname === "/" ? { origin: origin.origin } : {}),
  };
}

/** Server configuration only. Never include this object in page props, logs, or responses. */
export function getAuthConfiguration(env: AuthEnvironment = process.env): AuthConfiguration | null {
  const status = getAuthConfigurationStatus(env);
  if (!status.configured) return null;
  return { issuer: status.issuer!, origin: status.origin!, clientId: env.AUTH_OIDC_CLIENT_ID!.trim(), clientSecret: env.AUTH_OIDC_CLIENT_SECRET!, secret: env.AUTH_SECRET!, tokenEndpointAuthMethod: MICROSOFT_HOSTS.has(new URL(status.issuer!).hostname) ? "client_secret_post" : "client_secret_basic" };
}

/** Call only with the ID-token claims already validated by Auth.js's OIDC callback. */
export function identityFromClaims(claims: Record<string, unknown> | undefined, expectedIssuer: string): CorporateIdentity | null {
  if (!claims || claims.iss !== expectedIssuer || typeof claims.sub !== "string" || !claims.sub.length || claims.sub.length > 255 || /[\u0000-\u001f\u007f]/.test(claims.sub)) return null;
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 160) : "Team member";
  const email = typeof claims.email === "string" && claims.email.length <= 320 ? claims.email.trim() : undefined;
  // Email is display metadata only. It never links identities, grants membership, or assigns roles.
  return { issuer: expectedIssuer, subject: claims.sub, name, ...(email ? { email } : {}) };
}
