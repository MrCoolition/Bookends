import type { LocalAdminStore } from "./local";
import { formatNamedList } from "./named-list";
import { MAX_SPREADSHEET_BYTES, SPREADSHEET_HEADERS, type SpreadsheetCell, type SpreadsheetSheetName, type SpreadsheetWorkbook } from "./spreadsheet";

type ExportValues = Record<string, SpreadsheetCell | undefined>;
const REFERENCE_NOTE = "REFERENCE ONLY · Included for context and completeness. Changes on this sheet are not imported; use Administration to edit these settings.";
const EDIT_NOTE = "BATCH EDIT · Keep IDs and revisions unchanged. Edit values below row 4, then import and review the preview. Missing rows never delete records.";
const stringBoolean = (value: boolean) => value ? "true" : "false";
const identity = (record: { id: string; revision: number; active: boolean }) => ({ "Record ID": record.id, Revision: record.revision, Active: stringBoolean(record.active) });
const nullable = (value: unknown): SpreadsheetCell => value === undefined || value === null ? "" : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : JSON.stringify(value);

function dataSheet(name: SpreadsheetSheetName, records: ExportValues[]): SpreadsheetWorkbook["sheets"][number] {
  const headers = [...SPREADSHEET_HEADERS[name]];
  return { name, rows: [[`BOOKENDS / ${name}`], [EDIT_NOTE], [`${records.length} records · Includes active and inactive records`], headers, ...records.map(record => headers.map(header => record[header] ?? ""))] };
}
function referenceSheet(name: string, headers: string[], rows: SpreadsheetCell[][]): SpreadsheetWorkbook["sheets"][number] {
  return { name, rows: [[`BOOKENDS / ${name}`], [REFERENCE_NOTE], [`${rows.length} reference rows`], headers, ...rows] };
}

/** The entire saved workspace, never the currently filtered admin view. Reference
 * sheets intentionally do not turn access or playbook approvals into bulk edits. */
