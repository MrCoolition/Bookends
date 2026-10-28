import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLocalAdminCommand, createLocalAdminStore, parseLocalAdminStore } from "../lib/admin/local";
import { applySpreadsheetImport, planSpreadsheetImport, SPREADSHEET_HEADERS, type SpreadsheetCell, type SpreadsheetWorkbook } from "../lib/admin/spreadsheet";
import { workspaceSpreadsheetData, exportWorkspaceSpreadsheet } from "../lib/admin/spreadsheet-export";
import { readSpreadsheetFile } from "../lib/admin/spreadsheet";
import type { ClientBookend } from "../lib/scheduling/client-bookends";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rule: ClientBookend = { id: id(2), name: "Client arrival", purpose: "onboarding", phase: "start", enforcement: "required", cadence: "weeks", every: 2, anchorDate: "2027-01-04", windowDays: 1, noticeDays: 3, until: "2027-12-31", active: true, notes: "Confirm registration", excludedDates: ["2027-02-01"] };
function fixture() {
  const store = createLocalAdminStore();
  store.data.clients = [{ id: id(1), code: "ACORN", name: "Acorn", contactName: "", contactEmail: "", notes: "", active: true, revision: 3, bookends: [structuredClone(rule), { ...rule, id: id(3), name: "Quarterly access review", cadence: "months", every: 3, active: false }] }];
  return parseLocalAdminStore(store);
}
const sheet = (workbook: SpreadsheetWorkbook) => workbook.sheets.find(item => item.name === "Client bookends")!;
function cell(workbook: SpreadsheetWorkbook, row: number, field: string, value: SpreadsheetCell) { const tab = sheet(workbook); tab.rows[row][tab.rows[3].indexOf(field)] = value; }
function onlyRules() { const store = fixture(); return { store, workbook: { sheets: [structuredClone(sheet(workspaceSpreadsheetData(store)))] } as SpreadsheetWorkbook }; }

test("legacy clients parse without schedules and old client saves retain schedules", () => {
  const legacy = fixture(); delete legacy.data.clients[0].bookends;
  assert.equal(parseLocalAdminStore(legacy).data.clients[0].bookends, undefined);
  const store = fixture(), client = store.data.clients[0];
  const updated = applyLocalAdminCommand(store, { type: "save_client", id: client.id, expectedRevision: client.revision, code: client.code, name: "Acorn renamed", contactName: "", contactEmail: "", notes: "" });
  assert.deepEqual(updated.data.clients[0].bookends, client.bookends);
  assert.deepEqual(parseLocalAdminStore(JSON.stringify(updated)), updated);
  assert.throws(() => applyLocalAdminCommand(updated, { type: "save_client", id: client.id, expectedRevision: client.revision, code: client.code, name: "Stale", contactName: "", contactEmail: "", notes: "", bookends: [] }));
});

test("Excel roundtrip retains all client schedules, including inactive schedules and exceptions", async () => {
  const store = fixture(), book = workspaceSpreadsheetData(store);
  assert.equal(sheet(book).rows.length, 6);
  assert.equal(sheet(book).rows[5][sheet(book).rows[3].indexOf("Active")], "false");
  const bytes = await exportWorkspaceSpreadsheet(store);
  const parsed = await readSpreadsheetFile(new File([bytes.slice().buffer], "workspace.xlsx"));
  const plan = planSpreadsheetImport(store, parsed);
  assert.deepEqual(plan.errors, []); assert.equal(plan.counts.updates, 0);
  assert.deepEqual(applySpreadsheetImport(store, plan), store);
});

