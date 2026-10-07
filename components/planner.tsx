"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, Clock3, Compass, Flag, ShieldCheck, Sparkles, TriangleAlert, WandSparkles } from "lucide-react";
import { MISSIONS, PEOPLE, TODAY } from "@/lib/data";
import { addDays, dateNumber, evaluateMove, inclusiveEnd, matching, missionFor, validDate, workingDays } from "@/lib/domain";
import { availableWeeklyHours, getMoveGuidance, recommendMove } from "@/lib/planning";
import type { DemoState, Mission, Person, ScenarioMove } from "@/lib/types";
import { Avatar } from "./ui";

type Draft = { personId: string; missionId: string; start: string; lastDay: string; hours: string; step?: 1 | 2 };
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
  const [step, setStep] = useState<1 | 2 | 3>(initial.restored ? initial.draft.step === 1 ? 1 : 2 : editingMove ? 2 : 1);
  const [showAll, setShowAll] = useState(false);
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
  const landings = useMemo(() => [...MISSIONS].filter(m => m.end > TODAY)
    .map(item => ({ mission: item, plan: recommendMove(person, item, state.moves, editingMove?.id) }))
    .filter(item => item.plan).sort((a, b) => fitScore(person, a.mission) - fitScore(person, b.mission)), [person, state.moves, editingMove?.id]);
  const available = useMemo(() => availableWeeklyHours(person, mission, draft.start, end, state.moves, editingMove?.id), [person, mission, draft.start, end, state.moves, editingMove?.id]);
  const guidance = useMemo(() => getMoveGuidance(person, mission, { start: draft.start, end, weeklyHours: Number(draft.hours) }, state.moves, editingMove?.id), [person, mission, draft.start, end, draft.hours, state.moves, editingMove?.id]);
  const fit = matching(person, mission, state.obligations);
  const startError = !validDate(draft.start) ? "Choose a complete start date."
    : draft.start < firstAllowed || draft.start > lastAllowed ? `Choose ${dateLabel(firstAllowed)} through ${dateLabel(lastAllowed)}.` : "";
  const endError = !validDate(draft.lastDay) ? "Choose a complete end date."
    : draft.lastDay < draft.start ? `End on or after ${dateLabel(draft.start)}.`
    : draft.lastDay > lastAllowed || draft.lastDay < firstAllowed ? `Keep the end date within this mission: ${dateLabel(lastAllowed)} or earlier.` : "";
  const hoursError = draft.hours.trim() === "" || !Number.isFinite(move.weeklyHours) || move.weeklyHours <= 0 || !Number.isInteger(move.weeklyHours * 4)
    ? "Enter positive hours in 0.25-hour steps."
    : !startError && !endError && move.weeklyHours > available ? available > 0 ? `This window fits up to ${available} h/week. Use fewer hours or choose another window.` : "No shared capacity in this window. Choose an open landing above." : "";
  const fieldErrors = [startError, endError, hoursError].filter(Boolean);
  const issues = fieldErrors.length ? fieldErrors : evaluateMove(move, person, mission, state.moves);
  const recommendedIsCurrent = suggestion && suggestion.start === draft.start && suggestion.end === end && suggestion.weeklyHours === move.weeklyHours;
  const reviewCount = fit.missing.length + fit.blockers.length + (mission.commercial === "authorized" ? 0 : 1) + (person.home === mission.home ? 0 : 1);
  const workdayCount = !startError && !endError ? workingDays(draft.start, end).length : 0;
  const headingRef = useRef<HTMLHeadingElement>(null);

  function goTo(next: 1 | 2 | 3) {
    setStep(next);
    requestAnimationFrame(() => { formRef.current?.querySelector(".planner-scroll")?.scrollTo({ top: 0 }); headingRef.current?.focus({ preventScroll: true }); });
  }

  function focusIssue() {
    setAttempted(true);
    if (step !== 2) setStep(2);
    requestAnimationFrame(() => {
      const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? formRef.current?.querySelector<HTMLElement>("#plan-feedback");
      field?.focus(); field?.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
  }

  useEffect(() => {
    if (saving.current) return;
    // Resume a final review at dates/hours so current reservations are checked again.
    const resumable = { ...draft, step: step === 1 ? 1 as const : 2 as const };
    memoryDrafts.set(storageKey, resumable);
    try { localStorage.setItem(storageKey, JSON.stringify(resumable)); setStorageAvailable(true); }
    catch { setStorageAvailable(false); }
  }, [draft, storageKey, step]);

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
    setNotice("Suggested dates and available hours applied. Your move is ready to review.");
  }
  function chooseLanding(missionId: string) { changeSelection(person.id, missionId); goTo(2); }
  function applyOption(option: { missionId: string; start: string; end: string; weeklyHours: number }) {
    setDraft({ personId: person.id, missionId: option.missionId, start: option.start, lastDay: inclusiveEnd(option.end), hours: String(option.weeklyHours) });
    setAttempted(false); setNotice("A workable plan, selected. Adjust it or review your move."); goTo(2);
  }
  function useWindow(weeks?: number) {
    if (!suggestion) return;
    const until = weeks ? [addDays(suggestion.start, weeks * 7), suggestion.end].sort()[0] : suggestion.end;
    const days = workingDays(suggestion.start, until);
    if (!days.length) return;
    setDraft(current => ({ ...current, start: days[0], lastDay: days[days.length - 1], hours: String(suggestion.weeklyHours) }));
    setAttempted(false); setNotice("Window selected. Dates and capacity have been checked.");
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
      focusIssue();
      return;
    }
    if (step !== 3) { goTo(step === 1 ? 2 : 3); return; }
    saving.current = true;
    memoryDrafts.delete(storageKey);
    try { localStorage.removeItem(storageKey); } catch { /* Saving still works for this visit. */ }
    onSave({ ...move, id: editingMove?.id ?? crypto.randomUUID() });
  }

  return <form ref={formRef} className="move-planner guided-planner" onSubmit={save} noValidate>
    <nav className="plan-steps" aria-label="Planning steps">
      {([1, 2, 3] as const).map((item, index) => <button key={item} type="button" aria-label={["Choose a landing", "Dates & hours", "Review & save"][index]} aria-current={step === item ? "step" : undefined} disabled={item === 3 && issues.length > 0} onClick={() => goTo(item)}><span aria-hidden="true">{step > item ? <Check size={14}/> : `0${item}`}</span><strong>{["Choose a landing", "Dates & hours", "Review & save"][index]}</strong></button>)}
    </nav>
    <div className="planner-scroll">
      <div className="plan-stage" key={step}>
        <div className="plan-stage-heading"><div><p className="plan-kicker">{step === 1 ? "A WORLD OF POSSIBILITIES" : step === 2 ? "MAKE ROOM FOR WHAT’S NEXT" : "ONE GOOD MOVE. A NEW CHAPTER."}</p><h3 ref={headingRef} tabIndex={-1}>{step === 1 ? `Where should ${person.name.split(" ")[0]} land?` : step === 2 ? "Find your rhythm." : "Looking good. Let’s review."}</h3><p>{step === 1 ? "Pick a mission with room to grow. We’ll help with the dates." : step === 2 ? "Choose a window and a pace. Watch your plan take shape." : "Check the details, then add this possibility to your scenario."}</p></div><div className={`plan-stage-symbol symbol-${step}`} aria-hidden="true">{step === 1 ? <Compass/> : step === 2 ? <CalendarDays/> : <Flag/>}<span/><i/></div></div>

        {step === 1 && <>
          <div className="plan-person-picker"><Avatar person={person}/><label htmlFor="plan-person">Who’s making the move?<select id="plan-person" value={draft.personId} onChange={e => changeSelection(e.target.value, draft.missionId)}>{PEOPLE.map(p => <option key={p.id} value={p.id}>{p.name} · {p.home}</option>)}</select></label><span>{person.weeklyHours}<small>h / week</small></span></div>
          {!suggestion && <div className="plan-blocked-landing"><TriangleAlert size={19}/><div><strong>No open window for this pairing.</strong><p>{guidance.blockers[0]?.message || "There isn’t a workable window for this person and mission."} Pick an open landing below.</p></div></div>}
          <div className="plan-options-heading"><h4><Sparkles size={16}/> Open landings for {person.name.split(" ")[0]}</h4><span>{landings.length} available {landings.length === 1 ? "option" : "options"}</span></div>
          <div className="plan-landing-grid">{landings.slice(0, showAll ? landings.length : 3).map(({ mission: item, plan }, index) => <button key={item.id} type="button" className={`plan-landing-card ${item.id === mission.id ? "is-selected" : ""}`} aria-label={`Choose ${item.client} · ${item.name}`} aria-describedby={`landing-window-${item.id} landing-review-${item.id}`} onClick={() => chooseLanding(item.id)}><div className="plan-card-top"><span className={`plan-mission-mark mark-${index % 3}`}>{item.initials}</span><span className="plan-card-badge">{item.id === mission.id ? <><Check size={12}/> Selected</> : index === 0 ? "Closest skill fit" : "Capacity fits"}</span></div><strong>{item.client}</strong><span className="plan-card-name">{item.name}</span><div className="plan-card-skills">{item.skills.map(skill => <span key={skill}>{person.skills.includes(skill) ? <Check size={10}/> : <span aria-hidden="true">○</span>}{skill}</span>)}</div><div className="plan-card-window" id={`landing-window-${item.id}`}><CalendarDays size={13}/><span>{dateLabel(plan!.start)}<br/>{dateLabel(inclusiveEnd(plan!.end))}</span><b>{plan!.weeklyHours}<small>h/wk</small></b></div><div className="plan-card-bottom" id={`landing-review-${item.id}`}><span>{item.commercial !== "authorized" ? "Commercial review needed" : item.home !== person.home || item.skills.some(skill => !person.skills.includes(skill)) ? "Skills / HOME review needed" : "Skills aligned"}</span><ArrowRight size={17}/></div></button>)}</div>
          {!landings.length && <div className="plan-no-landings"><Compass size={30}/><h4>No open landing for this teammate yet.</h4><p>Existing commitments and saved scenario moves use the available capacity. Try another teammate above, or review your saved moves before adding more work.</p></div>}
          {landings.length > 3 && <button type="button" className="plan-show-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show closest options" : `Explore all ${landings.length} open landings`}<ChevronDown size={15}/></button>}
          <details className="plan-all-missions"><summary>Looking for a specific mission?</summary><label htmlFor="plan-mission">Where could they land?<select id="plan-mission" value={draft.missionId} onChange={e => changeSelection(draft.personId, e.target.value)}>{MISSIONS.filter(m => m.end > TODAY).map(m => <option key={m.id} value={m.id}>{m.client} · {m.name}</option>)}</select></label><p>Every mission is listed here. We’ll explain when a pairing has no room.</p></details>
          <p className="plan-choice-note">Capacity is checked against current commitments and your saved scenario. Skills, prerequisites, and approval still need review.</p>
        </>}

        {step === 2 && <>
          <div className="plan-route"><Avatar person={person}/><div><strong>{person.name}</strong><span>{person.home} · {person.weeklyHours}h capacity</span></div><ArrowRight size={18}/><div className="plan-route-destination"><strong>{mission.client}</strong><span>{mission.name}</span></div><button type="button" onClick={() => goTo(1)}>Change</button></div>
          {issues.length > 0 && <div className="plan-feedback" id="plan-feedback" tabIndex={-1} role={attempted ? "alert" : "status"}><TriangleAlert size={19}/><div><strong>{!suggestion ? "No open window for this pairing." : "Let’s find a window that works."}</strong><p>{startError || endError || guidance.blockers[0]?.message || issues[0]}</p>{!startError && !endError && guidance.blockers.slice(1).map((blocker, index) => <p key={index}>{blocker.message}</p>)}<div className="plan-recovery-options">{guidance.options.map((option, index) => <button type="button" key={`${option.missionId}-${index}`} onClick={() => applyOption(option)}><span>{option.title}</span><small>{dateLabel(option.start)} — {dateLabel(inclusiveEnd(option.end))} · {option.weeklyHours}h/week</small><ArrowRight size={16}/></button>)}</div>{!guidance.options.length && <button type="button" onClick={() => goTo(1)}>Choose another person or mission <ArrowRight size={15}/></button>}</div></div>}
          <section className="plan-capacity-board" aria-label="Capacity for these dates"><div className="plan-capacity-heading"><span>THE SPACE TO MAKE IT WORK</span><span>{!startError && !endError ? "Selected dates" : "Choose valid dates below"}</span></div><div className="plan-capacity-metrics"><div><span>{person.name.split(" ")[0]}’s space</span><strong>{guidance.personAvailableHours}<small>h/wk</small></strong></div><span className="plan-capacity-symbol">∩</span><div><span>{mission.client}’s space</span><strong>{guidance.missionAvailableHours}<small>h/wk</small></strong></div><span className="plan-capacity-symbol">=</span><div className="plan-capacity-result"><span>Fits together</span><strong>{available}<small>h/wk</small></strong></div></div><CapacityTimeline person={person} mission={mission} moves={state.moves} excludeId={editingMove?.id} start={draft.start} end={end}/></section>
          {suggestion && <div className="plan-window-picks"><span>Pick a window</span><div><button type="button" className={recommendedIsCurrent ? "selected" : ""} onClick={() => useWindow()}><WandSparkles size={14}/>{recommendedIsCurrent ? "Full available run selected" : "Full available run"}</button>{[4, 8].filter(weeks => addDays(suggestion.start, weeks * 7) < suggestion.end).map(weeks => <button type="button" key={weeks} onClick={() => useWindow(weeks)}>First {weeks} weeks</button>)}</div></div>}
          {!issues.length && suggestion && guidance.options.filter(option => option.kind === "change_dates" && option.missionId === mission.id && option.start < suggestion.start).map(option => <button type="button" className="plan-early-window" key={option.start} onClick={() => applyOption(option)}><Clock3 size={17}/><span><strong>{option.title}</strong><small>{dateLabel(option.start)} — {dateLabel(inclusiveEnd(option.end))} · {option.weeklyHours}h/week</small></span><ArrowRight size={17}/></button>)}
          <div className="plan-section-heading"><span><strong>Make the dates yours</strong></span>{suggestion && !recommendedIsCurrent && <button type="button" className="plan-suggest" onClick={useSuggestion}><WandSparkles size={14}/> Use suggested plan</button>}</div>
          <div className="plan-fields">
            <div><label htmlFor="plan-start">First working date<input id="plan-start" type="date" min={firstAllowed} max={lastAllowed} value={draft.start} aria-invalid={!!startError} aria-describedby="plan-start-hint" onChange={e => update("start", e.target.value)} onBlur={finishStartEdit}/></label><span id="plan-start-hint" className={startError ? "plan-field-error" : "plan-field-hint"}>{startError || dateLabel(draft.start)}</span></div>
            <div><label htmlFor="plan-end">Last working date<input id="plan-end" type="date" min={!startError ? draft.start : firstAllowed} max={lastAllowed} value={draft.lastDay} aria-invalid={!!endError} aria-describedby="plan-end-hint" onChange={e => update("lastDay", e.target.value)}/></label><span id="plan-end-hint" className={endError ? "plan-field-error" : "plan-field-hint"}>{endError || `${dateLabel(draft.lastDay)} · included`}</span></div>
          </div>
          <div className="plan-section-heading"><span><strong>Set the pace</strong></span><span className="plan-working-note">Monday–Friday</span></div>
          <div className="plan-hours-row"><div><label htmlFor="plan-hours">Hours per week<div className="plan-hours-input"><input id="plan-hours" type="number" min="0.25" step="0.25" max={person.weeklyHours} value={draft.hours} aria-invalid={!!hoursError} aria-describedby="plan-hours-hint" onChange={e => update("hours", e.target.value)}/><span>h / week</span></div></label><span id="plan-hours-hint" className={hoursError ? "plan-field-error" : "plan-field-hint"}>{hoursError || "A pace that fits alongside existing work."}</span></div><div className="plan-availability"><div><Clock3 size={15}/><span><strong>{available}h</strong> available each week</span></div><div className="plan-capacity-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, available / person.weeklyHours * 100))}%` }}/></div>{available > 0 && String(available) !== draft.hours && <button type="button" onClick={() => update("hours", String(available))}>Use available hours <ArrowRight size={13}/></button>}</div></div>
          <div className="plan-hour-presets" aria-label="Quick weekly hours">{[...new Set([8, 16, 24, 32, 40, available])].filter(hours => hours > 0 && hours <= person.weeklyHours).sort((a, b) => a - b).map(hours => <button type="button" key={hours} disabled={hours > available} aria-pressed={Number(draft.hours) === hours} onClick={() => update("hours", String(hours))}>{hours}<small>h</small>{hours === available && <span>max fit</span>}</button>)}</div>
        </>}

        {step === 3 && <>
          <div className="plan-ticket"><div className="plan-ticket-top"><span>YOUR NEXT CHAPTER</span><span><span className="plan-ticket-dot"/> SCENARIO DRAFT</span></div><div className="plan-ticket-route"><div><Avatar person={person} large/><h4>{person.name}</h4><span>{person.home}</span></div><div className="plan-ticket-connection" aria-hidden="true"><span/><ArrowRight size={28}/><span/></div><div><span className="plan-ticket-client">{mission.initials}</span><h4>{mission.client}</h4><span>{mission.name}</span></div></div><div className="plan-ticket-facts"><div><span>FIRST DAY</span><strong>{dateLabel(draft.start)}</strong></div><div><span>LAST DAY</span><strong>{dateLabel(draft.lastDay)}</strong></div><div><span>YOUR PACE</span><strong>{draft.hours}<small> h/week</small></strong></div><div><span>WORKING DAYS</span><strong>{workdayCount}</strong></div></div><div className="plan-ticket-bottom"><span><Check size={16}/> Dates + capacity checked</span><button type="button" onClick={() => goTo(2)}>Adjust this move <ArrowLeft size={14}/></button></div></div>
          <details className="plan-readiness" open={reviewCount > 0}><summary><ShieldCheck size={17}/><span>{reviewCount ? `${reviewCount} ${reviewCount === 1 ? "item" : "items"} to review before a real assignment` : "Skills aligned · approval is a separate step"}</span><ChevronDown size={15}/></summary><div><p>{mission.commercial === "authorized" ? "Commercially authorized" : "Commercial approval needed"} · Approval owner: {mission.owner}.</p><div className="skill-tags">{mission.skills.map(skill => <span key={skill} className={person.skills.includes(skill) ? "skill-match" : "skill-missing"}>{person.skills.includes(skill) ? <Check size={12}/> : <TriangleAlert size={12}/>} {skill}</span>)}</div>{fit.blockers.map(o => <p key={o.id}>{o.title} · {o.owner}</p>)}{person.home !== mission.home && <p>Cross-HOME review also needed from {person.owner}.</p>}<p>Saving adds a proposal to your scenario. It does not confirm staffing, approve readiness, or notify anyone.</p></div></details>
          <div className="plan-after-save"><Flag size={20}/><div><strong>Next: see the bigger picture.</strong><p>Your move joins the scenario. You can edit it, add another teammate, or compare the plan before requesting review.</p></div></div>
        </>}
        <p className="plan-notice" aria-live="polite">{notice || (storageAvailable ? "Unfinished changes are kept in this browser." : "Changes are kept for this visit; browser storage is unavailable.")}</p>
      </div>
    </div>
    <footer className="plan-save-bar"><div className="plan-footer-context">{step > 1 && <button className="plan-step-back" aria-label="Back a planning step" type="button" onClick={() => goTo(step === 3 ? 2 : 1)}><ArrowLeft size={16}/><span>Back</span></button>}<div><span className="plan-save-status">Step {step} of 3 <span aria-hidden="true">·</span> {step === 1 ? "Find the fit" : step === 2 ? issues.length ? "Find room for this move" : "Your plan is taking shape" : "Ready for your scenario"}</span><small>Draft only · No staffing changes or notices sent</small></div></div>{step === 1 ? <button type="button" className="button button-primary" disabled={!suggestion && !landings.length} onClick={() => suggestion ? goTo(2) : chooseLanding(landings[0].mission.id)}>{suggestion ? "Choose dates & hours" : "Try an open landing"}<ArrowRight size={17}/></button> : step === 2 && !suggestion ? <button type="button" className="button button-primary" onClick={() => goTo(1)}>Choose another landing<ArrowRight size={17}/></button> : <button type="submit" className="button button-primary">{step === 2 ? "Review this move" : editingMove ? "Save changes" : "Save to scenario"}{step === 3 ? <Check size={17}/> : <ArrowRight size={17}/>}</button>}</footer>
  </form>;
}

