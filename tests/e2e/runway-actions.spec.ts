import { test, expect, type Page } from "@playwright/test";

const metric = (page: Page, name: string) => page.locator(".stats-grid").getByRole("button", { name: new RegExp(name) });
async function expectActionView(page: Page, title: string) {
  const heading = page.getByRole("heading", { name: title, exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  if (page.viewportSize()!.width <= 700) {
    const titleBox = (await heading.boundingBox())!;
    const topbar = (await page.locator(".topbar").boundingBox())!;
    expect(titleBox.y).toBeGreaterThanOrEqual(topbar.y + topbar.height);
  }
  await expect(page.locator(".runway-action-banner")).toBeInViewport();
  await expect(page.getByRole("button", { name: /Plan next move for/ }).first()).toBeInViewport();
}

test("closing bookends reveals next actions immediately while preserving HOME, search and horizon", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Filter HOME").selectOption("Data");
  await page.getByLabel("Planning horizon").selectOption("26");
  await page.getByLabel("Search people").fill("Alex");
  await metric(page, "Closing bookends").click();
  await expectActionView(page, "Closing bookends");
  await expect(page.getByRole("list", { name: "Closing bookends", exact: true }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByLabel("Filter HOME")).toHaveValue("Data");
  await expect(page.getByLabel("Planning horizon")).toHaveValue("26");
  await expect(page.getByLabel("Search people")).toHaveValue("Alex");
  await expect(page.locator(".runway-action-banner")).toContainText("Data · Next 26 weeks");
  await page.getByRole("button", { name: "Plan next move for Alex Morgan", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Who’s making the move?")).toHaveValue("p1");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Clear filter ×", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mission runway", exact: true })).toBeFocused();
  await expect(page.locator(".runway-action-list")).toHaveCount(0);
  await expect(page.getByLabel("Filter HOME")).toHaveValue("Data");
  await expect(page.getByLabel("Planning horizon")).toHaveValue("26");
  await expect(page.getByLabel("Search people")).toHaveValue("Alex");
});

test("people needing a landing opens an actionable W2 list and the metric toggles cleanly", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Filter HOME").selectOption("Software Engineering");
  await page.getByLabel("Planning horizon").selectOption("52");
  await metric(page, "People needing a landing").click();
  await expectActionView(page, "People needing a landing");
  await expect(page.locator(".runway-action-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Plan next move for Noah Williams", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Plan next move for Olivia/ })).toHaveCount(0);
  await metric(page, "People needing a landing").click();
  await expect(page.getByRole("heading", { name: "Mission runway", exact: true })).toBeFocused();
  await expect(metric(page, "People needing a landing")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Filter HOME")).toHaveValue("Software Engineering");
  await expect(page.getByLabel("Planning horizon")).toHaveValue("52");
});

test("phone metric actions stay in view and both right-side metric destinations remain actionable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 650 });
  await page.goto("/");
  await metric(page, "Closing bookends").click();
  await expectActionView(page, "Closing bookends");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "artifacts/runway-actions-mobile.png", animations: "disabled" });
  await metric(page, "People needing a landing").click();
  await expectActionView(page, "People needing a landing");
  await metric(page, "Start blockers").click();
  await expectActionView(page, "People with start blockers");
  await page.getByRole("button", { name: /Review blockers for/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("tab", { name: /baggage/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Travel light into the next mission.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await metric(page, "Missions with open demand").click();
  await expect(page).toHaveURL(/\?view=missions$/);
  await expect(page.locator(".mission-card")).toHaveCount(4);
});

test("desktop metric action cards show the people and next step without a hidden timeline change", async ({ page }) => {
  await page.goto("/");
  await metric(page, "Closing bookends").click();
  await expectActionView(page, "Closing bookends");
  await expect(page.locator(".runway-action-card")).toHaveCount(10);
  await page.getByLabel("Sort runway").selectOption("release");
  const dates = await page.locator(".runway-action-card > p").allTextContents();
  const times = dates.map(value => Date.parse(`${value.replace("Next bookend: ", "")}, 2026`));
  expect(times).toEqual([...times].sort((a, b) => a - b));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "artifacts/runway-actions-desktop.png", animations: "disabled" });
});
