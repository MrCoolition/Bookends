"use client";

import { useId, useState } from "react";
import { CalendarClock, CalendarDays, ChevronDown, Clock3, Flag, Plus, Repeat2, Settings2, Trash2 } from "lucide-react";
import { clientBookendsSchema, describeBookend, upcomingBookendWindows, type ClientBookend } from "@/lib/scheduling/client-bookends";

const PURPOSES: { value: ClientBookend["purpose"]; label: string }[] = [
  { value: "onboarding", label: "Onboarding" }, { value: "offboarding", label: "Offboarding" },
  { value: "access", label: "Access / provisioning" }, { value: "review", label: "Review / approval" }, { value: "custom", label: "Something else" },
];
const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const numeric = (value: string) => value === "" ? 0 : Number(value);

export function ClientBookendSummary({ bookends, today }: { bookends?: ClientBookend[]; today: string }) {
  if (!bookends?.length) return null;
  const active = bookends.filter(rule => rule.active);
  const next = active.flatMap(rule => {
    const window = upcomingBookendWindows(rule, today, today, 1)[0];
    return window ? [{ rule, window }] : [];
  }).sort((a, b) => a.window.eligibleDate.localeCompare(b.window.eligibleDate) || a.rule.name.localeCompare(b.rule.name))[0];
  return <span className="client-bookend-summary"><CalendarClock size={14} aria-hidden="true"/><span>{next ? `${next.rule.name} · ${dateLabel(next.window.eligibleDate)}` : active.length ? "No upcoming window — review client timing" : "Client bookends paused"}{active.length > 1 && <small> · {active.length} active bookends</small>}</span></span>;
}

export function ClientBookendsEditor({ value, onChange, today }: { value: ClientBookend[]; onChange: (value: ClientBookend[]) => void; today: string }) {
  const heading = useId();
  const [expanded, setExpanded] = useState<string | null>(value.length === 1 ? value[0].id : null);
  function add() {
    const id = crypto.randomUUID();
    onChange([...value, { id, name: "Client onboarding", purpose: "onboarding", phase: "start", enforcement: "required", cadence: "weeks", every: 2, anchorDate: today, windowDays: 1, noticeDays: 0, until: null, active: true, notes: "", excludedDates: [] }]);
    setExpanded(id);
  }
  return <section className="client-bookends-editor" aria-labelledby={heading}>
    <header><span className="client-bookends-heading-icon"><CalendarClock size={22}/></span><div><h3 id={heading}>Client bookends <span>{value.length || ""}</span></h3><p>The client’s rhythm. Build your plans around it.</p></div><button type="button" className="admin-button admin-secondary" disabled={value.length >= 20} onClick={add}><Plus size={16}/>Add bookend</button></header>
    {!value.length && <div className="client-bookends-empty"><Repeat2 size={20}/><p>Intake every other Monday? Access approvals once a month? Add the windows your team needs to hit.</p></div>}
    {value.length > 0 && <p className="client-bookends-explainer">Required windows constrain planned start or end dates. Advisory windows are reminders. These dates don’t verify that onboarding is complete.</p>}
    <div className="client-bookends-list">{value.map((rule, index) => <BookendEditor key={rule.id} rule={rule} index={index} today={today} expanded={expanded === rule.id} onToggle={() => setExpanded(expanded === rule.id ? null : rule.id)} onChange={next => onChange(value.map(item => item.id === rule.id ? next : item))} onRemove={() => { onChange(value.filter(item => item.id !== rule.id)); if (expanded === rule.id) setExpanded(null); }}/>)}</div>
  </section>;
}

