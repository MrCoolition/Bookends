import { test, expect, type Page } from "@playwright/test";

const section = (page: Page, name: string) => page.getByRole("navigation", { name: "Administration sections" }).getByRole("button", { name: new RegExp(name) });

async function addClient(page: Page, name: string, code: string) {
  await page.getByRole("button", { name: "Add client", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Client name", { exact: true }).fill(name);
  await dialog.getByLabel(/^Stable client code/).fill(code);
  await dialog.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("open administration saves client, HOME, person and engagement configuration across reloads without server calls", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/admin")) apiCalls.push(request.url()); });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Add client", exact: true }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Client name", { exact: true }).fill("Solstice Test Client");
  await dialog.getByLabel(/^Stable client code/).fill("SOLSTICE");
  await dialog.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Solstice Test Client/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Solstice Test Client/ })).toBeVisible();

  await section(page, "HOMEs").click();
  await page.getByRole("button", { name: "Add HOME", exact: true }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Display name", { exact: true }).fill("Experience Studio");
  await dialog.getByLabel(/^Stable HOME code/).fill("EXPERIENCE");
  await dialog.getByRole("button", { name: "Add HOME", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await section(page, "People").click();
  await page.getByRole("button", { name: "Add person", exact: true }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Person’s name", { exact: true }).fill("Test Teammate");
  await dialog.getByRole("combobox", { name: "HOME", exact: true }).selectOption({ label: "Experience Studio" });
  await dialog.getByRole("combobox", { name: "Accountable owner", exact: true }).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Test Teammate/ })).toBeVisible();

  await section(page, "Engagements").click();
  await page.getByRole("button", { name: "Add engagement", exact: true }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Engagement name", { exact: true }).fill("Solstice Launch");
  await dialog.getByRole("combobox", { name: "Client", exact: true }).selectOption({ label: "Solstice Test Client" });
  await dialog.getByLabel("Engagement starts", { exact: true }).fill("2027-01-01");
  await dialog.getByLabel("Engagement ends", { exact: true }).fill("2027-12-31");
  await dialog.getByRole("button", { name: "Build the team", exact: true }).last().click();
  await dialog.getByRole("button", { name: "Application build", exact: true }).click();
  await dialog.getByRole("button", { name: "Review team plan", exact: true }).click();
  await dialog.getByRole("button", { name: "Save engagement", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Solstice Launch/ })).toBeVisible();
  await page.reload();
  await section(page, "Engagements").click();
  await expect(page.getByRole("button", { name: /Solstice Launch/ })).toBeVisible();
  expect(apiCalls).toEqual([]);
});

test("local setup backup restores only after review and local members need no provider identity", async ({ page }) => {
  await page.goto("/admin");
  await addClient(page, "Keep in backup", "KEEP");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export setup", exact: true }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const backup = { name: "bookends-test-backup.json", mimeType: "application/json", buffer: Buffer.concat(chunks) };
  expect(JSON.parse(backup.buffer.toString()).data.clients).toHaveLength(1);
  await addClient(page, "Added after backup", "LATER");
  await page.getByLabel("Choose a BOOKENDS backup", { exact: true }).setInputFiles(backup);
  let review = page.getByRole("dialog", { name: "Review before replacing." });
  await expect(review.getByRole("button", { name: "Replace browser setup", exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "Keep current setup", exact: true }).click();
  await expect(page.getByRole("button", { name: /Added after backup/ })).toBeVisible();
  await page.getByLabel("Choose a BOOKENDS backup", { exact: true }).setInputFiles(backup);
  review = page.getByRole("dialog", { name: "Review before replacing." });
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Replace browser setup", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Added after backup/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Keep in backup/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Keep in backup/ })).toBeVisible();
  await section(page, "Access & settings").click();
  await page.getByRole("button", { name: "Add member", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Verified identity subject", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Display name", { exact: true }).fill("Planned mission lead");
  await dialog.getByRole("combobox", { name: "Primary role", exact: true }).selectOption("mission_owner");
  await dialog.getByRole("button", { name: "Add setup member", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Planned mission lead/ })).toBeVisible();
});
