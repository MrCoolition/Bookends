"use client";

import { CalendarClock, CalendarDays, Check, Clock3, ArrowRight, CircleHelp } from "lucide-react";
import { useMemo } from "react";
import type { AdminClient } from "@/lib/admin/contracts";
import type { EngagementPlan } from "@/lib/admin/engagement";
import { assessEngagementBookends, needsTimingChange, type ClientTimingAssessment } from "@/lib/scheduling/engagement-bookends";

const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const hasAdvisory = (assessment: ClientTimingAssessment) => assessment.checks.some(check => check.enforcement === "advisory" && (check.delayDays === null || check.delayDays > 0));

export function TimingTrack({ assessment, phase }: { assessment: ClientTimingAssessment; phase: "start" | "end" }) {
  const changed = needsTimingChange(assessment);
  const advisory = hasAdvisory(assessment);
  const required = assessment.checks.some(check => check.enforcement === "required");
  return <div className={`cb-timing-track${changed ? " has-wait" : ""}`}>
    <span><small>Planned {phase}</small><strong>{dateLabel(assessment.requestedDate)}</strong></span>
    <span className="cb-timing-connector" aria-hidden="true"><i/><ArrowRight size={14}/></span>
    <span><small>{changed ? "Next eligible date" : required ? "Fits required windows" : "Planned date retained"}</small><strong>{assessment.eligibleDate ? dateLabel(assessment.eligibleDate) : "No shared opening"}</strong></span>
    <b className={`cb-timing-badge${changed || advisory ? " is-wait" : ""}`}>{assessment.status === "blocked" || advisory ? <CircleHelp size={13}/> : changed ? <Clock3 size={13}/> : <Check size={13}/>}{assessment.status === "blocked" ? "Review windows" : changed ? `${assessment.delayDays}d wait` : advisory ? "Advisory to review" : "Aligned"}</b>
  </div>;
}

export function ClientTimingPanel({ client, plan, readyOn, onApply, compact = false }: {
  client?: AdminClient; plan: EngagementPlan; readyOn: string; compact?: boolean;
  onApply?: (roleId: string, phase: "start" | "end", date: string) => void;
}) {
  const rows = useMemo(() => assessEngagementBookends(client, plan, readyOn), [client, plan, readyOn]);
  if (!rows.length) return null;
  const issues = rows.filter(row => needsTimingChange(row.start) || needsTimingChange(row.end));
  const advisories = rows.filter(row => hasAdvisory(row.start) || hasAdvisory(row.end));
  const priority = rows.filter(row => issues.includes(row) || advisories.includes(row));
  const shown = priority.slice(0, 3), remaining = rows.filter(row => !shown.includes(row));
  const renderRow = (row: typeof rows[number]) => <div className="cb-timing-role" key={row.roleId}>
      {plan.roles.length > 0 && <strong className="cb-role-title">{row.roleName}</strong>}
      {(["start", "end"] as const).map(phase => {
        const assessment = row[phase];
        if (assessment.status === "unconfigured") return null;
        return <div key={phase} className="cb-phase"><TimingTrack assessment={assessment} phase={phase}/>
          {assessment.reason && assessment.status === "blocked" && <p className="cb-timing-warning">{assessment.reason}</p>}
          <details className="cb-rule-details" open={hasAdvisory(assessment) || undefined}><summary><CalendarDays size={13}/>{assessment.checks.length} {phase === "start" ? "entry" : "exit"} {assessment.checks.length === 1 ? "window" : "windows"}</summary><ul>{assessment.checks.map(check => <li key={check.bookendId}><span><strong>{check.name}</strong><small>{check.enforcement === "advisory" ? "Advisory · " : "Required · "}{check.windowStart ? `${dateLabel(check.windowStart)}${check.windowEnd !== check.windowStart && check.windowEnd ? ` – ${dateLabel(check.windowEnd)}` : ""}` : "No eligible window"}{check.cutoff ? ` · notice by ${dateLabel(check.cutoff)}` : ""}</small></span>{check.delayDays !== null && check.delayDays > 0 && <b>+{check.delayDays}d</b>}</li>)}</ul></details>
          {onApply && plan.status === "draft" && assessment.status === "delayed" && assessment.eligibleDate && <button className="cb-apply" type="button" onClick={() => onApply(row.roleId, phase, assessment.eligibleDate!)}>{phase === "start" ? "Move to next opening" : "Extend to next exit window"}<ArrowRight size={14}/></button>}
        </div>;
      })}
    </div>;
  return <section className={`cb-timing-panel${compact ? " is-compact" : ""}`} aria-label="Client timing">
    <div className="cb-timing-heading"><span className="cb-calendar-icon"><CalendarClock size={22}/></span><div><p>CLIENT BOOKENDS · {client?.name}</p><h3>{issues.length ? `${issues.length} ${issues.length === 1 ? "role needs" : "roles need"} a timing check` : advisories.length ? "Required dates fit. Review the advisories." : "The timing fits."}</h3></div><a href="/admin?section=clients">Client setup<ArrowRight size={13}/></a></div>
    <p className="cb-timing-context">Notice checked from {dateLabel(readyOn)}. Client windows and teammate availability are separate checks.</p>
    {shown.length > 0 && <div className="cb-timing-rows">{shown.map(renderRow)}</div>}
    {remaining.length > 0 && <details className="cb-all-timing"><summary>Review {remaining.length} {remaining.length === 1 ? "role’s windows" : "more role windows"}</summary><div className="cb-timing-rows">{remaining.map(renderRow)}</div></details>}
    <p className="cb-timing-footnote">{plan.status === "draft" && onApply ? "Moving a role’s start keeps its duration; extending its end adds time. Review dates and availability before saving." : "Planned dates stay in place. Confirm client booking and prerequisites before committing."}</p>
  </section>;
}
