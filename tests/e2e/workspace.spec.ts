import { test, expect, type Page } from "@playwright/test";

async function datesStep(page: Page) {
  await page.getByRole("button", { name: "Dates & hours", exact: true }).click();
}

async function openPlanner(page: Page) {
  await page.getByRole("button", { name: "Plan the next move", exact: true }).click();
  await datesStep(page);
}

async function reviewAndSave(page: Page, editing = false) {
  await page.getByRole("button", { name: "Review this move", exact: true }).click();
  await page.getByRole("button", { name: editing ? "Save changes" : "Save to scenario", exact: true }).click();
}

async function choosePerson(page: Page, id: string) {
  await page.getByRole("button", { name: "Choose a landing", exact: true }).click();
  await page.getByLabel("Who’s making the move?").selectOption(id);
  await datesStep(page);
}

test("draft placement validates, persists, and requests review without committing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await openPlanner(page);
  await page.getByLabel("Hours per week").fill("0");
  await page.getByRole("button", { name: "Review this move", exact: true }).click();
  await expect(page.getByLabel("Hours per week")).toBeFocused();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Choose positive weekly hours");
  await page.getByLabel("Hours per week").fill("40");
  await page.getByLabel("Last working date").fill("");
  await page.getByRole("button", { name: "Review this move", exact: true }).click();
  await expect(page.getByLabel("Last working date")).toBeFocused();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Choose a complete end date");
  await page.getByLabel("Last working date").fill("2027-01-29");
  await reviewAndSave(page);
  await expect(page.getByRole("button", { name: "Edit Alex Morgan's proposed move" })).toBeVisible();
  await expect(page.locator(".scenario-move")).toHaveCount(1);
  await expect(page).toHaveURL(/\?view=runway$/);
  await page.reload();
  await page.getByRole("button", { name: "Explore a scenario", exact: true }).click();
  await expect(page.getByText("Alex Morgan", { exact: false }).last()).toBeVisible();
  await page.getByRole("button", { name: "Request review in demo" }).click();
  await expect(page.getByRole("button", { name: "Queued in demo Decisions" })).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Decisions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review “Next chapter”" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("self-service acknowledgment and evidence remain distinct from verification", async ({ page }) => {
  await page.goto("/?view=my-bookends");
  await page.getByRole("button", { name: "Got it. Thanks for the update." }).click();
  await expect(page.getByRole("button", { name: "You’re up to date" })).toBeDisabled();
  await page.getByRole("button", { name: "Submit completion evidence" }).first().click();
  await page.getByLabel("What was completed? Add a verification reference.").fill("Demo return arranged; reference TEST-2026.");
  await page.getByRole("button", { name: "Submit for verification", exact: true }).click();
  await expect(page.getByText("Awaiting verification", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "You’re up to date" })).toBeDisabled();
  await expect(page.getByText("Awaiting verification", { exact: true })).toBeVisible();
  await expect(page.getByText("No confirmed landing yet.", { exact: false })).toBeVisible();
});

test("filters, semantic table, command search and presentation operate by keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Filter HOME" }).selectOption("AI");
  await expect(page.getByRole("button", { name: /Alex Morgan Senior/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(4);
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search everything" }).fill("Noah");
  await page.getByRole("button", { name: /Noah Williams Software/ }).click();
  await expect(page).toHaveURL(/person=p7/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The people. The possibilities." })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Every mission has a horizon." })).toBeVisible();
  await page.getByRole("button", { name: "Scene 6: DECISIONS & OWNERS" }).click();
  await expect(page.getByRole("heading", { name: "Together, we move forward." })).toBeVisible();
  await page.getByRole("button", { name: "Exit presentation" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("open-demand metric and mission planner preserve their selected scope", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Missions with open demand/ }).click();
  await expect(page.locator(".mission-card")).toHaveCount(4);
  await page.locator(".mission-card").filter({ hasText: "Helix" }).click();
  await page.getByRole("button", { name: "Preview a placement" }).click();
  await page.getByRole("button", { name: "Choose a landing", exact: true }).click();
  await expect(page.getByLabel("Where could they land?")).toHaveValue("m5");
  await page.getByRole("button", { name: "Back to previous view" }).click();
  await expect(page.getByRole("heading", { name: "Intelligent operations", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?view=missions$/);
  await page.getByRole("button", { name: "Preview a placement" }).click();
  await page.getByRole("button", { name: "Choose a landing", exact: true }).click();
  await expect(page.getByLabel("Where could they land?")).toHaveValue("m5");
});

test("phone views have no page overflow at 320px and keep core actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  for (const view of ["runway", "missions", "decisions", "my-bookends"]) {
    await page.goto(`/?view=${view}`);
    await expect(page.locator(".workspace")).toBeVisible();
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.content, `${view} overflows`).toBeLessThanOrEqual(width.viewport);
  }
  await page.getByRole("button", { name: "Got it. Thanks for the update." }).click();
  await expect(page.getByRole("button", { name: "You’re up to date" })).toBeDisabled();
  await page.goto("/?view=runway");
  await openPlanner(page);
  const dialogWidth = await page.getByRole("dialog").evaluate(e => ({ content: e.scrollWidth, width: e.clientWidth }));
  expect(dialogWidth.content).toBeLessThanOrEqual(dialogWidth.width);
  await expect(page.getByRole("button", { name: "Review this move", exact: true })).toBeEnabled();
});

