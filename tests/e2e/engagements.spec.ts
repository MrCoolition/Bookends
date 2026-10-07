import { test, expect, type Locator, type Page } from "@playwright/test";
import { applyLocalAdminCommand, createLocalAdminStore, type LocalAdminStore } from "../../lib/admin/local";

const STORAGE_KEY = "bookends.local-admin.v1";
const section = (page: Page, name: string) => page.getByRole("navigation", { name: "Administration sections" }).getByRole("button", { name: new RegExp(name) });
const action = (dialog: Locator, name: string) => dialog.getByRole("button", { name, exact: true }).last();
const roleRows = (dialog: Locator) => dialog.locator(".eng-role-editor > fieldset");
const saved = (page: Page): Promise<LocalAdminStore> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);

async function openRole(dialog: Locator, index: number) {
  const toggle = dialog.locator(".eng-role-summary").nth(index);
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  return roleRows(dialog).nth(index);
}

async function addClient(page: Page) {
  await page.getByRole("button", { name: "Add client", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Client name", { exact: true }).fill("Meridian Labs");
  await dialog.getByLabel(/^Stable client code/).fill("MERIDIAN");
  await action(dialog, "Add client").click();
  await expect(dialog).toHaveCount(0);
}

async function newEngagement(page: Page, options: { name?: string; start?: string; end?: string } = {}) {
  await page.goto("/admin");
  await addClient(page);
  await section(page, "Engagements").click();
  await page.getByRole("button", { name: "Add engagement", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Engagement name", { exact: true }).fill(options.name ?? "Meridian application build");
  await dialog.getByRole("combobox", { name: "Client", exact: true }).selectOption({ label: "Meridian Labs" });
  await dialog.getByLabel("Engagement starts", { exact: true }).fill(options.start ?? "2027-01-01");
  await dialog.getByLabel("Engagement ends", { exact: true }).fill(options.end ?? "2028-06-30");
  return dialog;
}

async function applicationTeam(dialog: Locator) {
  await action(dialog, "Build the team").click();
  await action(dialog, "Application build").click();
  await expect(roleRows(dialog)).toHaveCount(3);
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
    dialog: document.querySelector("dialog")?.getBoundingClientRect().toJSON(),
    overflowing: [...document.querySelectorAll("dialog input, dialog select, dialog textarea, dialog button")].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);
    }).map(element => element.textContent || element.getAttribute("aria-label")),
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport);
  expect(widths.overflowing).toEqual([]);
  if (widths.dialog) {
    expect(widths.dialog.x).toBeGreaterThanOrEqual(0);
    expect(widths.dialog.right).toBeLessThanOrEqual(widths.viewport + 1);
  }
}

