import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { applyLocalAdminCommand, createLocalAdminStore, LOCAL_ADMIN_OWNER_ID, parseLocalAdminStore, type LocalAdminStore } from "../../lib/admin/local";

function seeded() {
  return applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", name: "Shared Test Client", code: "SHARED", contactName: "", contactEmail: "", notes: "" });
}
async function mockWorkspace(page: Page, authenticated = true) {
  const state = { authenticated, store: seeded(), writes: [] as string[], requestKeys: [] as string[], loseNextAcknowledgment: false };
  const receipts = new Map<string, string>();
  await page.route("**/api/shared/session", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      if (request.postDataJSON().passcode !== "synthetic-workspace-passcode") return route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "That passcode did not match." } } });
      state.authenticated = true;
    } else if (request.method() === "DELETE") state.authenticated = false;
    await route.fulfill({ json: { authenticated: state.authenticated, configured: true } });
  });
  await page.route("**/api/shared/admin", async route => {
    const request = route.request();
    if (!state.authenticated) return route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "Your session ended. Unlock to continue." } } });
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      state.requestKeys.push(body.idempotencyKey);
      const fingerprint = JSON.stringify(body.command ?? body.store);
      if (body.idempotencyKey && receipts.has(body.idempotencyKey)) {
        if (receipts.get(body.idempotencyKey) !== fingerprint) return route.fulfill({ status: 409, json: { error: { code: "idempotency_conflict", message: "This request key belongs to a different change." } } });
        return route.fulfill({ json: state.store });
      }
      if (body.expectedRevision !== state.store.revision) return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "The shared workspace changed. Refresh before saving." } } });
      state.writes.push(request.method());
      state.store = request.method() === "PUT" ? parseLocalAdminStore({ ...body.store, revision: state.store.revision + 1 }) : applyLocalAdminCommand(state.store, body.command);
      if (body.idempotencyKey) receipts.set(body.idempotencyKey, fingerprint);
      if (state.loseNextAcknowledgment) { state.loseNextAcknowledgment = false; return route.abort("failed"); }
    }
    await route.fulfill({ json: state.store });
  });
  return state;
}
async function openClient(page: Page, name = "My preserved client") {
  await page.getByRole("button", { name: "Add client", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "A new client", exact: true });
  await dialog.getByLabel("Client name", { exact: true }).fill(name);
  await dialog.getByLabel("Stable client code").fill("NEW");
  return dialog;
}
async function unlock(page: Page) {
  await page.getByLabel("Workspace passcode", { exact: true }).fill("synthetic-workspace-passcode");
  await page.getByRole("button", { name: "Enter workspace", exact: true }).click();
}

test("shared administration reveals no client data before unlock and supports lock", async ({ page }) => {
  const state = await mockWorkspace(page, false);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Great teams start here." })).toBeVisible();
  await expect(page.getByText("Shared Test Client", { exact: true })).toHaveCount(0);
  await page.getByLabel("Workspace passcode", { exact: true }).fill("wrong-passcode");
  await page.getByRole("button", { name: "Enter workspace", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("did not match");
  await unlock(page);
  await expect(page.getByRole("button", { name: /Shared Test Client/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Team Studio/ })).toHaveAttribute("href", "/studio");
  await expect(page.getByText("Changes are saved to the shared workspace and available in every signed-in browser.")).toBeVisible();
  expect(state.writes).toEqual([]);
  await page.getByLabel("Workspace options", { exact: true }).click();
  await page.getByRole("button", { name: "Lock workspace", exact: true }).click();
  await expect(page.getByLabel("Workspace passcode", { exact: true })).toBeVisible();
  await expect(page.getByText("Shared Test Client", { exact: true })).toHaveCount(0);
});

test("session expiration preserves a client draft through re-unlock", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/admin");
  const editor = await openClient(page);
  state.authenticated = false;
  await editor.getByRole("button", { name: "Add client", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "Great teams start here." });
  await expect(gate).toBeVisible();
  await unlock(page);
  await expect(gate).toHaveCount(0);
  await expect(editor.getByLabel("Client name", { exact: true })).toHaveValue("My preserved client");
  await editor.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: /My preserved client/ })).toBeVisible();
  expect(state.writes).toEqual(["POST"]);
});

