import { test, expect, type Page } from "@playwright/test";
import { applyLocalAdminCommand, createLocalAdminStore } from "../../lib/admin/local";

async function workspace(page: Page) {
  const state = { store: createLocalAdminStore(), writes: 0 };
  await page.clock.setFixedTime(new Date("2026-10-28T12:00:00Z"));
  await page.route("**/api/shared/session", route => route.fulfill({ json: { authenticated: true, configured: true } }));
  await page.route("**/api/shared/admin", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.expectedRevision !== state.store.revision) return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "Refresh before saving." } } });
      state.store = applyLocalAdminCommand(state.store, body.command);
      state.writes++;
    }
    await route.fulfill({ json: state.store });
  });
  return state;
}

test("client bookends preview skipped intake, persist, and can be paused without losing the schedule", async ({ page }) => {
  const state = await workspace(page);
  await page.goto("/admin?section=clients");
  await page.getByRole("button", { name: "Add client", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "A new client", exact: true });
  await dialog.getByLabel("Client name", { exact: true }).fill("Bookend Test Client");
  await dialog.getByLabel("Stable client code").fill("BOOKEND_TEST");
  await dialog.getByRole("button", { name: "Add bookend", exact: true }).click();
  await dialog.getByLabel("First known opening").fill("2026-11-02");
  await dialog.locator("summary").filter({ hasText: "Window length, notice & exceptions" }).click();
  await dialog.getByLabel("Advance notice (days)").fill("2");
  await dialog.getByLabel("Skip specific dates").fill("2026-11-02");
  await expect(dialog.getByLabel("Upcoming windows for Client onboarding")).toContainText("Nov 16, 2026");
  await expect(dialog.getByLabel("Upcoming windows for Client onboarding")).not.toContainText("Nov 2, 2026");
  await dialog.locator("summary").filter({ hasText: "Window length, notice & exceptions" }).click();
  await dialog.locator(".client-bookends-editor").screenshot({ path: "artifacts/client-bookends/admin-desktop.png" });
  expect(state.writes).toBe(0);
  await dialog.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const client = state.store.data.clients.find(row => row.code === "BOOKEND_TEST")!;
  expect(client.bookends).toHaveLength(1);
  expect(client.bookends![0]).toMatchObject({ cadence: "weeks", every: 2, noticeDays: 2, excludedDates: ["2026-11-02"] });
  await expect(page.getByRole("button", { name: /Bookend Test Client/ })).toContainText("Nov 16, 2026");
  await page.getByRole("button", { name: /Bookend Test Client/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit client", exact: true });
  await expect(edit.getByLabel("First known opening")).toHaveValue("2026-11-02");
  await edit.getByLabel("Active in planning").uncheck();
  await edit.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(edit).not.toBeVisible();
  expect(state.store.data.clients.find(row => row.id === client.id)!.bookends![0].active).toBe(false);
  await expect(page.getByRole("button", { name: /Bookend Test Client/ })).toContainText("Client bookends paused");
});

test("client bookend editor fits a narrow screen and discards an unsaved schedule", async ({ page }) => {
  const state = await workspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin?section=clients");
  await page.getByRole("button", { name: "Add client", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "A new client", exact: true });
  await dialog.getByRole("button", { name: "Add bookend", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Purpose", exact: true }).selectOption("offboarding");
  await expect(dialog.getByRole("combobox", { name: "Applies to", exact: true })).toHaveValue("end");
  await dialog.getByRole("combobox", { name: "Repeats", exact: true }).selectOption("once");
  await expect(dialog.getByRole("spinbutton", { name: /^Every/ })).toHaveCount(0);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dialog.locator(".client-bookends-editor").screenshot({ path: "artifacts/client-bookends/admin-mobile.png" });
  await dialog.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes).toBe(0);
});