function BookendEditor({ rule, index, today, expanded, onToggle, onChange, onRemove }: { rule: ClientBookend; index: number; today: string; expanded: boolean; onToggle: () => void; onChange: (rule: ClientBookend) => void; onRemove: () => void }) {
  const contentId = useId();
  const [skipDraft, setSkipDraft] = useState((rule.excludedDates ?? []).join("\n"));
  const update = <K extends keyof ClientBookend>(key: K, value: ClientBookend[K]) => onChange({ ...rule, [key]: value });
  const parsed = clientBookendsSchema.safeParse([rule]);
  const upcoming = parsed.success && rule.active ? upcomingBookendWindows(parsed.data[0], today, today, 3) : [];
  const validSchedule = parsed.success;
  const phaseWord = rule.phase === "start" ? "starts" : "ends";
  const recurrence = validSchedule ? describeBookend(rule) : "Finish the schedule below";
  return <article className={`client-bookend-card${rule.active ? "" : " is-paused"}`}>
    <button type="button" className="client-bookend-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={onToggle}>
      <span className="client-bookend-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{rule.name || "Untitled bookend"}</strong><small>{recurrence}</small></span><span className="client-bookend-kind">{!rule.active ? "Paused" : `${rule.enforcement === "required" ? "Required" : "Advisory"} · ${rule.phase}`}</span><ChevronDown size={16}/>
    </button>
    {expanded && <div className="client-bookend-body" id={contentId}>
      <div className="client-bookend-fields">
        <label>Bookend name<input required value={rule.name} maxLength={120} onChange={event => update("name", event.target.value)} placeholder="e.g. Client onboarding"/></label>
        <label>Purpose<select value={rule.purpose} onChange={event => {
          const purpose = event.target.value as ClientBookend["purpose"];
          onChange({ ...rule, purpose, phase: purpose === "offboarding" ? "end" : purpose === "onboarding" ? "start" : rule.phase, name: rule.name === "Client onboarding" && purpose !== "onboarding" ? PURPOSES.find(item => item.value === purpose)!.label : rule.name });
        }}>{PURPOSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>First known opening<input required type="date" min="0001-01-01" max="9999-12-31" value={rule.anchorDate} onChange={event => update("anchorDate", event.target.value)}/><small>The date this cycle is anchored to.</small></label>
        <div className="client-bookend-repeat"><label>Repeats<select value={rule.cadence} onChange={event => update("cadence", event.target.value as ClientBookend["cadence"])}><option value="once">One time</option><option value="days">Every N days</option><option value="weeks">Every N weeks</option><option value="months">Every N months</option></select></label>{rule.cadence !== "once" && <label>Every<input required type="number" min={1} max={366} value={rule.every || ""} onChange={event => update("every", numeric(event.target.value))}/><small>{rule.cadence}</small></label>}</div>
        <label>Applies to<select value={rule.phase} onChange={event => update("phase", event.target.value as ClientBookend["phase"])}><option value="start">Planned start dates</option><option value="end">Planned end dates</option></select></label>
        <label>Planning rule<select value={rule.enforcement} onChange={event => update("enforcement", event.target.value as ClientBookend["enforcement"])}><option value="required">Required — must fit the window</option><option value="advisory">Advisory — show a reminder</option></select></label>
      </div>
      <div className="client-bookend-preview" aria-label={`Upcoming windows for ${rule.name || "this bookend"}`}>
        <div className="client-bookend-preview-title"><CalendarDays size={15}/><strong>Next windows</strong><span>Ready to submit {dateLabel(today)}</span></div>
        {upcoming.length ? <ol>{upcoming.map((window, item) => <li key={window.start}><span>{item === 0 ? "NEXT OPENING" : `THEN ${item + 1}`}</span><strong>{dateLabel(window.eligibleDate)}</strong><small>{window.end !== window.eligibleDate ? `Through ${dateLabel(window.end)}` : "One day"}</small>{rule.noticeDays > 0 && <em>Submit by {dateLabel(window.cutoff)}</em>}</li>)}</ol> : <p>{!rule.active ? "Paused. This bookend will not affect plans." : validSchedule ? "No eligible window ahead. Check the end date, notice period, or skipped dates." : "Complete the schedule to see upcoming windows."}</p>}
      </div>
      <details className="client-bookend-advanced"><summary><Settings2 size={15}/>Window length, notice & exceptions<ChevronDown size={14}/></summary><div className="client-bookend-fields">
        <label>Days accepting {phaseWord}<input required type="number" min={1} max={90} value={rule.windowDays || ""} onChange={event => update("windowDays", numeric(event.target.value))}/><small>Calendar days the entry window stays open, including its first day. This is not the onboarding duration.</small></label>
        <label>Advance notice (days)<input required type="number" min={0} max={365} value={rule.noticeDays} onChange={event => update("noticeDays", numeric(event.target.value))}/><small>Submit by this many calendar days before the window opens.</small></label>
        <label>Last eligible date <span>Optional</span><input type="date" min={rule.anchorDate || "0001-01-01"} max="9999-12-31" value={rule.until ?? ""} onChange={event => update("until", event.target.value || null)}/><small>No dates after this day will be offered.</small></label>
        <label>Skip specific dates <span>Optional</span><textarea rows={2} value={skipDraft} onChange={event => { setSkipDraft(event.target.value); update("excludedDates", event.target.value.split(/[\n,;]+/).map(date => date.trim()).filter(Boolean)); }} placeholder={"2026-12-25\n2027-01-01"}/><small>YYYY-MM-DD, one per line. Use for holidays or closures.</small></label>
        <label className="client-bookend-full">Notes <span>Optional</span><textarea rows={2} maxLength={1000} value={rule.notes} onChange={event => update("notes", event.target.value)} placeholder="Who owns this window? What should the team know?"/></label>
      </div></details>
      {!parsed.success && <p className="client-bookend-error" role="status">{parsed.error.issues[0]?.message || "Review the schedule before saving."}</p>}
      <div className="client-bookend-actions"><label className="client-bookend-active"><input type="checkbox" checked={rule.active} onChange={event => update("active", event.target.checked)}/>{rule.active ? <Flag size={14}/> : <Clock3 size={14}/>}<span>{rule.active ? "Active in planning" : "Paused"}</span></label><button type="button" className="admin-text-button admin-remove" onClick={onRemove}><Trash2 size={14}/>Remove bookend</button></div>
    </div>}
  </article>;
}