test("the screenshot's inverted dates recover with one suggested-plan action", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await page.getByLabel("First working date").fill("2027-01-01");
  await page.getByLabel("Last working date").fill("2026-09-01");
  await page.getByRole("button", { name: "Review this move", exact: true }).click();
  await expect(page.getByLabel("Last working date")).toBeFocused();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("End on or after Jan 1, 2027");
  await page.getByRole("button", { name: "Use suggested plan", exact: true }).click();
  await expect(page.getByLabel("First working date")).toHaveValue("2026-11-02");
  await expect(page.getByLabel("Last working date")).toHaveValue("2027-01-29");
  await expect(page.getByLabel("Hours per week")).toHaveValue("40");
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await reviewAndSave(page);
  await expect(page.locator(".scenario-move")).toHaveCount(1);
});

test("extended years and an empty hours field stay editable and never crash the planner", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await openPlanner(page);
  await page.getByLabel("Last working date").fill("10000-01-01");
  await page.getByRole("button", { name: "Review this move", exact: true }).click();
  await expect(page.getByLabel("Last working date")).toBeFocused();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Choose a complete end date");
  await page.getByRole("button", { name: "Use suggested plan", exact: true }).click();
  await page.getByLabel("First working date").fill("10000-01-01");
  await page.getByRole("button", { name: "Review this move", exact: true }).click();
  await expect(page.getByLabel("First working date")).toBeFocused();
  await page.getByRole("button", { name: "Use suggested plan", exact: true }).click();
  await page.getByLabel("Hours per week").fill("");
  await expect(page.getByLabel("Hours per week")).toHaveValue("");
  await page.getByRole("button", { name: "Review this move", exact: true }).click();
  await expect(page.getByLabel("Hours per week")).toBeFocused();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Choose positive weekly hours");
  await page.getByLabel("Hours per week").fill("32.25");
  await reviewAndSave(page);
  await expect(page.locator(".scenario-move")).toContainText("32.25h/week");
  expect(errors).toEqual([]);
});

test("an unfinished plan survives closing, re-opening, and a browser reload", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await page.getByLabel("First working date").fill("2026-11-09");
  await page.getByLabel("Last working date").fill("2027-01-15");
  await page.getByLabel("Hours per week").fill("24");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await openPlanner(page);
  await expect(page.getByLabel("First working date")).toHaveValue("2026-11-09");
  await expect(page.getByLabel("Last working date")).toHaveValue("2027-01-15");
  await expect(page.getByLabel("Hours per week")).toHaveValue("24");
  await expect(page.getByText("Picked up right where you left off.", { exact: false })).toBeVisible();
  await page.reload();
  await openPlanner(page);
  await expect(page.getByLabel("First working date")).toHaveValue("2026-11-09");
  await expect(page.getByLabel("Last working date")).toHaveValue("2027-01-15");
  await expect(page.getByLabel("Hours per week")).toHaveValue("24");
});

