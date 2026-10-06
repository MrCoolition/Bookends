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

test("administration records remain inaccessible while its setup page is visible", async ({ request, page }) => {
  const response = await request.get("/api/admin", { headers: { "x-bookends-role": "administrator" } });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await response.json()).error.code).toBe("unauthenticated");
  const mutation = await request.post("/api/admin", { headers: { origin: "https://untrusted.example" }, data: { command: { type: "create_client", name: "Forbidden" } } });
  expect(mutation.status()).toBe(403);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator(".admin-access-gateway")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administration", exact: true })).toBeVisible();
  await expect(page.locator(".admin-records")).toHaveCount(0);
});

test("Administration is discoverable from the app navigation and command search", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Administration", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  for (const name of ["Clients", "HOMEs", "People", "Missions", "Playbooks", "Access & settings"])
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText(/setup/i).first()).toBeVisible();
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search everything" }).fill("admin");
  await page.getByRole("dialog").getByRole("link", { name: "Administration", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("Administration remains reachable from phone navigation and appearance settings", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 650 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Administration", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Administration", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
  await page.getByRole("button", { name: "Appearance and demo settings", exact: true }).click();
  await page.getByRole("link", { name: "Open Administration", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
});
