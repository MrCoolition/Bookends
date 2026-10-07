"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, ArrowLeft, Check, Download, Monitor, RefreshCw, Upload, X } from "lucide-react";
import { AdminWorkspace } from "./admin-workspace";
import { AdminSpreadsheetImport } from "./admin-spreadsheet-import";
import type { SpreadsheetImportPlan } from "@/lib/admin/spreadsheet";
import { applyLocalAdminCommand, createLocalAdminStore, parseLocalAdminStore, LocalAdminError, MAX_LOCAL_ADMIN_BYTES, type LocalAdminCommand, type LocalAdminStore } from "@/lib/admin/local";
import { seedLocalAdminClients } from "@/lib/admin/client-seed";

const STORAGE_KEY = "bookends.local-admin.v1";
const LOCK_NAME = "bookends.local-admin.write.v1";
const MAX_BACKUP_BYTES = MAX_LOCAL_ADMIN_BYTES;
type BackupReview = { store: LocalAdminStore; name: string; expectedRaw: string | null; startingClientsAdded: number };
class LocalConflict extends Error { readonly code = "conflict"; }
function errorText(error: unknown) { return error instanceof Error && error.message.length <= 400 ? error.message : "This change couldn’t be saved. Your current setup has not been replaced."; }
function savedRaw() {
  try { return window.localStorage.getItem(STORAGE_KEY); }
  catch { throw new Error("Browser storage is unavailable. Allow storage for this site to save your setup."); }
}
function readSaved(raw: string | null) {
  if (raw === null) throw new LocalConflict("The saved setup was removed in another tab. Export your open setup or reload this page before continuing.");
  try { return parseLocalAdminStore(JSON.parse(raw)); }
  catch { throw new Error("The saved setup could not be read. It has not been overwritten. Import a valid backup to recover it."); }
}
async function withWriteLock<T>(action: () => T): Promise<T> {
  if (!navigator.locks) throw new Error("This browser cannot coordinate safe setup saves. Open BOOKENDS in a current browser over HTTPS or localhost. Existing data can still be exported.");
  return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, action);
}
function persist(store: LocalAdminStore) {
  const raw = JSON.stringify(store);
  try { window.localStorage.setItem(STORAGE_KEY, raw); }
  catch { throw new Error("Your browser couldn’t save this change. Storage may be full or blocked. Your inputs are still here; export a backup before changing browser settings."); }
  if (savedRaw() !== raw) throw new LocalConflict("Another tab changed setup while it was saving. Refresh to review the saved version.");
  return raw;
}

