import { test, expect, type Page } from "@playwright/test";

const step = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const openPlanner = (page: Page) => step(page, "Plan the next move").click();
const review = (page: Page) => step(page, "Review this move").click();

async function screenshotDraft(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("bookends.planner-draft.v1.new", JSON.stringify({
      personId: "p1", missionId: "m10", start: "2026-11-30", lastDay: "2027-01-02", hours: "40",
    }));
  });
}

async function expectInsideViewport(page: Page, name: string) {
  const action = step(page, name);
  await expect(action).toBeVisible();
  const bounds = await action.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
}

test("guided planning reveals one decision at a time and reviews the latest edits before saving", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await openPlanner(page);
  await expect(step(page, "Choose a landing")).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Hours per week")).toHaveCount(0);
  await expect(step(page, "Save to scenario")).toHaveCount(0);
  await expect(step(page, "Choose dates & hours")).toBeVisible();
  await step(page, "Choose Northstar · Analytics engine").click();
  await expect(step(page, "Dates & hours")).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("First working date")).toHaveValue("2026-11-02");
  await expect(page.getByLabel("Hours per week")).toHaveValue("40");
  await review(page);
  await expect(step(page, "Review & save")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("dialog")).toContainText("Alex Morgan");
  await expect(page.getByRole("dialog")).toContainText("Northstar");
  await expect(page.getByLabel("Hours per week")).toHaveCount(0);
  await step(page, "Dates & hours").click();
  await page.getByLabel("Hours per week").fill("24");
  await review(page);
  await expect(page.getByRole("dialog")).toContainText("24");
  await step(page, "Save to scenario").click();
  await expect(page.locator(".scenario-move")).toHaveCount(1);
  await expect(page.locator(".scenario-move")).toContainText("24h/week");
  expect(errors).toEqual([]);
});

test("partial capacity can be applied directly without losing the selected person or mission", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await page.getByLabel("Who’s making the move?").selectOption("p5");
  await page.getByText("Looking for a specific mission?", { exact: true }).click();
  await page.getByLabel("Where could they land?").selectOption("m4");
  await step(page, "Dates & hours").click();
  await page.getByLabel("Hours per week").fill("40");
  await expect(step(page, "Review & save")).toBeDisabled();
  await step(page, "Use available hours").click();
  await expect(page.getByLabel("Hours per week")).toHaveValue("20");
  await expect(step(page, "Review & save")).toBeEnabled();
  await review(page);
  await expect(page.getByRole("dialog")).toContainText("Ethan Brooks");
  await expect(page.getByRole("dialog")).toContainText("Atlas");
  await step(page, "Save to scenario").click();
  await expect(page.locator(".scenario-move")).toContainText("20h/week");
});

test("the full Solstice draft offers an accessible recovery and preserves Alex on a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await screenshotDraft(page);
  await page.goto("/");
  await openPlanner(page);
  await expect(step(page, "Dates & hours")).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("First working date")).toHaveValue("2026-11-30");
  await expect(page.getByLabel("Last working date")).toHaveValue("2027-01-02");
  await expect(step(page, "Review & save")).toBeDisabled();
  await expect(step(page, "Save to scenario")).toHaveCount(0);
  await expectInsideViewport(page, "Choose another landing");
  await step(page, "Choose another landing").focus();
  await page.keyboard.press("Enter");
  await expect(step(page, "Choose a landing")).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Who’s making the move?")).toHaveValue("p1");
  await expectInsideViewport(page, "Try an open landing");
  await step(page, "Choose Northstar · Analytics engine").click();
  await expect(step(page, "Review & save")).toBeEnabled();
  await expectInsideViewport(page, "Review this move");
  await review(page);
  await expectInsideViewport(page, "Save to scenario");
  await expectInsideViewport(page, "Back a planning step");
  await step(page, "Back a planning step").focus();
  await page.keyboard.press("Enter");
  await expect(step(page, "Dates & hours")).toHaveAttribute("aria-current", "step");
  await review(page);
  const dialog = await page.getByRole("dialog").evaluate(element => ({ content: element.scrollWidth, viewport: element.clientWidth }));
  expect(dialog.content).toBeLessThanOrEqual(dialog.viewport);
  await step(page, "Save to scenario").click();
  await expect(page.getByRole("button", { name: "Edit Alex Morgan's proposed move", exact: true })).toBeVisible();
});