test("another browser's revision cannot be overwritten and refresh retains unsaved inputs", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/admin");
  const editor = await openClient(page);
  state.store = applyLocalAdminCommand(state.store, { type: "save_client", name: "Other browser client", code: "OTHER", contactName: "", contactEmail: "", notes: "" });
  await editor.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("workspace changed");
  expect(state.writes).toEqual([]);
  await editor.getByRole("button", { name: "Refresh records", exact: true }).click();
  await expect(editor.getByLabel("Client name", { exact: true })).toHaveValue("My preserved client");
  await editor.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(state.store.data.clients.map(client => client.name)).toEqual(["Shared Test Client", "Other browser client", "My preserved client"]);
});

test("retry after a committed change loses its acknowledgment uses the same key without duplicate data", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/admin");
  const editor = await openClient(page);
  state.loseNextAcknowledgment = true;
  await editor.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("connection was interrupted");
  await editor.getByRole("button", { name: "Refresh records", exact: true }).click();
  await editor.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toEqual(["POST"]);
  expect(state.requestKeys).toHaveLength(2);
  expect(state.requestKeys[0]).toBe(state.requestKeys[1]);
  expect(state.store.data.clients.filter(client => client.code === "NEW")).toHaveLength(1);
});

test("Excel is reviewed as shared data and saved atomically; backup replacement requires explicit confirmation", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/admin");
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Clients");
  sheet.getRow(4).values = ["Client code", "Client name", "Contact name", "Contact email", "Notes"];
  sheet.getRow(5).values = ["EXCEL", "Excel shared client", "", "", ""];
  await page.getByLabel("Choose an Excel workbook", { exact: true }).setInputFiles({ name: "shared-clients.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  let review = page.getByRole("dialog", { name: "Review your spreadsheet." });
  await expect(review.getByText("The workbook is read in this browser. Only the reviewed setup records are saved to the shared workspace when you apply.")).toBeVisible();
  await review.getByRole("checkbox", { name: "I reviewed these additions and updates. Apply them to the shared workspace." }).check();
  state.loseNextAcknowledgment = true;
  await review.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("connection was interrupted");
  await review.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Excel shared client/ })).toBeVisible();
  expect(state.writes).toEqual(["PUT"]);
  expect(state.requestKeys[0]).toBe(state.requestKeys[1]);
  const candidate: LocalAdminStore = seeded();
  await page.getByLabel("Choose a BOOKENDS backup", { exact: true }).setInputFiles({ name: "shared-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(candidate)) });
  review = page.getByRole("dialog", { name: "Review the whole picture." });
  await expect(review).toContainText("replaces the entire shared setup for everyone");
  await expect(review.getByRole("button", { name: "Replace shared setup", exact: true })).toBeDisabled();
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Replace shared setup", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Excel shared client/ })).toHaveCount(0);
  expect(state.writes).toEqual(["PUT", "PUT"]);
});

