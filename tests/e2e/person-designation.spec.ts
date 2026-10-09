import { test, expect, type Page } from "@playwright/test";
import { applyLocalAdminCommand, createLocalAdminStore } from "../../lib/admin/local";

async function workspace(page: Page) {
  let store = createLocalAdminStore();
  for (const entry of [
    { kind: "role" as const, name: "Data Engineer" },
    { kind: "role" as const, name: "Data Modeler" },
    { kind: "skill" as const, name: "SQL" },
    { kind: "skill" as const, name: "Python" },
  ]) store = applyLocalAdminCommand(store, { type: "save_capability", ...entry, description: "" });
  for (const person of [
    { name: "Avery Example", profile: { roles: ["Data Engineer", "Data Modeler"], skills: ["SQL", "Python"] } },
    { name: "Blair Example", profile: { roles: ["Data Engineer"], skills: ["SQL"], affiliation: "impower" as const } },
    { name: "Casey Example", profile: { roles: ["Data Modeler"], skills: ["Python"], affiliation: "contractor" as const } },
  ]) store = applyLocalAdminCommand(store, { type: "save_resource", ...person, home: "", ownerId: "" });
  const state = { store, writes: 0 };
  await page.route("**/api/shared/session", route => route.fulfill({ json: { authenticated: true, configured: true } }));
  await page.route("**/api/shared/admin", async route => {
    const request = route.request();
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      if (body.expectedRevision !== state.store.revision) return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "The shared workspace changed. Refresh before saving." } } });
      state.store = applyLocalAdminCommand(state.store, body.command);
      state.writes++;
    }
    await route.fulfill({ json: state.store });
  });
  return state;
}

const record = (page: Page, name: string) => page.locator(".admin-records > button").filter({ has: page.getByText(name, { exact: true }) });
const filter = (page: Page) => page.getByRole("combobox", { name: "Filter people by designation", exact: true });
const editDialog = (page: Page) => page.getByRole("dialog", { name: "Edit person", exact: true });

test("designation saves, reloads, switches and clears independently of a person's roles and skills", async ({ page }) => {
  const state = await workspace(page);
  await page.goto("/admin?section=people");
  await record(page, "Avery Example").click();
  const editor = editDialog(page);
  const designation = editor.getByRole("group", { name: "Designation", exact: true });
  await expect(designation.getByRole("radio", { name: "Not set", exact: true })).toBeChecked();
  for (const [label, value] of [["Impower", "impower"], ["Contractor", "contractor"], ["Not set", undefined]] as const) {
    await designation.getByRole("radio", { name: label, exact: true }).check();
    await editor.getByRole("button", { name: "Save person", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(record(page, "Avery Example")).toContainText(label);
    await page.reload();
    await record(page, "Avery Example").click();
    await expect(designation.getByRole("radio", { name: label, exact: true })).toBeChecked();
    expect(state.store.data.resources.find(person => person.name === "Avery Example")?.profile).toEqual({
      roles: ["Data Engineer", "Data Modeler"], skills: ["SQL", "Python"], ...(value ? { affiliation: value } : {}),
    });
    for (const name of ["Data Engineer", "Data Modeler"]) await expect(editor.getByRole("region", { name: "Delivery roles", exact: true }).getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    for (const name of ["SQL", "Python"]) await expect(editor.getByRole("region", { name: "Skills", exact: true }).getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  expect(state.store.data.resources.find(person => person.name === "Blair Example")?.profile?.affiliation).toBe("impower");
  expect(state.store.data.resources.find(person => person.name === "Casey Example")?.profile?.affiliation).toBe("contractor");
  expect(state.writes).toBe(3);
});

test("designation filters intersect with search and recover from no matches", async ({ page }) => {
  const state = await workspace(page);
  await page.goto("/admin?section=people");
  const rows = page.locator(".admin-records > button");
  await expect(rows).toHaveCount(3);
  for (const [value, name] of [["impower", "Blair Example"], ["contractor", "Casey Example"], ["unassigned", "Avery Example"]]) {
    await filter(page).selectOption(value);
    await expect(rows).toHaveCount(1);
    await expect(record(page, name)).toBeVisible();
  }
  await filter(page).selectOption("impower");
  await page.getByRole("textbox", { name: "Search People", exact: true }).fill("Casey");
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No matches just yet.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(filter(page)).toHaveValue("all");
  await expect(page.getByRole("textbox", { name: "Search People", exact: true })).toHaveValue("");
  await expect(rows).toHaveCount(3);
  await page.screenshot({ path: "artifacts/person-designation-desktop.png", fullPage: false });
  expect(state.writes).toBe(0);
});

test("a new person can be designated without adding a group or owner and mobile controls fit", async ({ page }) => {
  const state = await workspace(page);
  await page.goto("/admin?section=people");
  await page.getByRole("button", { name: "Add person", exact: true }).first().click();
  const editor = page.getByRole("dialog", { name: "A new person", exact: true });
  await editor.getByLabel("Person’s name", { exact: true }).fill("Drew Example");
  const designation = editor.getByRole("group", { name: "Designation", exact: true });
  await expect(designation.getByRole("radio", { name: "Not set", exact: true })).toBeChecked();
  await designation.getByRole("radio", { name: "Impower", exact: true }).check();
  await page.screenshot({ path: "artifacts/person-designation-editor-desktop.png", fullPage: false });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await designation.scrollIntoViewIfNeeded();
    const overflowing = await editor.evaluate(dialog => [...dialog.querySelectorAll("input, button, select, fieldset")].filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1);
    }).map(element => element.textContent || element.getAttribute("aria-label")));
    expect(overflowing).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/person-designation-editor-${width}.png`, fullPage: false });
  }
  await editor.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await filter(page).selectOption("impower");
  await expect(record(page, "Drew Example")).toContainText("Impower");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const created = state.store.data.resources.find(person => person.name === "Drew Example");
  expect(created?.profile?.affiliation).toBe("impower");
  expect(created?.home).toBe("");
  expect(created?.ownerId).toBe("");
  expect(state.writes).toBe(1);
  await page.screenshot({ path: "artifacts/person-designation-list-320.png", fullPage: false });
});
