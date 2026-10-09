import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { applyLocalAdminCommand, createLocalAdminStore, parseLocalAdminStore, type LocalAdminStore } from "../../lib/admin/local";

function seedWorkspace() {
  let store = createLocalAdminStore();
  store = applyLocalAdminCommand(store, { type: "save_client", name: "Northwind Example", code: "NORTH", contactName: "Casey Contact", contactEmail: "casey@example.test", notes: "Original client notes" });
  store = applyLocalAdminCommand(store, { type: "save_client", name: "Archived Example", code: "ARCHIVE", contactName: "", contactEmail: "", notes: "Retain this client" });
  const archivedClient = store.data.clients.find(client => client.code === "ARCHIVE")!;
  store = applyLocalAdminCommand(store, { type: "set_client_active", id: archivedClient.id, expectedRevision: archivedClient.revision, active: false });
  store = applyLocalAdminCommand(store, { type: "save_home", code: "DATA", name: "Data practice", description: "Example practice" });
  for (const entry of [{ kind: "role" as const, name: "Data Engineer" }, { kind: "skill" as const, name: "SQL" }, { kind: "skill" as const, name: "Cloud (AWS, Azure)" }]) {
    store = applyLocalAdminCommand(store, { type: "save_capability", ...entry, description: "Example capability" });
  }
  for (const person of [
    { name: "Avery Example", affiliation: "impower" as const },
    { name: "Morgan Example", affiliation: "contractor" as const },
    { name: "Retired Example", affiliation: undefined },
  ]) {
    store = applyLocalAdminCommand(store, { type: "save_resource", name: person.name, home: "", ownerId: "", profile: { roles: ["Data Engineer"], skills: ["SQL", "Cloud (AWS, Azure)"], ...(person.affiliation ? { affiliation: person.affiliation } : {}) } });
  }
  const retired = store.data.resources.find(person => person.name === "Retired Example")!;
  store = applyLocalAdminCommand(store, { type: "set_resource_active", id: retired.id, expectedRevision: retired.revision, active: false });
  store = applyLocalAdminCommand(store, {
    type: "save_mission", name: "Application build", clientId: store.data.clients[0].id,
    engagement: {
      version: 1, source: "sow", sowReference: "SOW-EXAMPLE", status: "signed", signedOn: "2026-09-30", start: "2026-10-01", end: "2027-03-31", outcomes: "Deliver an application",
      intake: { sourceName: "example-sow.txt", sourceKind: "text", evidence: [{ field: "outcomes", quote: "Deliver an application", verified: true }], uncertainties: ["Confirm delivery milestones"] },
      roles: [{ id: "00000000-0000-4000-8000-000000000777", name: "Data Engineer", headcount: 2, allocationPercent: 100, skills: ["SQL"], responsibilities: "Build pipelines", start: "2026-10-01", end: "2027-03-31", selectedResourceIds: [store.data.resources[0].id] }],
    },
  });
  return store;
}

async function mockWorkspace(page: Page) {
  const state = { store: seedWorkspace(), gets: 0, writes: [] as string[] };
  await page.route("**/api/shared/session", route => route.fulfill({ json: { authenticated: true, configured: true } }));
  await page.route("**/api/shared/admin", async route => {
    const request = route.request();
    if (request.method() === "GET") state.gets++;
    else {
      const body = request.postDataJSON();
      if (body.expectedRevision !== state.store.revision) return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "The shared workspace changed. Refresh before saving." } } });
      state.store = request.method() === "PUT" ? parseLocalAdminStore({ ...body.store, revision: state.store.revision + 1 }) : applyLocalAdminCommand(state.store, body.command);
      state.writes.push(request.method());
    }
    await route.fulfill({ json: state.store });
  });
  return state;
}

async function downloadWorkbook(page: Page) {
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path!);
  return workbook;
}

