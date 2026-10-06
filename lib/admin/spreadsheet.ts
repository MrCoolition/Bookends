import { z } from "zod";
import { adminRequestSchema } from "./validation";
import { LOCAL_ADMIN_OWNER_ID, parseLocalAdminStore, type LocalAdminStore } from "./local";
import type { AdminClient, AdminHome, AdminMission, AdminResource } from "./contracts";

export const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 1004, MAX_COLUMNS = 64, MAX_RECORDS = 1000;
export const SPREADSHEET_HEADERS = {
  HOMEs: ["HOME code", "HOME name", "Description"],
  Clients: ["Client code", "Client name", "Contact name", "Contact email", "Notes"],
  People: ["Person name", "HOME code", "Owner name"],
  Missions: ["Mission name", "Client code"],
} as const;
export type SpreadsheetSheetName = keyof typeof SPREADSHEET_HEADERS;
export type SpreadsheetCell = string | number | boolean | null | { formula: string } | { unsupported: string };
export type SpreadsheetIssue = { sheet: string; row: number; field: string; message: string };
export type SpreadsheetWorkbook = { sheets: { name: string; rows: SpreadsheetCell[][] }[]; errors?: SpreadsheetIssue[] };
export type SpreadsheetChange = { sheet: SpreadsheetSheetName; row: number; action: "add" | "update" | "skip"; label: string; fields?: { field: string; before: string; after: string }[] };
export type SpreadsheetImportPlan = {
  baselineRevision: number;
  counts: { adds: number; updates: number; skips: number };
  sheets: { name: SpreadsheetSheetName; adds: number; updates: number; unchanged: number }[];
  errors: SpreadsheetIssue[];
  changes: SpreadsheetChange[];
  /** The detached source and canonical baseline allow apply to revalidate the reviewed plan. */
  workbook: SpreadsheetWorkbook;
  baselineSnapshot: string;
};
export class SpreadsheetImportError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "SpreadsheetImportError"; }
}
function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new SpreadsheetImportError(code, message);
}
const cellSchema = z.union([z.string().max(20_000), z.number().finite(), z.boolean(), z.null(), z.object({ formula: z.string().max(20_000) }).strict(), z.object({ unsupported: z.string().max(200) }).strict()]);
const workbookSchema = z.object({
  sheets: z.array(z.object({ name: z.string().min(1).max(128), rows: z.array(z.array(cellSchema).max(256)).max(10_005) }).strict()).max(20),
  errors: z.array(z.object({ sheet: z.string().max(128), row: z.int().min(0), field: z.string().max(200), message: z.string().max(2000) }).strict()).max(10_000).optional(),
}).strict();
function columnName(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}
function nonblank(cell: SpreadsheetCell | undefined) { return cell !== undefined && cell !== null && !(typeof cell === "string" && !cell.trim()); }
function isDataSheet(name: string): name is SpreadsheetSheetName { return Object.hasOwn(SPREADSHEET_HEADERS, name); }
type ImportedRow = { sheet: SpreadsheetSheetName; row: number; values: Map<string, string>; columns: Set<string> };
function mapRows(workbook: SpreadsheetWorkbook, errors: SpreadsheetIssue[]): ImportedRow[] {
  const result: ImportedRow[] = [], seen = new Set<string>();
  let recognized = 0;
  for (const sheet of workbook.sheets) {
    if (sheet.name === "Start here") continue;
    if (!isDataSheet(sheet.name)) {
      if (sheet.rows.some(row => row.some(nonblank))) errors.push({ sheet: sheet.name, row: 1, field: "Sheet name", message: "Use HOMEs, Clients, People, or Missions for import data. Start here is the only ignored instruction sheet." });
      continue;
    }
    recognized++;
    if (seen.has(sheet.name)) { errors.push({ sheet: sheet.name, row: 1, field: "Sheet name", message: "This import contains the same sheet more than once." }); continue; }
    seen.add(sheet.name);
    const expected: readonly string[] = SPREADSHEET_HEADERS[sheet.name], rawHeaders = sheet.rows[3] ?? [];
    const headers = new Map<number, string>(), columns = new Set<string>();
    const issue = (row: number, field: string, message: string) => errors.push({ sheet: sheet.name, row, field, message });
    rawHeaders.forEach((value, index) => {
      if (!nonblank(value)) return;
      if (typeof value !== "string") { issue(4, columnName(index), "Use a plain-text column heading. Formulas and other cell types cannot be imported."); return; }
      const known = expected.find(header => header.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
      if (known) {
        if (columns.has(known)) issue(4, known, "This column heading appears more than once.");
        else { headers.set(index, known); columns.add(known); }
      }
    });
    for (const required of expected.slice(0, 2)) if (!columns.has(required)) issue(4, required, `Add the required '${required}' heading on row 4.`);
    let count = 0;
    for (let index = 4; index < sheet.rows.length; index++) {
      const cells = sheet.rows[index] ?? [];
      if (!cells.some(nonblank)) continue;
      count++;
      if (index >= MAX_ROWS || count > MAX_RECORDS) { issue(index + 1, "Row", "Each sheet supports 1,000 data rows, starting on row 5 and ending on row 1004."); continue; }
      const values = new Map<string, string>();
      const priorErrors = errors.length;
      cells.forEach((value, col) => {
        const header = headers.get(col);
        if (!nonblank(value)) { if (header) values.set(header, ""); return; }
        if (!header || col >= MAX_COLUMNS) { issue(index + 1, typeof rawHeaders[col] === "string" && rawHeaders[col]!.trim() ? String(rawHeaders[col]) : columnName(col), "This populated column is not part of the import format. Move its data to a supported column or remove it."); return; }
        if (typeof value === "object") { issue(index + 1, header, value && "formula" in value ? "Replace this formula with a plain value before importing; cached formula results are not imported." : "Use a plain text value here; dates, hyperlinks, and errors are not imported."); return; }
        if (typeof value === "boolean") { issue(index + 1, header, "Use a name or code as plain text here."); return; }
        values.set(header, String(value).trim());
      });
      for (const required of expected.slice(0, 2)) if (!values.get(required)) issue(index + 1, required, "This value is required for every populated row.");
      if (errors.length === priorErrors && expected.slice(0, 2).every(required => columns.has(required))) result.push({ sheet: sheet.name, row: index + 1, values, columns });
    }
  }
  if (!recognized) errors.push({ sheet: "Workbook", row: 0, field: "Sheets", message: "Add at least one import sheet: HOMEs, Clients, People, or Missions." });
  return result;
}
function key(...values: string[]) { return JSON.stringify(values); }
function matching<T>(records: T[], getKey: (value: T) => string) {
  const values = new Map<string, T[]>();
  for (const record of records) { const recordKey = getKey(record); values.set(recordKey, [...(values.get(recordKey) ?? []), record]); }
  return values;
}
function changed<T extends object>(current: T, values: Partial<T>) { return Object.entries(values).some(([field, value]) => current[field as keyof T] !== value); }
function buildPlan(store: LocalAdminStore, workbook: SpreadsheetWorkbook) {
  const draft = structuredClone(store), data = draft.data;
  const errors = [...(workbook.errors ?? [])], rows = mapRows(workbook, errors), changes: SpreadsheetChange[] = [];
  const seen = new Map<string, number>();
  const homes = matching(data.homes, row => row.code), clients = matching(data.clients, row => row.code);
  const people = matching(data.resources, row => key(row.name, row.home));
  const missions = matching(data.missions, row => key(row.name, data.clients.find(client => client.id === row.clientId)!.code));
  const rowIssue = (row: ImportedRow, field: string, message: string) => errors.push({ sheet: row.sheet, row: row.row, field, message });
  function identify<T extends { active: boolean }>(row: ImportedRow, rowKey: string, records: Map<string, T[]>, field: string): { existing?: T; valid: boolean } {
    const importKey = key(row.sheet, rowKey), first = seen.get(importKey);
    if (first !== undefined) { rowIssue(row, field, `This key is already listed on row ${first}. Keep one row for each record.`); return { valid: false }; }
    seen.set(importKey, row.row);
    const found = records.get(rowKey) ?? [];
    if (found.length > 1) { rowIssue(row, field, "More than one existing record matches this name and scope. Resolve the duplicate records before importing."); return { valid: false }; }
    if (found[0] && !found[0].active) { rowIssue(row, field, "This record is archived. Reactivate it in Administration before importing changes."); return { valid: false }; }
    return { existing: found[0], valid: true };
  }
  function validate(row: ImportedRow, command: unknown, fields: Record<string, string>) {
    const result = adminRequestSchema.safeParse({ idempotencyKey: LOCAL_ADMIN_OWNER_ID, command });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = fields[String(issue.path[1])] ?? "Row";
        const message = field === "Contact email" ? "Enter a valid email address or leave this cell blank." : issue.code === "too_small" ? `Enter a value for ${field}.` : issue.message;
        rowIssue(row, field, message);
      }
      return false;
    }
    return true;
  }
  function merge<T extends { id: string; revision: number; active: boolean }>(row: ImportedRow, existing: T | undefined, values: Omit<T, "id" | "revision" | "active">, records: T[], map: Map<string, T[]>, rowKey: string, label: string) {
    if (existing) {
      if (!changed(existing, values as Partial<T>)) { changes.push({ sheet: row.sheet, row: row.row, action: "skip", label }); return; }
      const fieldLabels: Record<string, string> = { name: row.sheet === "HOMEs" ? "HOME name" : row.sheet === "Clients" ? "Client name" : row.sheet === "People" ? "Person name" : "Mission name", code: row.sheet === "HOMEs" ? "HOME code" : "Client code", description: "Description", contactName: "Contact name", contactEmail: "Contact email", notes: "Notes", home: "HOME code", ownerId: "Owner name", clientId: "Client code" };
      const display = (field: string, value: unknown) => field === "ownerId" ? data.members.find(member => member.id === value)?.name ?? "Unavailable owner" : field === "clientId" ? data.clients.find(client => client.id === value)?.code ?? "Unavailable client" : String(value ?? "");
      const fields = Object.entries(values).filter(([field, value]) => existing[field as keyof T] !== value).map(([field, value]) => ({ field: fieldLabels[field] ?? field, before: display(field, existing[field as keyof T]), after: display(field, value) }));
      Object.assign(existing, values); existing.revision++;
      changes.push({ sheet: row.sheet, row: row.row, action: "update", label, fields });
    } else {
      if (records.length >= MAX_RECORDS) { rowIssue(row, "Row", "This import would exceed the 1,000-record limit for this section."); return; }
      const record = { ...values, id: crypto.randomUUID(), revision: 1, active: true } as T;
      records.push(record); map.set(rowKey, [record]);
      changes.push({ sheet: row.sheet, row: row.row, action: "add", label });
    }
  }
  // Resolve parents first, regardless of worksheet order in the uploaded file.
  for (const name of ["HOMEs", "Clients", "People", "Missions"] as const) for (const row of rows.filter(row => row.sheet === name)) {
    const value = (header: string) => row.values.get(header) ?? "";
    if (name === "HOMEs") {
      const code = value("HOME code"), found = identify(row, code, homes, "HOME code"); if (!found.valid) continue;
      const fields = { code, name: value("HOME name"), description: row.columns.has("Description") ? value("Description") : found.existing?.description ?? "" };
      if (!validate(row, { type: "save_home", ...fields }, { code: "HOME code", name: "HOME name", description: "Description" })) continue;
      merge<AdminHome>(row, found.existing, fields, data.homes, homes, code, `${fields.name} · ${code}`);
    } else if (name === "Clients") {
      const code = value("Client code"), found = identify(row, code, clients, "Client code"); if (!found.valid) continue;
      const fields = { code, name: value("Client name"), contactName: row.columns.has("Contact name") ? value("Contact name") : found.existing?.contactName ?? "", contactEmail: row.columns.has("Contact email") ? value("Contact email") : found.existing?.contactEmail ?? "", notes: row.columns.has("Notes") ? value("Notes") : found.existing?.notes ?? "" };
      if (!validate(row, { type: "save_client", ...fields }, { code: "Client code", name: "Client name", contactName: "Contact name", contactEmail: "Contact email", notes: "Notes" })) continue;
      merge<AdminClient>(row, found.existing, fields, data.clients, clients, code, `${fields.name} · ${code}`);
    } else if (name === "People") {
      const home = value("HOME code"), personName = value("Person name"), personKey = key(personName, home);
      const found = identify(row, personKey, people, "Person name"); if (!found.valid) continue;
      if (!homes.get(home)?.[0]?.active) { rowIssue(row, "HOME code", "Choose an active HOME code already in the workspace or included on the HOMEs sheet."); continue; }
      const ownerName = value("Owner name");
      const owners = data.members.filter(member => member.active && (ownerName ? member.name === ownerName : member.id === LOCAL_ADMIN_OWNER_ID));
      if (owners.length !== 1) { rowIssue(row, "Owner name", ownerName ? "Owner name must match exactly one active local member. Resolve missing or duplicate names in Administration." : "The default workspace owner is inactive. Choose another active local member by name."); continue; }
      const fields = { name: personName, home, ownerId: owners[0].id };
      if (!validate(row, { type: "save_resource", ...fields }, { name: "Person name", home: "HOME code", ownerId: "Owner name" })) continue;
      merge<AdminResource>(row, found.existing, fields, data.resources, people, personKey, `${personName} · ${home}`);
    } else {
      const clientCode = value("Client code"), missionName = value("Mission name"), missionKey = key(missionName, clientCode);
      const found = identify(row, missionKey, missions, "Mission name"); if (!found.valid) continue;
      const client = clients.get(clientCode)?.[0];
      if (!client?.active) { rowIssue(row, "Client code", "Choose an active client code already in the workspace or included on the Clients sheet."); continue; }
      const fields = { name: missionName, clientId: client.id };
      if (!validate(row, { type: "save_mission", ...fields }, { name: "Mission name", clientId: "Client code" })) continue;
      merge<AdminMission>(row, found.existing, fields, data.missions, missions, missionKey, `${missionName} · ${clientCode}`);
    }
  }
  const counts = { adds: changes.filter(change => change.action === "add").length, updates: changes.filter(change => change.action === "update").length, skips: changes.filter(change => change.action === "skip").length };
  if (counts.adds || counts.updates) { draft.revision++; draft.data.asOf = new Date().toISOString(); }
  if (!errors.length) {
    try { parseLocalAdminStore(draft); }
    catch (error) { errors.push({ sheet: "Workbook", row: 0, field: "Workspace", message: error instanceof Error ? error.message : "This import would leave invalid workspace references." }); }
  }
  const sheets = [...new Set(workbook.sheets.filter(sheet => isDataSheet(sheet.name)).map(sheet => sheet.name as SpreadsheetSheetName))].map(name => ({ name, adds: changes.filter(change => change.sheet === name && change.action === "add").length, updates: changes.filter(change => change.sheet === name && change.action === "update").length, unchanged: changes.filter(change => change.sheet === name && change.action === "skip").length }));
  return { draft, counts, sheets, errors, changes };
}

