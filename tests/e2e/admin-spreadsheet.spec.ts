import { test, expect, type Page } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const STORAGE_KEY = "bookends.local-admin.v1";
const section = (page: Page, name: string) => page.getByRole("navigation", { name: "Administration sections" }).getByRole("button", { name: new RegExp(name) });
const snapshot = (page: Page) => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Fill a copy of the delivered workbook. This verifies the actual template, including
// its headers and Excel metadata, instead of generating a separate idealized fixture.
function filledTemplate(bytes: Buffer, rows: Record<string, string[]>) {
  const files = unzipSync(bytes);
  const workbook = strFromU8(files["xl/workbook.xml"]);
  const rels = strFromU8(files["xl/_rels/workbook.xml.rels"]);
  for (const [name, values] of Object.entries(rows)) {
    const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)].find(match => match[0].includes(`name="${name}"`))?.[0];
    const relId = sheet?.match(/\br:id="([^"]+)"/)?.[1];
    expect(relId, `Template contains ${name}`).toBeTruthy();
    const relationship = [...rels.matchAll(/<Relationship\b[^>]*>/g)].find(match => match[0].includes(`Id="${relId}"`))?.[0];
    const target = relationship?.match(/\bTarget="([^"]+)"/)?.[1];
    expect(target).toBeTruthy();
    const path = target!.startsWith("/") ? target!.slice(1) : `xl/${target}`;
    let source = strFromU8(files[path]);
    const cells = values.map((value, index) => `<c r="${String.fromCharCode(65 + index)}5" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("");
    const row = `<row r="5">${cells}</row>`;
    const existing = /<row\b[^>]*\br="5"(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/row>)/;
    source = existing.test(source) ? source.replace(existing, row) : source.replace("</sheetData>", `${row}</sheetData>`);
    files[path] = strToU8(source);
  }
  return { name: "BOOKENDS_setup.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(zipSync(files)) };
}

async function downloadTemplate(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Excel template" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("BOOKENDS_Seed_Template.xlsx");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function reviewFile(page: Page, buffer: ReturnType<typeof filledTemplate>) {
  await page.getByLabel("Choose an Excel workbook", { exact: true }).setInputFiles(buffer);
  const review = page.getByRole("dialog", { name: "Review your spreadsheet." });
  await expect(review.getByText("Checking your workbook.")).toHaveCount(0);
  await expect(review.getByRole("table", { name: "Changes by workbook sheet" })).toBeVisible();
  return review;
}

const seed = {
  HOMEs: ["STUDIO", "Experience Studio", "Design and delivery"],
  Clients: ["SOLSTICE", "Solstice Example", "Casey Example", "casey@example.com", "Initial notes"],
  People: ["Alex Example", "STUDIO", ""],
  Missions: ["Solstice Launch", "SOLSTICE"],
};

test("downloaded Excel template seeds linked records, survives reload, skips repeats and previews updates", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin");
  const bytes = await downloadTemplate(page);
  const empty = { name: "blank.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bytes };
  let review = await reviewFile(page, empty);
  await expect(review.getByText("There are no additions or updates to apply.")).toBeVisible();
  await expect(review.getByRole("button", { name: "Apply import", exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "Close Excel review" }).click();
  const original = await snapshot(page);
  review = await reviewFile(page, filledTemplate(bytes, seed));
  await expect(review.locator(".admin-excel-totals")).toContainText("4 to add");
  expect(await snapshot(page)).toBe(original);
  await expect(review.getByRole("button", { name: "Apply import", exact: true })).toBeDisabled();
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Solstice Example/ })).toBeVisible();
  await page.reload();
  await section(page, "People").click();
  await expect(page.getByRole("button", { name: /Alex Example/ })).toBeVisible();
  await section(page, "Missions").click();
  await expect(page.getByRole("button", { name: /Solstice Launch/ })).toBeVisible();
  const saved = JSON.parse((await snapshot(page))!);
  expect(saved.data.resources[0].home).toBe("STUDIO");
  expect(saved.data.missions[0].clientId).toBe(saved.data.clients[0].id);
  review = await reviewFile(page, filledTemplate(bytes, seed));
  await expect(review.locator(".admin-excel-totals")).toHaveText(/0 to add.*0 to update.*4 unchanged/);
  await expect(review.getByRole("button", { name: "Apply import", exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "Close Excel review" }).click();
  const updated = { ...seed, Clients: ["SOLSTICE", "Solstice Renamed", "Casey Example", "casey@example.com", "Updated notes"] };
  review = await reviewFile(page, filledTemplate(bytes, updated));
  await expect(review.locator(".admin-excel-totals")).toHaveText(/0 to add.*1 to update.*3 unchanged/);
  await review.getByText("Review individual rows", { exact: true }).click();
  await expect(review.getByText("Updated notes", { exact: true })).toBeVisible();
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(review).toHaveCount(0);
  const after = JSON.parse((await snapshot(page))!);
  expect(after.data.clients).toHaveLength(1);
  expect(after.data.clients[0].id).toBe(saved.data.clients[0].id);
  expect(after.data.clients[0].name).toBe("Solstice Renamed");
  expect(after.data.clients[0].notes).toBe("Updated notes");
  expect(after.data.missions[0].clientId).toBe(saved.data.clients[0].id);
  expect(errors).toEqual([]);
});

test("Excel validation blocks the whole batch and stale reviews cannot overwrite another tab", async ({ page, context }) => {
  await page.goto("/admin");
  const bytes = await downloadTemplate(page);
  const original = await snapshot(page);
  const invalid = { ...seed, People: ["Alex Example", "MISSING", ""] };
  let review = await reviewFile(page, filledTemplate(bytes, invalid));
  await expect(review.getByText(/Fix .* issue/)).toBeVisible();
  await expect(review.locator(".admin-excel-issues")).toContainText("People");
  await expect(review.locator(".admin-excel-issues")).toContainText("Row 5");
  await expect(review.locator(".admin-excel-issues")).toContainText("HOME code");
  await expect(review.getByRole("button", { name: "Apply import", exact: true })).toBeDisabled();
  expect(await snapshot(page)).toBe(original);
  await review.getByRole("button", { name: "Close Excel review" }).click();
  review = await reviewFile(page, filledTemplate(bytes, seed));
  const other = await context.newPage();
  await other.goto("/admin");
  await other.getByRole("button", { name: "Add client", exact: true }).first().click();
  const dialog = other.getByRole("dialog");
  await dialog.getByLabel("Client name", { exact: true }).fill("Other tab client");
  await dialog.getByLabel(/^Stable client code/).fill("OTHER");
  await dialog.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const newer = await snapshot(other);
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("Setup changed after this workbook was reviewed");
  expect(await snapshot(page)).toBe(newer);
});