test("Excel edits and disables rules without deleting omitted rows; all revisions use the exported client revision", () => {
  const { store, workbook } = onlyRules();
  cell(workbook, 4, "Every", 3); cell(workbook, 4, "Active", false); cell(workbook, 5, "Bookend name", "Access review renamed");
  const plan = planSpreadsheetImport(store, workbook);
  assert.deepEqual(plan.errors, []);
  const saved = applySpreadsheetImport(store, plan);
  assert.equal(saved.data.clients[0].bookends![0].every, 3);
  assert.equal(saved.data.clients[0].bookends![0].active, false);
  assert.equal(saved.data.clients[0].bookends![1].name, "Access review renamed");
  const partial = onlyRules(); sheet(partial.workbook).rows.splice(5);
  cell(partial.workbook, 4, "Notes", "Updated");
  const partialSaved = applySpreadsheetImport(partial.store, planSpreadsheetImport(partial.store, partial.workbook));
  assert.deepEqual(partialSaved.data.clients[0].bookends![1], partial.store.data.clients[0].bookends![1]);
});

test("old, omitted and empty bookend sheets preserve saved schedules", () => {
  for (const mode of ["omitted", "empty", "blank"] as const) {
    const store = fixture(), workbook = workspaceSpreadsheetData(store);
    if (mode === "omitted") workbook.sheets = workbook.sheets.filter(item => item.name !== "Client bookends");
    else if (mode === "empty") sheet(workbook).rows.splice(4);
    else sheet(workbook).rows = [];
    const plan = planSpreadsheetImport(store, workbook);
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(applySpreadsheetImport(store, plan).data.clients[0].bookends, store.data.clients[0].bookends);
  }
});

test("stale revisions, foreign Rule IDs, malformed dates and duplicate rules reject the entire workbook", () => {
  for (const edit of [
    (book: SpreadsheetWorkbook) => cell(book, 4, "Revision", 2),
    (book: SpreadsheetWorkbook) => cell(book, 4, "Rule ID", id(99)),
    (book: SpreadsheetWorkbook) => cell(book, 4, "Anchor date", "2027-02-30"),
    (book: SpreadsheetWorkbook) => sheet(book).rows.push([...sheet(book).rows[4]]),
  ]) {
    const { store, workbook } = onlyRules(), before = structuredClone(store); edit(workbook);
    const plan = planSpreadsheetImport(store, workbook);
    assert.ok(plan.errors.length);
    assert.throws(() => applySpreadsheetImport(store, plan));
    assert.deepEqual(store, before);
  }
});

test("new clients and bookends resolve regardless of sheet order; existing-client additions require fresh revision", () => {
  const store = createLocalAdminStore();
  const headers = [...SPREADSHEET_HEADERS["Client bookends"]];
  const values: Record<string, SpreadsheetCell> = { "Client code": "NEW", "Bookend name": rule.name, Purpose: rule.purpose, Phase: rule.phase, Enforcement: rule.enforcement, Cadence: rule.cadence, Every: rule.every, "Anchor date": rule.anchorDate, "Window days": rule.windowDays, "Notice days": rule.noticeDays };
  const workbook: SpreadsheetWorkbook = { sheets: [{ name: "Client bookends", rows: [[], [], [], headers, headers.map(header => values[header] ?? "")] }, { name: "Clients", rows: [[], [], [], ["Client code", "Client name"], ["NEW", "New client"]] }] };
  const plan = planSpreadsheetImport(store, workbook);
  assert.deepEqual(plan.errors, []);
  assert.equal(applySpreadsheetImport(store, plan).data.clients[0].bookends?.length, 1);
  const existing = fixture(); values["Client code"] = "ACORN";
  workbook.sheets = [{ name: "Client bookends", rows: [[], [], [], headers, headers.map(header => values[header] ?? "")] }];
  assert.ok(planSpreadsheetImport(existing, workbook).errors.some(issue => issue.field === "Revision"));
});

test("Excel preview cannot apply after an unrelated concurrent workspace change", () => {
  const { store, workbook } = onlyRules(); cell(workbook, 4, "Every", 4);
  const plan = planSpreadsheetImport(store, workbook);
  const changed = applyLocalAdminCommand(store, { type: "set_organization", name: "Changed", expectedRevision: store.data.organization.revision });
  assert.throws(() => applySpreadsheetImport(changed, plan), /workspace changed/);
});
