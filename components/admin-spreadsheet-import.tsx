"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, ArrowRight, Check, ChevronDown, Download, FilePlus2, FileSpreadsheet, LoaderCircle, Upload, X } from "lucide-react";
import type { SpreadsheetImportPlan } from "@/lib/admin/spreadsheet";
import type { LocalAdminStore } from "@/lib/admin/local";

type Props = {
  disabled?: boolean;
  storageMode?: "browser" | "shared";
  compact?: boolean;
  onExport?: () => Promise<LocalAdminStore>;
  onPreview: (file: File) => Promise<SpreadsheetImportPlan>;
  onApply: (plan: SpreadsheetImportPlan) => Promise<void>;
  onDiscard: () => void;
};
const MAX_VISIBLE_ERRORS = 25;
const MAX_VISIBLE_CHANGES = 40;
function message(error: unknown) { return error instanceof Error && error.message.length < 500 ? error.message : "The workbook could not be processed. Use the BOOKENDS Excel template and try again."; }

export function AdminSpreadsheetImport({ disabled = false, storageMode = "browser", compact = false, onExport, onPreview, onApply, onDiscard }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const confirmFormId = useId();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<SpreadsheetImportPlan | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportLock = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [visibleChanges, setVisibleChanges] = useState(MAX_VISIBLE_CHANGES);
  const request = useRef(0);
  const applyingRef = useRef(false);
  const exportExcel = async () => {
    if (!onExport || disabled || exportLock.current) return;
    exportLock.current = true; setExporting(true); setExportError("");
    try {
      const current = await onExport();
      const { exportWorkspaceSpreadsheet } = await import("@/lib/admin/spreadsheet-export");
      const bytes = await exportWorkspaceSpreadsheet(current);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = url; link.download = `bookends-workspace-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) { setExportError(message(caught)); }
    finally { exportLock.current = false; setExporting(false); }
  };
  const close = () => { if (applyingRef.current) return; request.current++; setOpen(false); setReading(false); setPlan(null); setConfirmed(false); setError(""); onDiscard(); };
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || applyingRef.current) return;
    const attempt = ++request.current;
    setOpen(true); setVisibleChanges(MAX_VISIBLE_CHANGES); setFileName(file.name); setPlan(null); setConfirmed(false); setError(""); setReading(true);
    try { const next = await onPreview(file); if (request.current === attempt) setPlan(next); }
    catch (caught) { if (request.current === attempt) setError(message(caught)); }
    finally { if (request.current === attempt) setReading(false); }
  };
  const apply = async () => {
    if (!plan || plan.errors.length || !confirmed || applyingRef.current || plan.counts.adds + plan.counts.updates === 0) return;
    applyingRef.current = true; setApplying(true); setError("");
    try { await onApply(plan); applyingRef.current = false; close(); }
    catch (caught) { setError(message(caught)); }
    finally { applyingRef.current = false; setApplying(false); }
  };
  const changes = plan ? plan.counts.adds + plan.counts.updates : 0;
  return <><div className={`admin-excel-controls${compact ? " is-compact" : ""}`}>{onExport && <button type="button" className="admin-button admin-secondary" aria-label="Export Excel" title="Export all current workspace data to Excel" disabled={disabled || exporting || reading || applying} onClick={() => void exportExcel()}>{exporting ? <LoaderCircle className="admin-excel-spinner" size={15}/> : <Download size={15}/>}<span>{exporting ? "Exporting…" : "Export Excel"}</span></button>}<a className="admin-button admin-secondary" href="/templates/BOOKENDS_Seed_Template.xlsx" download aria-label="Download Excel template" title="Download Excel template"><FilePlus2 size={15} /><span>{compact ? "Blank template" : "Download Excel template"}</span></a><button className="admin-button admin-primary" disabled={disabled || reading || applying || exporting} onClick={() => fileRef.current?.click()}><FileSpreadsheet size={16} /> Import Excel</button><input ref={fileRef} className="admin-local-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose an Excel workbook" onChange={event => void choose(event)} />{exportError && <div className="admin-excel-export-error" role="alert"><span>{exportError}</span><button type="button" aria-label="Dismiss export error" onClick={() => setExportError("")}><X size={16}/></button></div>}</div>
    {open && <SpreadsheetDialog onClose={close} busy={applying}><div className="admin-excel-file"><FileSpreadsheet size={25} /><div><strong>{fileName}</strong><span>Excel workbook · reviewed before saving</span></div></div>
      {reading ? <div className="admin-excel-reading" role="status"><LoaderCircle className="admin-excel-spinner" size={25} /><h3>Checking your workbook.</h3><p>Reading the sheets and matching them with your saved setup.</p></div> : <>
        {plan && <><p className="admin-form-intro">Nothing is saved yet. This import adds new records and updates matching records. Existing records are kept.</p>{plan.workbook.sheets.some(sheet => sheet.name === "Workspace") && <p className="admin-form-intro">Reference tabs are included for completeness. Changes to workspace settings, members, playbooks, requirements, SOW notes, team-selection references, capacity, commitments, and saved scenarios are not imported. Use the editable data tabs for batch updates.</p>}<p className="admin-excel-totals"><strong>{plan.counts.adds}</strong> to add <span>·</span> <strong>{plan.counts.updates}</strong> to update <span>·</span> <strong>{plan.counts.skips}</strong> unchanged</p>
          <div className="admin-excel-table-wrap"><table className="admin-excel-table"><caption>Changes by workbook sheet</caption><thead><tr><th scope="col">Sheet</th><th scope="col">Add</th><th scope="col">Update</th><th scope="col">Unchanged</th></tr></thead><tbody>{plan.sheets.map(sheet => <tr key={sheet.name}><th scope="row">{sheet.name}</th><td>{sheet.adds}</td><td>{sheet.updates}</td><td>{sheet.unchanged}</td></tr>)}</tbody></table></div>
          {plan.errors.length > 0 ? <section className="admin-excel-issues" aria-labelledby="excel-issues-title"><header><AlertCircle size={20} /><div><h3 id="excel-issues-title">Fix {plan.errors.length} {plan.errors.length === 1 ? "issue" : "issues"} before importing.</h3><p>Correct these cells in Excel, save the workbook, then choose the updated file. No records have been changed.</p></div></header><ol>{plan.errors.slice(0, MAX_VISIBLE_ERRORS).map((issue, index) => <li key={`${issue.sheet}-${issue.row}-${issue.field}-${index}`}><span>{issue.sheet} <i> / </i> {issue.row > 0 ? `Row ${issue.row}` : "Sheet setup"}{issue.field ? ` / ${issue.field}` : ""}</span><p>{issue.message}</p></li>)}</ol>{plan.errors.length > MAX_VISIBLE_ERRORS && <p className="admin-excel-more">Showing the first {MAX_VISIBLE_ERRORS} issues. Correct them and recheck the workbook to see the remaining {plan.errors.length - MAX_VISIBLE_ERRORS}.</p>}</section> : changes > 0 ? <p className="admin-excel-ready"><Check size={17} /> Your workbook is ready for review and import.</p> : <p className="admin-excel-ready"><Check size={17} /> There are no additions or updates to apply.</p>}
          {plan.changes.length > 0 && <details className="admin-excel-change-list"><summary><span>Review individual rows</span><ChevronDown size={16} /></summary><ol>{plan.changes.slice(0, visibleChanges).map((change, index) => <li key={`${change.sheet}-${change.row}-${index}`}><span className={`admin-excel-action is-${change.action}`}>{change.action === "add" ? "Add" : change.action === "update" ? "Update" : "Unchanged"}</span><div><strong>{change.label}</strong><small>{change.sheet} · Row {change.row}</small>{change.fields && change.fields.length > 0 && <dl className="admin-excel-field-changes">{change.fields.map(field => <div key={field.field}><dt>{field.field}</dt><dd><span>Current</span><p>{field.before || "Not set"}</p></dd><dd><span>After import</span><p>{field.after || "Not set"}</p></dd></div>)}</dl>}</div></li>)}</ol>{plan.changes.length > visibleChanges && <div className="admin-excel-more"><p>Showing {visibleChanges} of {plan.changes.length} rows. Sheet counts include the full workbook.</p><button type="button" className="admin-text-button" onClick={() => setVisibleChanges(count => count + MAX_VISIBLE_CHANGES)}>Show more rows <ChevronDown size={14} /></button></div>}</details>}
        </>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {!plan && <p className="admin-form-intro">Start with the BOOKENDS Excel template and keep its sheet names and column headers. Choose an .xlsx workbook up to 5 MB.</p>}
        <form id={confirmFormId} className="admin-form admin-excel-confirm" onSubmit={event => { event.preventDefault(); void apply(); }}>
          {plan && !plan.errors.length && changes > 0 && <label className="admin-checkbox"><input type="checkbox" checked={confirmed} disabled={applying} onChange={event => setConfirmed(event.target.checked)} required /><span>{storageMode === "shared" ? "I reviewed these additions and updates. Apply them to the shared workspace." : "I reviewed these additions and updates. Apply them to the setup saved in this browser."}</span></label>}
          <p className="admin-excel-local-note">{storageMode === "shared" ? "The workbook is read in this browser. Only the reviewed setup records are saved to the shared workspace when you apply." : "Your workbook is processed in this browser. Nothing is uploaded or shared."}</p>
          </form><div className="admin-form-footer admin-excel-footer"><button type="button" className="admin-button admin-secondary" disabled={applying} onClick={() => fileRef.current?.click()}><Upload size={15} /> Choose another file</button><button form={confirmFormId} type="submit" className="admin-button admin-primary" disabled={!plan || plan.errors.length > 0 || !confirmed || !changes || applying}>{applying ? "Applying import…" : "Apply import"}<ArrowRight size={15} /></button></div>
      </>}
    </SpreadsheetDialog>}
  </>;
}

function SpreadsheetDialog({ children, onClose, busy }: { children: React.ReactNode; onClose: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const active = document.activeElement as HTMLElement | null; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); requestAnimationFrame(() => active?.focus()); }; }, []);
  return <dialog ref={ref} className="admin-dialog admin-local-import admin-excel-import" aria-labelledby="excel-review-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><header><div><p className="admin-eyebrow">EXCEL / BULK SETUP</p><h2 id="excel-review-title">Review your spreadsheet.</h2></div><button className="admin-icon-button" aria-label="Close Excel review" disabled={busy} onClick={onClose}><X size={21} /></button></header><div className="admin-dialog-body">{children}</div></dialog>;
}
