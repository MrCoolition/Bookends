import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalAdminStore, parseLocalAdminStore, LOCAL_ADMIN_OWNER_ID } from "../lib/admin/local";
import { exportWorkspaceSpreadsheet, workspaceSpreadsheetData } from "../lib/admin/spreadsheet-export";
import { applySpreadsheetImport, planSpreadsheetImport, readSpreadsheetFile, type SpreadsheetWorkbook } from "../lib/admin/spreadsheet";

const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
function fixture() {
  const store = createLocalAdminStore();
  store.revision = 12;
  store.clientSeedVersion = 1;
  store.data.asOf = "2026-10-09T16:00:00.000Z";
  store.data.homes = [
    { id: id(1), code: "data", name: "Data", description: "Delivery", active: true, revision: 2 },
    { id: id(2), code: "legacy", name: "Legacy", description: "Historic", active: false, revision: 3 },
  ];
  store.data.clients = [
    { id: id(3), code: "northstar", name: "Northstar", contactName: "Avery Client", contactEmail: "avery@example.test", notes: '=HYPERLINK("https://example.test")', active: true, revision: 3 },
    { id: id(4), code: "past", name: "Past client", contactName: "", contactEmail: "", notes: "Retain history\nKeep original contacts\nArchive only after transition\nPreserve delivery context\nUse the full record for future work.", active: false, revision: 5 },
  ];
  store.data.resources = [
    { id: id(5), name: "Avery Example", home: "data", ownerId: LOCAL_ADMIN_OWNER_ID, active: true, revision: 3, profile: { roles: ["Engineer", "BA"], skills: ["SQL", "Research, design"], affiliation: "impower" } },
    { id: id(6), name: "Taylor Example", home: "", ownerId: "", active: true, revision: 2 },
    { id: id(7), name: "Historic Example", home: "legacy", ownerId: id(8), active: false, revision: 4, profile: { roles: ["Data Engineer"], skills: ["Python"], affiliation: "contractor" } },
  ];
  store.data.members.push({ id: id(8), name: "Workspace owner", role: "mission_owner", resourceId: null, homeScope: "legacy", active: false, revision: 6, grants: [{ role: "client_liaison", scope: { clientId: id(4) } }] });
  store.data.capabilities = [
    { id: id(9), kind: "role", name: "Data Engineer", description: "Data delivery", active: true, revision: 4, aliases: ["Engineer"] },
    { id: id(10), kind: "role", name: "BA", description: "Requirements", active: false, revision: 2 },
    { id: id(11), kind: "skill", name: "SQL", description: "Queries", active: true, revision: 3, aliases: ["SQL Server"] },
    { id: id(12), kind: "skill", name: "Python", description: "Automation", active: false, revision: 5, aliases: [] },
  ];
  store.data.missions = [
    { id: id(13), name: "Earlier mission", clientId: id(4), active: false, revision: 2 },
    { id: id(14), name: "Analytics", clientId: id(3), active: true, revision: 7, engagement: {
      version: 1, status: "signed", sowReference: "SOW-123", signedOn: "2026-10-01", start: "2026-10-01", end: "2027-03-31", outcomes: "Launch analytics.",
      intake: { sourceName: "analytics.docx", sourceKind: "docx", evidence: [{ field: "headcount", quote: "Two data engineers", verified: true }, { field: "end", quote: "Through March", verified: false }], uncertainties: ["Confirm the handover owner."] },
      roles: [
        { id: id(15), name: "Data Engineer", headcount: 2, allocationPercent: 100, skills: ["SQL"], responsibilities: "Deliver pipelines", start: "2026-10-01", end: "2027-03-31", selectedResourceIds: [id(5), id(7)] },
        { id: id(16), name: "BA", headcount: 1, allocationPercent: 50, skills: [], responsibilities: "Requirements", start: "2026-10-01", end: "2027-03-31" },
      ],
    } },
    { id: id(17), name: "Direct plan", clientId: id(4), active: false, revision: 5, engagement: { version: 1, source: "direct", status: "complete", sowReference: "", signedOn: null, start: "2026-01-01", end: "2026-03-31", outcomes: "Complete", roles: [{ id: id(18), name: "Data Engineer", headcount: 1, allocationPercent: 75, skills: [], responsibilities: "", start: "2026-01-01", end: "2026-03-31", selectedResourceIds: [] }] } },
  ];
  return parseLocalAdminStore(store);
}
const sheet = (workbook: SpreadsheetWorkbook, name: string) => workbook.sheets.find(item => item.name === name)!;
function values(workbook: SpreadsheetWorkbook, name: string) {
  const { rows } = sheet(workbook, name);
  return rows.slice(4).map(row => Object.fromEntries(rows[3].map((header, index) => [String(header), row[index] ?? ""])));
}
const workbookFile = (bytes: Uint8Array) => new File([bytes.slice().buffer], "BOOKENDS-workspace.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

test("full workspace export includes inactive records, stable identities and every reference section", () => {
  const store = fixture(), before = structuredClone(store), book = workspaceSpreadsheetData(store);
  assert.deepEqual(store, before);
  assert.equal(book.sheets.length, 15);
  assert.equal(values(book, "People").length, 3);
  assert.equal(values(book, "People")[2].Active, "false");
  assert.equal(values(book, "People")[0]["Record ID"], id(5));
  assert.equal(values(book, "People")[0].Revision, 3);
  assert.equal(values(book, "People")[0].Designation, "Impower");
  assert.equal(values(book, "People")[0].Skills, 'SQL, "Research, design"');
  assert.equal(values(book, "Engagements").length, 2);
  assert.equal(values(book, "Missions").length, 1);
  assert.equal(values(book, "Engagement roles")[0]["Selected people IDs"], `${id(5)}, ${id(7)}`);
  assert.equal(values(book, "Engagement roles")[0]["Role ID"], id(15));
  assert.ok(values(book, "Workspace").some(row => row.Field === "Former names / aliases" && row.Value === "Engineer"));
  assert.ok(values(book, "Workspace").some(row => row.Record === "Historic Example" && row.Value === id(8)));
  assert.deepEqual(JSON.parse(String(values(book, "Members")[1]["Additional grants (JSON)"])), store.data.members[1].grants);
  assert.equal(values(book, "Playbooks").length, store.data.templates.length);
  assert.equal(values(book, "Requirements").length, store.data.templates.reduce((total, item) => total + item.requirements.length, 0));
  assert.ok(values(book, "SOW notes").some(row => row["Note type"] === "Evidence" && row.Text === "Two data engineers" && row.Verified === "true"));
  assert.ok(values(book, "SOW notes").some(row => row["Note type"] === "Uncertainty" && row.Text === "Confirm the handover owner."));
  assert.ok(values(book, "Team selections").some(row => row["Selected teammate"] === "Historic Example"));
});

test("unchanged populated export imports as a no-op, preserving optional fields and metadata exactly", () => {
  const store = fixture(), book = workspaceSpreadsheetData(store), plan = planSpreadsheetImport(store, book);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.adds, 0);
  assert.equal(plan.counts.updates, 0);
  assert.deepEqual(applySpreadsheetImport(store, plan), store);
});

