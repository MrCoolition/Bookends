import test from "node:test";
import assert from "node:assert/strict";
import { applyLocalAdminCommand, createLocalAdminStore } from "../lib/admin/local";
import { exportWorkspaceSpreadsheet, workspaceSpreadsheetData } from "../lib/admin/spreadsheet-export";
import { applySpreadsheetImport, planSpreadsheetImport, readSpreadsheetFile } from "../lib/admin/spreadsheet";

function fixture() {
  let store = createLocalAdminStore();
  store = applyLocalAdminCommand(store, { type: "save_client", code: "EX", name: "Example", contactName: "", contactEmail: "", notes: "" });
  store = applyLocalAdminCommand(store, { type: "save_resource", name: "Example Teammate", home: "", ownerId: "", profile: { roles: ["Data Engineer"], skills: ["SQL"] } });
  store = applyLocalAdminCommand(store, { type: "save_mission", name: "Potential analytics", clientId: store.data.clients[0].id, engagement: { version: 1, source: "sow", status: "draft", sowReference: "", signedOn: null, start: "2026-11-01", end: "2027-03-31", outcomes: "Analytics", pipeline: { stage: "proposal", confidence: 65, expectedClose: "2026-10-25" }, roles: [{ id: crypto.randomUUID(), name: "Data Engineer", headcount: 2, allocationPercent: 100, skills: ["SQL"], responsibilities: "Pipelines", start: "2026-11-01", end: "2027-03-31" }] } });
  store = applyLocalAdminCommand(store, { type: "save_forecast", expectedRevision: 0, forecast: { version: 1, revision: 0, capacities: [{ resourceId: store.data.resources[0].id, allocationPercent: 100, availableFrom: "2026-10-01", availableUntil: null, notes: "Confirmed planning capacity" }], commitments: [{ id: crypto.randomUUID(), resourceId: store.data.resources[0].id, missionId: null, name: "Other work", start: "2026-11-01", end: "2026-11-30", allocationPercent: 50 }], scenarios: [{ id: crypto.randomUUID(), name: "Upside", hiringLeadWeeks: 8, asOf: "2026-11-01", horizonMonths: 18, selections: [{ missionId: store.data.missions[0].id, included: true, shiftDays: 14, teamScale: 1.5 }] }] } });
  return store;
}

test("populated Excel keeps potential SOW metadata and all saved forecasting context", async () => {
  const store = fixture(), bytes = await exportWorkspaceSpreadsheet(store);
  const workbook = await readSpreadsheetFile(new File([new Uint8Array(bytes)], "forecast.xlsx"));
  for (const name of ["Forecast", "Capacity", "Commitments", "Scenarios"]) assert.ok(workbook.sheets.some(sheet => sheet.name === name));
  const plan = planSpreadsheetImport(store, workbook);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.adds + plan.counts.updates, 0);
  assert.deepEqual(applySpreadsheetImport(store, plan), store);
});

test("Excel updates potential confidence without changing saved scenarios or capacity", () => {
  const store = fixture(), workbook = workspaceSpreadsheetData(store), sheet = workbook.sheets.find(sheet => sheet.name === "Engagements")!;
  sheet.rows[4][sheet.rows[3].indexOf("Confidence %")] = 85;
  sheet.rows[4][sheet.rows[3].indexOf("Pipeline stage")] = "negotiation";
  const plan = planSpreadsheetImport(store, workbook);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.updates, 1);
  const updated = applySpreadsheetImport(store, plan);
  assert.deepEqual(updated.data.missions[0].engagement!.pipeline, { stage: "negotiation", confidence: 85, expectedClose: "2026-10-25" });
  assert.deepEqual(updated.data.forecast, store.data.forecast);
});

test("legacy Excel leaves pipeline metadata intact and invalid potential combinations cannot apply", () => {
  const store = fixture();
  const legacy = { sheets: [{ name: "Engagements", rows: [[], [], [], ["Engagement name", "Client code", "Start date", "End date"], ["Potential analytics", "EX", "2026-11-01", "2027-03-31"]] }] };
  const legacyPlan = planSpreadsheetImport(store, legacy);
  assert.deepEqual(legacyPlan.errors, []);
  assert.equal(legacyPlan.counts.updates, 0);
  assert.deepEqual(applySpreadsheetImport(store, legacyPlan), store);
  const book = workspaceSpreadsheetData(store), sheet = book.sheets.find(sheet => sheet.name === "Engagements")!;
  sheet.rows[4][sheet.rows[3].indexOf("Confidence %")] = 101;
  const invalid = planSpreadsheetImport(store, book);
  assert.ok(invalid.errors.some(issue => issue.field === "Confidence %"));
  assert.throws(() => applySpreadsheetImport(store, invalid));
});
