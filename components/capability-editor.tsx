"use client";

import { useId, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Tags } from "lucide-react";
import type { AdminBootstrap, AdminCapability } from "@/lib/admin/contracts";
import { parseNamedList, formatNamedList } from "@/lib/admin/named-list";
import type { LocalAdminCommand } from "@/lib/admin/local";

export function CapabilityEditor({ record, save, close }: { record?: AdminCapability; save: (command: LocalAdminCommand) => Promise<AdminBootstrap>; close: () => void }) {
  const [kind, setKind] = useState<"role" | "skill">(record?.kind || "role");
  const [name, setName] = useState(record?.name || "");
  const [description, setDescription] = useState(record?.description || "");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false);
  async function run(command: LocalAdminCommand) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await save(command); close(); } catch (caught) { setError(caught instanceof Error && caught.message.length < 400 ? caught.message : "This entry could not be saved. Your inputs are still here."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="admin-form" onSubmit={event => { event.preventDefault(); void run({ type: "save_capability", ...(record ? { id: record.id, expectedRevision: record.revision } : {}), kind, name: name.trim(), description: description.trim() }); }}>
    <p className="admin-form-intro">Give your team a shared vocabulary. Delivery roles describe the work a person can own; skills describe what they can do.</p>
    <label>Type<select aria-label="Type" value={kind} disabled={!!record} onChange={event => setKind(event.target.value as "role" | "skill")}><option value="role">Delivery role</option><option value="skill">Skill</option></select></label>
    <label>Name<input aria-label="Name" required maxLength={kind === "skill" ? 100 : 160} value={name} onChange={event => setName(event.target.value)} placeholder={kind === "role" ? "e.g. Data engineer, Full-stack developer, BA / PM" : "e.g. SQL, React, Agile delivery"}/></label>
    <label>Description<textarea aria-label="Description" maxLength={2000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder={kind === "role" ? "What does this role own?" : "What does proficiency in this skill mean for your team?"}/></label>
    {record && <p className="admin-note">Renaming keeps earlier names connected for matching. Retiring removes this entry from new choices; existing profiles and SOW plans keep their recorded values.</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    <footer className="admin-form-footer">{record && <button type="button" className="admin-archive-button" disabled={busy} onClick={() => void run({ type: "set_capability_active", id: record.id, expectedRevision: record.revision, active: !record.active })}>{record.active ? "Make inactive" : "Reactivate"}</button>}<button type="submit" className="admin-button admin-primary" disabled={busy}>{busy ? "Saving…" : "Save role or skill"}<ArrowRight size={16}/></button></footer>
  </form>;
}

export function CatalogChoices({ kind, entries, value, onChange }: { kind: "role" | "skill"; entries: AdminCapability[]; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const id = useId();
  const parsed = parseNamedList(value);
  const chosen = parsed.values;
  const options = entries.filter(entry => entry.active && entry.kind === kind);
  const matching = options.filter(entry => `${entry.name} ${entry.description}`.toLowerCase().includes(search.toLowerCase()));
  const represents = (entry: AdminCapability, value: string) => [entry.name, ...(entry.aliases || [])].some(name => name.toLowerCase() === value.toLowerCase());
  const selected = (entry: AdminCapability) => chosen.some(item => represents(entry, item));
  return <details className="eng-catalog-choices"><summary><Tags size={14}/><span>Choose configured {kind === "role" ? "roles" : "skills"}</span><span>{options.length}</span><ChevronDown size={14}/></summary><div>{parsed.error && <p role="status">Finish the quoted value above before choosing another entry.</p>}{options.length ? <><label htmlFor={id}>Find a {kind}<input id={id} value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${kind === "role" ? "roles" : "skills"}`}/></label><div>{matching.map(entry => <button type="button" key={entry.id} aria-pressed={selected(entry)} disabled={!!parsed.error} title={entry.description || entry.name} onClick={() => onChange(selected(entry) ? formatNamedList(chosen.filter(item => !represents(entry, item))) : formatNamedList([...chosen, entry.name]))}>{selected(entry) && <Check size={12}/>} {entry.name}</button>)}</div>{!matching.length && <p>No matches. Try another search.</p>}</> : <p>Add shared {kind === "role" ? "roles" : "skills"} in Admin → Roles & skills. You can also type a value into the field above.</p>}</div></details>;
}
