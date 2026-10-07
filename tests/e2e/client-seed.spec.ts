import { test, expect, type Page } from "@playwright/test";
import { applyLocalAdminCommand, createLocalAdminStore, type LocalAdminStore } from "../../lib/admin/local";

const STORAGE_KEY = "bookends.local-admin.v1";
const CLIENT_NAMES = ["Big 4", "TQL", "Nisource", "Compass", "Vantive", "Others", "Chipotle", "Safelite", "First Bank of Ohio"];
const rows = (page: Page) => page.locator(".admin-record");
const clientRow = (page: Page, name: string) => rows(page).filter({ has: page.getByText(name, { exact: true }) });
const snapshot = (page: Page) => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
async function initialize(page: Page, value: LocalAdminStore | string) {
  await page.addInitScript(({ key, raw }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
  }, { key: STORAGE_KEY, raw: typeof value === "string" ? value : JSON.stringify(value) });
}
async function expectClients(page: Page) {
  await expect(rows(page)).toHaveCount(9);
  for (const name of CLIENT_NAMES) await expect(clientRow(page, name)).toBeVisible();
}

test("the deployed client list appears in independent fresh browsers", async ({ page, browser, baseURL }) => {
  await page.goto("/admin?section=clients");
  await expectClients(page);
  const other = await browser.newContext({ baseURL });
  try {
    const second = await other.newPage();
    await second.goto("/admin?section=clients");
    await expectClients(second);
    await second.reload();
    await expectClients(second);
  } finally { await other.close(); }
});

test("an existing empty browser setup gains the clients once and concurrent reloads stay stable", async ({ page, context }) => {
  await initialize(page, createLocalAdminStore());
  await page.goto("/admin?section=clients");
  await expectClients(page);
  const first = await snapshot(page);
  const other = await context.newPage();
  await Promise.all([page.reload(), other.goto("/admin?section=clients")]);
  await expectClients(page);
  await expectClients(other);
  expect(await snapshot(page)).toBe(first);
  expect(await snapshot(other)).toBe(first);
});

test("previously entered clients retain custom IDs, contact details, renamed displays and inactive state", async ({ page }) => {
  let store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", code: "TQL", name: "TQL Enterprise", contactName: "Existing contact", contactEmail: "contact@example.test", notes: "Keep these details" });
  store = applyLocalAdminCommand(store, { type: "save_client", code: "COMPASS-CUSTOM", name: "Compass", contactName: "", contactEmail: "", notes: "Existing account" });
  const compass = store.data.clients[1];
  store = applyLocalAdminCommand(store, { type: "set_client_active", id: compass.id, expectedRevision: compass.revision, active: false });
  const original = store.data.clients;
  await initialize(page, store);
  await page.goto("/admin?section=clients");
  await expect(rows(page)).toHaveCount(8);
  await expect(clientRow(page, "TQL Enterprise")).toContainText("Existing contact");
  await expect(clientRow(page, "Compass")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Include inactive" }).check();
  await expect(rows(page)).toHaveCount(9);
  await expect(clientRow(page, "Compass")).toContainText("Inactive");
  const after: LocalAdminStore = JSON.parse((await snapshot(page))!);
  for (const client of original) expect(after.data.clients.find(item => item.id === client.id)).toEqual(client);
  await clientRow(page, "TQL Enterprise").click();
  const editor = page.getByRole("dialog", { name: "Edit client" });
  await expect(editor.getByLabel("Contact email", { exact: false })).toHaveValue("contact@example.test");
  await expect(editor.getByLabel("Useful context", { exact: false })).toHaveValue("Keep these details");
});

test("renaming and archiving a name-matched client never recreates its original name", async ({ page }) => {
  const store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", code: "MY-COMPASS", name: "Compass", contactName: "", contactEmail: "", notes: "" });
  const originalId = store.data.clients[0].id;
  await initialize(page, store);
  await page.goto("/admin?section=clients");
  await expectClients(page);
  await clientRow(page, "Compass").click();
  let editor = page.getByRole("dialog", { name: "Edit client" });
  await editor.getByLabel("Client name", { exact: true }).fill("Compass Delivery");
  await editor.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await clientRow(page, "Compass Delivery").click();
  editor = page.getByRole("dialog", { name: "Edit client" });
  await editor.getByRole("button", { name: "Make inactive", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(rows(page)).toHaveCount(8);
  await page.getByRole("checkbox", { name: "Include inactive" }).check();
  await expect(rows(page)).toHaveCount(9);
  await expect(clientRow(page, "Compass")).toHaveCount(0);
  await expect(clientRow(page, "Compass Delivery")).toContainText("Inactive");
  const after: LocalAdminStore = JSON.parse((await snapshot(page))!);
  expect(after.data.clients.find(client => client.id === originalId)).toMatchObject({ code: "MY-COMPASS", name: "Compass Delivery", active: false });
});

test("a legacy backup previews all nine clients before restoring them", async ({ page }) => {
  await page.goto("/admin?section=clients");
  await expectClients(page);
  await page.getByLabel("Choose a BOOKENDS backup", { exact: true }).setInputFiles({ name: "legacy-empty.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(createLocalAdminStore())) });
  const review = page.getByRole("dialog", { name: "Review before replacing." });
  await expect(review.locator(".admin-import-counts > div").filter({ hasText: "Clients" })).toHaveText(/Clients9\s*→\s*9/);
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Replace browser setup", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expectClients(page);
  await page.reload();
  await expectClients(page);
});

test("an unreadable saved setup is preserved instead of being replaced by the client seed", async ({ page }) => {
  const corrupt = "{unreadable-existing-setup";
  await initialize(page, corrupt);
  await page.goto("/admin?section=clients");
  await expect(page.getByRole("alert").filter({ hasText: "It has not been overwritten" })).toBeVisible();
  expect(await snapshot(page)).toBe(corrupt);
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Try opening setup again", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "It has not been overwritten" })).toBeVisible();
  expect(await snapshot(page)).toBe(corrupt);
});

test("a full legacy workspace still opens and exports without overwriting its saved records", async ({ page }) => {
  const store = createLocalAdminStore();
  store.data.clients = Array.from({ length: 1000 }, (_, index) => ({
    id: crypto.randomUUID(), code: `EXISTING-${index}`, name: `Existing client ${index}`,
    contactName: "", contactEmail: "", notes: "", active: true, revision: 1,
  }));
  const original = JSON.stringify(store);
  await initialize(page, original);
  await page.goto("/admin?section=clients");
  await expect(rows(page)).toHaveCount(1000);
  await expect(page.getByText("Your saved setup is open, but the starting clients could not be added", { exact: false })).toBeVisible();
  expect(await snapshot(page)).toBe(original);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export setup", exact: true }).click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(store);
  await page.reload();
  await expect(rows(page)).toHaveCount(1000);
  expect(await snapshot(page)).toBe(original);
});
