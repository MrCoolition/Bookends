"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Check, Cloud, Download, LockKeyhole, LogOut, MoreHorizontal, RefreshCw, Upload, X } from "lucide-react";
import type { AdminBootstrap } from "@/lib/admin/contracts";
import { MAX_LOCAL_ADMIN_BYTES, parseLocalAdminStore, type LocalAdminCommand, type LocalAdminStore } from "@/lib/admin/local";
import { STARTING_CLIENTS } from "@/lib/admin/client-seed";
import type { SpreadsheetImportPlan } from "@/lib/admin/spreadsheet";
import { AdminWorkspace } from "./admin-workspace";
import { AdminSpreadsheetImport } from "./admin-spreadsheet-import";
import { TeamStudio } from "./team-studio";

const BROWSER_KEY = "bookends.local-admin.v1";
const COLLECTIONS = [{ key: "clients", label: "Clients" }, { key: "homes", label: "HOMEs" }, { key: "resources", label: "People" }, { key: "missions", label: "Engagements" }, { key: "capabilities", label: "Roles & skills" }, { key: "templates", label: "Playbooks" }, { key: "members", label: "Planning members" }] as const;
type BackupReview = { store: LocalAdminStore; name: string; expectedRevision: number; fromBrowser: boolean };
class SharedRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); }
}
function errorText(error: unknown) { return error instanceof Error && error.message.length <= 600 ? error.message : "We couldn’t finish that change. Your entered details are still here."; }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", ...init?.headers } }); }
  catch { throw new SharedRequestError("connection", "The connection was interrupted. Refresh the saved records before retrying; your draft is still here."); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new SharedRequestError(payload?.error?.code ?? "unavailable", payload?.error?.message ?? "The shared workspace is temporarily unavailable. Please try again.", response.status);
  return payload as T;
}
function meaningfulBrowserSetup(store: LocalAdminStore): boolean {
  const data = store.data;
  return data.homes.length > 0 || data.resources.length > 0 || data.missions.length > 0 || Boolean(data.capabilities?.length) || data.members.length > 1 || data.members.some(member => member.revision > 1) || data.templates.some(template => template.persisted) || data.organization.name !== "BOOKENDS workspace" || data.clients.some(client => {
    const seed = STARTING_CLIENTS.find(item => item.code === client.code && item.name === client.name);
    return !seed || !client.active || Boolean(client.contactName || client.contactEmail || client.notes);
  });
}
function readBrowserSetup(): LocalAdminStore | null {
  try { const raw = window.localStorage.getItem(BROWSER_KEY); return raw ? parseLocalAdminStore(raw) : null; } catch { return null; }
}

