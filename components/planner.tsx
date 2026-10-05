"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronDown, Clock3, RotateCcw, ShieldCheck, TriangleAlert, WandSparkles } from "lucide-react";
import { MISSIONS, PEOPLE, TODAY } from "@/lib/data";
import { addDays, dateNumber, evaluateMove, inclusiveEnd, matching, missionFor, validDate } from "@/lib/domain";
import { availableWeeklyHours, recommendMove } from "@/lib/planning";
import type { DemoState, Mission, Person, ScenarioMove } from "@/lib/types";
import { Avatar } from "./ui";

type Draft = { personId: string; missionId: string; start: string; lastDay: string; hours: string };
type Props = { initialPersonId?: string; initialMissionId?: string; editingMove?: ScenarioMove; state: DemoState; onSave: (move: ScenarioMove) => void };
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const DRAFT_PREFIX = "bookends.planner-draft.v1.";
const memoryDrafts = new Map<string, Draft>();
const dateLabel = (value: string) => validDate(value) ? DATE_FORMAT.format(new Date(dateNumber(value))) : "Choose a date";

export function clearPlannerDrafts(moveId?: string) {
  const prefix = moveId ? `${DRAFT_PREFIX}${moveId}` : DRAFT_PREFIX;
  for (const key of memoryDrafts.keys()) if (moveId ? key === prefix : key.startsWith(prefix)) memoryDrafts.delete(key);
  try {
    for (const key of Object.keys(localStorage)) if (moveId ? key === prefix : key.startsWith(prefix)) localStorage.removeItem(key);
  } catch { /* The in-memory drafts are still cleared when storage is unavailable. */ }
}

function recommendedDraft(person: Person, mission: Mission, moves: ScenarioMove[], excludeId?: string): Draft {
  const suggestion = recommendMove(person, mission, moves, excludeId);
  return {
    personId: person.id, missionId: mission.id,
    start: suggestion?.start ?? (mission.start > TODAY ? mission.start : TODAY),
    lastDay: inclusiveEnd(suggestion?.end ?? mission.end),
    hours: String(suggestion?.weeklyHours ?? person.weeklyHours),
  };
}

function fitScore(person: Person, mission: Mission) {
  return mission.skills.filter(skill => !person.skills.includes(skill)).length * 10
    + (person.home === mission.home ? 0 : 3) + (mission.commercial === "authorized" ? 0 : 5);
}

function initialDraft({ initialPersonId, initialMissionId, editingMove, state }: Props): Draft {
  if (editingMove) return { personId: editingMove.personId, missionId: editingMove.missionId, start: editingMove.start, lastDay: inclusiveEnd(editingMove.end), hours: String(editingMove.weeklyHours) };
  let person = PEOPLE.find(p => p.id === initialPersonId) ?? PEOPLE[0];
  let mission = initialMissionId ? missionFor(initialMissionId) : MISSIONS[1];
  if (initialMissionId && !initialPersonId) {
    person = [...PEOPLE].sort((a, b) => fitScore(a, mission) - fitScore(b, mission))
      .find(p => recommendMove(p, mission, state.moves)) ?? person;
  } else if (!initialMissionId) {
    mission = [...MISSIONS].filter(m => m.end > TODAY).sort((a, b) => fitScore(person, a) - fitScore(person, b))
      .find(m => recommendMove(person, m, state.moves)) ?? mission;
  }
  return recommendedDraft(person, mission, state.moves);
}

function readDraft(key: string): Draft | null {
  if (memoryDrafts.has(key)) return memoryDrafts.get(key)!;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
    if (!value || !PEOPLE.some(p => p.id === value.personId) || !MISSIONS.some(m => m.id === value.missionId)) return null;
    return [value.start, value.lastDay, value.hours].every(v => typeof v === "string" && v.length < 24) ? value : null;
  } catch { return null; }
}