export function workspaceSpreadsheetData(store: LocalAdminStore): SpreadsheetWorkbook {
  if (store.data.hasMore) throw new Error("The workspace is still loading. Refresh all records before exporting Excel.");
  const { data } = store;
  const clientCode = (id: string) => data.clients.find(client => client.id === id)?.code ?? "";
  const memberName = (id: string) => data.members.find(member => member.id === id)?.name ?? "";
  const personName = (id: string) => data.resources.find(person => person.id === id)?.name ?? "";
  const engagements = data.missions.filter(mission => mission.engagement);
  const editable = [
    dataSheet("Clients", data.clients.map(client => ({ ...identity(client), "Client code": client.code, "Client name": client.name, "Contact name": client.contactName, "Contact email": client.contactEmail, Notes: client.notes }))),
    dataSheet("People", data.resources.map(person => ({ ...identity(person), "Person name": person.name, "HOME code": person.home, "Owner name": memberName(person.ownerId), "Delivery roles": formatNamedList(person.profile?.roles ?? []), Skills: formatNamedList(person.profile?.skills ?? []), Designation: person.profile?.affiliation === "impower" ? "Impower" : person.profile?.affiliation === "contractor" ? "Contractor" : "" }))),
    dataSheet("Engagements", engagements.map(mission => {
      const plan = mission.engagement!;
      return { ...identity(mission), "Engagement name": mission.name, "Client code": clientCode(mission.clientId), "SOW reference": plan.sowReference, Status: plan.status, "Signed on": plan.signedOn ?? "", "Start date": plan.start, "End date": plan.end, Outcomes: plan.outcomes, Source: plan.source ?? "" };
    })),
    dataSheet("Engagement roles", engagements.flatMap(mission => mission.engagement!.roles.map(role => ({ "Engagement name": mission.name, "Client code": clientCode(mission.clientId), "Role name": role.name, Headcount: role.headcount, "Allocation %": role.allocationPercent, Skills: formatNamedList(role.skills), Responsibilities: role.responsibilities, "Start date": role.start, "End date": role.end, "Role ID": role.id, "Engagement ID": mission.id, Revision: mission.revision, "Selected people IDs": formatNamedList(role.selectedResourceIds ?? []) })))),
    dataSheet("Roles", (data.capabilities ?? []).filter(item => item.kind === "role").map(item => ({ ...identity(item), Name: item.name, Description: item.description }))),
    dataSheet("Skills", (data.capabilities ?? []).filter(item => item.kind === "skill").map(item => ({ ...identity(item), Name: item.name, Description: item.description }))),
    dataSheet("HOMEs", data.homes.map(home => ({ ...identity(home), "HOME code": home.code, "HOME name": home.name, Description: home.description }))),
    dataSheet("Missions", data.missions.filter(mission => !mission.engagement).map(mission => ({ ...identity(mission), "Mission name": mission.name, "Client code": clientCode(mission.clientId) }))),
  ];
  const workspaceRows: SpreadsheetCell[][] = [
    ["Workspace", "", "", "Format version", store.version],
    ["Workspace", "", "", "Saved revision", store.revision],
    ["Workspace", "", "", "Client seed version", store.clientSeedVersion ?? ""],
    ["Workspace", "", "", "As of (UTC)", data.asOf],
    ["Workspace", "", "", "More records pending", stringBoolean(data.hasMore ?? false)],
    ["Organization", data.organization.name, data.organization.id, "Revision", data.organization.revision],
    ["Viewer", data.viewer.name, data.viewer.id, "Display name", data.viewer.name],
    ...data.resources.map(person => ["Person", person.name, person.id, "Owner ID", person.ownerId]),
    ...(data.capabilities ?? []).map(item => [item.kind === "role" ? "Role" : "Skill", item.name, item.id, "Former names / aliases", formatNamedList(item.aliases ?? [])]),
  ];
  const playbookRows = data.templates.map(template => [template.id, template.name, template.kind, template.version, template.description, template.status, template.sourceReference, template.policyOwnerId ?? "", template.approvedBy ?? "", template.approvedAt ?? "", nullable(template.approvedScope), template.revision, stringBoolean(template.persisted)]);
  const requirementRows = data.templates.flatMap(template => template.requirements.map(requirement => [template.id, template.name, requirement.id, requirement.version, requirement.title, requirement.description, requirement.category, requirement.sourceReference, requirement.applicableScope, requirement.trigger, requirement.leadTimeDays, requirement.dueRule.anchor, requirement.dueRule.offsetDays, requirement.approverRole, stringBoolean(requirement.evidencePolicy.required), formatNamedList(requirement.evidencePolicy.acceptedKinds), stringBoolean(requirement.evidencePolicy.independentVerification), formatNamedList(requirement.blockedActions), requirement.severity, stringBoolean(requirement.overridePolicy.allowed), formatNamedList(requirement.overridePolicy.approverRoles), stringBoolean(requirement.overridePolicy.evidenceRequired), formatNamedList(requirement.prerequisiteTemplateIds), stringBoolean(requirement.active)]));
  const sowRows: SpreadsheetCell[][] = engagements.flatMap(mission => {
    const plan = mission.engagement!, intake = plan.intake;
    const common: SpreadsheetCell[] = [mission.name, mission.id, plan.version, plan.source ?? "", plan.sowReference, intake?.sourceName ?? "", intake?.sourceKind ?? ""];
    return [
      [...common, "Plan", "", intake ? "SOW intake saved" : "No SOW intake", ""],
      ...(intake?.evidence ?? []).map(item => [...common, "Evidence", item.field, item.quote, stringBoolean(item.verified)]),
      ...(intake?.uncertainties ?? []).map(item => [...common, "Uncertainty", "", item, ""]),
    ];
  });
  const selectionRows: SpreadsheetCell[][] = engagements.flatMap(mission => mission.engagement!.roles.flatMap(role => {
    const common: SpreadsheetCell[] = [mission.name, mission.id, role.name, role.id];
    return role.selectedResourceIds?.length ? role.selectedResourceIds.map((id, index) => [...common, index + 1, personName(id), id]) : [[...common, "", "No teammates selected", ""]];
  }));
  const workbook: SpreadsheetWorkbook = { sheets: [
    { name: "Start here", rows: [
      ["BOOKENDS / Your workspace, ready for batch edits"],
      ["Export → Edit in Excel → Import → Review → Apply"],
      [`Workspace revision ${store.revision} · ${data.organization.name} · ${data.asOf}`],
      ["Step", "What to do"],
      ["1. Edit the populated tabs", "Clients, People, Engagements, Engagement roles, Roles, Skills, HOMEs and Missions contain all saved records, including inactive records. Headers stay on row 4; data starts on row 5."],
      ["2. Keep record identity", "Keep Record ID, Role ID, Engagement ID and Revision unchanged. Keep client and HOME codes stable. IDs let you rename existing records without creating duplicates."],
      ["3. Add or archive", "For new rows leave IDs and Revision blank. Active is true or false: false archives a record, true restores it where references allow. Removing a row from Excel never deletes it from BOOKENDS."],
      ["4. Use plain values", "Dates use YYYY-MM-DD. Separate multiple roles, skills or selected people IDs with commas; put a value containing a comma in double quotes. No formulas. Blank optional cells clear editable values; omitted columns preserve them."],
      ["People links", "With a Record ID, clearing HOME code or Owner name removes that person's link; removing the entire column preserves it. Legacy imports without Record IDs keep existing HOME and owner links when those cells are blank."],
      ["5. Review before applying", "Import Excel to see adds, updates, unchanged records and validation errors. Nothing saves until you apply the preview. If an exported record changed in BOOKENDS, download a fresh export and reapply your edits."],
      ["Engagements & team choices", "Engagement roles use stable Role ID and Engagement ID. Selected people IDs are proposed teammates, not staffing assignments. Team selections lists their names. Source is direct or sow; blank retains the legacy SOW interpretation."],
      ["Reference sheets", "Workspace, Members, Playbooks, Requirements, SOW notes and Team selections include settings, access, policy approvals, evidence and readable team choices. These tabs are reference only; edits are ignored during import. Use Administration to change them."],
      ["Complete restoration", "Excel is for reviewed batch editing. Keep a JSON backup for restoring the complete workspace, including reference-only settings and approvals. Credentials and sign-in sessions are never included."],
    ] },
    ...editable,
    referenceSheet("Workspace", ["Section", "Record", "Record ID", "Field", "Value"], workspaceRows),
    referenceSheet("Members", ["Member ID", "Name", "Access role", "Linked person ID", "Linked person", "HOME scope", "Active", "Revision", "Additional grants (JSON)"], data.members.map(member => [member.id, member.name, member.role, member.resourceId ?? "", member.resourceId ? personName(member.resourceId) : "", member.homeScope ?? "", stringBoolean(member.active), member.revision, JSON.stringify(member.grants)])),
    referenceSheet("Playbooks", ["Playbook ID", "Name", "Journey kind", "Version", "Description", "Status", "Source reference", "Policy owner ID", "Approved by", "Approved at (UTC)", "Approved scope (JSON)", "Revision", "Persisted"], playbookRows),
    referenceSheet("Requirements", ["Playbook ID", "Playbook name", "Requirement ID", "Version", "Title", "Description", "Category", "Source reference", "Applicable scope", "Trigger", "Lead time days", "Due anchor", "Due offset days", "Approver role", "Evidence required", "Accepted evidence kinds", "Independent verification", "Blocked actions", "Severity", "Override allowed", "Override approver roles", "Override evidence required", "Prerequisite IDs", "Active"], requirementRows),
    referenceSheet("SOW notes", ["Engagement", "Engagement ID", "Plan version", "Source", "SOW reference", "Source name", "Source kind", "Note type", "Field", "Text", "Verified"], sowRows),
    referenceSheet("Team selections", ["Engagement", "Engagement ID", "Delivery role", "Role ID", "Position", "Selected teammate", "Person ID"], selectionRows),
  ] };
  let cells = 0;
  for (const sheet of workbook.sheets) {
    if (sheet.rows.length > 1004) throw new Error(`${sheet.name} has more than 1,000 data rows, exceeding the Excel import limit. Export a JSON backup to keep the complete workspace; no records were omitted.`);
    for (const row of sheet.rows) {
      cells += row.length;
      if (row.length > 64 || row.some(value => typeof value === "string" && value.length > 20_000)) throw new Error(`${sheet.name} contains data beyond the Excel import limits. Export a JSON backup to keep the complete workspace; no values were truncated.`);
    }
  }
  if (cells > 90_000) throw new Error("This workspace is too large for a single editable Excel workbook. Export a JSON backup to keep every record; no data was omitted.");
  return workbook;
}