export function SharedWorkspace({ view = "admin" }: { view?: "admin" | "studio" }) {
  const [store, setStore] = useState<LocalAdminStore | null>(null);
  const storeRef = useRef<LocalAdminStore | null>(null);
  const [loading, setLoading] = useState(true), [locked, setLocked] = useState(false), [configured, setConfigured] = useState(true);
  const [loadError, setLoadError] = useState(""), [conflict, setConflict] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [backup, setBackup] = useState<BackupReview | null>(null), [backupError, setBackupError] = useState(""), [hasBrowserSetup, setHasBrowserSetup] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null), writeBusy = useRef(false), mounted = useRef(true);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const spreadsheetReview = useRef<{ plan: SpreadsheetImportPlan; baseline: LocalAdminStore; candidate?: LocalAdminStore } | null>(null);
  const pendingKeys = useRef(new Map<string, string>());
  const spreadsheetAttempt = useRef(0);
  const accept = useCallback((next: LocalAdminStore) => {
    // A refresh started before a save must not put its older response back on screen.
    if (storeRef.current && next.revision < storeRef.current.revision) return storeRef.current;
    storeRef.current = next; setStore(next); setLoadError(""); setConflict(false); return next;
  }, []);
  const handleError = useCallback((error: unknown) => {
    if (error instanceof SharedRequestError && error.status === 401) setLocked(true);
    if (error instanceof SharedRequestError && (error.status === 409 || error.code === "connection")) setConflict(true);
  }, []);
  const loadStore = useCallback(async (): Promise<AdminBootstrap> => {
    try { const next = parseLocalAdminStore(await request<LocalAdminStore>("/api/shared/admin")); return (mounted.current ? accept(next) : next).data; }
    catch (error) { if (mounted.current) handleError(error); throw error; }
  }, [accept, handleError]);
  useEffect(() => {
    mounted.current = true;
    const browserSetup = readBrowserSetup();
    setHasBrowserSetup(Boolean(browserSetup && meaningfulBrowserSetup(browserSetup)));
    void request<{ authenticated: boolean; configured: boolean }>("/api/shared/session").then(async session => {
      if (!mounted.current) return;
      setConfigured(session.configured); setLocked(!session.authenticated);
      if (session.authenticated) await loadStore();
    }).catch(error => { if (mounted.current) { handleError(error); setLoadError(errorText(error)); } }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [handleError, loadStore]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { const menu = optionsRef.current; if (menu?.open && !menu.contains(event.target as Node)) menu.open = false; };
    const escape = (event: KeyboardEvent) => { const menu = optionsRef.current; if (event.key === "Escape" && menu?.open) { event.preventDefault(); menu.open = false; menu.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const closeOptions = () => { const menu = optionsRef.current; if (menu) { menu.open = false; menu.querySelector("summary")?.focus(); } };

  const save = async (command: LocalAdminCommand) => {
    const current = storeRef.current;
    if (!current) throw new Error("Open the shared workspace before saving.");
    if (writeBusy.current) throw new Error("Another change is being saved. Please try again in a moment.");
    const fingerprint = `command:${JSON.stringify(command)}`;
    const idempotencyKey = pendingKeys.current.get(fingerprint) ?? crypto.randomUUID();
    pendingKeys.current.set(fingerprint, idempotencyKey);
    writeBusy.current = true; setBusy(true);
    try {
      const next = parseLocalAdminStore(await request<LocalAdminStore>("/api/shared/admin", { method: "POST", body: JSON.stringify({ expectedRevision: current.revision, idempotencyKey, command }) }));
      pendingKeys.current.delete(fingerprint); accept(next); return next.data;
    } catch (error) {
      if (error instanceof SharedRequestError && error.status >= 400 && error.status < 500 && ![401, 409, 429].includes(error.status)) pendingKeys.current.delete(fingerprint);
      handleError(error); throw error;
    }
    finally { writeBusy.current = false; setBusy(false); }
  };
  const replace = async (candidate: LocalAdminStore, expectedRevision: number) => {
    const fingerprint = `replace:${JSON.stringify(candidate)}`;
    const idempotencyKey = pendingKeys.current.get(fingerprint) ?? crypto.randomUUID();
    pendingKeys.current.set(fingerprint, idempotencyKey);
    try {
      const next = parseLocalAdminStore(await request<LocalAdminStore>("/api/shared/admin", { method: "PUT", body: JSON.stringify({ expectedRevision, idempotencyKey, store: candidate }) }));
      pendingKeys.current.delete(fingerprint); accept(next);
    } catch (error) {
      if (error instanceof SharedRequestError && error.status >= 400 && error.status < 500 && ![401, 409, 429].includes(error.status)) pendingKeys.current.delete(fingerprint);
      throw error;
    }
  };
  const unlock = async (passcode: string) => {
    await request("/api/shared/session", { method: "POST", body: JSON.stringify({ passcode }) });
    await loadStore(); setLocked(false); setNotice("");
  };
  const signOut = async () => {
    if (writeBusy.current) return;
    try {
      await request("/api/shared/session", { method: "DELETE" });
      storeRef.current = null; setStore(null); setBackup(null); spreadsheetReview.current = null; pendingKeys.current.clear(); setLocked(true); setNotice(""); setLoadError("");
    } catch (error) { handleError(error); setLoadError(errorText(error)); }
  };
  const exportBackup = () => {
    if (!storeRef.current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(storeRef.current)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `bookends-shared-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Exported a backup of the shared revision currently open.");
  };
  const chooseBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !storeRef.current) return;
    const expectedRevision = storeRef.current.revision; setBackupError("");
    try {
      if (file.size > MAX_LOCAL_ADMIN_BYTES) throw new Error("Choose a BOOKENDS setup backup smaller than 4 MB.");
      const candidate = parseLocalAdminStore(await file.text());
      setBackup({ store: candidate, name: file.name, expectedRevision, fromBrowser: false });
    } catch (error) { setBackupError(error instanceof Error && error.message.includes("4 MB") ? error.message : "This is not a valid BOOKENDS setup backup. The shared workspace has not changed."); }
  };
  const reviewBrowserSetup = () => {
    const candidate = readBrowserSetup();
    if (!candidate || !storeRef.current) { setBackupError("The earlier browser setup could not be read. It has not been changed."); return; }
    setBackupError(""); setBackup({ store: candidate, name: "Your earlier browser setup", expectedRevision: storeRef.current.revision, fromBrowser: true });
  };
  const restoreBackup = async () => {
    if (!backup || writeBusy.current) return;
    writeBusy.current = true; setBusy(true); setBackupError("");
    try { await replace(backup.store, backup.expectedRevision); setBackup(null); setHasBrowserSetup(false); setNotice("Shared setup restored. The earlier browser copy remains untouched."); }
    catch (error) { handleError(error); setBackupError(errorText(error)); }
    finally { writeBusy.current = false; setBusy(false); }
  };
  const previewSpreadsheet = async (file: File) => {
    const attempt = ++spreadsheetAttempt.current, current = storeRef.current;
    if (!current) throw new Error("Open the shared workspace before importing Excel.");
    spreadsheetReview.current = null;
    const { readSpreadsheetFile, planSpreadsheetImport } = await import("@/lib/admin/spreadsheet");
    const workbook = await readSpreadsheetFile(file), plan = planSpreadsheetImport(current, workbook);
    if (attempt !== spreadsheetAttempt.current) throw new Error("This review was closed. Choose a workbook to begin again.");
    if (storeRef.current?.revision !== current.revision) throw new Error("The workspace changed while Excel was being checked. Choose the workbook again to review current changes.");
    spreadsheetReview.current = { plan, baseline: current }; return plan;
  };
  const applySpreadsheet = async (plan: SpreadsheetImportPlan) => {
    const review = spreadsheetReview.current;
    if (!review || review.plan !== plan) throw new Error("Choose the workbook again to prepare a current import review.");
    if (plan.errors.length) throw new Error("Correct the workbook issues before applying this import.");
    if (writeBusy.current) throw new Error("Another change is being saved. Please try again in a moment.");
    writeBusy.current = true; setBusy(true);
    try {
      const { applySpreadsheetImport } = await import("@/lib/admin/spreadsheet");
      review.candidate ??= applySpreadsheetImport(review.baseline, plan);
      await replace(review.candidate, review.baseline.revision);
      spreadsheetReview.current = null; setNotice(`Shared Excel import saved: ${plan.counts.adds} added, ${plan.counts.updates} updated, ${plan.counts.skips} unchanged.`);
    } catch (error) { handleError(error); throw error; }
    finally { writeBusy.current = false; setBusy(false); }
  };
  const refreshVisible = async () => { try { await loadStore(); setNotice("Latest shared records loaded. Your open draft is still here for review."); } catch (error) { setLoadError(errorText(error)); } };

  const controls = <section className="shared-controls" aria-label="Shared workspace controls">
    <div className="shared-toolbar">
      <div className="shared-toolbar-status" title={`Shared workspace · revision ${store?.revision}`}><Cloud size={17}/><span>Shared<span className="shared-status-detail"> workspace</span></span>{busy && <small role="status">Saving…</small>}</div>
      <div className="shared-toolbar-actions"><AdminSpreadsheetImport compact storageMode="shared" disabled={!store || busy || locked} onPreview={previewSpreadsheet} onApply={applySpreadsheet} onDiscard={() => { spreadsheetAttempt.current++; spreadsheetReview.current = null; }} />
        <details ref={optionsRef} className="shared-options"><summary aria-label="Workspace options" title="Workspace options"><MoreHorizontal size={20}/></summary><div className="shared-options-panel"><p>Shared workspace <span>Revision {store?.revision}</span></p><button onClick={() => { closeOptions(); exportBackup(); }} disabled={!store || busy}><Download size={16}/> Export setup</button><button onClick={() => { closeOptions(); fileRef.current?.click(); }} disabled={busy}><Upload size={16}/> Restore backup</button><button onClick={() => { closeOptions(); void refreshVisible(); }} disabled={busy}><RefreshCw size={16}/> Refresh shared records</button>{hasBrowserSetup && <button onClick={() => { closeOptions(); reviewBrowserSetup(); }} disabled={busy}><ArrowRight size={16}/> Review earlier browser setup</button>}<button className="shared-options-lock" onClick={() => { closeOptions(); void signOut(); }} disabled={busy}><LogOut size={16}/> Lock workspace</button></div></details>
      </div>
    </div>
    <input ref={fileRef} className="admin-local-file" type="file" accept="application/json,.json" aria-label="Choose a BOOKENDS backup" onChange={event => void chooseBackup(event)} />
    {hasBrowserSetup && <div className="shared-toolbar-message shared-migration"><span>Your earlier browser setup is still here.</span><button className="admin-text-button" onClick={reviewBrowserSetup} disabled={busy}>Review for sharing <ArrowRight size={15} /></button></div>}
    {conflict && <div className="shared-toolbar-message shared-conflict" role="status"><AlertCircle size={16}/><span>The workspace changed. Your draft is still here.</span><button onClick={() => void refreshVisible()} disabled={busy}>Refresh shared records <RefreshCw size={13}/></button></div>}
    {loadError && <p className="shared-toolbar-message admin-error" role="alert">{loadError}</p>}{backupError && !backup && <p className="shared-toolbar-message admin-error" role="alert">{backupError}</p>}
  </section>;

  return <>
    {store ? <div className={locked ? "shared-preserved-draft" : undefined} inert={locked} aria-hidden={locked || undefined}>
      {view === "studio" ? <>{controls}<TeamStudio data={store.data} save={save} refresh={loadStore} onSignOut={() => void signOut()} /></> : <AdminWorkspace initialData={store.data} localTransport={{ save, refresh: loadStore }} localControls={controls} storageMode="shared" />}
      {notice && <div className="shared-toast" role="status"><Check size={17}/><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16}/></button></div>}
      {backup && <SharedBackupDialog review={backup} current={store} busy={busy} error={backupError} onClose={() => { if (!busy) { setBackup(null); setBackupError(""); } }} onRestore={() => void restoreBackup()} />}
    </div> : !locked ? <main className="shared-gate"><a className="shared-wordmark" href="/">[·] BOOKENDS</a><div className="shared-gate-card"><Cloud size={30} /><h1>{loading ? "Opening your workspace." : "Let’s reconnect."}</h1><p role={loadError ? "alert" : "status"}>{loadError || "Bringing your people and possibilities together…"}</p>{!loading && <button className="admin-button admin-primary" onClick={() => void refreshVisible()}><RefreshCw size={16} /> Try again</button>}</div></main> : null}
    {locked && <UnlockWorkspace configured={configured} preserved={!!store} onUnlock={unlock} />}
  </>;
}

function UnlockWorkspace({ configured, preserved, onUnlock }: { configured: boolean; preserved: boolean; onUnlock: (passcode: string) => Promise<void> }) {
  const [passcode, setPasscode] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null), inputRef = useRef<HTMLInputElement>(null), submitting = useRef(false);
  useEffect(() => { const dialog = dialogRef.current; if (preserved) dialog?.showModal(); inputRef.current?.focus(); return () => dialog?.close(); }, [preserved]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (submitting.current || !configured || !passcode) return;
    submitting.current = true; setBusy(true); setError("");
    try { await onUnlock(passcode); setPasscode(""); } catch (caught) { setError(errorText(caught)); }
    finally { submitting.current = false; setBusy(false); }
  };
  const content = <div className="shared-gate-card"><div className="shared-gate-kicker"><LockKeyhole size={16} /> YOUR PEOPLE. YOUR POSSIBILITIES.</div><h1 id="shared-unlock-title">Great teams<br /><em>start here.</em></h1><p>{!configured ? "The shared workspace needs its connection settings before it can open." : preserved ? "Your session ended. Unlock to continue with your draft right where you left it." : "Unlock your shared workspace to build what’s next."}</p>{configured && <form onSubmit={event => void submit(event)}><label htmlFor="workspace-passcode">Workspace passcode</label><input id="workspace-passcode" ref={inputRef} type="password" value={passcode} onChange={event => setPasscode(event.target.value)} required maxLength={256} autoComplete="current-password" disabled={busy} />{error && <p className="admin-error" role="alert">{error}</p>}<button className="admin-button admin-primary" disabled={busy || !passcode}>{busy ? "Opening…" : "Enter workspace"}<ArrowRight size={18} /></button></form>}<span className="shared-gate-footer"><Cloud size={15} /> One place for your clients, people, and team plans.</span></div>;
  return preserved ? <dialog ref={dialogRef} className="shared-unlock-dialog" aria-labelledby="shared-unlock-title" onCancel={event => event.preventDefault()}>{content}</dialog> : <main className="shared-gate"><a className="shared-wordmark" href="/">[·] BOOKENDS</a>{content}<div className="shared-gate-orbit" aria-hidden="true"><span>01 / THE WORK</span><span>02 / THE PEOPLE</span><span>03 / WHAT’S NEXT</span></div></main>;
}

function SharedBackupDialog({ review, current, busy, error, onClose, onRestore }: { review: BackupReview; current: LocalAdminStore; busy: boolean; error: string; onClose: () => void; onRestore: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { const active = document.activeElement as HTMLElement | null; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); active?.focus(); }; }, []);
  return <dialog ref={ref} className="admin-dialog admin-local-import" aria-labelledby="shared-backup-title" onCancel={event => { event.preventDefault(); onClose(); }}><header><div><p className="admin-eyebrow">SHARED SETUP REVIEW</p><h2 id="shared-backup-title">Review the whole picture.</h2></div><button className="admin-icon-button" aria-label="Close backup review" onClick={onClose} disabled={busy}><X size={20} /></button></header><div className="admin-dialog-body"><p className="admin-form-intro">Restoring <strong>{review.name}</strong> replaces the entire shared setup for everyone. It does not merge records.{review.fromBrowser ? " The earlier browser copy will stay untouched." : " Export the current shared setup first if you want to keep a copy."}</p><div className="admin-import-organization"><span>Workspace after restore</span><strong>{review.store.data.organization.name}</strong></div><p className="admin-import-caption">Shared now <span aria-hidden="true">→</span> After restore</p><dl className="admin-import-counts">{COLLECTIONS.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{current.data[key]?.length ?? 0} <span aria-hidden="true">→</span> <strong>{review.store.data[key]?.length ?? 0}</strong></dd></div>)}</dl><form className="admin-form" onSubmit={event => { event.preventDefault(); if (confirmed) onRestore(); }}><label className="admin-checkbox"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I understand this replaces the shared setup for everyone, and I have exported anything I want to keep.</span></label>{error && <p className="admin-error" role="alert">{error}</p>}<div className="admin-form-footer"><button type="button" className="admin-button admin-secondary" onClick={onClose} disabled={busy}>Keep shared setup</button><button className="admin-button admin-primary" disabled={!confirmed || busy}>{busy ? "Restoring…" : "Replace shared setup"}<Upload size={15} /></button></div></form></div></dialog>;
}
