import { test, expect } from "@playwright/test";

test("operational reads do not trust browser identity or organization hints", async ({ request }) => {
  const response = await request.get("/api/operations?organizationId=10000000-0000-4000-8000-000000000001", {
    headers: { "x-bookends-role": "administrator", "x-bookends-user": "pretend-member" },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = await response.json();
  expect(body.error.code).toBe("unauthenticated");
  expect(body.journeys).toBeUndefined();
  expect(body.members).toBeUndefined();
});

test("cross-origin and missing-origin mutations are denied before execution", async ({ request }) => {
  const origins: Record<string, string>[] = [{ origin: "https://untrusted.example", "sec-fetch-site": "cross-site" }, {}];
  for (const headers of origins) {
    const response = await request.post("/api/operations", {
      headers,
      data: { idempotencyKey: "10000000-0000-4000-8000-000000000001", command: { type: "create_mission", name: "Forbidden", clientName: "Forbidden" } },
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect((await response.json()).error.code).toBe("forbidden");
  }
});

test("the protected entry point and fictional preview stay separate", async ({ page }) => {
  await page.goto("/journeys");
  await expect(page.locator(".experience-gateway")).toBeVisible();
  await expect(page.getByRole("heading", { name: /A thoughtful welcome/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /fictional design preview/ })).toHaveAttribute("href", "/demo");
  await expect(page.locator(".exp-workspace")).toHaveCount(0);
  await page.getByRole("link", { name: /fictional design preview/ }).click();
  await expect(page).toHaveURL(/\/demo/);
  await expect(page.locator(".workspace")).toBeVisible();
});

test("administration remains inaccessible to an unsigned browser", async ({ request, page }) => {
  const response = await request.get("/api/admin", { headers: { "x-bookends-role": "administrator" } });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await response.json()).error.code).toBe("unauthenticated");
  const mutation = await request.post("/api/admin", { headers: { origin: "https://untrusted.example" }, data: { command: { type: "create_client", name: "Forbidden" } } });
  expect(mutation.status()).toBe(403);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/journeys$/);
  await expect(page.locator(".experience-gateway")).toBeVisible();
});
