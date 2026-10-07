"use client";
import { useState, type CSSProperties } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Diamond, Layers3, List, Search, SlidersHorizontal, AlertTriangle, ArrowUpRight } from "lucide-react";
import { ASSIGNMENTS, HOMES, HOME_META, TODAY } from "@/lib/data";
import { addDays, assignmentsFor, daysBetween, formatDate, inclusiveEnd, missionFor, nextRelease, scenarioAssignments, uncoveredHours } from "@/lib/domain";
import type { Assignment, Focus, Home, Obligation, Person, ScenarioMove } from "@/lib/types";
import { Avatar, EmptyState, Status } from "./ui";

type Props = {
  people: Person[]; home: Home | "all"; setHome: (value: Home | "all") => void;
  query: string; setQuery: (value: string) => void; weeks: number; setWeeks: (value: number) => void;
  focus: Focus; setFocus: (value: Focus) => void; onPerson: (id: string) => void; onReviewBlockers: (id: string) => void;
  onPlan: (id?: string) => void; obligations: Obligation[]; moves: ScenarioMove[];
  scenario: boolean; onScenario: () => void; scenarioName: string;
};

function Ribbon({ assignment, weeks, onClick, lane }: { assignment: Assignment; weeks: number; onClick: () => void; lane: number }) {
  const mission = missionFor(assignment.missionId);
  const start = Math.max(0, daysBetween(TODAY, assignment.start));
  const end = Math.min(weeks * 7, daysBetween(TODAY, assignment.end));
  if (end <= start) return null;
  const left = start / (weeks * 7) * 100;
  const width = (end - start) / (weeks * 7) * 100;
  const proposed = assignment.staffing !== "committed";
  const title = `${mission.client} · ${mission.name} · ${assignment.weeklyHours} h/week · ${formatDate(assignment.start)}–${formatDate(inclusiveEnd(assignment.end))} · ${proposed ? "Proposed staffing" : "Confirmed staffing"} · ${mission.commercial} · ${assignment.readiness}`;
  return <button className={`ribbon ${proposed ? "ribbon-proposed" : ""} ${assignment.readiness === "blocked" ? "ribbon-blocked" : ""}`} style={{ left: `${left}%`, width: `calc(${width}% - 5px)`, "--home": HOME_META[mission.home].color, "--lane": lane } as CSSProperties} onClick={onClick} title={title} aria-label={title}>
    <span className="ribbon-client">{mission.client}</span><span className="ribbon-name">{mission.name}</span><span className="ribbon-hours">{assignment.weeklyHours}h</span>
    {proposed ? <span className="ribbon-state">Proposed</span> : <span className="ribbon-bookend"><Diamond size={10} fill="currentColor" /></span>}
    {assignment.readiness === "blocked" && <AlertTriangle className="ribbon-alert" size={12} />}
  </button>;
}