test("earlier browser setup is offered for explicit review and stays untouched", async ({ page }) => {
  const state = await mockWorkspace(page);
  const local = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", name: "Earlier browser client", code: "EARLIER", contactName: "", contactEmail: "", notes: "" });
  await page.addInitScript(value => localStorage.setItem("bookends.local-admin.v1", value), JSON.stringify(local));
  await page.goto("/admin");
  await page.getByRole("button", { name: "Review for sharing", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review the whole picture." });
  await expect(review).toContainText("earlier browser copy will stay untouched");
  expect(state.writes).toEqual([]);
  await review.getByRole("button", { name: "Keep shared setup", exact: true }).click();
  await expect(page.getByRole("button", { name: /Shared Test Client/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bookends.local-admin.v1"))).toBe(JSON.stringify(local));
});

function addPeople(state: { store: LocalAdminStore }) {
  state.store = applyLocalAdminCommand(state.store, { type: "save_home", code: "ENG", name: "Engineering", description: "" });
  for (const person of [{ name: "Alex Rivers", roles: ["Data engineer"], skills: ["SQL", "Python"] }, { name: "Blair Chen", roles: ["Full-stack developer"], skills: ["React", "TypeScript"] }, { name: "Chris Bell", roles: ["Data engineer"], skills: ["SQL"] }]) state.store = applyLocalAdminCommand(state.store, { type: "save_resource", name: person.name, home: "ENG", ownerId: LOCAL_ADMIN_OWNER_ID, profile: { roles: person.roles, skills: person.skills } });
}
async function directBoard(page: Page, captureLobby = false, selectAlex = true) {
  await page.goto("/studio");
  if (captureLobby) { await expect(page.getByRole("button", { name: /Build it myself/ })).toBeVisible(); await page.screenshot({ path: "artifacts/team-studio-lobby-desktop.png", fullPage: true }); }
  await page.getByRole("button", { name: /Build it myself/ }).click();
  await page.getByRole("combobox", { name: "Who’s the client?", exact: true }).selectOption({ label: "Shared Test Client" });
  await page.getByLabel("Engagement / workstream name", { exact: true }).fill("Customer platform build");
  await page.getByLabel("First day", { exact: true }).fill("2027-01-01");
  await page.getByRole("button", { name: "6 months", exact: true }).click();
  await expect(page.getByLabel("Last day", { exact: true })).toHaveValue("2027-06-30");
  await page.getByRole("button", { name: "Build the team", exact: true }).click();
  await page.getByRole("button", { name: "Add the first role", exact: true }).click();
  await page.getByLabel("Delivery role", { exact: true }).fill("Data engineer");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  if (selectAlex) await page.getByRole("button", { name: "Select Alex Rivers for Data engineer", exact: true }).click();
}

test("a known team becomes a direct client plan without an SOW and survives reload", async ({ page }) => {
  const state = await mockWorkspace(page); addPeople(state);
  await directBoard(page, true);
  await page.getByRole("button", { name: "Select Chris Bell for Data engineer", exact: true }).click();
  await expect(page.locator(".ts-error")).toContainText("All 1 Data engineer positions");
  await expect(page.locator(".ts-position-filled")).toHaveCount(1);
  await page.getByRole("spinbutton", { name: "Data engineer positions", exact: true }).fill("2");
  await page.getByRole("button", { name: "Select Chris Bell for Data engineer", exact: true }).click();
  await page.getByRole("button", { name: "Add role", exact: true }).click();
  await page.getByLabel("Delivery role", { exact: true }).fill("Full-stack developer");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Full-stack developer allocation", exact: true }).fill("50");
  await page.getByRole("button", { name: "Select Blair Chen for Full-stack developer", exact: true }).click();
  await expect(page.locator(".ts-position-filled")).toHaveCount(3);
  await page.screenshot({ path: "artifacts/team-studio-known-team-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Customer platform build", exact: true });
  await expect(review).toContainText("Alex Rivers, Chris Bell");
  await expect(review).toContainText("Blair Chen");
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByText("That’s a team worth building.", { exact: true })).toBeVisible();
  const engagement = state.store.data.missions[0].engagement!;
  expect(engagement.source).toBe("direct"); expect(engagement.sowReference).toBe(""); expect(engagement.signedOn).toBe(null);
  expect(engagement.roles.map(role => role.selectedResourceIds?.length)).toEqual([2, 1]);
  expect(engagement.roles[1].allocationPercent).toBe(50);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Customer platform build", exact: true })).toBeVisible();
  await expect(page.locator(".ts-position-filled")).toHaveCount(3);
  expect(state.writes).toEqual(["POST"]);
});

test("an unsaved team and review survive session expiry", async ({ page }) => {
  const state = await mockWorkspace(page); addPeople(state);
  await directBoard(page);
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Customer platform build", exact: true });
  state.authenticated = false;
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Great teams start here." })).toBeVisible();
  await unlock(page);
  await expect(review).toBeVisible();
  await expect(review).toContainText("Alex Rivers");
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(state.store.data.missions).toHaveLength(1);
  expect(state.store.data.missions[0].engagement!.roles[0].selectedResourceIds).toEqual([state.store.data.resources[0].id]);
});

test("unlock, shared admin, and direct team board remain usable at 390 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockWorkspace(page, false); addPeople(state);
  await page.goto("/admin");
  await expect(page.getByLabel("Workspace passcode", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/shared-unlock-mobile.png", fullPage: true });
  await unlock(page);
  await expect(page.getByRole("button", { name: /Shared Test Client/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/shared-admin-mobile.png", fullPage: true });
  await directBoard(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/team-studio-known-team-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Customer platform build", exact: true }).getByRole("button", { name: "Save team plan", exact: true })).toBeVisible();
});

test("a team creation acknowledged after retry remains the same engagement on subsequent edit", async ({ page }) => {
  const state = await mockWorkspace(page); addPeople(state);
  await directBoard(page);
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Customer platform build", exact: true });
  state.loseNextAcknowledgment = true;
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("connection was interrupted");
  await review.getByRole("button", { name: "Refresh saved records", exact: true }).click();
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(state.store.data.missions).toHaveLength(1);
  const id = state.store.data.missions[0].id;
  await expect(page).toHaveURL(new RegExp(`engagement=${id}$`));
  await page.getByRole("spinbutton", { name: "Data engineer allocation", exact: true }).fill("60");
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(state.store.data.missions).toHaveLength(1);
  expect(state.store.data.missions[0].id).toBe(id);
  expect(state.store.data.missions[0].revision).toBe(2);
  expect(state.store.data.missions[0].engagement!.roles[0].allocationPercent).toBe(60);
  expect(state.writes).toEqual(["POST", "POST"]);
});

test("edited team conflicts require reviewing the saved version before keeping a draft", async ({ page }) => {
  const state = await mockWorkspace(page); addPeople(state);
  await directBoard(page);
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Customer platform build", exact: true });
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.getByRole("spinbutton", { name: "Data engineer allocation", exact: true }).fill("50");
  const mission = state.store.data.missions[0];
  state.store = applyLocalAdminCommand(state.store, { type: "save_mission", id: mission.id, expectedRevision: mission.revision, name: mission.name, clientId: mission.clientId, engagement: { ...mission.engagement!, outcomes: "Another planner updated the delivery outcome." } });
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("workspace changed");
  await review.getByRole("button", { name: "Refresh saved records", exact: true }).click();
  await expect(review).toContainText("Another planner updated the delivery outcome.");
  await expect(review.getByRole("button", { name: "Save team plan", exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "Keep my draft instead", exact: true }).click();
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(state.store.data.missions).toHaveLength(1);
  expect(state.store.data.missions[0].revision).toBe(3);
  expect(state.store.data.missions[0].engagement!.roles[0].allocationPercent).toBe(50);
});

test("malformed skill text blocks team save until the visible input is corrected", async ({ page }) => {
  const state = await mockWorkspace(page); addPeople(state);
  await directBoard(page);
  await page.getByRole("button", { name: "Edit Data engineer", exact: true }).click();
  const skills = page.locator(".ts-role-details").getByLabel(/^Skills/);
  await skills.fill('"Unclosed skill');
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Customer platform build", exact: true });
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.locator(".ts-error")).toContainText("Data engineer");
  expect(state.writes).toEqual([]);
  await expect(skills).toHaveValue('"Unclosed skill');
  await skills.fill('"Cloud (AWS, Azure)", SQL');
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(state.store.data.missions[0].engagement!.roles[0].skills).toEqual(["Cloud (AWS, Azure)", "SQL"]);
});

test("adding the first teammate retries a lost practice acknowledgment without creating duplicate practices", async ({ page }) => {
  const state = await mockWorkspace(page);
  await directBoard(page, false, false);
  await page.getByRole("button", { name: "Add a teammate", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a teammate.", exact: true });
  await dialog.getByLabel("Full name", { exact: true }).fill("New teammate");
  await dialog.getByLabel("Practice name", { exact: true }).fill("Engineering");
  await dialog.getByLabel(/^Delivery roles/).fill("Data engineer");
  await dialog.getByLabel(/^Skills/).fill("SQL, Python");
  state.loseNextAcknowledgment = true;
  await dialog.getByRole("button", { name: "Add to the workspace", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("connection was interrupted");
  await expect(dialog.getByLabel("Full name", { exact: true })).toHaveValue("New teammate");
  await dialog.getByRole("button", { name: "Add to the workspace", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.store.data.homes).toHaveLength(1);
  expect(state.store.data.resources).toHaveLength(1);
  expect(state.requestKeys[0]).toBe(state.requestKeys[1]);
  expect(state.writes).toEqual(["POST", "POST"]);
  await page.getByRole("button", { name: "Select New teammate for Data engineer", exact: true }).click();
  await expect(page.locator(".ts-position-filled")).toContainText("New teammate");
});
