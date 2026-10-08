"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, Code2, Copy, FileSignature, Layers3, Plus, Search, Sparkles, Trash2, UsersRound } from "lucide-react";
import type { AdminBootstrap, AdminCapability, AdminMission, AdminResource } from "@/lib/admin/contracts";
import type { LocalAdminCommand } from "@/lib/admin/local";
import { engagementPlanSchema, engagementWindowError, findRoleMatches, isEngagementDate, summarizeEngagement, type EngagementPlan, type EngagementRole } from "@/lib/admin/engagement";

import { parseNamedList, formatNamedList } from "@/lib/admin/named-list";
import { CatalogChoices } from "./capability-editor";

type Save = (command: LocalAdminCommand) => Promise<AdminBootstrap>;
type RoleDraft = Omit<EngagementRole, "headcount" | "allocationPercent" | "skills"> & { headcount: string; allocationPercent: string; skillsText: string };
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
export const engagementDate = (value: string) => isEngagementDate(value) ? dateFormatter.format(new Date(`${value}T00:00:00Z`)) : "Dates to set";
const dayNumber = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
const fromRole = (role: EngagementRole): RoleDraft => ({ ...role, headcount: String(role.headcount), allocationPercent: String(role.allocationPercent), skillsText: formatNamedList(role.skills) });
const toRole = ({ skillsText, ...role }: RoleDraft): EngagementRole => ({ ...role, headcount: Number(role.headcount), allocationPercent: Number(role.allocationPercent), skills: parseNamedList(skillsText).values });
const pretty = (number: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number);

export function EngagementCard({ record, client, onEdit }: { record: AdminMission; client: string; onEdit: () => void }) {
  const plan = record.engagement;
  const summary = plan && summarizeEngagement(plan);
  return <button className={`eng-card ${record.active ? "" : "eng-inactive"}`} onClick={onEdit}>
    <div className="eng-card-heading"><span>{client}</span><span className={`eng-status status-${plan?.status || "draft"}`}>{!record.active ? "Inactive" : plan?.status === "signed" ? "SOW signed" : plan?.status === "complete" ? "Complete" : "Draft"}</span></div>
    <h3>{record.name}</h3>
    {plan && summary ? <><p className="eng-card-reference"><FileSignature size={14}/>{plan.sowReference || "SOW reference to add"}</p><div className="eng-card-numbers"><div><strong>{summary.totalSeats}</strong><span>role positions</span></div><div><strong>{summary.months}<small> mo</small></strong><span>engagement span</span></div><div><strong>{pretty(summary.peakFte)}</strong><span>FTE at peak</span></div></div><div className="eng-card-roles">{plan.roles.slice(0, 4).map(role => <span key={role.id}><b>{role.headcount}×</b> {role.name}</span>)}{plan.roles.length > 4 && <span>+{plan.roles.length - 4} more</span>}</div><div className="eng-card-period"><CalendarDays size={14}/>{engagementDate(plan.start)} → {engagementDate(plan.end)}</div></> : <div className="eng-card-legacy"><Layers3 size={25}/><p>Add the SOW, dates, and team this engagement needs.</p><span>Your existing mission history stays connected.</span></div>}
    <div className="eng-card-bottom"><span>{plan ? "View team needs & matches" : "Build the engagement plan"}</span><ArrowRight size={17}/></div>
  </button>;
}

export function EngagementOverview({ missions, clients }: { missions: AdminMission[]; clients: AdminBootstrap["clients"] }) {
  const planned = missions.filter(mission => mission.active && mission.engagement);
  return <div className="eng-overview"><div><span className="eng-overview-mark"><Layers3 size={25}/></span><div><p>THE WORK YOU SELL. THE TEAM IT TAKES.</p><strong>Start with the whole engagement.</strong><span>Client → SOW → roles & skills → teammate matches</span></div></div><div className="eng-overview-counts"><span><strong>{clients.filter(client => client.active).length}</strong> clients</span><span><strong>{planned.length}</strong> team plans</span><span><strong>{planned.filter(mission => mission.engagement?.status === "signed").length}</strong> signed SOWs</span></div></div>;
}