export function Runway(props: Props) {
  const { people, home, setHome, query, setQuery, weeks, setWeeks, focus, setFocus, onPerson, onReviewBlockers, onPlan, obligations, moves, scenario, onScenario, scenarioName } = props;
  const [mode, setMode] = useState<"timeline" | "table">("timeline");
  const [collapsed, setCollapsed] = useState<Home[]>([]);
  const [sort, setSort] = useState("home");
  const dates = Array.from({ length: weeks }, (_, i) => addDays(TODAY, i * 7));
  const horizon = addDays(TODAY, weeks * 7);
  const focused = focus !== "all";
  const title = focus === "closing" ? "Closing bookends" : focus === "uncovered" ? "People needing a landing" : focus === "blocked" ? "People with start blockers" : "Mission runway";
  const allAssignments = scenario ? [...ASSIGNMENTS, ...scenarioAssignments(moves)] : ASSIGNMENTS;
  const groups = (sort === "release" ? [...HOMES].sort((a,b) => {
    const first = (h: Home) => people.filter(p => p.home === h).map(p => nextRelease(p.id)?.end || "9999").sort()[0] || "9999";
    return first(a).localeCompare(first(b));
  }) : HOMES).filter(h => people.some(p => p.home === h));
  return <section id="runway-results" className={`runway-panel${focused ? " runway-filtered" : ""}`} aria-labelledby="runway-title">
    <div className="panel-heading"><div className="title-with-icon"><span className="panel-icon"><Layers3 size={19} /></span><h2 id="runway-title" tabIndex={-1}>{title}</h2><span className="small-count">{people.length} people</span></div>{!focused && <div className="segmented"><button className={mode === "timeline" ? "selected" : ""} onClick={() => setMode("timeline")} aria-pressed={mode === "timeline"}><Layers3 size={14}/> <span>Timeline</span></button><button className={mode === "table" ? "selected" : ""} onClick={() => setMode("table")} aria-pressed={mode === "table"}><List size={14}/><span>Table</span></button></div>}</div>
    <div className="runway-toolbar"><label className="search-input"><Search size={15}/><input placeholder="Find your people…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search people"/></label><label className="select-control"><span className="filter-dot"/><select aria-label="Filter HOME" value={home} onChange={e => setHome(e.target.value as Home | "all")}><option value="all">All HOMEs</option>{HOMES.map(h => <option key={h}>{h}</option>)}</select><ChevronDown size={13}/></label><label className="select-control horizon-select"><select aria-label="Planning horizon" value={weeks} onChange={e => setWeeks(Number(e.target.value))}><option value={13}>13 weeks</option><option value={26}>26 weeks</option><option value={52}>12 months</option></select><ChevronDown size={13}/></label><button className={`scenario-chip ${scenario ? "is-active" : ""}`} onClick={onScenario}><span className="scenario-dot"/>{scenario ? scenarioName : "Approved plan"}<ChevronDown size={13}/></button><label className="sort-control" title="Sort runway"><SlidersHorizontal size={15}/><select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort runway"><option value="home">By HOME</option><option value="release">By release</option></select></label></div>
    {focused && <div className="filter-banner runway-action-banner"><div><strong>{focus === "blocked" ? "Clear the way for their next chapter." : "Choose a person. Plan their next chapter."}</strong><span>{home === "all" ? "All HOMEs" : home} · Next {weeks} weeks{query ? ` · Matching “${query}”` : ""}</span></div><button onClick={() => setFocus("all")}>Clear filter ×</button></div>}
    {scenario && <div className="scenario-banner"><span>◈</span><strong>Scenario workspace</strong><span>{moves.length} proposed {moves.length === 1 ? "move" : "moves"} · Approved staffing stays unchanged</span><button onClick={() => onPlan()}>Add move <ArrowRight size={14}/></button></div>}
    {!people.length ? <EmptyState title={focused ? "No people in this view." : "A little too specific?"} detail="Try another name, skill, or HOME to find your people." onReset={() => { setHome("all"); setQuery(""); setFocus("all"); }}/> : focused ? <ul className="runway-action-list" aria-label={title}>{(sort === "release" ? [...people].sort((a,b) => (nextRelease(a.id)?.end || "9999").localeCompare(nextRelease(b.id)?.end || "9999")) : people).map(person => {
      const release = nextRelease(person.id);
      const blockers = obligations.filter(item => item.personId === person.id && item.blocksStart && item.state !== "satisfied" && item.due < horizon);
      return <li className="runway-action-card" key={person.id}><button className="runway-action-person" onClick={() => onPerson(person.id)} aria-label={`View ${person.name}'s next chapter`}><Avatar person={person}/><span><strong>{person.name}</strong><small>{person.home} · {person.employment}</small></span><ArrowUpRight size={15}/></button><p>{focus === "closing" ? `Next bookend: ${release ? formatDate(inclusiveEnd(release.end)) : "To be confirmed"}` : focus === "uncovered" ? `Uncovered time in the next ${weeks} weeks` : `${blockers.length} ${blockers.length === 1 ? "check needs" : "checks need"} attention before starting`}</p><div className="runway-action-card-footer">{blockers.length > 0 ? <button className="runway-action-review" onClick={() => onReviewBlockers(person.id)} aria-label={`Review blockers for ${person.name}`}><AlertTriangle size={13}/>Review blockers</button> : <span>Ready to explore</span>}<button className="button button-primary" onClick={() => onPlan(person.id)} aria-label={`Plan next move for ${person.name}`}>Plan next move <ArrowRight size={14}/></button></div></li>;
    })}</ul> : mode === "table" ? <div className="semantic-table-wrap"><table className="semantic-table"><caption className="sr-only">Precise resource allocations and upcoming bookends</caption><thead><tr><th>Person / HOME</th><th>Next release</th><th>Allocated now</th><th>Uncovered in horizon</th><th>Readiness</th></tr></thead><tbody>{people.map(p => { const release = nextRelease(p.id); return <tr key={p.id}><th><button onClick={() => onPerson(p.id)}>{p.name}<span>{p.home} · {p.employment}</span></button></th><td>{release ? formatDate(inclusiveEnd(release.end)) : "Unknown"}</td><td>{assignmentsFor(p.id).filter(a=>a.staffing==="committed" && a.start <= TODAY && a.end>TODAY).reduce((sum,a)=>sum+a.weeklyHours,0)} / {p.weeklyHours}h</td><td>{uncoveredHours(p,TODAY,horizon).toLocaleString()}h <small>{p.employment === "1099" ? "availability" : "uncovered"}</small></td><td><Status type={obligations.some(o=>o.personId===p.id && o.blocksStart && o.state!=="satisfied") ? "blocked" : "good"}>{obligations.some(o=>o.personId===p.id && o.blocksStart && o.state!=="satisfied") ? "Start blocked" : "No start blocker"}</Status></td></tr>; })}</tbody></table></div> : <>
    <div className="timeline-desktop"><div className="timeline-scroll" role="region" aria-label="Mission timeline, scroll horizontally for longer horizons" tabIndex={0}><div className="timeline-content" style={{ minWidth: weeks > 13 ? `${250 + weeks * 54}px` : undefined }}>
      <div className="timeline-axis"><div className="axis-label">YOUR PEOPLE <span>HOURS / WEEK</span></div><div className="week-labels" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>{dates.map((d,i)=><div key={d} className={i===0 ? "this-week" : ""}><span>{i===0 || d.slice(5,7)!==dates[i-1]?.slice(5,7) ? formatDate(d).split(" ")[0].toUpperCase() : ""}</span><strong>{d.slice(8).replace(/^0/, "")}</strong>{i===0 && <i>TODAY</i>}</div>)}</div></div>
      {groups.map(h => <div key={h} className="home-group" style={{ "--home": HOME_META[h].color } as CSSProperties}>
        <button className="home-group-heading" onClick={()=>setCollapsed(prev=>prev.includes(h)?prev.filter(x=>x!==h):[...prev,h])} aria-expanded={!collapsed.includes(h)}>{collapsed.includes(h) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}<span className="home-symbol">{HOME_META[h].glyph}</span>{HOME_META[h].short}<span className="home-group-count">{people.filter(p=>p.home===h).length}</span><span className="group-line"/></button>
        {!collapsed.includes(h) && people.filter(p=>p.home===h).sort((a,b)=>sort==="release"?(nextRelease(a.id)?.end||"").localeCompare(nextRelease(b.id)?.end||""):0).map(p=>{
          const assignments = allAssignments.filter(a=>a.personId===p.id);
          const release = nextRelease(p.id);
          const relevant = assignments.filter(a => a.start < horizon && a.end > TODAY);
          const split = relevant.some((a,i)=>relevant.some((b,j)=>i!==j && a.start<b.end && b.start<a.end));
          const hasFuture = release && assignments.some(a=>a.id!==release.id && a.start>=release.end && a.staffing==="committed");
          const gapStart = release ? Math.max(0,daysBetween(TODAY,release.end)) / (weeks*7)*100 : 0;
          const blockers = obligations.filter(o=>o.personId===p.id&&o.blocksStart&&o.state!=="satisfied").length;
          return <div className={`person-row ${split ? "person-row-split" : ""}`} key={p.id}>
            <button className="person-label" onClick={()=>onPerson(p.id)}><Avatar person={p}/><span className="person-copy"><strong>{p.name}</strong><span>{p.grade} <i>·</i> {p.employment}</span></span><span className="person-capacity">{p.weeklyHours}<small>h</small></span></button>
            <div className="person-track" style={{ "--weeks": weeks } as CSSProperties}>
              <span className="today-line"/>
              {release && !hasFuture && gapStart<90 && <button className="gap-ribbon" style={{left:`${gapStart}%`, width:`${100-gapStart}%`}} onClick={()=>onPlan(p.id)} title={`Find a landing for ${p.name}`}><span>＋</span><span>{p.employment === "W2" ? "Next chapter?" : "Available"}</span><ArrowUpRight size={12}/></button>}
              {relevant.map((a,i)=><Ribbon key={a.id} assignment={a} weeks={weeks} lane={split?i%2:0} onClick={()=>onPerson(p.id)}/>)}
              {blockers>0 && <button className="track-blocker" title={`${blockers} start blocker for ${p.name}`} aria-label={`View ${p.name}'s start blockers`} onClick={()=>onPerson(p.id)}><AlertTriangle size={10}/>{blockers}</button>}
            </div>
          </div>;
        })}
      </div>)}
    </div></div></div>
    <div className="mobile-runway">{people.map(p=>{ const release=nextRelease(p.id);return <button className="mobile-person" key={p.id} onClick={()=>onPerson(p.id)} style={{"--home":HOME_META[p.home].color} as CSSProperties}><div><Avatar person={p}/><span><strong>{p.name}</strong><small>{p.home} · {p.employment} · {p.weeklyHours}h/week</small></span><ChevronRight size={16}/></div><div className="mobile-mission"><span className="home-dot"/>{release?missionFor(release.missionId).client:"No current mission"}<span>{release?`Ends ${formatDate(inclusiveEnd(release.end))}`:"Available now"}</span></div><div className="mobile-mini-timeline">{allAssignments.filter(a=>a.personId===p.id&&a.end>TODAY&&a.start<horizon).map(a=><span key={a.id} className={a.staffing!=="committed"?"proposed":""} style={{left:`${Math.max(0,daysBetween(TODAY,a.start))/(weeks*7)*100}%`,width:`${Math.min(weeks*7,daysBetween(TODAY,a.end))-Math.max(0,daysBetween(TODAY,a.start))>0?(Math.min(weeks*7,daysBetween(TODAY,a.end))-Math.max(0,daysBetween(TODAY,a.start)))/(weeks*7)*100:0}%`}}/>)}</div><span className="mobile-uncovered">{uncoveredHours(p,TODAY,horizon).toLocaleString()}h {p.employment==="W2"?"uncovered":"availability"} in this horizon</span></button>;})}</div>
    </>}
    <footer className="runway-footer"><div className="legend"><span><i className="legend-solid"/>Confirmed staffing</span><span><i className="legend-pattern"/>Proposed</span><span><Diamond size={10}/>Bookend</span><span><i className="legend-gap"/>Uncovered</span></div><span>Oct 5 — {formatDate(inclusiveEnd(horizon))}, {horizon.slice(0,4)} <span className="precision-label">· Weekly view</span></span></footer>
  </section>;
}