test("editing a saved move excludes its own capacity and replaces it without duplication", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await reviewAndSave(page);
  await page.getByRole("button", { name: "Edit Alex Morgan's proposed move" }).click();
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await expect(page.locator(".plan-availability")).toContainText("40h available each week");
  await page.getByLabel("Hours per week").fill("24");
  await reviewAndSave(page, true);
  await expect(page.locator(".scenario-move")).toHaveCount(1);
  await expect(page.locator(".scenario-move")).toContainText("24h/week");
  await page.reload();
  await page.getByRole("button", { name: "Explore a scenario", exact: true }).click();
  await expect(page.locator(".scenario-move")).toHaveCount(1);
  await expect(page.locator(".scenario-move")).toContainText("24h/week");
});

test("person context returns correctly and changing people suggests a conflict-free window", async ({ page }) => {
  await page.goto("/?view=runway&person=p1");
  await page.getByRole("button", { name: "Explore next landings" }).click();
  await expect(page).toHaveURL(/\?view=runway$/);
  await expect(page.getByLabel("Who’s making the move?")).toHaveValue("p1");
  await datesStep(page);
  await page.getByLabel("Hours per week").fill("20");
  await page.getByRole("button", { name: "Back to previous view" }).click();
  await expect(page).toHaveURL(/person=p1$/);
  await page.getByRole("button", { name: "Explore next landings" }).click();
  await datesStep(page);
  await expect(page.getByLabel("Hours per week")).toHaveValue("20");
  await choosePerson(page, "p3");
  await expect(page.getByLabel("First working date")).toHaveValue("2026-11-16");
  await expect(page.getByLabel("Hours per week")).toHaveValue("32");
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await reviewAndSave(page);
  await expect(page.getByRole("button", { name: "Edit James Okafor's proposed move" })).toBeVisible();
  await expect(page).toHaveURL(/\?view=runway$/);
});

test("the next action stays physically visible while the form scrolls in short desktop and phone viewports", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 600 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await openPlanner(page);
    await page.getByRole("dialog").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const save = page.getByRole("button", { name: "Review this move", exact: true });
    const before = await save.boundingBox();
    expect(before).not.toBeNull();
    expect(before!.y).toBeGreaterThanOrEqual(0);
    expect(before!.y + before!.height).toBeLessThanOrEqual(viewport.height);
    expect(before!.x).toBeGreaterThanOrEqual(0);
    expect(before!.x + before!.width).toBeLessThanOrEqual(viewport.width);
    const scroll = page.locator(".planner-scroll");
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const after = await save.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    await page.getByRole("button", { name: "Close dialog" }).click();
  }
});

test("reset clears unfinished planner work across reopening and reload", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await page.getByLabel("Hours per week").fill("17");
  await page.getByLabel("Last working date").fill("");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Appearance and demo settings" }).click();
  await page.getByRole("button", { name: "Reset demo workspace" }).click();
  await openPlanner(page);
  await expect(page.getByLabel("Hours per week")).toHaveValue("40");
  await expect(page.getByLabel("Last working date")).toHaveValue("2027-01-29");
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await page.reload();
  await openPlanner(page);
  await expect(page.getByLabel("Hours per week")).toHaveValue("40");
  await expect(page.getByLabel("Last working date")).toHaveValue("2027-01-29");
});

test("a full pairing offers a direct route to an available mission", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await choosePerson(page, "p2");
  await expect(page.locator(".plan-feedback")).toContainText("Maya Patel has 0 h/week available across these dates");
  const alternate = page.locator(".plan-feedback").getByRole("button", { name: /^Try / }).first();
  await expect(alternate).toBeVisible();
  await alternate.click();
  await expect(page.locator(".plan-route")).not.toContainText("Analytics engine");
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await reviewAndSave(page);
  await expect(page.getByRole("button", { name: "Edit Maya Patel's proposed move" })).toBeVisible();
});

test("unfinished changes survive closing when browser storage is unavailable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key.startsWith("bookends.planner-draft.v1.")) throw new DOMException("Storage unavailable", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("/");
  await openPlanner(page);
  await page.getByLabel("Hours per week").fill("16");
  await expect(page.locator(".plan-notice")).toContainText("Changes are kept for this visit; browser storage is unavailable.");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await openPlanner(page);
  await expect(page.getByLabel("Hours per week")).toHaveValue("16");
  await reviewAndSave(page);
  await expect(page.locator(".scenario-move")).toContainText("16h/week");
  expect(errors).toEqual([]);
});