export function LocalAdminWorkspace() {
  const [store, setStore] = useState<LocalAdminStore | null>(null);
  const storeRef = useRef<LocalAdminStore | null>(null);
  const rawRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [backup, setBackup] = useState<BackupReview | null>(null);
  const [backupError, setBackupError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const writeBusy = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const spreadsheetReview = useRef<{ plan: SpreadsheetImportPlan; expectedRaw: string } | null>(null);
  const spreadsheetAttempt = useRef(0);
  const accept = (next: LocalAdminStore, raw: string) => { storeRef.current = next; rawRef.current = raw; setStore(next); setChangedElsewhere(false); setLoadError(""); };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        let raw = savedRaw();
        let next = raw === null ? null : readSaved(raw);
        if (!next || next.clientSeedVersion !== 1) {
          const initialized = await withWriteLock(() => {
            const existingRaw = savedRaw();
            const existing = existingRaw === null ? createLocalAdminStore() : readSaved(existingRaw);
            try {
              const seeded = seedLocalAdminClients(existing);
              return { store: seeded, raw: existingRaw === null || seeded.revision !== existing.revision ? persist(seeded) : existingRaw, notice: "" };
            } catch (error) {
              if (existingRaw !== null && error instanceof LocalAdminError && ["client_seed_limit", "too_large"].includes(error.code)) {
                return { store: existing, raw: existingRaw, notice: "Your saved setup is open, but the starting clients could not be added because it is at the browser storage limit. Export a backup before making space." };
              }
              throw error;
            }
          });
          next = initialized.store; raw = initialized.raw;
          if (active) setNotice(initialized.notice);
        }
        if (active) accept(next, raw!);
      } catch (error) { if (active) setLoadError(errorText(error)); }
    };
    void load();
    const changed = (event: StorageEvent) => { if ((event.key === STORAGE_KEY || event.key === null) && event.newValue !== rawRef.current) setChangedElsewhere(true); };
    window.addEventListener("storage", changed);
    return () => { active = false; window.removeEventListener("storage", changed); };
  }, [loadAttempt]);

  const save = async (command: LocalAdminCommand) => {
    const current = storeRef.current; const expectedRaw = rawRef.current;
    if (!current) throw new Error("Your browser setup is still loading. Please try again.");
    if (writeBusy.current) throw new Error("Another change is being saved. Please try again in a moment.");
    writeBusy.current = true; setBusy(true);
    try {
      return await withWriteLock(() => {
        const actualRaw = savedRaw();
        if (actualRaw !== expectedRaw) { setChangedElsewhere(true); throw new LocalConflict("Another tab changed your setup. Refresh records, then review your preserved draft before saving."); }
        const saved = readSaved(actualRaw);
        if (saved.revision !== current.revision) throw new LocalConflict("The saved setup changed. Refresh before saving your draft.");
        const next = applyLocalAdminCommand(saved, command);
        accept(next, persist(next));
        return next.data;
      });
    } finally { writeBusy.current = false; setBusy(false); }
  };
  const refresh = async () => { const raw = savedRaw(); const next = readSaved(raw); accept(next, raw!); return next.data; };
  const exportBackup = () => {
    setBackupError("");
    try {
      if (!storeRef.current) throw new Error("No readable setup is open to export.");
      const blob = new Blob([JSON.stringify(storeRef.current)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `bookends-setup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Backup exported for the setup currently open in this tab.");
    } catch (error) { setBackupError(errorText(error)); }
  };
  const chooseBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setBackupError(""); setNotice("");
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("Choose a BOOKENDS backup smaller than 4 MB.");
      const parsed = parseLocalAdminStore(JSON.parse(await file.text()));
      const candidate = seedLocalAdminClients(parsed);
      const expectedRaw = savedRaw();
      if (storeRef.current && expectedRaw !== rawRef.current) { setChangedElsewhere(true); throw new LocalConflict("Another tab changed this setup. Refresh to review it, then choose your backup again."); }
      setBackup({ store: candidate, name: file.name, expectedRaw, startingClientsAdded: candidate.data.clients.length - parsed.data.clients.length });
    } catch (error) { setBackupError(error instanceof LocalConflict ? error.message : "This file is not a valid BOOKENDS setup backup. Your saved setup has not changed."); }
  };
  const replaceWithBackup = async () => {
    if (!backup || writeBusy.current) return;
    writeBusy.current = true; setBusy(true); setBackupError("");
    try {
      await withWriteLock(() => {
        const currentRaw = savedRaw();
        if (currentRaw !== backup.expectedRaw) throw new LocalConflict("Setup changed after this backup was selected. Close this review, refresh, and choose the backup again before replacing anything.");
        let revision = 0;
        if (currentRaw !== null) { try { revision = readSaved(currentRaw).revision; } catch { /* Explicit reviewed import can recover an unreadable store. */ } }
        const next = parseLocalAdminStore({ ...backup.store, revision: Math.max(revision, backup.store.revision) + 1 });
        accept(next, persist(next));
      });
      setBackup(null); setNotice("Backup imported. This browser’s setup has been replaced.");
    } catch (error) { setBackupError(errorText(error)); }
    finally { writeBusy.current = false; setBusy(false); }
  };

  const previewSpreadsheet = async (file: File) => {
    const attempt = ++spreadsheetAttempt.current;
    const current = storeRef.current; const expectedRaw = rawRef.current;
    spreadsheetReview.current = null;
    if (!current || expectedRaw === null) throw new Error("Open your saved setup before importing Excel.");
    if (savedRaw() !== expectedRaw) { setChangedElsewhere(true); throw new LocalConflict("Another tab changed your setup. Close this review, refresh your records, then choose the workbook again."); }
    const { readSpreadsheetFile, planSpreadsheetImport } = await import("@/lib/admin/spreadsheet");
    const workbook = await readSpreadsheetFile(file);
    const plan = planSpreadsheetImport(current, workbook);
    if (attempt !== spreadsheetAttempt.current) throw new Error("This review was closed. Choose a workbook to begin again.");
    if (savedRaw() !== expectedRaw || rawRef.current !== expectedRaw) { setChangedElsewhere(true); throw new LocalConflict("Your setup changed while the workbook was being checked. Close this review, refresh, and choose the workbook again."); }
    spreadsheetReview.current = { plan, expectedRaw };
    return plan;
  };
  const applySpreadsheet = async (plan: SpreadsheetImportPlan) => {
    const review = spreadsheetReview.current;
    if (!review || review.plan !== plan) throw new Error("Choose your workbook again to prepare a current import review.");
    if (plan.errors.length) throw new Error("Correct the workbook issues before applying this import.");
    if (writeBusy.current) throw new Error("Another change is being saved. Please try again in a moment.");
    writeBusy.current = true; setBusy(true);
    try {
      const { applySpreadsheetImport } = await import("@/lib/admin/spreadsheet");
      await withWriteLock(() => {
        const currentRaw = savedRaw();
        if (currentRaw !== review.expectedRaw) { setChangedElsewhere(true); throw new LocalConflict("Setup changed after this workbook was reviewed. Close this review, refresh, and choose the workbook again. Nothing from this import was saved."); }
        const next = applySpreadsheetImport(readSaved(currentRaw), plan);
        accept(next, persist(next));
      });
      spreadsheetReview.current = null;
      setNotice(`Excel import saved in this browser: ${plan.counts.adds} added, ${plan.counts.updates} updated, ${plan.counts.skips} unchanged.`);
    } finally { writeBusy.current = false; setBusy(false); }
  };

  const controls = <section className="admin-local-bar" aria-label="Browser-local setup"><div className="admin-local-label"><Monitor size={19} /><div><strong>Open setup <span aria-hidden="true">•</span> {store ? "Saved in this browser" : "Browser storage"}</strong><p>These records stay in this browser. They are not shared or connected to company sign-in.</p></div></div><AdminSpreadsheetImport disabled={!store || busy} onPreview={previewSpreadsheet} onApply={applySpreadsheet} onDiscard={() => { spreadsheetAttempt.current++; spreadsheetReview.current = null; }} /><div className="admin-local-actions admin-local-backups"><span>JSON backup</span><button className="admin-button admin-secondary" onClick={exportBackup} disabled={!store || busy}><Download size={15} /> Export setup</button><button className="admin-button admin-secondary" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15} /> Import setup</button><input ref={fileRef} className="admin-local-file" type="file" accept="application/json,.json" aria-label="Choose a BOOKENDS backup" onChange={event => void chooseBackup(event)} /></div>{changedElsewhere && <p className="admin-local-warning" role="status"><AlertCircle size={15} /> Another tab changed this setup. Use Refresh to load it; your open draft stays in place for review.</p>}{backupError && !backup && <p className="admin-error" role="alert">{backupError}</p>}{notice && <p className="admin-local-notice" role="status"><Check size={14} />{notice}</p>}</section>;

  return <>{store ? <AdminWorkspace initialData={store.data} localTransport={{ save, refresh }} localControls={controls} /> : <div className="admin-workspace admin-local-loading"><header className="admin-topbar"><a className="admin-brand" href="/"><span>[<i />]</span> BOOKENDS</a><div><a href="/" className="admin-back"><ArrowLeft size={15} /> Back to app</a></div></header>{controls}<main className="admin-main"><h1>Administration</h1>{loadError ? <><p className="admin-error" role="alert">{loadError}</p><button className="admin-button admin-primary" onClick={() => { setLoadError(""); setLoadAttempt(value => value + 1); }}><RefreshCw size={16} /> Try opening setup again</button></> : <p role="status">Opening your saved browser setup…</p>}</main></div>}{backup && <BackupDialog backup={backup} current={store} busy={busy} error={backupError} onClose={() => { if (!busy) { setBackup(null); setBackupError(""); } }} onReplace={() => void replaceWithBackup()} />}</>;
}

function BackupDialog({ backup, current, busy, error, onClose, onReplace }: { backup: BackupReview; current: LocalAdminStore | null; busy: boolean; error: string; onClose: () => void; onReplace: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { const active = document.activeElement as HTMLElement | null; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); requestAnimationFrame(() => active?.focus()); }; }, []);
  const collections = [{ key: "clients" as const, label: "Clients" }, { key: "homes" as const, label: "HOMEs" }, { key: "resources" as const, label: "People" }, { key: "missions" as const, label: "Engagements" }, { key: "capabilities" as const, label: "Roles & skills" }, { key: "templates" as const, label: "Playbooks" }, { key: "members" as const, label: "Members" }];
  return <dialog ref={ref} className="admin-dialog admin-local-import" aria-labelledby="backup-review-title" onCancel={event => { event.preventDefault(); onClose(); }}><header><div><p className="admin-eyebrow">BACKUP REVIEW</p><h2 id="backup-review-title">Review before replacing.</h2></div><button className="admin-icon-button" aria-label="Close backup review" disabled={busy} onClick={onClose}><X size={20} /></button></header><div className="admin-dialog-body"><p className="admin-form-intro">Importing <strong>{backup.name}</strong> replaces this browser’s entire setup. It does not merge records or upload them to a server.</p>{backup.startingClientsAdded > 0 && <p className="admin-form-intro">This older backup will also include {backup.startingClientsAdded} missing starting clients from your company list.</p>}<div className="admin-import-organization"><span>Workspace in this backup</span><strong>{backup.store.data.organization.name}</strong></div><p className="admin-import-caption">Currently open <span aria-hidden="true">→</span> After restore</p><dl className="admin-import-counts">{collections.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{current?.data[key]?.length ?? 0} <span aria-hidden="true">→</span> <strong>{backup.store.data[key]?.length ?? 0}</strong></dd></div>)}</dl><form className="admin-form" onSubmit={event => { event.preventDefault(); if (confirmed) onReplace(); }}><label className="admin-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={busy} /><span>I understand this replaces the saved setup in this browser. I have exported anything I want to keep.</span></label>{error && <p className="admin-error" role="alert">{error}</p>}<div className="admin-form-footer"><button type="button" className="admin-button admin-secondary" disabled={busy} onClick={onClose}>Keep current setup</button><button className="admin-button admin-primary" disabled={!confirmed || busy}>{busy ? "Replacing…" : "Replace browser setup"}<Upload size={15} /></button></div></form></div></dialog>;
}
