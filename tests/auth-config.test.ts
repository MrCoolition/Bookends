import { test } from "node:test";
import assert from "node:assert/strict";
import { getAuthConfiguration, getAuthConfigurationStatus, identityFromClaims, type AuthEnvironment } from "../lib/auth/config";
import { createAuthOptions, handlers } from "../auth";
import { NextRequest } from "next/server";
import { checkMutationOrigin, MAX_OPERATION_BYTES, MAX_ADMIN_BYTES, operationFailure, readOperationBody } from "../lib/operations/http";
import { operationsRequestSchema } from "../lib/operations/validation";

const configured: AuthEnvironment = {
  AUTH_OIDC_ISSUER: "https://identity.example.test/tenant",
  AUTH_OIDC_CLIENT_ID: "bookends-client",
  AUTH_OIDC_CLIENT_SECRET: "private-test-provider-secret",
  AUTH_SECRET: "test-only-session-secret-with-at-least-32-characters",
  AUTH_URL: "https://bookends.example.test",
};

test("corporate auth fails closed until every required input is configured", () => {
  assert.equal(getAuthConfigurationStatus({}).configured, false);
  assert.equal(getAuthConfiguration({}), null);
  for (const key of Object.keys(configured)) {
    const env = { ...configured, [key]: "" };
    assert.equal(getAuthConfigurationStatus(env).configured, false, key);
    assert.equal(getAuthConfiguration(env), null, key);
  }
  assert.equal(getAuthConfigurationStatus(configured).configured, true);
});

test("status never exposes credential values", () => {
  const status = JSON.stringify(getAuthConfigurationStatus(configured));
  assert.ok(!status.includes(configured.AUTH_OIDC_CLIENT_SECRET!));
  assert.ok(!status.includes(configured.AUTH_SECRET!));
  assert.ok(!status.includes(configured.AUTH_OIDC_CLIENT_ID!));
});

test("issuer and fixed origin require HTTPS without credentials or URL additions", () => {
  for (const issuer of ["http://identity.example.test", "https://user:password@identity.example.test", "https://identity.example.test?tenant=one", "https://identity.example.test#tenant", "not-a-url", " https://identity.example.test"])
    assert.equal(getAuthConfigurationStatus({ ...configured, AUTH_OIDC_ISSUER: issuer }).configured, false, issuer);
  for (const origin of ["http://localhost:3000", "https://user:password@bookends.example.test", "https://bookends.example.test/api/auth", "https://bookends.example.test?redirect=evil", "https://bookends.example.test#fragment"])
    assert.equal(getAuthConfigurationStatus({ ...configured, AUTH_URL: origin }).configured, false, origin);
  assert.equal(getAuthConfigurationStatus({ ...configured, AUTH_SECRET: "change-me" }).configured, false);
});

