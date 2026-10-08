import { test, expect, type Page, type Route } from "@playwright/test";
import { applyLocalAdminCommand, createLocalAdminStore, LOCAL_ADMIN_OWNER_ID, type LocalAdminCommand } from "../../lib/admin/local";
import { seedLocalAdminClients } from "../../lib/admin/client-seed";
import type { SowIntakeResult } from "../../lib/ai/contracts";

const brief = "TQL is building a customer data platform from January 1, 2027 through June 30, 2027. Two data engineers need SQL and Python. Allocation is to be confirmed.";
const result = (): SowIntakeResult => ({
  draftOnly: true, source: { name: "Pasted brief", kind: "text" },
  draft: { clientName: "TQL", name: "Customer data platform", sowReference: null, status: "draft", signedOn: null, start: "2027-01-01", end: "2027-06-30", outcomes: "Build a customer data platform.", roles: [{ name: "Data engineer", headcount: 2, allocationPercent: null, skills: ["SQL", "Python"], responsibilities: null, start: null, end: null }] },
  evidence: [{ field: "clientName", quote: "TQL is building a customer data platform", verified: true }, { field: "roles.0.headcount", quote: "Two data engineers", verified: true }, { field: "roles.0.skills", quote: "SQL and Python", verified: true }],
  uncertainties: ["What allocation percentage is needed for the data engineers?", "Confirm whether these roles span the full engagement."],
});

async function mockWorkspace(page: Page) {
  let store = seedLocalAdminClients(createLocalAdminStore());
  store = applyLocalAdminCommand(store, { type: "save_home", name: "Data", code: "DATA", description: "" });
  store = applyLocalAdminCommand(store, { type: "save_resource", name: "Taylor Reed", home: "DATA", ownerId: LOCAL_ADMIN_OWNER_ID, profile: { roles: ["Data engineer"], skills: ["SQL", "Python"] } });
  const writes: LocalAdminCommand[] = [];
  await page.route("**/api/shared/session", route => route.fulfill({ json: { authenticated: true, configured: true } }));
  await page.route("**/api/shared/admin", async route => {
    if (route.request().method() === "POST") {
      const { command, expectedRevision } = route.request().postDataJSON() as { command: LocalAdminCommand; expectedRevision: number };
      expect(expectedRevision).toBe(store.revision); writes.push(command); store = applyLocalAdminCommand(store, command);
    }
    await route.fulfill({ json: store });
  });
  return { writes, store: () => store };
}
async function reader(page: Page, post?: (route: Route) => Promise<void>, available = true) {
  await page.route("**/api/ai/sow", async route => {
    if (route.request().method() === "GET") await route.fulfill({ json: { available, ...(available ? {} : { reason: "SOW reading is not connected yet. You can still build your team directly." }), maxFileBytes: 3 * 1024 * 1024, maxTextCharacters: 60_000, formats: ["pdf", "docx", "txt"] } });
    else if (post) await post(route);
    else await route.fulfill({ json: result() });
  });
}
async function openReader(page: Page) {
  await page.goto("/studio");
  await page.getByRole("button", { name: /Start from an SOW/ }).click();
  await expect(page.getByRole("heading", { name: /Big plans/ })).toBeVisible();
}

