import { test, expect, type Locator, type Page } from "@playwright/test";
import { applyLocalAdminCommand, createLocalAdminStore } from "../../lib/admin/local";

async function workspace(page: Page) {
  let store = createLocalAdminStore();
  for (const entry of [
    { kind: "role" as const, name: "Data Engineer" },
    { kind: "role" as const, name: "Data Modeler" },
    { kind: "skill" as const, name: "SQL" },
    { kind: "skill" as const, name: "Python" },
    { kind: "skill" as const, name: "Cloud (AWS, Azure)" },
  ]) store = applyLocalAdminCommand(store, { type: "save_capability", ...entry, description: "" });
  // The corrected catalog can retain an inactive entry of the former type.
  store = applyLocalAdminCommand(store, { type: "save_capability", kind: "role", name: "SQL", description: "Earlier classification" });
  const retiredRole = store.data.capabilities!.find(item => item.name === "SQL" && item.kind === "role")!;
  store = applyLocalAdminCommand(store, { type: "set_capability_active", id: retiredRole.id, expectedRevision: retiredRole.revision, active: false });
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

const roleFilter = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const record = (page: Page, name: string) => page.locator(".admin-records > button").filter({ has: page.getByText(name, { exact: true }) });

test("roles and skills have distinct catalog filters and icons, and creation follows the chosen type", async ({ page }) => {
  const state = await workspace(page);
  await page.goto("/admin?section=capabilities");
  await expect(record(page, "Data Engineer")).toBeVisible();
  await expect(record(page, "SQL")).toBeVisible();
  await expect(record(page, "Data Engineer").locator("svg.lucide-briefcase-business")).toBeVisible();
  await expect(record(page, "SQL").locator("svg.lucide-wrench")).toBeVisible();
  await roleFilter(page, "Roles").click();
  await expect(roleFilter(page, "Roles")).toHaveAttribute("aria-pressed", "true");
  await expect(record(page, "Data Engineer")).toBeVisible();
  await expect(record(page, "SQL")).toHaveCount(0);
  await roleFilter(page, "Skills").click();
  await expect(record(page, "SQL")).toBeVisible();
  await expect(record(page, "Data Engineer")).toHaveCount(0);
  await page.getByRole("button", { name: /^Add (?:role or skill|skill)$/, exact: false }).first().click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("button", { name: "Skill A tool or expertise they bring", exact: true })).toHaveAttribute("aria-pressed", "true");
  await editor.getByLabel("Name", { exact: true }).fill("Snowflake");
  await editor.getByRole("button", { name: "Save skill", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(record(page, "Snowflake")).toBeVisible();
  expect(state.store.data.capabilities?.find(item => item.name === "Snowflake")?.kind).toBe("skill");
  await roleFilter(page, "All").click();
  await expect(record(page, "Data Engineer")).toBeVisible();
  await expect(record(page, "Snowflake")).toBeVisible();
  await page.screenshot({ path: "artifacts/capabilities-catalog-desktop.png", fullPage: false });
  expect(state.writes).toBe(1);
});

const picker = (editor: Locator, kind: "role" | "skill") => editor.getByRole("region", { name: kind === "role" ? "Delivery roles" : "Skills", exact: true });
async function addPerson(page: Page, name: string) {
  await page.getByRole("button", { name: "Add person", exact: true }).first().click();
  const editor = page.getByRole("dialog", { name: "A new person", exact: true });
  await editor.getByLabel("Person’s name", { exact: true }).fill(name);
  return editor;
}

test("two people can share multiple independent roles and skills, with edits retained after reload", async ({ page }) => {
  const state = await workspace(page);
  await page.goto("/admin?section=people");
  for (const name of ["Avery Example", "Morgan Example"]) {
    const editor = await addPerson(page, name);
    for (const role of ["Data Engineer", "Data Modeler"]) await picker(editor, "role").getByRole("button", { name: role, exact: true }).click();
    for (const skill of ["SQL", "Cloud (AWS, Azure)"]) await picker(editor, "skill").getByRole("button", { name: skill, exact: true }).click();
    if (name === "Avery Example") {
      await picker(editor, "role").scrollIntoViewIfNeeded();
      await page.screenshot({ path: "artifacts/capabilities-person-desktop.png", fullPage: false });
    }
    await editor.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  expect(state.store.data.resources.map(person => person.profile)).toEqual([
    { roles: ["Data Engineer", "Data Modeler"], skills: ["SQL", "Cloud (AWS, Azure)"] },
    { roles: ["Data Engineer", "Data Modeler"], skills: ["SQL", "Cloud (AWS, Azure)"] },
  ]);
  await page.reload();
  await record(page, "Avery Example").click();
  const editor = page.getByRole("dialog", { name: "Edit person", exact: true });
  await expect(picker(editor, "role").getByRole("button", { name: "Data Engineer", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(picker(editor, "skill").getByRole("button", { name: "Cloud (AWS, Azure)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await picker(editor, "role").getByRole("button", { name: "Remove Data Modeler from roles", exact: true }).click();
  await picker(editor, "skill").getByRole("button", { name: "Remove SQL from skills", exact: true }).click();
  await editor.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await record(page, "Avery Example").click();
  await expect(picker(editor, "role").getByRole("button", { name: "Data Modeler", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(picker(editor, "skill").getByRole("button", { name: "SQL", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(state.store.data.resources.find(person => person.name === "Avery Example")?.profile).toEqual({ roles: ["Data Engineer"], skills: ["Cloud (AWS, Azure)"] });
  expect(state.store.data.resources.find(person => person.name === "Morgan Example")?.profile).toEqual({ roles: ["Data Engineer", "Data Modeler"], skills: ["SQL", "Cloud (AWS, Azure)"] });
  expect(state.writes).toBe(3);
});

test("person searches keep role and skill choices separate and block accidental cross-type entry", async ({ page }) => {
  const state = await workspace(page);
  await page.goto("/admin?section=people");
  const editor = await addPerson(page, "Casey Example");
  const roles = picker(editor, "role"), skills = picker(editor, "skill");
  await expect(roles.getByRole("button", { name: "SQL", exact: true })).toHaveCount(0);
  await expect(skills.getByRole("button", { name: "Data Engineer", exact: true })).toHaveCount(0);
  await roles.getByRole("textbox", { name: "Search or add roles", exact: true }).fill("SQL");
  await expect(roles).toContainText("“SQL” is a skill. Choose it under Skills.");
  await roles.getByRole("textbox").press("Enter");
  await expect(roles.getByRole("button", { name: "Remove SQL from roles", exact: true })).toHaveCount(0);
  await expect(editor).toBeVisible();
  expect(state.writes).toBe(0);
  await roles.getByRole("textbox").fill("Model");
  await expect(roles.getByRole("button", { name: "Data Modeler", exact: true })).toBeVisible();
  await expect(roles.getByRole("button", { name: "Data Engineer", exact: true })).toHaveCount(0);
  await roles.getByRole("button", { name: "Data Modeler", exact: true }).click();
  await skills.getByRole("textbox", { name: "Search or add skills", exact: true }).fill("Data Engineer");
  await expect(skills).toContainText("“Data Engineer” is a delivery role. Choose it under Delivery roles.");
  await skills.getByRole("textbox").press("Enter");
  await expect(skills.getByRole("button", { name: "Remove Data Engineer from skills", exact: true })).toHaveCount(0);
  await skills.getByRole("textbox").fill("Python");
  await skills.getByRole("textbox").press("Enter");
  await skills.getByRole("textbox").fill("Cloud (GCP, Azure)");
  await skills.getByRole("textbox").press("Enter");
  await expect(skills.getByRole("button", { name: "Remove Cloud (GCP, Azure) from skills", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(state.store.data.resources[0].profile).toEqual({ roles: ["Data Modeler"], skills: ["Python", "Cloud (GCP, Azure)"] });
  expect(state.writes).toBe(1);
});

test("the catalog requires an explicit type and compact pickers fit a mobile screen", async ({ page }) => {
  await workspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin?section=capabilities");
  await page.getByRole("button", { name: "Add role or skill", exact: true }).first().click();
  let editor = page.getByRole("dialog");
  await expect(editor.getByRole("button", { name: "Choose a type to continue", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Delivery role A job someone can do", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Save role", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "Close editor", exact: true }).click();
  await page.screenshot({ path: "artifacts/capabilities-catalog-mobile.png", fullPage: false });
  await page.goto("/admin?section=people");
  editor = await addPerson(page, "Mobile Example");
  await picker(editor, "role").getByRole("button", { name: "Data Engineer", exact: true }).click();
  await picker(editor, "skill").getByRole("button", { name: "Cloud (AWS, Azure)", exact: true }).click();
  await expect(picker(editor, "skill").getByRole("button", { name: "Remove Cloud (AWS, Azure) from skills", exact: true })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const overflowing = await editor.evaluate(dialog => [...dialog.querySelectorAll("input, button")].filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1);
    }).map(element => element.textContent || element.getAttribute("aria-label")));
    expect(overflowing).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await picker(editor, "role").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/capabilities-person-${width}.png`, fullPage: false });
  }
});