test("a signed 18-month application engagement saves a role-based team with fractional demand and survives edits", async ({ page }) => {
  const errors: string[] = [];
  const serverMutations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/admin") && request.method() === "POST") serverMutations.push(request.url()); });
  const dialog = await newEngagement(page);
  await dialog.getByLabel("SOW reference", { exact: true }).fill("MER-APP-2027-01");
  await dialog.getByRole("combobox", { name: "SOW status", exact: true }).selectOption("signed");
  await dialog.getByLabel("Signed on", { exact: true }).fill("2026-12-15");
  await dialog.getByLabel("Outcomes & scope", { exact: true }).fill("Build and launch the client application with a dependable data platform.");
  await applicationTeam(dialog);
  await expect(roleRows(dialog).nth(0).getByLabel("Role name", { exact: true })).toHaveValue("Data engineer");
  await expect(roleRows(dialog).nth(1).getByLabel("Role name", { exact: true })).toHaveValue("Full-stack developer");
  await expect(roleRows(dialog).nth(1).getByLabel("Headcount", { exact: true })).toHaveValue("2");
  await expect(roleRows(dialog).nth(2).getByLabel("Role name", { exact: true })).toHaveValue("BA / PM");
  await (await openRole(dialog, 2)).getByLabel("Allocation per person (%)", { exact: true }).fill("50");
  await expect(roleRows(dialog).nth(2).getByRole("textbox", { name: "Responsibilities", exact: true })).toHaveValue(/ceremonies/i);
  await action(dialog, "Review team plan").click();
  await expect(dialog).toContainText("18");
  await expect(dialog).toContainText("3.5");
  await action(dialog, "Save engagement").click();
  await expect(dialog).toHaveCount(0);
  const initial = (await saved(page)).data.missions[0];
  expect(initial.engagement).toMatchObject({ status: "signed", sowReference: "MER-APP-2027-01", signedOn: "2026-12-15", start: "2027-01-01", end: "2028-06-30" });
  expect(initial.engagement!.roles.map(role => [role.name, role.headcount, role.allocationPercent])).toEqual([
    ["Data engineer", 1, 100], ["Full-stack developer", 2, 100], ["BA / PM", 1, 50],
  ]);
  expect(initial.engagement!.roles.every(role => role.skills.length > 0 && role.responsibilities.length > 0)).toBe(true);
  await page.reload();
  await section(page, "Engagements").click();
  await page.getByRole("button", { name: /Meridian application build/ }).click();
  await action(dialog, "The engagement").click();
  await dialog.getByLabel("Engagement name", { exact: true }).fill("Meridian application build — launch phase");
  await action(dialog, "Build the team").click();
  await expect(roleRows(dialog).nth(2).getByLabel("Allocation per person (%)", { exact: true })).toHaveValue("50");
  await action(dialog, "Review team plan").click();
  await action(dialog, "Save engagement").click();
  const after = (await saved(page)).data.missions[0];
  expect(after.id).toBe(initial.id);
  expect(after.revision).toBe(initial.revision + 1);
  expect(after.engagement).toEqual(initial.engagement);
  expect(errors).toEqual([]);
  expect(serverMutations).toEqual([]);
});

test("signed SOW details and delivery roles are required before saving", async ({ page }) => {
  const dialog = await newEngagement(page);
  await dialog.getByRole("combobox", { name: "SOW status", exact: true }).selectOption("signed");
  await action(dialog, "Build the team").click();
  await expect(dialog.getByLabel("SOW reference", { exact: true })).toBeVisible();
  expect((await saved(page)).data.missions).toHaveLength(0);
  await dialog.getByLabel("SOW reference", { exact: true }).fill("MER-APP-2027-02");
  await action(dialog, "Build the team").click();
  await expect(dialog.getByLabel("Signed on", { exact: true })).toBeVisible();
  await dialog.getByLabel("Signed on", { exact: true }).fill("2026-12-15");
  await action(dialog, "Build the team").click();
  await action(dialog, "Review team plan").click();
  await expect(action(dialog, "Application build")).toBeVisible();
  await expect(action(dialog, "Save engagement")).toHaveCount(0);
  expect((await saved(page)).data.missions).toHaveLength(0);
  await action(dialog, "Application build").click();
  await action(dialog, "Review team plan").click();
  await action(dialog, "Save engagement").click();
  await expect(dialog).toHaveCount(0);
  expect((await saved(page)).data.missions).toHaveLength(1);
});

test("phased roles preserve their own dates and cannot extend beyond the engagement", async ({ page }) => {
  const dialog = await newEngagement(page, { start: "2027-01-01", end: "2027-12-31" });
  await applicationTeam(dialog);
  const ba = await openRole(dialog, 2);
  await ba.getByLabel("Full engagement", { exact: true }).uncheck();
  await ba.getByLabel("Role starts", { exact: true }).fill("2027-03-01");
  await ba.getByLabel("Role ends", { exact: true }).fill("2028-02-29");
  await action(dialog, "Review team plan").click();
  await expect(ba.getByLabel("Role ends", { exact: true })).toBeVisible();
  expect((await saved(page)).data.missions).toHaveLength(0);
  await ba.getByLabel("Role ends", { exact: true }).fill("2027-10-31");
  await ba.getByLabel("Allocation per person (%)", { exact: true }).fill("37.5");
  await action(dialog, "Review team plan").click();
  await action(dialog, "Save engagement").click();
  await expect(dialog).toHaveCount(0);
  const phase = (await saved(page)).data.missions[0].engagement!.roles[2];
  expect(phase).toMatchObject({ start: "2027-03-01", end: "2027-10-31", allocationPercent: 37.5 });
  await page.reload();
  await section(page, "Engagements").click();
  await page.getByRole("button", { name: /Meridian application build/ }).click();
  await action(dialog, "Build the team").click();
  await openRole(dialog, 2);
  await expect(ba.getByLabel("Full engagement", { exact: true })).not.toBeChecked();
  await expect(ba.getByLabel("Role starts", { exact: true })).toHaveValue("2027-03-01");
  await expect(ba.getByLabel("Role ends", { exact: true })).toHaveValue("2027-10-31");
});