function columnWidth(header: string) {
  if (/^Active$|^Revision$|^Headcount$|^Allocation %$|^Version$|^Persisted$/.test(header)) return 14;
  if (/ID$/.test(header)) return 39;
  if (/date|Signed on/.test(header)) return 17;
  if (/Description|Notes|Outcomes|Responsibilities|Text|Value|What to do|JSON/.test(header)) return 58;
  if (/Skills|roles|names/i.test(header)) return 34;
  return 26;
}

function readableRowHeight(values: SpreadsheetCell[], widths: number[], minimum: number) {
  const lines = values.reduce<number>((maximum, value, column) => {
    const charactersPerLine = Math.max(8, Math.floor((widths[column] ?? 26) * 0.95));
    const wrapped = String(value ?? "").split(/\r?\n/).reduce((total, paragraph) => {
      let lineCount = 1, used = 0;
      for (const word of paragraph.split(/\s+/)) {
        if (used && used + word.length + 1 > charactersPerLine) { lineCount++; used = 0; }
        const length = word.length + (used ? 1 : 0);
        lineCount += Math.max(0, Math.ceil(length / charactersPerLine) - 1);
        used = length > charactersPerLine ? length % charactersPerLine : used + length;
      }
      return total + lineCount;
    }, 0);
    return Math.max(maximum, wrapped);
  }, 1);
  // Excel's maximum row height is 409 points; longer notes remain intact in the
  // cell and formula bar, while everyday wrapped notes are fully visible.
  return Math.min(409, Math.max(minimum, lines * 15 + 12));
}