function CapacityTimeline({ person, mission, moves, excludeId, start, end }: { person: Person; mission: Mission; moves: ScenarioMove[]; excludeId?: string; start: string; end: string }) {
  const first = mission.start > TODAY ? mission.start : TODAY;
  const weeks = useMemo(() => {
    const result: { start: string; end: string; hours: number }[] = [];
    for (let day = first; day < mission.end && result.length < 105; day = addDays(day, 7)) {
      const until = addDays(day, 7) < mission.end ? addDays(day, 7) : mission.end;
      result.push({ start: day, end: until, hours: availableWeeklyHours(person, mission, day, until, moves, excludeId) });
    }
    return result;
  }, [first, mission, person, moves, excludeId]);
  return <figure className="plan-week-map"><figcaption><span>Room for this pairing, week by week</span><span><i/> Open capacity</span></figcaption><div className="plan-week-bars" role="img" aria-label={`${weeks.filter(week => week.hours > 0).length} of ${weeks.length} weeks have open capacity. Exact capacity for your selected dates is shown above.`}>{weeks.map(week => <span key={week.start} className={`${week.hours > 0 ? "has-room" : "no-room"} ${week.start < end && week.end > start ? "in-window" : ""}`} title={`${dateLabel(week.start)} — ${dateLabel(inclusiveEnd(week.end))}: ${week.hours}h/week available`}><i style={{ height: `${Math.max(8, week.hours / person.weeklyHours * 100)}%` }}/></span>)}</div><div className="plan-week-labels"><span>{dateLabel(first)}</span><span>{dateLabel(inclusiveEnd(mission.end))}</span></div></figure>;
}