function cell(sheet: ExcelJS.Worksheet, row: number, heading: string) {
  const headers = sheet.getRow(4).values as ExcelJS.CellValue[];
  const column = headers.findIndex(value => value === heading);
  expect(column, `${sheet.name} column ${heading}`).toBeGreaterThan(0);
  return sheet.getRow(row).getCell(column);
}
function dataRows(sheet: ExcelJS.Worksheet) {
  const rows: number[] = [];
  sheet.eachRow((row, index) => { if (index >= 5 && row.hasValues) rows.push(index); });
  return rows;
}
function findRow(sheet: ExcelJS.Worksheet, heading: string, value: string) {
  const row = dataRows(sheet).find(index => cell(sheet, index, heading).text === value);
  expect(row, `${sheet.name}: ${value}`).toBeDefined();
  return row!;
}
async function importWorkbook(page: Page, workbook: ExcelJS.Workbook) {
  await page.getByLabel("Choose an Excel workbook", { exact: true }).setInputFiles({ name: "BOOKENDS_batch_updates.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  const review = page.getByRole("dialog", { name: "Review your spreadsheet.", exact: true });
  await expect(review.locator(".admin-excel-totals")).toBeVisible();
  return review;
}
function withoutAsOf(store: LocalAdminStore) {
  const { asOf: _asOf, ...data } = store.data;
  return data;
}

test("populated Excel exports fresh complete data regardless of visible filters, and an unchanged file imports without updates", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/admin?section=people");
  await page.getByRole("textbox", { name: "Search People", exact: true }).fill("Avery");
  await page.getByRole("combobox", { name: "Filter people by designation", exact: true }).selectOption("impower");
  await expect(page.locator(".admin-records > button")).toHaveCount(1);
  const previousGets = state.gets;
  // Simulate a teammate saving from another browser after this screen was loaded.
  state.store = applyLocalAdminCommand(state.store, { type: "save_resource", name: "Fresh Example", home: "", ownerId: "" });
  const baseline = structuredClone(state.store);
  const workbook = await downloadWorkbook(page);
  expect(state.gets).toBeGreaterThan(previousGets);
  const people = workbook.getWorksheet("People")!, clients = workbook.getWorksheet("Clients")!;
  expect(dataRows(people)).toHaveLength(4);
  expect(dataRows(clients)).toHaveLength(2);
  expect(cell(people, findRow(people, "Person name", "Retired Example"), "Active").text.toLowerCase()).toMatch(/false|no|inactive/);
  expect(cell(people, findRow(people, "Person name", "Fresh Example"), "Record ID").text).toBe(state.store.data.resources.at(-1)!.id);
  expect(dataRows(workbook.getWorksheet("Engagement roles")!)).toHaveLength(1);
  for (const name of ["HOMEs", "Engagements", "Roles", "Skills", "Workspace", "Members", "Playbooks", "Requirements", "SOW notes", "Team selections"]) expect(workbook.getWorksheet(name), name).toBeDefined();
  const review = await importWorkbook(page, workbook);
  await expect(review.getByText("Reference tabs are included for completeness.", { exact: false })).toBeVisible();
  await expect(review.locator(".admin-excel-totals")).toContainText("0 to add");
  await expect(review.locator(".admin-excel-totals")).toContainText("0 to update");
  await expect(review.getByText("There are no additions or updates to apply.", { exact: false })).toBeVisible();
  await expect(review.getByRole("button", { name: "Apply import", exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]);
  expect(withoutAsOf(state.store)).toEqual(withoutAsOf(baseline));
});

test("Excel edits update existing IDs, preserve unedited data and ignore reference sheet changes", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/admin?section=people");
  await expect(page.getByRole("heading", { name: "Real people. Clear ownership." })).toBeVisible();
  const baseline = structuredClone(state.store);
  const workbook = await downloadWorkbook(page);
  const people = workbook.getWorksheet("People")!, clients = workbook.getWorksheet("Clients")!;
  const personRow = findRow(people, "Person name", "Avery Example");
  cell(people, personRow, "Person name").value = "Avery Updated";
  cell(people, personRow, "Designation").value = "Contractor";
  cell(clients, findRow(clients, "Client code", "NORTH"), "Notes").value = "Batch updated client notes";
  // These sheets expose context; Excel must never change permissions or playbook policy.
  for (const name of ["Workspace", "Members", "Playbooks", "Requirements", "SOW notes", "Team selections"]) workbook.getWorksheet(name)!.getCell("A5").value = "REFERENCE EDIT MUST NOT APPLY";
  const review = await importWorkbook(page, workbook);
  await expect(review.locator(".admin-excel-totals")).toContainText("0 to add");
  await expect(review.locator(".admin-excel-totals")).toContainText("2 to update");
  await expect(review.locator(".admin-excel-issues")).toHaveCount(0);
  await review.locator(".admin-excel-change-list > summary").click();
  await expect(review.locator(".admin-excel-field-changes")).toContainText(["Batch updated client notes", "Avery Updated"]);
  await page.screenshot({ path: "artifacts/excel-import-review-desktop.png", fullPage: false });
  await review.getByRole("checkbox", { name: "I reviewed these additions and updates. Apply them to the shared workspace." }).check();
  await review.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(state.writes).toEqual(["PUT"]);
  expect(state.store.data.resources).toHaveLength(baseline.data.resources.length);
  expect(state.store.data.clients).toHaveLength(baseline.data.clients.length);
  expect(state.store.data.resources.find(person => person.id === baseline.data.resources[0].id)).toMatchObject({ name: "Avery Updated", profile: { roles: ["Data Engineer"], skills: ["SQL", "Cloud (AWS, Azure)"], affiliation: "contractor" } });
  expect(state.store.data.clients.find(client => client.id === baseline.data.clients[0].id)).toMatchObject({ name: "Northwind Example", notes: "Batch updated client notes" });
  for (const key of ["organization", "viewer", "members", "templates", "missions", "homes", "capabilities"] as const) expect(state.store.data[key]).toEqual(baseline.data[key]);
  await page.reload();
  await expect(page.locator(".admin-records > button").filter({ hasText: "Avery Updated" })).toContainText("Contractor");
  await expect(page.locator(".admin-records > button").filter({ hasText: "Avery Example" })).toHaveCount(0);
});

test("an older exported row cannot overwrite a newer saved revision", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/admin?section=people");
  const workbook = await downloadWorkbook(page);
  const sheet = workbook.getWorksheet("People")!;
  cell(sheet, findRow(sheet, "Person name", "Avery Example"), "Person name").value = "Stale Excel Name";
  const person = state.store.data.resources[0];
  state.store = applyLocalAdminCommand(state.store, { type: "save_resource", id: person.id, expectedRevision: person.revision, name: "Newer Server Name", home: person.home, ownerId: person.ownerId, profile: person.profile });
  // Import must refresh its baseline itself; this browser still shows the old name.
  const review = await importWorkbook(page, workbook);
  await expect(review.locator(".admin-excel-issues")).toContainText(/revision|changed|newer|export again/i);
  await expect(review.getByRole("button", { name: "Apply import", exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]);
  expect(state.store.data.resources[0].name).toBe("Newer Server Name");
});

for (const width of [390, 320]) {
  test(`Excel controls remain accessible without horizontal overflow at ${width}px`, async ({ page }) => {
    await mockWorkspace(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin?section=people");
    const toolbar = page.getByRole("region", { name: "Shared workspace controls", exact: true });
    await expect(toolbar.getByRole("button", { name: "Export Excel", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Import Excel", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("link", { name: "Download Excel template", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflowing = await toolbar.evaluate(element => [...element.querySelectorAll("a, button, summary")].filter(control => {
      const bounds = control.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1);
    }).map(control => control.textContent || control.getAttribute("aria-label")));
    expect(overflowing).toEqual([]);
    await toolbar.screenshot({ path: `artifacts/excel-export-toolbar-${width}.png` });
  });
}
