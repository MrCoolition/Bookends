import { test, expect } from "@playwright/test";

test("draft placement validates, persists, and requests review without committing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Plan the next move", exact: true }).click();
  await page.getByLabel("Hours per week").fill("0");
  await expect(page.getByRole("button", { name: "Save to scenario" })).toBeDisabled();
  await page.getByLabel("Hours per week").fill("40");
  await page.getByLabel("Last working date").fill("");
  await expect(page.getByRole("button", { name: "Save to scenario" })).toBeDisabled();
  await page.getByLabel("Last working date").fill("2027-01-29");
  await page.getByRole("button", { name: "Save to scenario" }).click();
  await expect(page.getByText("1 proposed move · Approved staffing stays unchanged")).toBeVisible();
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
  await page.getByRole("button", { name: "Plan the next move", exact: true }).click();
  const dialogWidth = await page.getByRole("dialog").evaluate(e => ({ content: e.scrollWidth, width: e.clientWidth }));
  expect(dialogWidth.content).toBeLessThanOrEqual(dialogWidth.width);
  await expect(page.getByRole("button", { name: "Save to scenario" })).toBeEnabled();
});