/** Generate only on request, keeping ExcelJS out of the initial admin bundle. */
export async function exportWorkspaceSpreadsheet(store: LocalAdminStore): Promise<Uint8Array> {
  const source = workspaceSpreadsheetData(store);
  const { default: ExcelJS } = await import("exceljs");
  const excel = new ExcelJS.Workbook();
  excel.creator = "BOOKENDS";
  excel.subject = "Complete workspace export for reviewed batch editing";
  excel.title = `${store.data.organization.name} · Workspace revision ${store.revision}`;
  excel.created = new Date();
  for (const item of source.sheets) {
    const editable = Object.hasOwn(SPREADSHEET_HEADERS, item.name), guide = item.name === "Start here";
    const sheet = excel.addWorksheet(item.name, { properties: { tabColor: { argb: guide ? "FF18243C" : editable ? "FF3455F6" : "FFE88063" } }, views: [{ state: "frozen", ySplit: 4, xSplit: guide ? 0 : 1, showGridLines: false }], pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const headers = item.rows[3].map(value => String(value ?? ""));
    const widths = headers.map(header => guide && header === "What to do" ? 110 : columnWidth(header));
    sheet.columns = widths.map(width => ({ width }));
    item.rows.forEach(row => sheet.addRow(row));
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.mergeCells(2, 1, 2, headers.length);
    sheet.mergeCells(3, 1, 3, headers.length);
    sheet.getRow(1).height = 37;
    sheet.getRow(2).height = guide ? 28 : 34;
    sheet.getRow(3).height = 24;
    sheet.getRow(4).height = 32;
    for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex++) {
      const row = sheet.getRow(rowIndex);
      if (rowIndex > 4) row.height = readableRowHeight(item.rows[rowIndex - 1], widths, guide ? 65 : 38);
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cell.font = { name: "Aptos", size: rowIndex === 1 ? 18 : 11, bold: rowIndex === 1 || rowIndex === 4, color: { argb: rowIndex === 1 || rowIndex === 4 ? "FFFFFFFF" : rowIndex === 2 ? "FF52617B" : "FF18243C" } };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIndex === 1 ? "FF18243C" : rowIndex === 4 ? editable ? "FF3455F6" : "FF52617B" : rowIndex > 4 && rowIndex % 2 ? "FFF0F3FA" : "FFFFFFFF" } };
        // Explicit strings stay strings, even when user content starts with =, +, - or @.
        if (typeof cell.value === "string") cell.numFmt = "@";
        else if (typeof cell.value === "number") cell.numFmt = "0.##";
        if (rowIndex > 4 && /^(Record ID|Role ID|Engagement ID|Revision)$/.test(headers[column - 1])) cell.font = { name: "Aptos", size: 10, color: { argb: "FF6D7890" } };
      });
    }
    if (!guide) sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, sheet.rowCount), column: headers.length } };
    if (editable) for (const [header, choices] of Object.entries({ Active: "true,false", Designation: "Impower,Contractor", Status: "draft,signed,complete", Source: "direct,sow" })) {
      const column = headers.indexOf(header) + 1;
      if (!column) continue;
      for (let row = 5; row <= Math.min(1004, Math.max(29, item.rows.length + 10)); row++) sheet.getCell(row, column).dataValidation = { type: "list", allowBlank: true, formulae: [`"${choices}"`], showErrorMessage: true, errorStyle: "stop", errorTitle: `Choose a ${header.toLowerCase()}`, error: `Use ${choices.split(",").join(" or ")}, or leave blank.` };
    }
  }
  const bytes = new Uint8Array(await excel.xlsx.writeBuffer());
  if (bytes.byteLength > MAX_SPREADSHEET_BYTES) throw new Error("This export exceeds the 5 MiB Excel import limit. Export a JSON backup to keep every record; no data was omitted.");
  const { unzipSync } = await import("fflate");
  let expanded = 0;
  unzipSync(bytes, { filter(entry) { expanded += entry.originalSize; return false; } });
  if (expanded > 20 * 1024 * 1024) throw new Error("This export exceeds the expanded Excel import limit. Export a JSON backup to keep every record; no data was omitted.");
  return bytes;
}