test("legacy missions are retained and gain engagement detail without being duplicated", async ({ page }) => {
  let store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", name: "Meridian Labs", code: "MERIDIAN", contactName: "", contactEmail: "", notes: "" });
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Existing delivery", clientId: store.data.clients[0].id });
  const legacy = store.data.missions[0];
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: STORAGE_KEY, value: JSON.stringify(store) });
  await page.goto("/admin");
  await section(page, "Engagements").click();
  await page.getByRole("button", { name: /Existing delivery/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Engagement name", { exact: true })).toHaveValue("Existing delivery");
  await dialog.getByLabel("Engagement starts", { exact: true }).fill("2027-01-01");
  await dialog.getByLabel("Engagement ends", { exact: true }).fill("2027-12-31");
  await applicationTeam(dialog);
  await action(dialog, "Review team plan").click();
  await action(dialog, "Save engagement").click();
  await expect(dialog).toHaveCount(0);
  const after = await saved(page);
  expect(after.data.missions).toHaveLength(1);
  expect(after.data.missions[0]).toMatchObject({ id: legacy.id, name: legacy.name, clientId: legacy.clientId, revision: legacy.revision + 1 });
  expect(after.data.missions[0].engagement!.roles).toHaveLength(3);
});

test("phone setup can create and review a team without horizontal clipping", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 650 });
  const dialog = await newEngagement(page, { name: "Mobile application build" });
  await expectNoHorizontalOverflow(page);
  await applicationTeam(dialog);
  await expectNoHorizontalOverflow(page);
  await (await openRole(dialog, 2)).getByLabel("Allocation per person (%)", { exact: true }).fill("50");
  await action(dialog, "Review team plan").click();
  await expectNoHorizontalOverflow(page);
  await action(dialog, "Save engagement").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Mobile application build/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("recorded teammate profiles distinguish skill alignment, missing skills and unknown profiles", async ({ page }) => {
  let store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_home", code: "DELIVERY", name: "Delivery", description: "" });
  for (const person of [
    { name: "Asha Example", profile: { roles: ["Data engineer"], skills: ["SQL"] } },
    { name: "Noah Example", profile: { roles: ["Data engineer"], skills: [] } },
    { name: "Sam Example" },
  ]) store = applyLocalAdminCommand(store, { type: "save_resource", ...person, home: "DELIVERY", ownerId: store.data.viewer.id });
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: STORAGE_KEY, value: JSON.stringify(store) });
  await page.goto("/admin");
  await section(page, "People").click();
  await page.getByRole("button", { name: /Asha Example/ }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/^Delivery roles/)).toHaveValue("Data engineer");
  await dialog.getByLabel(/^Skills/).fill("SQL, Python");
  await action(dialog, "Save person").click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  expect((await saved(page)).data.resources.find(person => person.name === "Asha Example")!.profile).toEqual({ roles: ["Data engineer"], skills: ["SQL", "Python"] });
  dialog = await newEngagement(page);
  await applicationTeam(dialog);
  await action(dialog, "Review team plan").click();
  const dataRole = dialog.locator(".eng-review-role").filter({ has: page.getByRole("heading", { name: "Data engineer", exact: true }) });
  await dataRole.getByText("Find teammates", { exact: true }).click();
  const known = dataRole.getByRole("article").filter({ hasText: "Asha Example" });
  await expect(known).toContainText("2/3 skills");
  await expect(known).toContainText("Not recorded: Data pipelines");
  const unknown = dataRole.getByRole("article").filter({ hasText: "Noah Example" });
  await expect(unknown).toContainText("Skills not recorded");
  await expect(dataRole).toContainText("1 active teammate needs a role or skills profile before matching.");
  await expect(dataRole).toContainText("Availability and interest still need review.");
  await expect(dataRole.getByRole("article").filter({ hasText: "Sam Example" })).toHaveCount(0);
});

