import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { applyLocalAdminCommand, createLocalAdminStore } from "../../lib/admin/local";
import type { EngagementPlan } from "../../lib/admin/engagement";
import { emptyForecast } from "../../lib/forecast/types";

async function workspace(page: Page, signed = false) {
  let store = applyLocalAdminCommand(createLocalAdminStore(), { type: "save_client", name: "Timing Example", code: "TIMING", contactName: "", contactEmail: "", notes: "", bookends: [{ id: randomUUID(), name: "Fortnightly intake", purpose: "onboarding", phase: "start", enforcement: "required", cadence: "weeks", every: 2, anchorDate: "2027-01-04", windowDays: 1, noticeDays: 3, until: null, active: true, notes: "Client intake calendar" }] });
  store = applyLocalAdminCommand(store, { type: "save_resource", name: "Avery Example", home: "", ownerId: "", profile: { roles: ["Data Engineer"], skills: ["SQL"] } });
  const plan: EngagementPlan = { version: 1, source: "sow", status: signed ? "signed" : "draft", signedOn: signed ? "2026-12-01" : null, sowReference: signed ? "SOW-1" : "", start: "2027-01-05", end: "2027-03-31", outcomes: "Client timing test", roles: [{ id: randomUUID(), name: "Data Engineer", headcount: 2, allocationPercent: 100, start: "2027-01-05", end: "2027-03-31", skills: ["SQL"], responsibilities: "", selectedResourceIds: [] }] };
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Team with client windows", clientId: store.data.clients[0].id, engagement: plan });
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Potential with client windows", clientId: store.data.clients[0].id, engagement: { ...plan, status: "draft", signedOn: null, pipeline: { stage: "proposal", confidence: 70, expectedClose: "2027-01-01" } } });
  const forecast = emptyForecast();
  forecast.capacities.push({ resourceId: store.data.resources[0].id, allocationPercent: 100, availableFrom: "2027-01-18", availableUntil: null, notes: "Available from the second intake" });
  forecast.scenarios.push({ id: randomUUID(), name: "Client windows", hiringLeadWeeks: 4, asOf: "2027-01-01", horizonMonths: 6, selections: [{ missionId: store.data.missions[1].id, included: !signed, shiftDays: 0, teamScale: 1 }] });
  store = applyLocalAdminCommand(store, { type: "save_forecast", expectedRevision: 0, forecast });
  store.data.asOf = "2027-01-01T12:00:00.000Z";
  const state = { store, writes: 0 };
  await page.clock.setFixedTime(new Date("2027-01-01T12:00:00Z"));
  await page.route("**/api/shared/session", route => route.fulfill({ json: { authenticated: true, configured: true } }));
  await page.route("**/api/shared/admin", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      state.store = applyLocalAdminCommand(state.store, body.command);
      state.store.data.asOf = "2027-01-01T12:00:00.000Z";
      state.writes++;
    }
    await route.fulfill({ json: state.store });
  });
  return state;
}

test("Team Studio explains client wait and explicitly moves a draft role with duration preserved", async ({ page }) => {
  const state = await workspace(page), missionId = state.store.data.missions[0].id;
  await page.goto(`/studio?engagement=${missionId}`);
  const panel = page.getByRole("region", { name: "Client timing", exact: true });
  await expect(panel).toContainText("13d wait");
  await expect(panel).toContainText("Jan 18, 2027");
  await panel.screenshot({ path: "artifacts/client-bookends/studio-timing.png" });
  await panel.getByRole("button", { name: "Move to next opening", exact: true }).click();
  await expect(panel).toContainText("The timing fits.");
  expect(state.writes).toBe(0);
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Team with client windows" });
  await expect(review).toContainText("Apr 2027");
  await review.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(review).not.toBeVisible();
  const plan = state.store.data.missions.find(row => row.id === missionId)!.engagement!;
  expect(plan.roles[0].start).toBe("2027-01-18");
  expect(plan.roles[0].end).toBe("2027-04-13");
  expect(state.writes).toBe(1);
});

test("What if makes a reversible timing shift and saves the scenario without changing the SOW", async ({ page }) => {
  const state = await workspace(page), original = structuredClone(state.store.data.missions);
  await page.goto("/pipeline");
  const panel = page.getByRole("region", { name: "Client timing in this scenario" });
  await expect(panel).toContainText("13d wait");
  await expect(page.getByLabel("Peak uncovered positions")).toHaveText(/2/);
  await panel.screenshot({ path: "artifacts/client-bookends/forecast-timing.png" });
  await panel.getByRole("button", { name: "Try +13 days for this SOW", exact: true }).click();
  await expect(panel).toContainText("Your client windows line up.");
  await expect(page.getByLabel("Peak uncovered positions")).toHaveText(/1/);
  expect(state.writes).toBe(0);
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await expect(page.getByText("Scenario saved for your workspace.", { exact: true })).toBeVisible();
  expect(state.store.data.forecast!.scenarios[0].selections[0].shiftDays).toBe(13);
  expect(state.store.data.missions).toEqual(original);
  await page.reload();
  await expect(panel).toContainText("Your client windows line up.");
});

test("signed work keeps dates and client timing fits a mobile viewport", async ({ page }) => {
  const state = await workspace(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pipeline");
  const panel = page.getByRole("region", { name: "Client timing in this scenario" });
  await expect(panel).toContainText("Signed dates retained");
  await expect(panel).toContainText("13d wait");
  await expect(panel.getByRole("button", { name: /Try \+/ })).toHaveCount(0);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: "artifacts/client-bookends/forecast-mobile.png" });
  expect(state.store.data.missions[0].engagement!.start).toBe("2027-01-05");
  expect(state.writes).toBe(0);
});
