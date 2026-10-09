import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { applyLocalAdminCommand, createLocalAdminStore, parseLocalAdminStore, type LocalAdminCommand } from "../../lib/admin/local";
import type { EngagementPlan } from "../../lib/admin/engagement";
import { emptyForecast } from "../../lib/forecast/types";

test.use({ actionTimeout: 10_000 });

const START = "2027-01-01", END = "2027-03-31";
function baseWorkspace() {
  let store = createLocalAdminStore();
  store = applyLocalAdminCommand(store, { type: "save_client", name: "Northwind Example", code: "NORTH", contactName: "", contactEmail: "", notes: "" });
  for (const entry of [{ kind: "role" as const, name: "Data Engineer" }, { kind: "skill" as const, name: "SQL" }]) {
    store = applyLocalAdminCommand(store, { type: "save_capability", ...entry, description: "Pipeline test capability" });
  }
  for (const name of ["Avery Example", "Morgan Example", "Unconfirmed Example"]) {
    store = applyLocalAdminCommand(store, { type: "save_resource", name, home: "", ownerId: "", profile: { roles: ["Data Engineer"], skills: ["SQL"], affiliation: "impower" } });
  }
  const engagement: EngagementPlan = {
    version: 1, source: "sow", sowReference: "SOW-SIGNED", status: "signed", signedOn: "2026-12-01", start: START, end: END, outcomes: "Deliver the signed platform",
    roles: [{ id: randomUUID(), name: "Data Engineer", headcount: 1, allocationPercent: 100, skills: ["SQL"], responsibilities: "Build pipelines", start: START, end: END, selectedResourceIds: [store.data.resources[0].id] }],
  };
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Signed platform", clientId: store.data.clients[0].id, engagement });
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Potential analytics", clientId: store.data.clients[0].id, engagement: {
    ...engagement, sowReference: "", signedOn: null, status: "draft", pipeline: { stage: "qualified", confidence: 70, expectedClose: "2026-12-15" },
    roles: [{ ...engagement.roles[0], id: randomUUID(), headcount: 3, selectedResourceIds: [] }],
  } });
  const forecast = emptyForecast();
  forecast.capacities = store.data.resources.slice(0, 2).map(person => ({ resourceId: person.id, allocationPercent: 100, availableFrom: START, availableUntil: "2027-12-31", notes: "Confirmed planning capacity" }));
  forecast.commitments = [{ id: randomUUID(), resourceId: store.data.resources[0].id, missionId: store.data.missions[0].id, name: "Signed delivery allocation", start: START, end: END, allocationPercent: 100 }];
  store = applyLocalAdminCommand(store, { type: "save_forecast", expectedRevision: 0, forecast });
  return store;
}

async function mockWorkspace(page: Page, store = baseWorkspace()) {
  const state = { store, authenticated: true, expireNextWrite: false, writes: [] as LocalAdminCommand[], pauseNextWrite: null as (() => Promise<void>) | null };
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
    if (request.method() !== "GET" && state.expireNextWrite) { state.authenticated = false; state.expireNextWrite = false; }
    if (!state.authenticated) return route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "Your session ended. Unlock to continue." } } });
    if (request.method() !== "GET") {
      if (state.pauseNextWrite) { const pause = state.pauseNextWrite; state.pauseNextWrite = null; await pause(); }
      const body = request.postDataJSON();
      const fingerprint = JSON.stringify(body.command ?? body.store);
      if (body.idempotencyKey && receipts.has(body.idempotencyKey)) {
        if (receipts.get(body.idempotencyKey) !== fingerprint) return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "This request key belongs to a different change." } } });
        return route.fulfill({ json: state.store });
      }
      if (body.expectedRevision !== state.store.revision) return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "The shared workspace changed. Refresh before saving." } } });
      state.store = request.method() === "PUT" ? parseLocalAdminStore({ ...body.store, revision: state.store.revision + 1 }) : applyLocalAdminCommand(state.store, body.command);
      state.writes.push(body.command);
      if (body.idempotencyKey) receipts.set(body.idempotencyKey, fingerprint);
    }
    await route.fulfill({ json: state.store });
  });
  return state;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  const overflow = await page.locator("dialog[open]").evaluateAll(dialogs => dialogs.flatMap(dialog => [...dialog.querySelectorAll("input, select, textarea, button")].filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
  }).map(element => element.getAttribute("aria-label") || element.textContent)));
  expect(overflow).toEqual([]);
}

