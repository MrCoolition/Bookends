"use client";

import { CalendarClock, ArrowRight } from "lucide-react";
import type { ForecastResult, ForecastRoleResult, ForecastScenario } from "@/lib/forecast/types";
import { needsTimingChange } from "@/lib/scheduling/engagement-bookends";
import { TimingTrack } from "./client-timing-panel";

export function ClientTimingForecast({ result, scenario, onShift, disabled }: {
  result: ForecastResult; scenario: ForecastScenario; onShift: (missionId: string, shiftDays: number) => void; disabled: boolean;
}) {
  const rows = result.roles.filter(role => role.clientTiming);
  if (!rows.length) return null;
  const issues = rows.filter(role => needsTimingChange(role.clientTiming!.start) || needsTimingChange(role.clientTiming!.end));
  const advisories = rows.filter(role => [role.clientTiming!.start, role.clientTiming!.end].some(assessment => assessment.checks.some(check => check.enforcement === "advisory" && (check.delayDays === null || check.delayDays > 0))));
  const priority = rows.filter(role => issues.includes(role) || advisories.includes(role));
  const aligned = rows.filter(role => !priority.includes(role));
  function rowView(role: ForecastRoleResult) {
    const currentShift = scenario.selections.find(selection => selection.missionId === role.missionId)?.shiftDays ?? 0;
    return <article className="cb-forecast-item" key={role.key}><header><div><strong>{role.roleName}</strong><small>{role.clientName} · {role.missionName}</small></div><span className="cb-forecast-mode">{role.baseline ? "Signed dates retained" : "What if"}</span></header>
      {(["start", "end"] as const).map(phase => {
        const assessment = role.clientTiming![phase];
        if (assessment.status === "unconfigured") return null;
        const nextShift = currentShift + (assessment.delayDays ?? 0), canTry = !role.baseline && assessment.status === "delayed" && nextShift <= 730;
        return <div className="cb-phase" key={phase}><TimingTrack assessment={assessment} phase={phase}/>
          <p className="cb-timing-context">{assessment.checks.map(check => `${check.name}${check.enforcement === "advisory" ? ` (advisory${check.delayDays ? `: +${check.delayDays}d` : check.delayDays === null ? ": no upcoming window" : ""})` : ""}`).join(" · ")}</p>
          {assessment.status === "blocked" && <p className="cb-timing-warning">{assessment.reason || "No common window found. Review the client’s timing rules."}</p>}
          {canTry && <button type="button" className="cb-apply" disabled={disabled} onClick={() => onShift(role.missionId, nextShift)}>Try +{assessment.delayDays} days for this SOW<ArrowRight size={14}/></button>}
          {!role.baseline && assessment.status === "delayed" && !canTry && <p className="cb-timing-warning">The next opening is beyond the scenario’s two-year shift limit. Review the potential SOW dates.</p>}
        </div>;
      })}
    </article>;
  }
  return <section className="cb-timing-panel is-compact" aria-label="Client timing in this scenario">
    <div className="cb-timing-heading"><span className="cb-calendar-icon"><CalendarClock size={22}/></span><div><p>CLIENT BOOKENDS</p><h3>{issues.length ? `${issues.length} ${issues.length === 1 ? "role is" : "roles are"} waiting on timing` : advisories.length ? "Required dates fit. Review the advisories." : "Your client windows line up."}</h3></div><a href="/admin?section=clients">Client setup<ArrowRight size={13}/></a></div>
    <p className="cb-timing-context">Notice checked from the planning start or a later expected close. Confirm existing bookings. Demand and hiring dates stay as planned until you try a shift.</p>
    <div className="cb-forecast-list">{priority.slice(0, 3).map(rowView)}</div>
    {priority.length > 3 && <details className="cb-all-timing"><summary>Show {priority.length - 3} more timing checks</summary><div className="cb-forecast-list">{priority.slice(3).map(rowView)}</div></details>}
    {aligned.length > 0 && <details className="cb-all-timing"><summary>{aligned.length} {aligned.length === 1 ? "role fits" : "roles fit"} required windows · view details</summary><div className="cb-forecast-list">{aligned.map(rowView)}</div></details>}
    <p className="cb-timing-footnote">Trying a shift moves every role in this potential SOW and recalculates capacity and hiring. Other roles and exit windows are checked again. Signed plans and commitments keep their dates.</p>
  </section>;
}
