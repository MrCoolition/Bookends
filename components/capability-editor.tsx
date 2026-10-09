"use client";

import { useId, useRef, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Check, ChevronDown, Plus, Search, Wrench, X } from "lucide-react";
import type { AdminBootstrap, AdminCapability } from "@/lib/admin/contracts";
import { parseNamedList, formatNamedList } from "@/lib/admin/named-list";
import type { LocalAdminCommand } from "@/lib/admin/local";
import { byName, compareNames } from "@/lib/alphabetical";

type CapabilityKind = "role" | "skill";
const nameKey = (value: string) => value.trim().toLocaleLowerCase("en-US");
const represents = (entry: AdminCapability, value: string) => [entry.name, ...(entry.aliases || [])].some(name => nameKey(name) === nameKey(value));

export function CapabilityEditor({ record, initialKind, save, close }: { record?: AdminCapability; initialKind?: CapabilityKind; save: (command: LocalAdminCommand) => Promise<AdminBootstrap>; close: () => void }) {
  const [kind, setKind] = useState<CapabilityKind | undefined>(record?.kind || initialKind);
  const [name, setName] = useState(record?.name || "");
  const [description, setDescription] = useState(record?.description || "");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false);
  async function run(command: LocalAdminCommand) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await save(command); close(); } catch (caught) { setError(caught instanceof Error && caught.message.length < 400 ? caught.message : "This entry could not be saved. Your inputs are still here."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="admin-form" onSubmit={event => { event.preventDefault(); if (!kind) { setError("Choose a delivery role or skill before saving."); return; } void run({ type: "save_capability", ...(record ? { id: record.id, expectedRevision: record.revision } : {}), kind, name: name.trim(), description: description.trim() }); }}>
    <p className="admin-form-intro">Give your team a shared vocabulary. Delivery roles describe the work a person can own; skills describe what they can do.</p>
    <fieldset className="capability-type-picker"><legend>{record ? "Type" : "What are you adding?"}</legend><div>{(["role", "skill"] as const).map(option => { const Icon = option === "role" ? BriefcaseBusiness : Wrench; return <button key={option} type="button" className={`capability-type-choice capability-${option}`} aria-pressed={kind === option} disabled={!!record} onClick={() => { setKind(option); setError(""); }}><Icon size={22}/><span><strong>{option === "role" ? "Delivery role" : "Skill"}</strong><small>{option === "role" ? "A job someone can do" : "A tool or expertise they bring"}</small></span>{kind === option && <Check size={16}/>}</button>; })}</div></fieldset>
    <label>Name<input aria-label="Name" required maxLength={kind === "skill" ? 100 : 160} value={name} onChange={event => setName(event.target.value)} placeholder={kind === "role" ? "e.g. Data Engineer, Business Analyst" : kind === "skill" ? "e.g. SQL, React, Agile delivery" : "Choose a type, then give it a name"}/></label>
    <label>Description<textarea aria-label="Description" maxLength={2000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder={kind === "role" ? "What does this role own?" : kind === "skill" ? "What does proficiency in this skill mean for your team?" : "A short explanation for your team"}/></label>
    {record && <p className="admin-note">Renaming keeps earlier names connected for matching. Retiring removes this entry from new choices; existing profiles and SOW plans keep their recorded values.</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    <footer className="admin-form-footer">{record && <button type="button" className="admin-archive-button" disabled={busy} onClick={() => void run({ type: "set_capability_active", id: record.id, expectedRevision: record.revision, active: !record.active })}>{record.active ? "Make inactive" : "Reactivate"}</button>}<button type="submit" className="admin-button admin-primary" disabled={busy || !kind}>{busy ? "Saving…" : kind === "role" ? "Save role" : kind === "skill" ? "Save skill" : "Choose a type to continue"}<ArrowRight size={16}/></button></footer>
  </form>;
}

export function CapabilityMultiSelect({ kind, entries, value, onChange }: { kind: CapabilityKind; entries: AdminCapability[]; value: string[]; onChange: (value: string[]) => void }) {
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const id = useId();
  const Icon = kind === "role" ? BriefcaseBusiness : Wrench;
  const plural = kind === "role" ? "roles" : "skills";
  const limit = kind === "role" ? 30 : 100;
  const query = search.trim();
  const sameKind = entries.filter(entry => entry.kind === kind);
  const options = sameKind.filter(entry => entry.active).sort(byName);
  const exactEntry = sameKind.find(entry => entry.active && represents(entry, query)) || sameKind.find(entry => represents(entry, query));
  const otherKindEntry = (name: string) => {
    const currentKind = sameKind.find(entry => entry.active && represents(entry, name)) || sameKind.find(entry => represents(entry, name));
    if (currentKind?.active) return undefined;
    return entries.find(entry => entry.active && entry.kind !== kind && represents(entry, name)) || (!currentKind ? entries.find(entry => entry.kind !== kind && represents(entry, name)) : undefined);
  };
  const wrongKind = otherKindEntry(query);
  const matching = options.filter(entry => [entry.name, entry.description, ...(entry.aliases || [])].some(item => nameKey(item).includes(nameKey(query))));
  const selected = (entry: AdminCapability) => value.some(item => represents(entry, item));
  const alreadyChosen = value.some(item => nameKey(item) === nameKey(query)) || !!(exactEntry && selected(exactEntry));
  const canAdd = !!query && !wrongKind && !alreadyChosen && (!exactEntry || exactEntry.active) && value.length < limit;
  const add = () => {
    if (!canAdd) return;
    const next = exactEntry?.name || query;
    onChange([...value, next]); setSearch(""); setNotice(`${next} added.`);
  };
  const toggle = (entry: AdminCapability) => {
    if (selected(entry)) { onChange(value.filter(item => !represents(entry, item))); setNotice(`${entry.name} removed.`); }
    else if (value.length < limit) { onChange([...value, entry.name]); setNotice(`${entry.name} added.`); }
  };
  const misplaced = value.filter(item => otherKindEntry(item));
  const selectedValues = value.map((item, index) => ({ item, index })).sort((a, b) => compareNames(a.item, b.item) || a.index - b.index);
  return <section className={`capability-multiselect capability-${kind}`} aria-labelledby={`${id}-heading`}>
    <header><span className="capability-field-icon"><Icon size={19}/></span><div><h4 id={`${id}-heading`}>{kind === "role" ? "Delivery roles" : "Skills"}</h4><p>{kind === "role" ? "The roles this person can fill. Choose more than one." : "Their tools and expertise. Choose as many as they bring."}</p></div><span className="capability-selection-count">{value.length} selected</span></header>
    {!!value.length && <ul className="capability-selected" aria-label={`Selected ${plural}`}>{selectedValues.map(({ item, index }) => <li key={`${item}-${index}`}><Icon size={13}/><span>{item}</span><button type="button" aria-label={`Remove ${item} from ${plural}`} onClick={() => { onChange(value.filter((_, itemIndex) => itemIndex !== index)); setNotice(`${item} removed.`); }}><X size={14}/></button></li>)}</ul>}
    {misplaced.length > 0 && <p className="capability-input-hint capability-input-warning">{misplaced.join(", ")} {misplaced.length === 1 ? "is a" : "are"} configured {kind === "role" ? "skill" : "role"}{misplaced.length === 1 ? "" : "s"}. Remove {misplaced.length === 1 ? "it" : "them"} here and choose {misplaced.length === 1 ? "it" : "them"} under {kind === "role" ? "Skills" : "Delivery roles"}.</p>}
    <label className="capability-search" htmlFor={`${id}-search`}><Search size={16}/><input id={`${id}-search`} aria-label={`Search or add ${plural}`} aria-describedby={`${id}-hint`} value={search} onChange={event => { setSearch(event.target.value); setNotice(""); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); add(); } }} maxLength={kind === "role" ? 160 : 100} autoComplete="off" placeholder={`Search or add ${kind === "role" ? "a role" : "a skill"}…`}/></label>
    <div className="capability-options" aria-label={`Available ${plural}`}>{matching.map(entry => <button type="button" key={entry.id} aria-pressed={selected(entry)} disabled={!selected(entry) && value.length >= limit} title={entry.description || entry.name} onClick={() => toggle(entry)}>{selected(entry) ? <Check size={13}/> : <Plus size={13}/>}<span>{entry.name}</span></button>)}</div>
    {canAdd && <button type="button" className="capability-add-value" onClick={add}><Plus size={14}/>{exactEntry ? "Select" : "Add"} “{exactEntry?.name || query}”{!exactEntry && <small>to this person</small>}</button>}
    <p id={`${id}-hint`} className={`capability-input-hint${wrongKind ? " capability-input-warning" : ""}`}>{wrongKind ? `“${wrongKind.name}” is a ${kind === "role" ? "skill" : "delivery role"}. Choose it under ${kind === "role" ? "Skills" : "Delivery roles"}.` : exactEntry && !exactEntry.active ? "This entry is inactive. Reactivate it in Roles & skills before adding it." : alreadyChosen && query ? "Already selected. Choose another or remove its chip above." : value.length >= limit ? `Up to ${limit} ${plural} can be selected.` : !matching.length && !query ? `No configured ${plural} yet. Type a name to add one to this person.` : query && !matching.length ? "Press Enter or choose Add to keep this as one value, including any commas." : "Click to select or remove. Type a new name and press Enter to add it."}</p>
    <span className="capability-announcement" role="status">{notice}</span>
  </section>;
}

export function CatalogChoices({ kind, entries, value, onChange }: { kind: "role" | "skill"; entries: AdminCapability[]; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const id = useId();
  const parsed = parseNamedList(value);
  const chosen = parsed.values;
  const options = entries.filter(entry => entry.active && entry.kind === kind).sort(byName);
  const matching = options.filter(entry => `${entry.name} ${entry.description}`.toLowerCase().includes(search.toLowerCase()));
  const selected = (entry: AdminCapability) => chosen.some(item => represents(entry, item));
  const Icon = kind === "role" ? BriefcaseBusiness : Wrench;
  return <details className={`eng-catalog-choices capability-${kind}`}><summary><Icon size={14}/><span>Choose configured {kind === "role" ? "roles" : "skills"}</span><span>{options.length}</span><ChevronDown size={14}/></summary><div>{parsed.error && <p role="status">Finish the quoted value above before choosing another entry.</p>}{options.length ? <><label htmlFor={id}>Find a {kind}<input id={id} value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${kind === "role" ? "roles" : "skills"}`}/></label><div>{matching.map(entry => <button type="button" key={entry.id} aria-pressed={selected(entry)} disabled={!!parsed.error} title={entry.description || entry.name} onClick={() => onChange(selected(entry) ? formatNamedList(chosen.filter(item => !represents(entry, item))) : formatNamedList([...chosen, entry.name]))}>{selected(entry) && <Check size={12}/>} {entry.name}</button>)}</div>{!matching.length && <p>No matches. Try another search.</p>}</> : <p>Add shared {kind === "role" ? "roles" : "skills"} in Admin → Roles & skills. You can also type a value into the field above.</p>}</div></details>;
}