test("pasted SOW becomes an editable brief and team board; reviewed facts and original quotations survive saving and reload", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const workspace = await mockWorkspace(page);
  await reader(page, async route => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    expect(route.request().postData()).toContain(brief);
    await route.fulfill({ json: result() });
  });
  await openReader(page);
  await page.getByRole("button", { name: "Paste a brief", exact: true }).click();
  await page.getByLabel("Paste the SOW or workstream brief").fill(brief);
  await page.getByRole("button", { name: "Bring the plan to life" }).click();
  await expect(page.getByLabel("Engagement / workstream name")).toHaveValue("Customer data platform");
  await expect(page.getByLabel("Who’s the client?")).toHaveValue(workspace.store().data.clients.find(client => client.name === "TQL")!.id);
  expect(workspace.writes).toHaveLength(0);
  await page.locator(".ts-source-notes > summary").click();
  await expect(page.getByText("What allocation percentage is needed for the data engineers?", { exact: true })).toBeVisible();
  await expect(page.getByText("Quote found in source", { exact: true })).toHaveCount(3);
  await page.getByLabel("Engagement / workstream name").fill("Customer data platform — phase one");
  await page.getByRole("button", { name: "Build the team", exact: true }).click();
  await expect(page.getByLabel("Data engineer allocation", { exact: true })).toHaveValue("");
  await page.getByLabel("Data engineer allocation", { exact: true }).fill("75");
  await page.getByRole("button", { name: "Use engagement dates", exact: true }).click();
  await page.getByRole("button", { name: "Select Taylor Reed for Data engineer", exact: true }).click();
  await page.getByRole("button", { name: "Review team plan", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Customer data platform — phase one" });
  await dialog.getByRole("button", { name: "Save team plan", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("That’s a team worth building.", { exact: true })).toBeVisible();
  expect(workspace.writes).toHaveLength(1);
  const mission = workspace.store().data.missions[0];
  expect(mission.name).toBe("Customer data platform — phase one");
  expect(mission.engagement).toMatchObject({ source: "sow", status: "draft", roles: [{ headcount: 2, allocationPercent: 75, start: "2027-01-01", end: "2027-06-30", selectedResourceIds: [workspace.store().data.resources[0].id] }], intake: { sourceName: "Pasted brief", sourceKind: "text", evidence: result().evidence, uncertainties: result().uncertainties } });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: mission.name })).toBeVisible();
  await expect(page.getByLabel("Data engineer allocation", { exact: true })).toHaveValue("75");
  await page.locator(".ts-source-notes > summary").click();
  await expect(page.getByText("Two data engineers", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("document upload sends its contents and retains the PDF source label for review", async ({ page }) => {
  await mockWorkspace(page);
  let posted = false;
  await reader(page, async route => {
    const payload = route.request().postDataBuffer()!.toString();
    expect(payload).toContain('filename="TQL-workstream.pdf"'); expect(payload).toContain("%PDF-1.7");
    expect(payload).not.toContain('name="text"'); posted = true;
    const output = result(); output.source = { name: "TQL-workstream.pdf", kind: "pdf" }; output.evidence.forEach(item => { item.verified = false; });
    await route.fulfill({ json: output });
  });
  await openReader(page);
  await page.getByLabel("Choose SOW document", { exact: true }).setInputFiles({ name: "TQL-workstream.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nSynthetic PDF upload fixture") });
  await expect(page.getByText("TQL-workstream.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bring the plan to life" }).click();
  await expect(page.getByLabel("Engagement / workstream name")).toHaveValue("Customer data platform");
  await page.locator(".ts-source-notes > summary").click();
  await expect(page.getByText("TQL-workstream.pdf · 3 source quotes", { exact: true })).toBeVisible();
  await expect(page.getByText("Check quote in original document", { exact: true })).toHaveCount(3);
  expect(posted).toBe(true);
});

test("unavailable AI keeps the manual team path available without submitting a document", async ({ page }) => {
  await mockWorkspace(page); let posts = 0;
  await reader(page, async route => { posts++; await route.fulfill({ status: 503, json: { error: "Unavailable", code: "ai_unavailable" } }); }, false);
  await openReader(page);
  await expect(page.getByText("SOW reading is not connected yet. You can still build your team directly.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bring the plan to life" })).toBeDisabled();
  await page.getByRole("button", { name: "Build it myself", exact: true }).click();
  await expect(page.getByLabel("Engagement / workstream name")).toBeVisible();
  await expect(page.getByText("DIRECT TEAM PLAN", { exact: true })).toBeVisible();
  expect(posts).toBe(0);
});

test("file validation, provider errors, and stopping a request preserve the input for another try", async ({ page }) => {
  await mockWorkspace(page); let posts = 0, release: (() => void) | undefined;
  await reader(page, async route => {
    posts++;
    if (posts === 1) { await route.fulfill({ status: 429, json: { error: "SOW reading is busy. Try again shortly.", code: "ai_busy" } }); return; }
    if (posts === 2) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: result() }).catch(() => {});
  });
  await openReader(page);
  await page.getByLabel("Choose SOW document", { exact: true }).setInputFiles({ name: "large.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(3 * 1024 * 1024 + 1) });
  await expect(page.locator(".sow-panel").getByRole("alert")).toContainText("Keep it under 3 MB"); expect(posts).toBe(0);
  await page.getByRole("button", { name: "Paste a brief", exact: true }).click();
  await page.getByLabel("Paste the SOW or workstream brief").fill(brief);
  await page.getByRole("button", { name: "Bring the plan to life" }).click();
  await expect(page.locator(".sow-panel").getByRole("alert")).toContainText("SOW reading is busy");
  await expect(page.getByLabel("Paste the SOW or workstream brief")).toHaveValue(brief);
  await page.getByRole("button", { name: "Bring the plan to life" }).click();
  await expect(page.getByText("Reading your brief…", { exact: true })).toBeVisible();
  await expect.poll(() => posts).toBe(2);
  await page.getByRole("button", { name: "Stop reading", exact: true }).click(); release?.();
  await expect(page.getByRole("button", { name: "Bring the plan to life" })).toBeEnabled();
  await expect(page.getByLabel("Paste the SOW or workstream brief")).toHaveValue(brief);
  await expect(page.getByLabel("Engagement / workstream name")).toHaveCount(0);
  await page.getByRole("button", { name: "Bring the plan to life" }).click();
  await expect(page.getByLabel("Engagement / workstream name")).toHaveValue("Customer data platform");
  expect(posts).toBe(3);
});

test("intake is legible and keyboard accessible on desktop and a 320px phone", async ({ page }) => {
  await mockWorkspace(page); await reader(page); await openReader(page);
  await expect(page.getByRole("button", { name: "Bring the plan to life" })).toBeEnabled();
  await page.locator(".sow-panel").screenshot({ path: "artifacts/sow-intake-desktop.png" });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.getByRole("button", { name: "Choose a document", exact: true })).toBeVisible();
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
  await page.locator(".sow-panel").screenshot({ path: "artifacts/sow-intake-mobile.png" });
  await page.getByRole("button", { name: "Paste a brief", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("Paste the SOW or workstream brief")).toBeVisible();
  await page.getByLabel("Paste the SOW or workstream brief").fill(brief);
  await page.getByRole("button", { name: "Bring the plan to life" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("Engagement / workstream name")).toHaveValue("Customer data platform");
});
