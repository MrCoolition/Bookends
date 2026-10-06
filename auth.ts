import NextAuth, { customFetch, type NextAuthConfig, type NextAuthResult, type Session } from "next-auth";
import type { NextRequest } from "next/server";
import { getAuthConfiguration, identityFromClaims, type AuthConfiguration } from "@/lib/auth/config";

export const CORPORATE_PROVIDER_ID = "corporate";
const SESSION_SECONDS = 60 * 60;

export function createAuthOptions(config: AuthConfiguration): NextAuthConfig {
  return {
    secret: config.secret,
    basePath: "/api/auth",
    // AUTH_URL is mandatory and validated; Auth.js derives callback URLs from that fixed origin.
    trustHost: true,
    useSecureCookies: true,
    session: { strategy: "jwt", maxAge: SESSION_SECONDS },
    providers: [{
      id: CORPORATE_PROVIDER_ID,
      name: "Company account",
      type: "oidc",
      issuer: config.issuer,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorization: { params: { scope: "openid profile email" } },
      checks: ["pkce", "state", "nonce"],
      idToken: true,
      allowDangerousEmailAccountLinking: false,
      // Use Auth.js's default for generic providers and Entra's registered POST convention.
      client: { token_endpoint_auth_method: config.tokenEndpointAuthMethod },
      [customFetch]: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("OIDC endpoints must use HTTPS.");
        return fetch(input, { ...init, redirect: "error" });
      },
      profile(profile) {
        const identity = identityFromClaims(profile, config.issuer);
        if (!identity) throw new Error("The corporate identity claims are invalid.");
        return { id: identity.subject, name: identity.name, email: identity.email ?? null, image: null };
      },
    }],
    callbacks: {
      signIn({ account, profile }) {
        return account?.provider === CORPORATE_PROVIDER_ID && !!identityFromClaims(profile, config.issuer);
      },
      jwt({ token, account, profile }) {
        if (account) {
          if (account.provider !== CORPORATE_PROVIDER_ID) return null;
          const identity = identityFromClaims(profile, config.issuer);
          if (!identity) return null;
          // Only the validated sign-in callback writes these claims. Ignore client session updates.
          return { ...token, identity, identityExpiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS };
        }
        if (token.identity?.issuer !== config.issuer || typeof token.identityExpiresAt !== "number" || token.identityExpiresAt <= Date.now() / 1000) return null;
        return token;
      },
      session({ session, token }) {
        // No access tokens, organization membership, role grants, or provider secrets enter the session.
        return { expires: session.expires, identity: token.identity, user: { name: token.identity?.name, email: token.identity?.email, image: null } };
      },
      redirect({ url }) {
        try {
          const target = new URL(url, config.origin);
          return target.origin === config.origin && !target.username && !target.password ? target.href : config.origin;
        } catch { return config.origin; }
      },
    },
    // Auth.js error causes can contain provider response data. Keep operational logs metadata-free.
    logger: {
      error() { console.error("[auth] Corporate authentication failed."); },
      warn() { console.warn("[auth] Corporate authentication configuration warning."); },
      debug() {},
    },
  };
}

function configuredAuth(): NextAuthResult | null {
  const config = getAuthConfiguration();
  return config ? NextAuth(createAuthOptions(config)) : null;
}

function unavailable() {
  return Response.json({ error: "AUTH_NOT_CONFIGURED", message: "Company sign-in is not configured. Contact your BOOKENDS administrator." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
}

export const handlers = {
  async GET(request: NextRequest) { return configuredAuth()?.handlers.GET(request) ?? unavailable(); },
  async POST(request: NextRequest) { return configuredAuth()?.handlers.POST(request) ?? unavailable(); },
};

/** Server session reader only. Every business request must separately verify active database membership. */
export async function auth(): Promise<Session | null> {
  const instance = configuredAuth();
  return instance ? instance.auth() : null;
}

export const signIn: NextAuthResult["signIn"] = async (provider, options, authorizationParams) => {
  const instance = configuredAuth();
  if (!instance || (provider && provider !== CORPORATE_PROVIDER_ID)) throw new Error("Company sign-in is not configured.");
  return instance.signIn(CORPORATE_PROVIDER_ID, options, authorizationParams);
};

export const signOut: NextAuthResult["signOut"] = async options => {
  const instance = configuredAuth();
  if (!instance) throw new Error("Company sign-in is not configured.");
  return instance.signOut(options);
};