export function Planner(props: Props) {
  const { state, editingMove, onSave } = props;
  const storageKey = `${DRAFT_PREFIX}${editingMove?.id ?? props.initialPersonId ?? props.initialMissionId ?? "new"}`;
  const [initial] = useState(() => { const saved = readDraft(storageKey); return { draft: saved ?? initialDraft(props), restored: !!saved }; });
  const [draft, setDraft] = useState(initial.draft);
  const [notice, setNotice] = useState(initial.restored ? "Picked up right where you left off." : "A suggested starting point. Make it yours.");
  const [attempted, setAttempted] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  const person = PEOPLE.find(p => p.id === draft.personId)!;
  const mission = missionFor(draft.missionId);
  const firstAllowed = mission.start > TODAY ? mission.start : TODAY;
  const lastAllowed = inclusiveEnd(mission.end);
  const moveId = editingMove?.id ?? "preview";
  // Native date fields can temporarily contain partial or extended years. Never do arithmetic on them.
  const end = validDate(draft.lastDay) && draft.lastDay <= lastAllowed ? addDays(draft.lastDay, 1) : "";
  const move: ScenarioMove = { id: moveId, personId: person.id, missionId: mission.id, start: draft.start, end, weeklyHours: Number(draft.hours) };
  const suggestion = useMemo(() => recommendMove(person, mission, state.moves, editingMove?.id), [person, mission, state.moves, editingMove?.id]);
  const alternativeMission = useMemo(() => suggestion ? null : [...MISSIONS]
    .filter(m => m.id !== mission.id && m.end > TODAY)
    .sort((a, b) => fitScore(person, a) - fitScore(person, b))
    .find(m => recommendMove(person, m, state.moves, editingMove?.id)), [suggestion, person, mission, state.moves, editingMove?.id]);
  const available = useMemo(() => availableWeeklyHours(person, mission, draft.start, end, state.moves, editingMove?.id), [person, mission, draft.start, end, state.moves, editingMove?.id]);
  const fit = matching(person, mission, state.obligations);
  const startError = !validDate(draft.start) ? "Choose a complete start date."
    : draft.start < firstAllowed || draft.start > lastAllowed ? `Choose ${dateLabel(firstAllowed)} through ${dateLabel(lastAllowed)}.` : "";
  const endError = !validDate(draft.lastDay) ? "Choose a complete end date."
    : draft.lastDay < draft.start ? `End on or after ${dateLabel(draft.start)}.`
    : draft.lastDay > lastAllowed || draft.lastDay < firstAllowed ? `Keep the end date within this mission: ${dateLabel(lastAllowed)} or earlier.` : "";
  const hoursError = draft.hours.trim() === "" || !Number.isFinite(move.weeklyHours) || move.weeklyHours <= 0 || !Number.isInteger(move.weeklyHours * 4)
    ? "Enter positive hours in 0.25-hour steps."
    : !startError && !endError && move.weeklyHours > available ? `Only ${available} h/week fits these dates. Try the suggested plan${available ? " or lower the hours" : " or another mission"}.` : "";
  const fieldErrors = [startError, endError, hoursError].filter(Boolean);
  const issues = fieldErrors.length ? fieldErrors : evaluateMove(move, person, mission, state.moves);
  const recommendedIsCurrent = suggestion && suggestion.start === draft.start && suggestion.end === end && suggestion.weeklyHours === move.weeklyHours;

  useEffect(() => {
    if (saving.current) return;
    memoryDrafts.set(storageKey, draft);
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); setStorageAvailable(true); }
    catch { setStorageAvailable(false); }
  }, [draft, storageKey]);

  function update(field: keyof Draft, value: string) { setAttempted(false); setNotice(""); setDraft(current => ({ ...current, [field]: value })); }
  function changeSelection(personId: string, missionId: string) {
    const nextPerson = PEOPLE.find(p => p.id === personId)!;
    const nextMission = missionFor(missionId);
    const next = recommendMove(nextPerson, nextMission, state.moves, editingMove?.id);
    setDraft(recommendedDraft(nextPerson, nextMission, state.moves, editingMove?.id));
    setAttempted(false);
    setNotice(next ? "Dates and hours updated to fit this pairing." : "No open capacity for this pairing. Try another person or mission.");
  }
  function useSuggestion() {
    setDraft(recommendedDraft(person, mission, state.moves, editingMove?.id));
    setAttempted(false);
    setNotice("Suggested dates and available hours applied. Ready to save.");
  }
  function finishStartEdit() {
    // Wait until the user leaves the field; changing it mid-keystroke makes native date editing jump.
    if (!startError && validDate(draft.lastDay) && draft.lastDay < draft.start) {
      setDraft(current => ({ ...current, lastDay: lastAllowed }));
      setNotice(`End date moved to ${dateLabel(lastAllowed)} to keep your dates in order.`);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (issues.length) {
      setAttempted(true);
      const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? formRef.current?.querySelector<HTMLElement>("#plan-feedback");
      field?.focus();
      field?.scrollIntoView({ block: "nearest", behavior: "instant" });
      return;
    }
    saving.current = true;
    memoryDrafts.delete(storageKey);
    try { localStorage.removeItem(storageKey); } catch { /* Saving still works for this visit. */ }
    onSave({ ...move, id: editingMove?.id ?? crypto.randomUUID() });
  }

  return <form ref={formRef} className="move-planner" onSubmit={save} noValidate>
    <div className="planner-scroll">
      <div className="plan-route" aria-hidden="true">
        <Avatar person={person}/><div><strong>{person.name.split(" ")[0]}’s next chapter</strong><span>{person.home} · {person.weeklyHours}h weekly capacity</span></div>
        <ArrowRight size={20}/><span className="plan-client">{mission.client}</span>
      </div>
      <div className="plan-fields">
        <label htmlFor="plan-person">Who’s making the move?<select id="plan-person" value={draft.personId} onChange={e => changeSelection(e.target.value, draft.missionId)}>{PEOPLE.map(p => <option key={p.id} value={p.id}>{p.name} · {p.home}</option>)}</select></label>
        <label htmlFor="plan-mission">Where could they land?<select id="plan-mission" value={draft.missionId} onChange={e => changeSelection(draft.personId, e.target.value)}>{MISSIONS.filter(m => m.end > TODAY).map(m => <option key={m.id} value={m.id}>{m.client} · {m.name}</option>)}</select></label>
      </div>
      <div className="plan-section-heading"><span>01 <strong>Find the right window</strong></span><button type="button" className="plan-suggest" onClick={useSuggestion} disabled={!suggestion || !!recommendedIsCurrent}><WandSparkles size={14}/> Use suggested plan</button></div>
      <p className="plan-window">Mission window <strong>{dateLabel(firstAllowed)} — {dateLabel(lastAllowed)}</strong></p>
      <div className="plan-fields">
        <div><label htmlFor="plan-start">First working date<input id="plan-start" type="date" min={firstAllowed} max={lastAllowed} value={draft.start} aria-invalid={!!startError} aria-describedby="plan-start-hint" onChange={e => update("start", e.target.value)} onBlur={finishStartEdit}/></label><span id="plan-start-hint" className={startError ? "plan-field-error" : "plan-field-hint"}>{startError || dateLabel(draft.start)}</span></div>
        <div><label htmlFor="plan-end">Last working date<input id="plan-end" type="date" min={!startError ? draft.start : firstAllowed} max={lastAllowed} value={draft.lastDay} aria-invalid={!!endError} aria-describedby="plan-end-hint" onChange={e => update("lastDay", e.target.value)}/></label><span id="plan-end-hint" className={endError ? "plan-field-error" : "plan-field-hint"}>{endError || `${dateLabel(draft.lastDay)} · included`}</span></div>
      </div>
      <div className="plan-section-heading"><span>02 <strong>Set a comfortable pace</strong></span><span className="plan-working-note">Monday–Friday</span></div>
      <div className="plan-hours-row">
        <div><label htmlFor="plan-hours">Hours per week<div className="plan-hours-input"><input id="plan-hours" type="number" min="0.25" step="0.25" max={person.weeklyHours} value={draft.hours} aria-invalid={!!hoursError} aria-describedby="plan-hours-hint" onChange={e => update("hours", e.target.value)}/><span>h / week</span></div></label><span id="plan-hours-hint" className={hoursError ? "plan-field-error" : "plan-field-hint"}>{hoursError || "Shared with their other commitments."}</span></div>
        <div className="plan-availability"><div><Clock3 size={15}/><span>{startError || endError ? "Choose valid dates to check capacity" : <><strong>{available}h</strong> available each week</>}</span></div><div className="plan-capacity-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, available / person.weeklyHours * 100))}%` }}/></div><button type="button" onClick={() => update("hours", String(available))} disabled={available <= 0 || String(available) === draft.hours}>Use available hours <ArrowRight size={13}/></button></div>
      </div>
      {issues.length > 0 && <div className="plan-feedback" id="plan-feedback" tabIndex={-1} role={attempted ? "alert" : "status"}><TriangleAlert size={17}/><div><strong>{attempted ? "Let’s fix this before saving." : "A quick adjustment needed"}</strong><p>{issues[0]}</p>{suggestion && !recommendedIsCurrent ? <button type="button" onClick={useSuggestion}><RotateCcw size={13}/> Use {dateLabel(suggestion.start)} — {dateLabel(inclusiveEnd(suggestion.end))} · {suggestion.weeklyHours}h/week</button> : !suggestion && (alternativeMission ? <button type="button" onClick={() => changeSelection(person.id, alternativeMission.id)}><ArrowRight size={13}/> Try {alternativeMission.client} · {alternativeMission.name}</button> : <p>Choose another person to find open capacity.</p>)}</div></div>}
      <details className="plan-readiness"><summary><ShieldCheck size={16}/><span>{fit.label}</span><span className="plan-review-count">{fit.missing.length + fit.blockers.length + (mission.commercial === "authorized" ? 0 : 1) || "View"} {fit.missing.length || fit.blockers.length || mission.commercial !== "authorized" ? "to review" : "details"}</span><ChevronDown size={15}/></summary><div><p>{mission.commercial === "authorized" ? "Commercially authorized" : "Commercial approval needed"} · Approval owner: {mission.owner}.</p><div className="skill-tags">{mission.skills.map(skill => <span key={skill} className={person.skills.includes(skill) ? "skill-match" : "skill-missing"}>{person.skills.includes(skill) ? <Check size={12}/> : <TriangleAlert size={12}/>} {skill}</span>)}</div>{fit.blockers.map(o => <p key={o.id}>{o.title} · {o.owner}</p>)}{person.home !== mission.home && <p>Cross-HOME review also needed from {person.owner}.</p>}<p>Readiness and approvals are checked separately from dates and capacity.</p></div></details>
      <p className="plan-notice" aria-live="polite">{notice || (storageAvailable ? "Unfinished changes are kept in this browser." : "Changes are kept for this visit; browser storage is unavailable.")}</p>
    </div>
    <footer className="plan-save-bar"><div><span className={issues.length ? "plan-save-status needs-detail" : "plan-save-status"}>{issues.length ? <TriangleAlert size={15}/> : <Check size={15}/>} {issues.length ? "Adjust the highlighted details" : "Dates + capacity checked"}</span><small>Draft only · No staffing changes or notices sent</small></div><button type="submit" className="button button-primary">{editingMove ? "Save changes" : "Save to scenario"}<ArrowRight size={17}/></button></footer>
  </form>;
}