test("generated XLSX is readable, formatted for batch editing, formula-safe and round-trips without updates", async () => {
  const store = fixture(), bytes = await exportWorkspaceSpreadsheet(store);
  assert.ok(bytes.byteLength > 1000);
  const { default: ExcelJS } = await import("exceljs"), excel = new ExcelJS.Workbook();
  await excel.xlsx.load(bytes.buffer as Parameters<typeof excel.xlsx.load>[0]);
  assert.equal(excel.worksheets.length, 15);
  const people = excel.getWorksheet("People")!;
  assert.equal(people.views[0].state, "frozen");
  assert.equal("ySplit" in people.views[0] && people.views[0].ySplit, 4);
  assert.ok(people.autoFilter);
  assert.equal(people.getCell("F5").dataValidation.type, "list");
  assert.equal(excel.getWorksheet("Clients")!.getCell("E5").value, store.data.clients[0].notes);
  assert.equal(excel.getWorksheet("Clients")!.getCell("E5").formula, undefined);
  assert.ok(excel.getWorksheet("Clients")!.getRow(6).height! >= 87, "Five-line notes get room to remain readable");
  const read = await readSpreadsheetFile(workbookFile(bytes)), plan = planSpreadsheetImport(store, read);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.adds, 0);
  assert.equal(plan.counts.updates, 0);
  assert.deepEqual(applySpreadsheetImport(store, plan), store);
});

test("empty editable sheets do not invent records when a starter workspace is exported", async () => {
  const store = createLocalAdminStore(), bytes = await exportWorkspaceSpreadsheet(store), read = await readSpreadsheetFile(workbookFile(bytes));
  const plan = planSpreadsheetImport(store, read);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.counts, { adds: 0, updates: 0, skips: 0 });
  assert.deepEqual(applySpreadsheetImport(store, plan), store);
});

test("populated exports support renamed people and edited designations without creating duplicates", () => {
  const store = fixture(), book = workspaceSpreadsheetData(store), people = sheet(book, "People"), headers = people.rows[3];
  people.rows[4][headers.indexOf("Person name")] = "Avery Updated";
  people.rows[4][headers.indexOf("Designation")] = "Contractor";
  const plan = planSpreadsheetImport(store, book);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.adds, 0);
  assert.equal(plan.counts.updates, 1);
  const next = applySpreadsheetImport(store, plan);
  assert.equal(next.data.resources.length, 3);
  assert.equal(next.data.resources[0].id, id(5));
  assert.equal(next.data.resources[0].name, "Avery Updated");
  assert.equal(next.data.resources[0].profile?.affiliation, "contractor");
  assert.deepEqual(next.data.missions[1].engagement?.roles[0].selectedResourceIds, [id(5), id(7)]);
});

test("exports reject incomplete or oversized data clearly instead of silently truncating", () => {
  const store = fixture();
  store.data.hasMore = true;
  assert.throws(() => workspaceSpreadsheetData(store), /still loading/);
  store.data.hasMore = false;
  store.data.resources = Array.from({ length: 1001 }, (_, index) => ({ ...store.data.resources[0], id: id(index + 100), name: `Person ${index}` }));
  assert.throws(() => workspaceSpreadsheetData(store), /more than 1,000 data rows/);
});

test("guide describes clearing ID-bound People links and legacy import fallback accurately", () => {
  const store = fixture(), book = workspaceSpreadsheetData(store);
  const guide = sheet(book, "Start here").rows.flat().join(" ");
  assert.match(guide, /With a Record ID, clearing HOME code or Owner name removes that person's link/);
  assert.match(guide, /Legacy imports without Record IDs keep existing HOME and owner links/);
  const people = sheet(book, "People");
  people.rows[4][people.rows[3].indexOf("HOME code")] = "";
  people.rows[4][people.rows[3].indexOf("Owner name")] = "";
  const plan = planSpreadsheetImport(store, book);
  assert.deepEqual(plan.errors, []);
  const updated = applySpreadsheetImport(store, plan).data.resources[0];
  assert.equal(updated.home, "");
  assert.equal(updated.ownerId, "");
});
