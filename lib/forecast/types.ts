/** Planning facts and hypotheses. None of these records authorize staffing. */
export type PipelineStage = "exploring" | "qualified" | "proposal" | "negotiation" | "lost";
export type ForecastScenario = { id: string; name: string; selections: { missionId: string; included: boolean; shiftDays: number; teamScale: number }[]; hiringLeadWeeks: number; asOf?: string; horizonMonths?: number };
export type PlanningCapacity = { resourceId: string; allocationPercent: number; availableFrom: string; availableUntil: string | null; notes: string };
export type PlanningCommitment = { id: string; resourceId: string; missionId: string | null; name: string; start: string; end: string; allocationPercent: number };
export type ForecastWorkspace = { version: 1; revision: number; scenarios: ForecastScenario[]; capacities: PlanningCapacity[]; commitments: PlanningCommitment[] };
export type ForecastCandidate = { resourceId: string; name: string; status: "available" | "unknown" | "busy"; minimumAvailablePercent: number; reason: string };
export type ForecastMonth = { month: string; label: string; demandFte: number; baselineFte: number; potentialFte: number; confirmedCoverageFte: number; unknownCoverageFte: number; hiringGapFte: number; capacityFte: number };
export type ForecastRoleResult = {
  key: string; missionId: string; missionName: string; clientName: string; roleId: string; roleName: string; baseline: boolean;
  start: string; end: string; seats: number; allocationPercent: number; skills: string[]; confidence: number | null;
  confirmedSeats: number; unknownSeats: number; hiringGapSeats: number; firstGapDate: string | null; hireBy: string | null;
  candidates: ForecastCandidate[];
};
export type ForecastSummary = { potentialCount: number; baselineCount: number; peakDemandFte: number; peakHiringGapFte: number; hiringGapSeats: number; unknownCapacityPeople: number; confirmedCapacityPeople: number; firstHireBy: string | null };
export type ForecastResult = { asOf: string; months: ForecastMonth[]; roles: ForecastRoleResult[]; summary: ForecastSummary; warnings: string[]; method: string };
export function emptyForecast(): ForecastWorkspace { return { version: 1, revision: 0, scenarios: [], capacities: [], commitments: [] }; }