export function planSpreadsheetImport(input: LocalAdminStore, raw: SpreadsheetWorkbook): SpreadsheetImportPlan {
  const store = parseLocalAdminStore(input), workbook = workbookSchema.parse(raw);
  const { counts, sheets, errors, changes } = buildPlan(store, workbook);
  return { baselineRevision: store.revision, baselineSnapshot: JSON.stringify(store), workbook, counts, sheets, errors, changes };
}
export function applySpreadsheetImport(input: LocalAdminStore, plan: SpreadsheetImportPlan): LocalAdminStore {
  const store = parseLocalAdminStore(input);
  ensure(plan.baselineRevision === store.revision && plan.baselineSnapshot === JSON.stringify(store), "conflict", "The workspace changed after this preview. Review the spreadsheet again before applying it.");
  ensure(plan.errors.length === 0, "invalid_import", "Fix every spreadsheet issue before applying this import. Nothing has been changed.");
  const rebuilt = buildPlan(store, workbookSchema.parse(plan.workbook));
  ensure(rebuilt.errors.length === 0, "invalid_import", "The spreadsheet no longer passes validation. Review it again; nothing has been changed.");
  return parseLocalAdminStore(rebuilt.draft);
}

/** Parses locally on demand. No upload, macro execution, external-link fetch, or formula evaluation. */
export async function readSpreadsheetFile(file: File): Promise<SpreadsheetWorkbook> {
  ensure(/\.xlsx$/i.test(file.name), "invalid_file", "Choose an .xlsx workbook. Use the BOOKENDS template to match the import columns.");
  ensure(file.size > 0 && file.size <= MAX_SPREADSHEET_BYTES, "too_large", "Choose an Excel workbook no larger than 5 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  ensure(bytes.byteLength <= MAX_SPREADSHEET_BYTES, "too_large", "Choose an Excel workbook no larger than 5 MiB.");
  const { unzipSync, Unzip, UnzipInflate } = await import("fflate");
  let entries = 0, uncompressed = 0;
  try {
    unzipSync(bytes, { filter(entry) {
      entries++; uncompressed += entry.originalSize;
      ensure(entries <= 2000 && uncompressed <= MAX_UNCOMPRESSED_BYTES, "too_large", "This workbook expands beyond the supported size. Remove unused sheets or embedded media and try again.");
      return false;
    } });
    ensure(entries > 0, "invalid_file", "This file is not a readable Excel workbook.");
    // Directory sizes can be falsified. Count actual streamed output in small input
    // chunks before ExcelJS is allowed to allocate a complete workbook.
    let actualBytes = 0, fileCount = 0, cellCount = 0, mergeCount = 0, mergedCells = 0, formattedColumns = 0;
    const paths = new Set<string>();
    const stream = new Unzip(entry => {
      ensure(++fileCount <= 2000 && !paths.has(entry.name), "invalid_file", "This workbook contains too many or duplicate archive entries.");
      ensure(!entry.name.startsWith("/") && !entry.name.includes("\\") && !entry.name.split("/").some((part, index, parts) => part === "." || part === ".." || (part === "" && index < parts.length - 1)), "invalid_file", "This workbook contains unsupported archive paths. Save a standard Excel copy.");
      paths.add(entry.name);
      const inspectXml = /\.xml$/i.test(entry.name), chunks: Uint8Array[] = [];
      entry.ondata = (error, chunk, final) => {
        if (error) throw error;
        actualBytes += chunk.byteLength;
        ensure(actualBytes <= MAX_UNCOMPRESSED_BYTES, "too_large", "This workbook expands beyond 20 MiB. Remove unused sheets or embedded media and try again.");
        if (inspectXml) chunks.push(chunk);
        if (!final || !inspectXml) return;
        const bytes = new Uint8Array(chunks.reduce((sum, part) => sum + part.byteLength, 0));
        let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
        const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        ensure(!/<!DOCTYPE|<!ENTITY/i.test(xml), "invalid_file", "Use a standard Excel workbook without XML document entities.");
        if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name)) return;
        for (const match of xml.matchAll(/<(?:[\w.-]+:)?row\b[^>]*\br\s*=\s*["']([^"']+)["']/g)) ensure(/^\d+$/.test(match[1]) && Number(match[1]) >= 1 && Number(match[1]) <= MAX_ROWS, "too_large", `A worksheet contains an unsupported row (${match[1]}). Keep worksheet data and formatting within rows 1–1004.`);
        for (const match of xml.matchAll(/<(?:[\w.-]+:)?col\b([^>]*)>/g)) {
          const min = /\bmin\s*=\s*["'](\d+)["']/.exec(match[1]), max = /\bmax\s*=\s*["'](\d+)["']/.exec(match[1]);
          ensure(min && max && Number(min[1]) >= 1 && Number(max[1]) >= Number(min[1]) && Number(max[1]) <= 16_384, "too_large", "Worksheet column formatting exceeds Excel's physical column limit.");
          formattedColumns += Number(max[1]) - Number(min[1]) + 1;
          ensure(formattedColumns <= 100_000, "too_large", "This workbook contains too much column formatting. Remove unused worksheet formatting and try again.");
        }
        for (const match of xml.matchAll(/<(?:[\w.-]+:)?c\b[^>]*\br\s*=\s*["']([^"']+)["']/g)) {
          const point = /^([A-Z]+)(\d+)$/.exec(match[1]);
          const column = point && [...point[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
          ensure(++cellCount <= 100_000 && point && column && column <= MAX_COLUMNS && Number(point[2]) >= 1 && Number(point[2]) <= MAX_ROWS, "too_large", `A worksheet contains a cell outside the supported import area (${match[1]}). Keep data in the template columns and rows.`);
        }
        for (const match of xml.matchAll(/<(?:[\w.-]+:)?mergeCell\b[^>]*\bref\s*=\s*["']([^"']+)["']/g)) {
          ensure(++mergeCount <= 200, "too_large", "This workbook contains too many merged areas. Use the import template.");
          const points: { column: number; row: number }[] = [];
          for (const address of match[1].split(":")) {
            const point = /^([A-Z]+)(\d+)$/.exec(address);
            const column = point && [...point[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
            ensure(point && column && column <= MAX_COLUMNS && Number(point[2]) >= 1 && Number(point[2]) <= MAX_ROWS, "too_large", "A merged area extends beyond the supported import area. Use the template's worksheet layout.");
            points.push({ column, row: Number(point[2]) });
          }
          const first = points[0], last = points[points.length - 1];
          ensure(points.length <= 2 && last.column >= first.column && last.row >= first.row, "invalid_file", "This workbook contains an invalid merged area.");
          mergedCells += (last.column - first.column + 1) * (last.row - first.row + 1);
          ensure(mergedCells <= 100_000, "too_large", "The workbook's merged areas cover too many cells. Use the template's worksheet layout.");
        }
      };
      entry.start();
    });
    stream.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 4096) stream.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  } catch (error) {
    if (error instanceof SpreadsheetImportError) throw error;
    throw new SpreadsheetImportError("invalid_file", "This file is not a readable .xlsx workbook. Open it in Excel and save a new copy.");
  }
  const { default: ExcelJS } = await import("exceljs");
  const excel = new ExcelJS.Workbook();
  try { await excel.xlsx.load(bytes.buffer as Parameters<typeof excel.xlsx.load>[0]); }
  catch { throw new SpreadsheetImportError("invalid_file", "This workbook could not be read. Save it as a standard, unencrypted .xlsx file and try again."); }
  ensure(excel.worksheets.length <= 20, "too_large", "Import at most 20 worksheets in one workbook.");
  const result: SpreadsheetWorkbook = { sheets: [], errors: [] };
  for (const sheet of excel.worksheets) {
    if (sheet.name === "Start here") continue;
    const rows: SpreadsheetCell[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (isDataSheet(sheet.name) && rowNumber < 4) return;
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        if (cell.value === null || cell.value === undefined || cell.value === "") return;
        if (rowNumber > MAX_ROWS || column > MAX_COLUMNS) {
          result.errors!.push({ sheet: sheet.name, row: rowNumber, field: columnName(column - 1), message: rowNumber > MAX_ROWS ? "Move data into rows 5–1004; later data cannot be imported." : "Move data into a supported template column; this column is outside the import area." }); return;
        }
        let value: SpreadsheetCell;
        if (typeof cell.value === "string" || typeof cell.value === "number" || typeof cell.value === "boolean") value = cell.value;
        else if (typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value)) value = { formula: String(cell.formula || "formula") };
        else if (typeof cell.value === "object" && "hyperlink" in cell.value && typeof cell.value.text === "string") value = cell.value.text;
        else if (typeof cell.value === "object" && "richText" in cell.value) value = cell.value.richText.map(part => part.text).join("");
        else value = { unsupported: cell.value instanceof Date ? "date" : "non-text cell" };
        while (rows.length < rowNumber) rows.push([]);
        while (rows[rowNumber - 1].length < column) rows[rowNumber - 1].push(null);
        rows[rowNumber - 1][column - 1] = value;
      });
    });
    result.sheets.push({ name: sheet.name, rows });
  }
  return result;
}