async function potentialForm(page: Page, name = "New application opportunity") {
  await page.getByRole("button", { name: "Add potential SOW", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Potential SOW", exact: true });
  await dialog.getByLabel("Engagement name", { exact: true }).fill(name);
  await dialog.getByRole("combobox", { name: "Client", exact: true }).selectOption({ label: "Northwind Example" });
  await dialog.getByLabel("Start date", { exact: true }).fill("2027-07-01");
  await dialog.getByLabel("End date", { exact: true }).fill("2027-12-31");
  await dialog.getByRole("combobox", { name: "Stage", exact: true }).selectOption("proposal");
  await dialog.getByLabel("Expected close", { exact: true }).fill("2027-06-01");
  await dialog.getByRole("button", { name: "Add role", exact: true }).click();
  await dialog.getByLabel("Role name", { exact: true }).fill("Data Engineer");
  await dialog.getByLabel("Headcount", { exact: true }).fill("2");
  await dialog.getByLabel("Allocation", { exact: true }).fill("75");
  await dialog.getByLabel("Search or add skills", { exact: true }).fill("SQL");
  await dialog.getByLabel("Search or add skills", { exact: true }).press("Enter");
  return dialog;
}

test("a potential SOW saves configurable role demand and remains separate from signed delivery", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const state = await mockWorkspace(page), originals = structuredClone(state.store.data.missions);
  await page.goto("/pipeline");
  const dialog = await potentialForm(page);
  await dialog.getByRole("button", { name: "Save potential", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  const added = state.store.data.missions.find(mission => mission.name === "New application opportunity")!;
  expect(added.engagement).toMatchObject({ source: "sow", status: "draft", signedOn: null, start: "2027-07-01", end: "2027-12-31", pipeline: { stage: "proposal", expectedClose: "2027-06-01" }, roles: [{ name: "Data Engineer", headcount: 2, allocationPercent: 75, skills: ["SQL"], start: "2027-07-01", end: "2027-12-31" }] });
  expect(state.store.data.missions.slice(0, originals.length)).toEqual(originals);
  await page.reload();
  await page.getByRole("tab", { name: /^Pipeline/ }).click();
  await expect(page.getByRole("button", { name: "Edit New application opportunity", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("session expiration keeps the potential SOW draft through re-unlock", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/pipeline");
  const editor = await potentialForm(page, "Preserved opportunity draft");
  state.expireNextWrite = true;
  await editor.getByRole("button", { name: "Save potential", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "Let’s get to it.", exact: true });
  await expect(gate).toBeVisible();
  await gate.getByLabel("Workspace passcode", { exact: true }).fill("synthetic-workspace-passcode");
  await gate.getByRole("button", { name: "Enter workspace", exact: true }).click();
  await expect(gate).toHaveCount(0);
  await expect(editor.getByLabel("Engagement name", { exact: true })).toHaveValue("Preserved opportunity draft");
  await expect(editor.getByLabel("Headcount", { exact: true })).toHaveValue("2");
  await editor.getByRole("button", { name: "Save potential", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.store.data.missions.filter(mission => mission.name === "Preserved opportunity draft")).toHaveLength(1);
});

test("marking an opportunity won requires signature facts and preserves the same engagement identity", async ({ page }) => {
  const state = await mockWorkspace(page), source = structuredClone(state.store.data.missions[1]);
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: /^Pipeline/ }).click();
  await page.getByRole("button", { name: "Mark won Potential analytics", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make it a win.", exact: true });
  await dialog.getByRole("button", { name: "Mark won", exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await expect(dialog.getByLabel("Signed SOW reference", { exact: true })).toBeFocused();
  await dialog.getByLabel("Signed SOW reference", { exact: true }).fill("SIGNED-ANALYTICS-2027");
  await dialog.getByLabel("Signature date", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "Mark won", exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await dialog.getByLabel("Signature date", { exact: true }).fill("2026-12-15");
  await dialog.getByRole("button", { name: "Mark won", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const won = state.store.data.missions.find(mission => mission.id === source.id)!;
  expect(won.engagement).toMatchObject({ status: "signed", sowReference: "SIGNED-ANALYTICS-2027", signedOn: "2026-12-15", roles: source.engagement!.roles });
  expect(won.engagement!.pipeline).toBeUndefined();
  expect(state.store.data.missions).toHaveLength(2);
});

test("what-if dates change the hiring gap, save across reload, and leave signed and potential source plans untouched", async ({ page }) => {
  const state = await mockWorkspace(page), sources = structuredClone(state.store.data.missions);
  await page.goto("/pipeline");
  const skipLink = page.getByRole("link", { name: "Skip to planning", exact: true });
  await expect(skipLink).toHaveCSS("width", "1px");
  await page.getByRole("link", { name: "BOOKENDS home", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport({ ratio: 1 });
  expect((await skipLink.boundingBox())!.width).toBeGreaterThan(80);
  await page.getByLabel("Planning start", { exact: true }).fill(START);
  await page.getByLabel("Scenario name", { exact: true }).fill("Q1 or Q2 launch");
  const toggle = page.getByRole("button", { name: "Include Potential analytics", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Peak uncovered positions", { exact: true })).toContainText("0 positions");
  await toggle.click();
  await expect(page.getByLabel("Peak uncovered positions", { exact: true })).toContainText("1 positions");
  await page.locator(".pf-hiring-row").filter({ hasText: "Potential analytics" }).locator("summary").click();
  await expect(page.locator(".pf-unknown-note")).toContainText("1 positions");
  await expect(page.locator(".pf-candidates").getByText("Unknown", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/pipeline-gap-desktop.png", fullPage: true });
  await page.getByLabel("Potential analytics start shift (days)", { exact: true }).fill("90");
  await expect(page.getByLabel("Peak uncovered positions", { exact: true })).toContainText("0 positions");
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Scenario saved for your workspace.");
  expect(state.writes.map(command => command.type)).toEqual(["save_forecast"]);
  const scenario = state.store.data.forecast!.scenarios[0];
  expect(scenario).toMatchObject({ name: "Q1 or Q2 launch", selections: [{ missionId: sources[1].id, included: true, shiftDays: 90, teamScale: 1 }] });
  expect(state.store.data.missions).toEqual(sources);
  await page.reload();
  await expect(page.getByLabel("Scenario name", { exact: true })).toHaveValue("Q1 or Q2 launch");
  await expect(page.getByLabel("Potential analytics start shift (days)", { exact: true })).toHaveValue("90");
  await expect(page.getByLabel("Saved scenario", { exact: true })).toHaveValue(scenario.id);
  await expect(page.getByLabel("Peak uncovered positions", { exact: true })).toContainText("0 positions");
  expect(state.store.data.missions).toEqual(sources);
});

test("capacity stays unknown until explicitly recorded, and dated commitments survive reload", async ({ page }) => {
  const state = await mockWorkspace(page), sourcePeople = structuredClone(state.store.data.resources), sourceMissions = structuredClone(state.store.data.missions);
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: "Capacity", exact: true }).click();
  const personRow = page.locator(".pf-person-row").filter({ hasText: "Unconfirmed Example" });
  await expect(personRow).toContainText("Unknown");
  await page.getByRole("button", { name: "Edit capacity for Unconfirmed Example", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Capacity · Unconfirmed Example", exact: true });
  await dialog.getByLabel("Capacity percent", { exact: true }).fill("80");
  await dialog.getByLabel("Available from", { exact: true }).fill(START);
  await dialog.getByLabel(/^Available until/).fill("2027-12-31");
  await dialog.getByLabel("Capacity notes", { exact: true }).fill("Explicitly reviewed availability");
  await dialog.getByRole("button", { name: "Save capacity", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(personRow).toContainText("80%");
  await page.getByRole("button", { name: "Add commitment", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add commitment", exact: true });
  await dialog.getByRole("combobox", { name: "Person", exact: true }).selectOption({ label: "Unconfirmed Example" });
  await dialog.getByLabel("Commitment label", { exact: true }).fill("Other delivery work");
  await dialog.getByLabel("Commitment start", { exact: true }).fill(START);
  await dialog.getByLabel("Commitment end", { exact: true }).fill(END);
  await dialog.getByLabel("Commitment allocation", { exact: true }).fill("50");
  await dialog.getByRole("button", { name: "Save commitment", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes.map(command => command.type)).toEqual(["save_forecast", "save_forecast"]);
  const person = sourcePeople.find(person => person.name === "Unconfirmed Example")!;
  expect(state.store.data.forecast!.capacities.find(capacity => capacity.resourceId === person.id)).toMatchObject({ allocationPercent: 80, availableFrom: START, availableUntil: "2027-12-31", notes: "Explicitly reviewed availability" });
  expect(state.store.data.forecast!.commitments.find(commitment => commitment.name === "Other delivery work")).toMatchObject({ resourceId: person.id, missionId: null, start: START, end: END, allocationPercent: 50 });
  expect(state.store.data.resources).toEqual(sourcePeople);
  expect(state.store.data.missions).toEqual(sourceMissions);
  await page.reload();
  await page.getByRole("tab", { name: "Capacity", exact: true }).click();
  await expect(personRow).toContainText("80%");
  await expect(page.getByRole("button", { name: "Edit commitment Other delivery work", exact: true })).toBeVisible();
});

test("refresh adopts a remote saved scenario, and copying a stale local draft preserves newer shared facts", async ({ page }) => {
  let seed = baseWorkspace();
  const forecast = seed.data.forecast!, scenarioId = randomUUID(), missionId = seed.data.missions[1].id;
  seed = applyLocalAdminCommand(seed, { type: "save_forecast", expectedRevision: forecast.revision, forecast: { ...forecast, scenarios: [{ id: scenarioId, name: "Original scenario", hiringLeadWeeks: 8, asOf: START, horizonMonths: 12, selections: [{ missionId, included: true, shiftDays: 0, teamScale: 1 }] }] } });
  const state = await mockWorkspace(page, seed);
  await page.goto("/pipeline");
  await expect(page.getByLabel("Scenario name", { exact: true })).toHaveValue("Original scenario");
  let remote = structuredClone(state.store.data.forecast!);
  remote.scenarios[0].name = "Updated in another browser";
  remote.scenarios[0].selections[0].shiftDays = 14;
  state.store = applyLocalAdminCommand(state.store, { type: "save_forecast", expectedRevision: remote.revision, forecast: remote });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("Scenario name", { exact: true })).toHaveValue("Updated in another browser");
  await expect(page.getByLabel("Potential analytics start shift (days)", { exact: true })).toHaveValue("14");
  await page.getByLabel("Potential analytics start shift (days)", { exact: true }).fill("28");
  remote = structuredClone(state.store.data.forecast!);
  remote.scenarios[0].name = "Newer shared plan";
  remote.scenarios[0].selections[0].shiftDays = 42;
  remote.capacities[0].notes = "Newer verified capacity note";
  state.store = applyLocalAdminCommand(state.store, { type: "save_forecast", expectedRevision: remote.revision, forecast: remote });
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await expect(page.locator(".pf-error[role='alert']")).toContainText(/changed|Refresh/);
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Refresh saved records", exact: true }).click();
  await expect(page.getByLabel("Potential analytics start shift (days)", { exact: true })).toHaveValue("28");
  await page.getByRole("button", { name: "Duplicate scenario", exact: true }).click();
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await expect(page.locator(".pf-notice")).toContainText("Scenario saved for your workspace.");
  const saved = state.store.data.forecast!;
  expect(saved.scenarios).toHaveLength(2);
  expect(saved.scenarios.find(scenario => scenario.id === scenarioId)).toMatchObject({ name: "Newer shared plan", selections: [{ missionId, shiftDays: 42 }] });
  expect(saved.scenarios.find(scenario => scenario.id !== scenarioId)).toMatchObject({ name: "Updated in another browser — copy", selections: [{ missionId, shiftDays: 28 }] });
  expect(saved.capacities[0].notes).toBe("Newer verified capacity note");
  expect(state.store.data.missions).toEqual(seed.data.missions);
});

test("scenario controls lock during saving so in-flight edits cannot disappear", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/pipeline");
  await page.getByLabel("Scenario name", { exact: true }).fill("One deliberate save");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  state.pauseNextWrite = () => held;
  const sent = page.waitForRequest(request => request.url().endsWith("/api/shared/admin") && request.method() === "POST");
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await sent;
  try {
    await expect(page.locator("#pf-whatif")).toHaveAttribute("inert", "");
    await page.getByLabel("Scenario name", { exact: true }).evaluate((element: HTMLInputElement) => element.focus());
    await expect(page.getByLabel("Scenario name", { exact: true })).not.toBeFocused();
  } finally { release(); }
  await expect(page.locator(".pf-notice")).toContainText("Scenario saved for your workspace.");
  await expect(page.locator("#pf-whatif")).not.toHaveAttribute("inert", "");
  expect(state.store.data.forecast!.scenarios[0].name).toBe("One deliberate save");
  expect(state.writes).toHaveLength(1);
});

for (const width of [390, 320]) {
  test(`pipeline and potential editor fit ${width}px without horizontal page overflow`, async ({ page }) => {
    await mockWorkspace(page);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/pipeline");
    await expect(page.getByRole("button", { name: "Add potential SOW", exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `artifacts/pipeline-${width}.png`, fullPage: true });
    const dialog = await potentialForm(page, "Mobile opportunity");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `artifacts/pipeline-editor-${width}.png`, fullPage: false });
    await expect(dialog.getByRole("button", { name: "Save potential", exact: true })).toBeVisible();
  });
}

test("320px navigation opens What if from admin and Team Studio, keeping potentials outside the delivery board", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/admin?section=people");
  const adminLink = page.getByRole("link", { name: "What if", exact: true });
  await expect(adminLink).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow(page);
  await adminLink.click();
  await expect(page).toHaveURL(/\/pipeline$/);
  await page.goto("/studio");
  const studioLink = page.getByRole("link", { name: "What if", exact: true });
  await expect(studioLink).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".ts-plan-card").filter({ hasText: "Signed platform" })).toBeVisible();
  await expect(page.locator(".ts-plan-card").filter({ hasText: "Potential analytics" })).toHaveCount(0);
  await studioLink.click();
  await expect(page).toHaveURL(/\/pipeline$/);
  expect(state.writes).toHaveLength(0);
});

test("admin people display in alphabetical order without rewriting stored records", async ({ page }) => {
  const seed = baseWorkspace();
  seed.data.resources[0].name = "Zora Example";
  seed.data.resources[1].name = "alex 10";
  seed.data.resources[2].name = "Alex 2";
  const state = await mockWorkspace(page, seed), originalPeople = structuredClone(seed.data.resources);
  await page.goto("/admin?section=people");
  const names = page.locator(".admin-record-name > strong");
  await expect(names).toHaveText(["Alex 2", "alex 10", "Zora Example"]);
  await page.getByRole("textbox", { name: "Search People", exact: true }).fill("alex");
  await expect(names).toHaveText(["Alex 2", "alex 10"]);
  await page.reload();
  await expect(names).toHaveText(["Alex 2", "alex 10", "Zora Example"]);
  expect(state.store.data.resources).toEqual(originalPeople);
  expect(state.writes).toHaveLength(0);
});

test("Team Studio assembly settles and the locked entrance shows the revised artwork", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/studio");
  await expect(page.locator(".ts-assembly")).toBeVisible();
  await expect.poll(() => page.locator(".ts-assembly").evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
  await page.screenshot({ path: "artifacts/team-studio-assembled-desktop.png", fullPage: false });
  state.authenticated = false;
  await page.goto("/pipeline");
  await expect(page.getByLabel("Workspace passcode", { exact: true })).toBeVisible();
  await expect(page.locator(".shared-gate-art-arrow")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/pipeline-locked-artwork-desktop.png", fullPage: false });
  expect(state.writes).toHaveLength(0);
});