test("configured roles and skills feed people and engagement matching while renames preserve existing profiles", async ({ page }) => {
  let store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_home", code: "DELIVERY", name: "Delivery", description: "" });
  store = applyLocalAdminCommand(store, { type: "save_resource", name: "Morgan Example", home: "DELIVERY", ownerId: store.data.viewer.id });
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: STORAGE_KEY, value: JSON.stringify(store) });
  await page.goto("/admin");
  await section(page, "Roles & skills").click();
  for (const entry of [{ kind: "role", name: "Delivery analyst" }, { kind: "skill", name: "Cloud (AWS, Azure)" }]) {
    await page.getByRole("button", { name: "Add role or skill", exact: true }).first().click();
    const editor = page.getByRole("dialog");
    await editor.getByLabel("Type", { exact: true }).selectOption(entry.kind);
    await editor.getByLabel("Name", { exact: true }).fill(entry.name);
    await editor.getByLabel("Description", { exact: true }).fill("A shared delivery capability.");
    await action(editor, "Save role or skill").click();
    await expect(editor).toHaveCount(0);
  }
  await section(page, "People").click();
  await page.getByRole("button", { name: /Morgan Example/ }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByText("Choose configured roles", { exact: true }).click();
  await action(dialog, "Delivery analyst").click();
  await dialog.getByText("Choose configured skills", { exact: true }).click();
  await action(dialog, "Cloud (AWS, Azure)").click();
  await expect(dialog.getByLabel("Delivery roles", { exact: true })).toHaveValue("Delivery analyst");
  await expect(dialog.getByLabel("Skills", { exact: true })).toHaveValue('"Cloud (AWS, Azure)"');
  await action(dialog, "Save person").click();
  await expect(dialog).toHaveCount(0);
  await section(page, "Roles & skills").click();
  await page.getByRole("button", { name: /Delivery analyst/ }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Product analyst");
  await action(dialog, "Save role or skill").click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const renamed = (await saved(page)).data.capabilities!.find(entry => entry.kind === "role")!;
  expect(renamed).toMatchObject({ name: "Product analyst", aliases: ["Delivery analyst"] });
  expect((await saved(page)).data.resources[0].profile).toEqual({ roles: ["Delivery analyst"], skills: ["Cloud (AWS, Azure)"] });
  await section(page, "People").click();
  await page.getByRole("button", { name: /Morgan Example/ }).click();
  await expect(dialog.getByLabel("Skills", { exact: true })).toHaveValue('"Cloud (AWS, Azure)"');
  await dialog.getByRole("button", { name: "Close editor", exact: true }).click();
  dialog = await newEngagement(page, { name: "Requirements and delivery" });
  await action(dialog, "Build the team").click();
  await dialog.getByRole("button", { name: /^Add role/ }).click();
  const role = roleRows(dialog).first();
  await role.getByLabel("Role name", { exact: true }).fill("Product analyst");
  await role.getByText("Choose configured skills", { exact: true }).click();
  await action(role, "Cloud (AWS, Azure)").click();
  await expect(role.getByLabel("Required skills", { exact: true })).toHaveValue('"Cloud (AWS, Azure)"');
  await action(dialog, "Review team plan").click();
  await dialog.getByText("Find teammates", { exact: true }).click();
  const match = dialog.getByRole("article").filter({ hasText: "Morgan Example" });
  await expect(match).toContainText("Role matches");
  await expect(match).toContainText("1/1 skills");
  await action(dialog, "Save engagement").click();
  await expect(dialog).toHaveCount(0);
  await section(page, "Roles & skills").click();
  await page.getByRole("button", { name: /Product analyst/ }).click();
  await action(dialog, "Make inactive").click();
  await expect(dialog).toHaveCount(0);
  expect((await saved(page)).data.capabilities!.find(entry => entry.id === renamed.id)!.active).toBe(false);
  expect((await saved(page)).data.resources[0].profile!.roles).toEqual(["Delivery analyst"]);
  expect((await saved(page)).data.missions[0].engagement!.roles[0].name).toBe("Product analyst");
});