export function EngagementEditor({ record, data, save, close }: { record?: AdminMission; data: AdminBootstrap; save: Save; close: () => void }) {
  const existing = record?.engagement;
  const [step, setStep] = useState<1 | 2 | 3>(existing ? 3 : 1);
  const [name, setName] = useState(record?.name || "");
  const [clientId, setClientId] = useState(record?.clientId || "");
  const [reference, setReference] = useState(existing?.sowReference || "");
  const [status, setStatus] = useState<EngagementPlan["status"]>(existing?.status || "draft");
  const [signedOn, setSignedOn] = useState(existing?.signedOn || "");
  const [start, setStart] = useState(existing?.start || "");
  const [end, setEnd] = useState(existing?.end || "");
  const [outcomes, setOutcomes] = useState(existing?.outcomes || "");
  const [roles, setRoles] = useState<RoleDraft[]>(existing?.roles.map(fromRole) || []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: "center" }); } }, [error]);
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const plan: EngagementPlan = { ...existing, version: 1, sowReference: reference.trim(), status, signedOn: signedOn || null, start, end, outcomes: outcomes.trim(), roles: roles.map(toRole) };
  const parsed = engagementPlanSchema.safeParse(plan);
  const listErrorRole = roles.find(role => parseNamedList(role.skillsText).error);
  const summary = parsed.success ? summarizeEngagement(parsed.data) : null;
  const clientName = data.clients.find(client => client.id === clientId)?.name || "Choose a client";
  const headcount = roles.reduce((sum, role) => sum + (Number(role.headcount) || 0), 0);

  function navigate(next: 1 | 2 | 3) {
    setError(""); setStep(next);
    requestAnimationFrame(() => { form.current?.closest("dialog")?.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }); });
  }
  function briefError() {
    if (!name.trim()) return "Give this engagement a name.";
    if (!data.clients.some(client => client.id === clientId && client.active)) return "Choose an active client for this engagement.";
    const windowError = engagementWindowError(start, end);
    if (windowError) return windowError;
    if (existing?.source !== "direct" && status !== "draft" && (!reference.trim() || !isEngagementDate(signedOn))) return "A signed or completed SOW needs its reference and a valid signing date.";
    return "";
  }
  function next(nextStep: 2 | 3) {
    const problem = briefError();
    if (problem) { setStep(1); setError(problem); return; }
    if (nextStep === 3 && (listErrorRole || !parsed.success)) { setStep(2); revealInvalidRole(); setError(validationMessage()); return; }
    navigate(nextStep);
  }
  function revealInvalidRole() {
    if (listErrorRole) { setExpanded(listErrorRole.id); return; }
    if (parsed.success) return;
    const roleIndex = parsed.error.issues.find(issue => issue.path[0] === "roles" && typeof issue.path[1] === "number")?.path[1];
    if (typeof roleIndex === "number" && roles[roleIndex]) setExpanded(roles[roleIndex].id);
  }
  function validationMessage() {
    if (listErrorRole) return `${listErrorRole.name || "Role"}: ${parseNamedList(listErrorRole.skillsText).error}`;
    if (parsed.success) return "";
    const issue = parsed.error.issues[0];
    const roleIndex = typeof issue.path[1] === "number" ? issue.path[1] : undefined;
    return `${roleIndex !== undefined ? `Role ${roleIndex + 1}: ` : ""}${issue.message}`;
  }
  function changeDate(which: "start" | "end", value: string) {
    const previous = which === "start" ? start : end;
    setRoles(current => current.map(role => role[which] === previous ? { ...role, [which]: value } : role));
    if (which === "start") setStart(value); else setEnd(value);
    setError("");
  }
  function duration(months: number) {
    if (!isEngagementDate(start)) { setError("Choose the engagement’s start date first."); return; }
    const [year, month, day] = start.split("-").map(Number);
    const target = new Date(Date.UTC(year, month - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay)); target.setUTCDate(target.getUTCDate() - 1);
    changeDate("end", target.toISOString().slice(0, 10));
  }
  function addRole(values: Partial<RoleDraft> = {}) {
    const role: RoleDraft = { id: crypto.randomUUID(), name: "", headcount: "1", allocationPercent: "100", skillsText: "", responsibilities: "", start, end, ...values };
    setRoles(current => [...current, role]); setExpanded(role.id); setError("");
  }
  function applicationBuild() {
    const starters = [
      { name: "Data engineer", headcount: "1", skillsText: "SQL, Python, Data pipelines", responsibilities: "Design data models and pipelines; integrate and validate application data." },
      { name: "Full-stack developer", headcount: "2", skillsText: "React, TypeScript, APIs", responsibilities: "Build the application UI and services, integrate APIs, and deliver tested features." },
      { name: "BA / PM", headcount: "1", skillsText: "Business analysis, Agile delivery, Requirements, Testing", responsibilities: "Run the boards and Agile ceremonies; manage requirements and acceptance criteria; coordinate delivery and light testing." },
    ].map(value => ({ id: crypto.randomUUID(), allocationPercent: "100", start, end, ...value }));
    setRoles(starters); setExpanded(starters[0].id); setError("");
  }
  function changeRole(roleId: string, values: Partial<RoleDraft>) { setRoles(current => current.map(role => role.id === roleId ? { ...role, ...values } : role)); setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step !== 3) { next(step === 1 ? 2 : 3); return; }
    const problem = briefError();
    if (problem) { setStep(1); setError(problem); return; }
    if (listErrorRole || !parsed.success) { setStep(2); revealInvalidRole(); setError(validationMessage()); return; }
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await save({ type: "save_mission", ...(record ? { id: record.id, expectedRevision: record.revision } : {}), name: name.trim(), clientId, engagement: parsed.data }); close(); }
    catch (caught) { setError(caught instanceof Error && caught.message.length < 400 ? caught.message : "This engagement could not be saved. Your inputs are still here."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function toggleActive() {
    if (!record || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await save({ type: "set_mission_active", id: record.id, expectedRevision: record.revision, active: !record.active }); close(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "This engagement could not be updated."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form ref={form} className="admin-form eng-editor" onSubmit={submit} noValidate>
    <datalist id={`${id}-role-catalog`}>{(data.capabilities || []).filter(entry => entry.active && entry.kind === "role").map(entry => <option key={entry.id} value={entry.name}/>)}</datalist>
    <nav className="eng-steps" aria-label="Engagement setup steps">{(["The engagement", "Build the team", "Review & save"] as const).map((label, index) => <button type="button" key={label} aria-current={step === index + 1 ? "step" : undefined} disabled={busy} onClick={() => index === 0 ? navigate(1) : next(index === 1 ? 2 : 3)}><span aria-hidden="true">{index + 1 < step ? <Check size={13}/> : `0${index + 1}`}</span>{label}</button>)}</nav>
    <div className="eng-stage-heading"><p className="admin-eyebrow">{step === 1 ? "START WITH WHAT YOU SOLD" : step === 2 ? "GREAT WORK IS A TEAM SPORT" : "THE WHOLE ENGAGEMENT, IN VIEW"}</p><h3 ref={heading} tabIndex={-1}>{step === 1 ? "A big idea. A clear brief." : step === 2 ? "Who will make it happen?" : name || "Your delivery team."}</h3><p>{step === 1 ? "Set the SOW and its delivery window. Then shape the team it needs." : step === 2 ? "Plan positions by role, skills, and a share of each person’s capacity." : `${clientName} · Review the demand, timing, and possible teammate matches.`}</p></div>
    {error && <p ref={errorRef} tabIndex={-1} className="admin-error" role="alert">{error}</p>}
    {step === 1 && <>
      <label>Engagement name<input required value={name} onChange={event => setName(event.target.value)} maxLength={160} placeholder="e.g. Customer platform build"/></label>
      <label>Client<select required value={clientId} onChange={event => setClientId(event.target.value)}><option value="">Choose a client</option>{data.clients.filter(client => client.active || client.id === clientId).map(client => <option value={client.id} key={client.id}>{client.name}{client.active ? "" : " (inactive)"}</option>)}</select>{!data.clients.length && <small>Add a client in the Clients section first.</small>}</label>
      <label>Outcomes & scope<textarea value={outcomes} onChange={event => setOutcomes(event.target.value)} maxLength={4000} rows={3} placeholder="What are we delivering, and what does success look like?"/></label>
      <div className="eng-field-heading"><FileSignature size={18}/><h4>The statement of work</h4></div>
      <div className="admin-form-columns"><label>SOW reference<input value={reference} onChange={event => setReference(event.target.value)} maxLength={160} placeholder="e.g. ACME-2027-001"/></label><label>SOW status<select value={status} onChange={event => setStatus(event.target.value as EngagementPlan["status"])}><option value="draft">Draft / not yet signed</option><option value="signed">Signed</option><option value="complete">Complete</option></select></label></div>
      {status !== "draft" && <label>Signed on<input aria-label="Signed on" type="date" value={signedOn} onChange={event => setSignedOn(event.target.value)} required/><small>The date recorded on your signed SOW.</small></label>}
      <div className="eng-field-heading"><CalendarDays size={18}/><h4>The delivery window</h4></div>
      <div className="admin-form-columns"><label>Engagement starts<input type="date" value={start} onChange={event => changeDate("start", event.target.value)} required/></label><label>Engagement ends<input aria-label="Engagement ends" type="date" value={end} min={start || undefined} onChange={event => changeDate("end", event.target.value)} required/><small>Last day included.</small></label></div>
      <div className="eng-duration-picks"><span>From the start date</span>{[3, 6, 12, 24].map(months => <button type="button" key={months} onClick={() => duration(months)}>{months} months</button>)}</div>
      <p className="eng-context-note">Each role can span the full engagement or have its own start and end dates for a phased delivery.</p>
    </>}
    {step === 2 && <>
      <div className="eng-team-context"><span>{clientName} / {name}</span><strong>{engagementDate(start)} → {engagementDate(end)}</strong><button type="button" onClick={() => navigate(1)}>Edit brief <ArrowLeft size={13}/></button></div>
      {!roles.length && <div className="eng-starter"><div><span className="eng-starter-icon"><Code2 size={25}/></span><div><p className="admin-eyebrow">A RUNNING START</p><h4>An application build</h4><p>1 data engineer · 2 full-stack developers · 1 BA/PM</p></div></div><button className="admin-button admin-primary" type="button" onClick={applicationBuild}><Sparkles size={16}/> Application build <ArrowRight size={16}/></button><small>A starter team you can change to match the SOW.</small></div>}
      {!!roles.length && <div className="eng-team-tally"><span><strong>{headcount}</strong> role positions</span><span><strong>{roles.length}</strong> role types</span><span>Headcount ≠ FTE</span></div>}
      {roles.map((role, index) => <section className="eng-role-editor" key={role.id}>
        <button type="button" className="eng-role-summary" aria-expanded={expanded === role.id} aria-controls={`${id}-role-${role.id}`} onClick={() => setExpanded(expanded === role.id ? null : role.id)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{role.name || "Name this role"}</strong><small>{role.headcount || "—"} {Number(role.headcount) === 1 ? "person" : "people"} × {role.allocationPercent || "—"}% each · {role.start === start && role.end === end ? "Full engagement" : "Phased dates"}</small></div><ChevronDown size={17}/></button>
        <fieldset id={`${id}-role-${role.id}`} hidden={expanded !== role.id}><legend className="eng-sr-only">Role {index + 1}</legend>
          <label>Role name<input list={`${id}-role-catalog`} value={role.name} onChange={event => changeRole(role.id, { name: event.target.value })} maxLength={160} placeholder="e.g. Data engineer" required/></label>
          <div className="admin-form-columns"><label>Headcount<input aria-label="Headcount" type="number" min="1" max="1000" step="1" value={role.headcount} onChange={event => changeRole(role.id, { headcount: event.target.value })} required/><small>Number of people needed for this role.</small></label><label>Allocation per person (%)<input aria-label="Allocation per person (%)" type="number" min="1" max="100" step="any" value={role.allocationPercent} onChange={event => changeRole(role.id, { allocationPercent: event.target.value })} required/><small>50% = half of each person’s working capacity.</small></label></div>
          <label>Required skills<input aria-label="Required skills" value={role.skillsText} onChange={event => changeRole(role.id, { skillsText: event.target.value })} maxLength={3000} placeholder="SQL, Python, Data pipelines"/><small>Separate skills with commas. These connect the role to teammate profiles.</small></label>
          <CatalogChoices kind="skill" entries={data.capabilities || []} value={role.skillsText} onChange={value => changeRole(role.id, { skillsText: value })}/>
          <label>Responsibilities<textarea value={role.responsibilities} onChange={event => changeRole(role.id, { responsibilities: event.target.value })} maxLength={2000} rows={3} placeholder="What will this person own and deliver?"/></label>
          <label className="eng-checkbox"><input type="checkbox" checked={role.start === start && role.end === end} onChange={event => { if (event.target.checked) changeRole(role.id, { start, end }); else changeRole(role.id, { start: "", end: "" }); }}/><span>Full engagement</span></label>
          {!(role.start === start && role.end === end) && <div className="admin-form-columns"><label>Role starts<input type="date" value={role.start} min={start} max={end} onChange={event => changeRole(role.id, { start: event.target.value })}/></label><label>Role ends<input aria-label="Role ends" type="date" value={role.end} min={role.start || start} max={end} onChange={event => changeRole(role.id, { end: event.target.value })}/><small>Last day included.</small></label></div>}
          <div className="eng-role-actions"><button type="button" onClick={() => addRole({ ...role, id: crypto.randomUUID(), name: `${role.name} — next phase` })}><Copy size={14}/> Copy for another phase</button><button type="button" onClick={() => { setRoles(current => current.filter(item => item.id !== role.id)); setExpanded(null); }}><Trash2 size={14}/> Remove role</button></div>
        </fieldset>
      </section>)}
      <button type="button" className="eng-add-role" disabled={roles.length >= 100} onClick={() => addRole()}><Plus size={18}/> Add role <span>Build your own team mix</span></button>
      <p className="eng-context-note">One BA/PM can cover boards, ceremonies, requirements, and light testing in one role. Add separate roles when the SOW calls for separate people.</p>
    </>}
    {step === 3 && parsed.success && summary && <>
      <div className="eng-review-brief"><div><span className={`eng-status status-${status}`}>{status === "signed" ? "SOW signed" : status === "complete" ? "Complete" : "Draft SOW"}</span><span>{reference || "Reference to add"}</span></div>{outcomes && <p>{outcomes}</p>}<span><CalendarDays size={15}/>{engagementDate(start)} → {engagementDate(end)}</span></div>
      <div className="eng-review-stats"><div><strong>{summary.totalSeats}</strong><span>role positions</span></div><div><strong>{summary.peakHeadcount}</strong><span>people at peak</span></div><div><strong>{pretty(summary.peakFte)}</strong><span>FTE at peak</span></div><div><strong>{summary.months}<small> mo</small></strong><span>engagement span</span></div></div>
      <EngagementTimeline plan={parsed.data}/>
      <div className="eng-field-heading"><UsersRound size={18}/><h4>The team this work needs</h4><button type="button" onClick={() => navigate(2)}>Edit team <ArrowLeft size={13}/></button></div>
      {parsed.data.roles.map(role => <div className="eng-review-role" key={role.id}><div><span className="eng-role-quantity">{role.headcount}×</span><div><h4>{role.name}</h4><p>{role.allocationPercent}% per person · {engagementDate(role.start)} → {engagementDate(role.end)}</p></div></div>{role.responsibilities && <p>{role.responsibilities}</p>}<div className="eng-skill-tags">{role.skills.length ? role.skills.map(skill => <span key={skill}>{skill}</span>) : <span>Skills not specified</span>}</div><RoleMatches role={role} resources={data.resources} capabilities={data.capabilities || []}/></div>)}
      <p className="eng-context-note">This records the team the SOW needs. Matches are suggestions; saving does not assign teammates or confirm their availability.</p>
    </>}
    <footer className="admin-form-footer eng-save-footer"><div>{step > 1 ? <button type="button" className="eng-back" disabled={busy} onClick={() => navigate(step === 3 ? 2 : 1)}><ArrowLeft size={16}/> Back</button> : record && <button type="button" className="admin-archive-button" disabled={busy} onClick={() => void toggleActive()}>{record.active ? "Make inactive" : "Reactivate"}</button>}<span>Step {step} of 3</span></div><button type="submit" disabled={busy} className="admin-button admin-primary">{busy ? "Saving…" : step === 1 ? "Build the team" : step === 2 ? "Review team plan" : "Save engagement"}{step === 3 ? <Check size={16}/> : <ArrowRight size={16}/>}</button></footer>
  </form>;
}

export function EngagementTimeline({ plan }: { plan: EngagementPlan }) {
  const start = dayNumber(plan.start), end = dayNumber(plan.end), span = Math.max(1, end - start + 1);
  const points = Array.from({ length: 5 }, (_, index) => monthFormatter.format(new Date((start + (span - 1) * index / 4) * 86_400_000)));
  return <figure className="eng-timeline"><figcaption><span><CalendarDays size={16}/> Team shape over time</span><small>Role demand · positions × allocation</small></figcaption><div className="eng-timeline-axis"><span/>{points.map((point, index) => <span key={index}>{point}</span>)}</div>{plan.roles.map((role, index) => <div className="eng-timeline-row" key={role.id}><span title={role.name}>{role.name}<small>{role.headcount} × {role.allocationPercent}%</small></span><div aria-label={`${role.name}: ${engagementDate(role.start)} through ${engagementDate(role.end)}, ${role.headcount} people at ${role.allocationPercent}% each`} role="img"><i className={`eng-bar-${index % 4}`} style={{ left: `${(dayNumber(role.start) - start) / span * 100}%`, width: `${Math.max(.5, (dayNumber(role.end) - dayNumber(role.start) + 1) / span * 100)}%` }}/></div></div>)}<p>Positions can start and finish at different times. Peak figures count overlapping roles.</p></figure>;
}

function RoleMatches({ role, resources, capabilities }: { role: EngagementRole; resources: AdminResource[]; capabilities: AdminCapability[] }) {
  const matches = findRoleMatches(role, resources, capabilities);
  const unprofiled = resources.filter(resource => resource.active && (!resource.profile || (!resource.profile.roles.length && !resource.profile.skills.length))).length;
  return <details className="eng-matches"><summary><Search size={15}/><span>Find teammates</span><span>{matches.length} possible {matches.length === 1 ? "match" : "matches"}</span><ChevronDown size={15}/></summary><div><p>Based on recorded roles and skills. Availability and interest still need review.</p>{!matches.length && <div className="eng-no-match">No recorded match yet. Add delivery roles and skills under People, or review the skills this role needs.</div>}{matches.map(match => <article key={match.resource.id}><div><span className="eng-match-avatar">{match.resource.name.split(/\s+/).slice(0, 2).map(word => word[0]).join("")}</span><div><strong>{match.resource.name}</strong><small>{match.resource.home && <>{match.resource.home} · </>}{match.roleMatch ? "Role matches" : "Skills overlap"}</small></div><span className={match.missingSkills.length ? "eng-match-partial" : "eng-match-fit"}>{!role.skills.length ? "Skills not specified" : !match.skillsKnown ? "Skills not recorded" : `${match.matchedSkills.length}/${role.skills.length} skills`}</span></div>{match.matchedSkills.length > 0 && <p className="eng-matched-skills"><Check size={13}/> {match.matchedSkills.join(" · ")}</p>}{match.missingSkills.length > 0 && <p>Not recorded: {match.missingSkills.join(" · ")}</p>}</article>)}{unprofiled > 0 && <p>{unprofiled} active {unprofiled === 1 ? "teammate needs" : "teammates need"} a role or skills profile before matching.</p>}</div></details>;
}
