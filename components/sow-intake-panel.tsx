"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, LoaderCircle, Paperclip, RotateCcw, ScanText, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import type { SowCapability, SowIntakeResult } from "@/lib/ai/contracts";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 60_000;
function failureMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || !("error" in value)) return fallback;
  if (typeof value.error === "string") return value.error;
  if (value.error && typeof value.error === "object" && "message" in value.error && typeof value.error.message === "string") return value.error.message;
  return fallback;
}

export function SowIntakePanel({ onDraft, onCancel, onSessionExpired }: { onDraft: (result: SowIntakeResult) => void; onCancel: () => void; onSessionExpired?: () => void }) {
  const id = useId(), fileInput = useRef<HTMLInputElement>(null), errorBox = useRef<HTMLDivElement>(null);
  const generation = useRef<AbortController | null>(null);
  const sessionExpired = useRef(onSessionExpired);
  const [mode, setMode] = useState<"file" | "text">("file"), [file, setFile] = useState<File | null>(null), [text, setText] = useState("");
  const [capability, setCapability] = useState<SowCapability | null>(null), [connectionError, setConnectionError] = useState(""), [connectionAttempt, setConnectionAttempt] = useState(0);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [dragging, setDragging] = useState(false), [elapsed, setElapsed] = useState(0);
  useEffect(() => { sessionExpired.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ai/sow", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.status === 401 && !controller.signal.aborted) sessionExpired.current?.();
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(failureMessage(value, "The SOW reader could not be reached. Try the connection again."));
      if (!value || typeof value !== "object" || !("available" in value) || typeof value.available !== "boolean") throw new Error("The SOW reader could not be reached. Try the connection again.");
      if (!controller.signal.aborted) { setCapability(value as SowCapability); setConnectionError(""); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setConnectionError(cause instanceof Error ? cause.message : "The SOW reader could not be reached. Try the connection again.");
    });
    return () => controller.abort();
  }, [connectionAttempt]);
  useEffect(() => () => generation.current?.abort(), []);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now(), timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  function chooseFile(candidate: File | undefined) {
    setDragging(false); if (!candidate || busy) return;
    setError("");
    if (!/\.(pdf|docx|txt)$/i.test(candidate.name)) { setError("Choose a PDF, DOCX, or TXT file. You can also paste your brief."); return; }
    if (!candidate.size) { setError("That file is empty. Choose a document with the work and team details."); return; }
    if (candidate.size > (capability?.maxFileBytes ?? MAX_FILE_BYTES)) { setError("That file is a little too big. Keep it under 3 MB, or paste the relevant sections."); return; }
    setFile(candidate);
  }
  function cancelReading() { generation.current?.abort(); generation.current = null; setBusy(false); setElapsed(0); }
  function leave() { cancelReading(); onCancel(); }
  function changeMode(next: "file" | "text") { if (!busy) { setMode(next); setError(""); } }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !capability?.available) return;
    if (mode === "file" && !file) { setError("Choose your SOW first, or switch to Paste a brief."); return; }
    if (mode === "text" && text.trim().length < 30) { setError("Add a few sentences about the work, team, and timeframe."); return; }
    if (mode === "text" && text.length > (capability.maxTextCharacters ?? MAX_TEXT_CHARACTERS)) { setError("Keep the brief below 60,000 characters. The relevant SOW sections work well."); return; }
    const controller = new AbortController(), body = new FormData(); generation.current = controller;
    if (mode === "file") body.set("file", file!); else body.set("text", text.trim());
    setError(""); setBusy(true); setElapsed(0);
    try {
      const response = await fetch("/api/ai/sow", { method: "POST", body, signal: controller.signal });
      if (response.status === 401 && !controller.signal.aborted) sessionExpired.current?.();
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(failureMessage(value, "The reader couldn't finish this document. Try again, paste the relevant text, or build your team directly."));
      if (!value || typeof value !== "object" || !("draftOnly" in value) || value.draftOnly !== true || !("draft" in value) || !value.draft) throw new Error("The reader couldn't produce a reviewable draft. Try a clearer brief.");
      if (!controller.signal.aborted) onDraft(value as SowIntakeResult);
    } catch (cause: unknown) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The document could not be read. Please try again.");
    } finally { if (generation.current === controller) { generation.current = null; setBusy(false); } }
  }
  const ready = capability?.available === true && !connectionError;
  const unavailable = connectionError || (capability?.available === false ? capability.reason || "SOW reading is not connected yet. You can still build your team directly." : "");
  const count = text.length.toLocaleString("en-US");

  return <section className="sow-panel" aria-labelledby={`${id}-heading`}>
    <div className="sow-topline"><button type="button" onClick={leave}><ArrowLeft size={16} /> Back to team studio</button><span><Sparkles size={14} /> SOW READER</span></div>
    <div className="sow-layout">
      <aside className="sow-story">
        <p className="sow-kicker">THE NEXT CHAPTER STARTS HERE</p>
        <h2 id={`${id}-heading`}>Big plans.<br /><em>Meet your team.</em></h2>
        <p className="sow-intro">Drop in the work. Bring the team into focus. We’ll turn your SOW into a first draft you can make your own.</p>
        <div className={`sow-blueprint ${busy ? "sow-blueprint-active" : ""}`} aria-hidden="true">
          <div className="sow-paper"><FileText size={24} /><span>SCOPE OF WORK</span><i /><i /><i /><div><i /><i /></div></div>
          <div className="sow-paper-trail"><span /><span /><span /></div>
          <div className="sow-team-preview"><div><span>01</span><i /><b /></div><div><span>02</span><i /><b /></div><div><span>03</span><i /><b /></div></div>
          <div className="sow-orbit"><Sparkles size={21} /></div>
        </div>
        <ol className="sow-promise"><li><span>01</span><div><strong>Find the shape of the work</strong><small>Client, timeframe, roles, and skills.</small></div></li><li><span>02</span><div><strong>Keep the source close</strong><small>Quotations and open questions to review.</small></div></li><li><span>03</span><div><strong>Make it yours</strong><small>Edit the plan. Choose the people. Save when ready.</small></div></li></ol>
      </aside>
      <form className="sow-workbench" onSubmit={submit} aria-busy={busy}>
        <div className="sow-workbench-heading"><span className="sow-workbench-icon"><ScanText size={22} /></span><div><h3>A little context. A big head start.</h3><p>Your document becomes an editable plan.</p></div></div>
        <div className="sow-modes" role="group" aria-label="Choose SOW input method"><button type="button" aria-pressed={mode === "file"} disabled={busy} onClick={() => changeMode("file")}><Paperclip size={15} /> Upload a document</button><button type="button" aria-pressed={mode === "text"} disabled={busy} onClick={() => changeMode("text")}><FileText size={15} /> Paste a brief</button></div>
        {mode === "file" ? <div className={`sow-drop ${dragging ? "sow-drop-hover" : ""} ${file ? "sow-drop-selected" : ""}`} role="group" aria-label="SOW document upload"
          onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length > 1) { setDragging(false); setError("Choose one SOW at a time so each engagement gets its own plan."); } else chooseFile(event.dataTransfer.files[0]); }}>
          <input ref={fileInput} id={`${id}-file`} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="sow-visually-hidden" aria-label="Choose SOW document" disabled={busy} tabIndex={-1} onChange={event => { chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
          <span className="sow-drop-icon">{file ? <Check size={29} /> : <Upload size={29} />}</span>
          {file ? <><strong className="sow-file-name">{file.name}</strong><span>{(file.size / 1024).toLocaleString("en-US", { maximumFractionDigits: 0 })} KB · Ready to read</span><div className="sow-file-actions"><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Choose another</button><button type="button" disabled={busy} onClick={() => { setFile(null); setError(""); }}><X size={13} /> Remove</button></div></>
            : <><strong>Drop your SOW right here.</strong><span>PDF, DOCX, or TXT · Up to 3 MB</span><button type="button" className="sow-choose" disabled={busy} onClick={() => fileInput.current?.click()}>Choose a document <ArrowRight size={15} /></button></>}
        </div> : <div className="sow-text-input"><label htmlFor={`${id}-text`}>Paste the SOW or workstream brief</label><textarea id={`${id}-text`} disabled={busy} value={text} maxLength={MAX_TEXT_CHARACTERS} onChange={event => { setText(event.target.value); if (error) setError(""); }} placeholder="Client, what we're building, when it starts and ends, the roles we need…" aria-describedby={`${id}-text-note`} /><div id={`${id}-text-note`}><span>Missing details stay open for your review.</span><span>{count} / 60,000</span></div></div>}
        {unavailable ? <div className="sow-connection" role="status"><span>{unavailable}</span><button type="button" onClick={() => { setCapability(null); setConnectionError(""); setConnectionAttempt(value => value + 1); }}><RotateCcw size={13} /> Check connection</button></div>
          : !capability ? <div className="sow-connection sow-connection-checking" role="status"><LoaderCircle className="sow-spin" size={14} /><span>Checking the SOW reader…</span></div> : null}
        {error ? <div className="sow-error" ref={errorBox} tabIndex={-1} role="alert"><span>Let’s get this moving.</span><p>{error}</p></div> : null}
        {busy ? <div className="sow-reading" role="status"><div><LoaderCircle className="sow-spin" size={20} /><strong>Reading your {mode === "file" ? "document" : "brief"}…</strong><span aria-hidden="true">{elapsed}s</span></div><p>{elapsed >= 30 ? "Still working through the source. A detailed document can take a little longer." : "Looking for the work, dates, and team requirements. You’ll review the draft next."}</p><div className="sow-reading-line" aria-hidden="true"><i /></div><button type="button" onClick={cancelReading}>Stop reading</button></div> : null}
        <div className="sow-submit-area"><button className="sow-submit" type="submit" disabled={busy || !ready}>{busy ? <><LoaderCircle className="sow-spin" size={17} /> Reading the source</> : <><Sparkles size={17} /> Bring the plan to life <ArrowRight size={18} /></>}</button><p><ShieldCheck size={14} /> You review every detail before anything is saved.</p></div>
        <div className="sow-manual"><span>Already know the team and timeframe?</span><button type="button" onClick={leave}>Build it myself <ArrowRight size={15} /></button></div>
        <p className="sow-provider-note">Reading sends this document to OpenAI. The original upload is not saved by BOOKENDS.</p>
      </form>
    </div>
  </section>;
}