test("Microsoft issuers must identify a fixed tenant rather than a shared authority", () => {
  for (const tenant of ["common", "organizations", "consumers", "", "example.onmicrosoft.com"])
    assert.equal(getAuthConfigurationStatus({ ...configured, AUTH_OIDC_ISSUER: `https://login.microsoftonline.com/${tenant}/v2.0` }).configured, false, tenant);
  assert.equal(getAuthConfigurationStatus({ ...configured, AUTH_OIDC_ISSUER: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0" }).configured, true);
  assert.equal(getAuthConfigurationStatus({ ...configured, AUTH_OIDC_ISSUER: "https://login.microsoftonline.us/common/v2.0" }).configured, false);
});

test("identity requires exact validated issuer and immutable subject, never email or role claims", () => {
  const issuer = configured.AUTH_OIDC_ISSUER!;
  const claims = { iss: issuer, sub: "immutable-Subject-123", name: "Teammate", email: "teammate@example.test", roles: ["admin"], organizationId: "attacker" };
  assert.deepEqual(identityFromClaims(claims, issuer), { issuer, subject: "immutable-Subject-123", name: "Teammate", email: "teammate@example.test" });
  assert.equal(identityFromClaims({ ...claims, iss: "https://other.example.test" }, issuer), null);
  assert.equal(identityFromClaims({ email: "teammate@example.test" }, issuer), null);
  assert.equal(identityFromClaims({ ...claims, sub: "" }, issuer), null);
  assert.equal(identityFromClaims({ ...claims, sub: "x".repeat(256) }, issuer), null);
  assert.equal(identityFromClaims({ ...claims, sub: "subject\ninvalid" }, issuer), null);
  assert.deepEqual(identityFromClaims({ iss: issuer, sub: "abc" }, issuer), { issuer, subject: "abc", name: "Team member" });
});

test("client session updates cannot replace identity or extend its absolute lifetime", async () => {
  const config = getAuthConfiguration(configured)!;
  const options = createAuthOptions(config);
  const identity = { issuer: config.issuer, subject: "trusted-subject", name: "Trusted teammate" };
  const expiry = Math.floor(Date.now() / 1000) + 900;
  const token = { identity, identityExpiresAt: expiry };
  const result = await options.callbacks!.jwt!({ token, trigger: "update", session: { identity: { ...identity, subject: "forged" }, roles: ["admin"] }, user: { id: "ignored" }, account: null });
  assert.deepEqual(result, token);
  assert.equal(await options.callbacks!.jwt!({ token: { ...token, identityExpiresAt: 1 }, user: { id: "ignored" }, account: null }), null);
  assert.equal(await options.callbacks!.jwt!({ token: { ...token, identity: { ...identity, issuer: "https://wrong.example.test" } }, user: { id: "ignored" }, account: null }), null);
  assert.equal(options.session?.maxAge, 3600);
  assert.equal(options.useSecureCookies, true);
});

test("authentication redirects stay on the fixed application origin", async () => {
  const config = getAuthConfiguration(configured)!;
  const redirect = createAuthOptions(config).callbacks!.redirect!;
  assert.equal(await redirect({ url: "//external.example.test", baseUrl: config.origin }), config.origin);
  assert.equal(await redirect({ url: "https://external.example.test", baseUrl: config.origin }), config.origin);
  assert.equal(await redirect({ url: "https://user:password@bookends.example.test/workspace", baseUrl: config.origin }), config.origin);
  assert.equal(await redirect({ url: "/workspace", baseUrl: "https://untrusted-host.example.test" }), `${config.origin}/workspace`);
});

test("mutation requests require the configured origin and an exact JSON content type", () => {
  const previous = process.env.AUTH_URL;
  process.env.AUTH_URL = configured.AUTH_URL;
  const request = (origin: string, contentType = "application/json; charset=utf-8") => new Request(configured.AUTH_URL!, { method: "POST", headers: { origin, "content-type": contentType } });
  try {
    assert.doesNotThrow(() => checkMutationOrigin(request(configured.AUTH_URL!)));
    assert.throws(() => checkMutationOrigin(request("https://other.example.test")), { status: 403 });
    assert.throws(() => checkMutationOrigin(request(configured.AUTH_URL!, "application/json-evil")), { status: 415 });
    process.env.AUTH_URL = "malformed";
    assert.throws(() => checkMutationOrigin(request(configured.AUTH_URL!)), { status: 403 });
  } finally { if (previous === undefined) delete process.env.AUTH_URL; else process.env.AUTH_URL = previous; }
});

test("JSON body limits apply to streamed bytes before parsing, including missing or false lengths", async () => {
  const request = (body: string, length?: string) => new Request(configured.AUTH_URL!, { method: "POST", body, ...(length ? { headers: { "content-length": length } } : {}) });
  assert.deepEqual(await readOperationBody(request('{"value":"🌈"}')), { value: "🌈" });
  await assert.rejects(readOperationBody(request("{}", String(MAX_OPERATION_BYTES + 1))), { status: 413 });
  await assert.rejects(readOperationBody(request("{}", "invalid")), { status: 400 });
  await assert.rejects(readOperationBody(request(JSON.stringify({ value: "🌈".repeat(MAX_OPERATION_BYTES / 4) }), "2")), { status: 413 });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(MAX_OPERATION_BYTES + 1)); }, cancel() { cancelled = true; } });
  const streaming = new Request(configured.AUTH_URL!, { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  await assert.rejects(readOperationBody(streaming), { status: 413 });
  assert.equal(cancelled, true);
  const invalidUtf8 = new Request(configured.AUTH_URL!, { method: "POST", body: new Uint8Array([0xc3, 0x28]) });
  assert.equal(operationFailure(await readOperationBody(invalidUtf8).catch(error => error)).status, 400);
});

test("administration accommodates longer playbooks while enforcing a separate byte limit", async () => {
  const request = (body: string) => new Request(configured.AUTH_URL!, { method: "POST", body });
  const playbook = { requirements: Array.from({ length: 50 }, (_, index) => ({ title: `Step ${index}`, description: "Guidance for this step. ".repeat(50) })) };
  const body = JSON.stringify(playbook);
  assert.ok(Buffer.byteLength(body) > MAX_OPERATION_BYTES);
  await assert.rejects(readOperationBody(request(body)), { status: 413 });
  assert.deepEqual(await readOperationBody(request(body), MAX_ADMIN_BYTES), playbook);
  await assert.rejects(readOperationBody(request(JSON.stringify({ value: "x".repeat(MAX_ADMIN_BYTES) })), MAX_ADMIN_BYTES), { status: 413 });
});

test("per-step owner overrides are bounded and orchestration decisions accept company actions", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const command = { type: "create_journey", templateId: id, resourceId: id, ownerId: id, fulfillerId: id, verifierId: id, openingAt: null, releaseAt: null, closeoutAt: null };
  const triple = { ownerId: id, fulfillerId: id, verifierId: id };
  const parse = (value: unknown) => operationsRequestSchema.safeParse({ idempotencyKey: id, command: value }).success;
  assert.equal(parse({ ...command, owners: { equipment: triple } }), true);
  assert.equal(parse({ ...command, owners: { equipment: { ...triple, role: "administrator" } } }), false);
  assert.equal(parse({ ...command, owners: { ["x".repeat(161)]: triple } }), false);
  assert.equal(parse({ ...command, owners: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [String(index), triple])) }), false);
  for (const targetAction of ["open_journey", "close_journey"])
    assert.equal(parse({ type: "obligation", journeyId: id, obligationId: id, expectedRevision: 1, command: { type: "waive", decisionId: id, targetAction, scope: { organizationId: id, resourceId: id }, reason: "Approved scoped exception", expiresAt: "2030-01-01T00:00:00.000Z", evidenceIds: [] } }), true);
});

test("unconfigured auth endpoints return safe 503 without initializing provider requests", async () => {
  const previous = process.env.AUTH_OIDC_ISSUER;
  delete process.env.AUTH_OIDC_ISSUER;
  try {
    for (const method of ["GET", "POST"] as const) {
      const response = await handlers[method](new NextRequest("https://bookends.example.test/api/auth/session", { method }));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal((await response.json()).error, "AUTH_NOT_CONFIGURED");
    }
  } finally {
    if (previous === undefined) delete process.env.AUTH_OIDC_ISSUER;
    else process.env.AUTH_OIDC_ISSUER = previous;
  }
});