test("the exact full-mission draft explains the constraint and keeps the selected dates during recovery", async ({ page }) => {
  await screenshotDraft(page);
  await page.goto("/");
  await openPlanner(page);
  const capacity = page.getByRole("region", { name: "Capacity for these dates", exact: true });
  await expect(capacity).toContainText("Alex’s space");
  await expect(capacity).toContainText("Solstice’s space");
  await expect(capacity).toContainText(/Alex’s space40/);
  await expect(capacity).toContainText(/Solstice’s space0/);
  await expect(page.locator(".plan-feedback")).toContainText("Liam Davis already holds 40 h/week in the committed plan");
  await expect(step(page, "Use suggested plan")).toHaveCount(0);
  await page.locator(".plan-feedback").getByRole("button", { name: /^Try Northstar · Analytics engine/ }).click();
  await expect(page.locator(".plan-route")).toContainText("Alex Morgan");
  await expect(page.locator(".plan-route")).toContainText("Analytics engine");
  await expect(page.getByLabel("First working date")).toHaveValue("2026-11-30");
  await expect(page.getByLabel("Last working date")).toHaveValue("2027-01-02");
  await expect(page.getByLabel("Hours per week")).toHaveValue("40");
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await review(page);
  await expect(page.getByRole("dialog")).toContainText("Draft only");
  await step(page, "Save to scenario").click();
  await expect(page.locator(".scenario-move")).toHaveCount(1);
});

test("a saved scenario reservation is explained and cannot be saved again as another overlapping move", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await step(page, "Choose Northstar · Analytics engine").click();
  await review(page);
  await step(page, "Save to scenario").click();
  await step(page, "Close dialog").click();
  await openPlanner(page);
  await step(page, "Choose a landing").click();
  await page.getByText("Looking for a specific mission?", { exact: true }).click();
  await page.getByLabel("Where could they land?").selectOption("m2");
  await step(page, "Dates & hours").click();
  await expect(page.locator(".plan-feedback")).toContainText("this scenario");
  await expect(step(page, "Review & save")).toBeDisabled();
  await expect(step(page, "Save to scenario")).toHaveCount(0);
  await step(page, "Close dialog").click();
  await step(page, "Explore a scenario").click();
  await expect(page.locator(".scenario-move")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit Alex Morgan's proposed move", exact: true }).click();
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await expect(step(page, "Review & save")).toBeEnabled();
});


test("closing the untouched landing step preserves it, while review resumes at dates for a fresh check", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await expect(step(page, "Choose a landing")).toHaveAttribute("aria-current", "step");
  await step(page, "Close dialog").click();
  await openPlanner(page);
  await expect(step(page, "Choose a landing")).toHaveAttribute("aria-current", "step");
  await step(page, "Close dialog").click();
  await page.reload();
  await openPlanner(page);
  await expect(step(page, "Choose a landing")).toHaveAttribute("aria-current", "step");
  await step(page, "Choose Northstar · Analytics engine").click();
  await page.getByLabel("Hours per week").fill("24");
  await review(page);
  await step(page, "Close dialog").click();
  await page.reload();
  await openPlanner(page);
  await expect(step(page, "Dates & hours")).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Hours per week")).toHaveValue("24");
  await expect(step(page, "Save to scenario")).toHaveCount(0);
});

test("a valid later plan still offers an earlier part-time start with approvals kept separate", async ({ page }) => {
  await page.goto("/");
  await openPlanner(page);
  await page.getByLabel("Who’s making the move?").selectOption("p5");
  await page.getByText("Looking for a specific mission?", { exact: true }).click();
  await page.getByLabel("Where could they land?").selectOption("m6");
  await step(page, "Dates & hours").click();
  await expect(page.getByLabel("First working date")).toHaveValue("2026-11-09");
  await expect(page.getByLabel("Hours per week")).toHaveValue("40");
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await page.getByRole("button", { name: /^Start earlier at 20 h\/week/ }).click();
  await expect(page.getByLabel("First working date")).toHaveValue("2026-10-05");
  await expect(page.getByLabel("Hours per week")).toHaveValue("20");
  await expect(page.locator(".plan-feedback")).toHaveCount(0);
  await review(page);
  await expect(page.getByRole("dialog")).toContainText("Commercial approval needed");
  await expect(page.getByRole("dialog")).toContainText("does not confirm staffing, approve readiness, or notify anyone");
});
