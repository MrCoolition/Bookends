import { ASSIGNMENTS, TODAY } from "./data";
import { addDays, daysBetween, validDate, workingDays } from "./domain";
import type { Mission, Person, ScenarioMove } from "./types";

export type MoveRecommendation = Pick<ScenarioMove, "start" | "end" | "weeklyHours">;

const MAX_PLACEMENT_DAYS = 730;

function validSpan(start: string, end: string) {
  return validDate(start) && validDate(end) && start < end;
}

function availabilityFor(person: Person, mission: Mission, moves: ScenarioMove[], excludeId?: string) {
  const commitments = ASSIGNMENTS.filter(assignment => assignment.staffing === "committed"
    && (assignment.personId === person.id || assignment.missionId === mission.id));
  const drafts = moves.filter(move => move.id !== excludeId
    && (move.personId === person.id || move.missionId === mission.id));
  const placements = [...commitments, ...drafts];

  return (day: string) => {
    let personHours = 0;
    let missionHours = 0;
    for (const placement of placements) {
      if (placement.start > day || placement.end <= day) continue;
      if (placement.personId === person.id) personHours += placement.weeklyHours;
      if (placement.missionId === mission.id) missionHours += placement.weeklyHours;
    }
    const remaining = Math.min(person.weeklyHours - personHours, mission.weeklyHours - missionHours);
    return Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining * 4) / 4) : 0;
  };
}

/** Minimum assignable weekly hours across every working day in a half-open span. */
export function availableWeeklyHours(
  person: Person,
  mission: Mission,
  start: string,
  end: string,
  moves: ScenarioMove[] = [],
  excludeId?: string,
): number {
  if (!validSpan(mission.start, mission.end) || !validSpan(start, end)
    || start < TODAY || start < mission.start || end > mission.end
    || daysBetween(start, end) > MAX_PLACEMENT_DAYS) return 0;

  const dates = workingDays(start, end);
  if (!dates.length) return 0;
  const availability = availabilityFor(person, mission, moves, excludeId);
  return Math.min(...dates.map(availability));
}

/**
 * Prefer the fullest feasible allocation, then its longest uninterrupted run.
 * Weekends can bridge working days; they never create or consume capacity.
 * The end is exclusive, matching assignments and evaluateMove.
 */
export function recommendMove(
  person: Person,
  mission: Mission,
  moves: ScenarioMove[] = [],
  excludeId?: string,
): MoveRecommendation | null {
  if (!validSpan(mission.start, mission.end)) return null;
  const start = mission.start > TODAY ? mission.start : TODAY;
  if (start >= mission.end) return null;
  const end = daysBetween(start, mission.end) > MAX_PLACEMENT_DAYS
    ? addDays(start, MAX_PLACEMENT_DAYS) : mission.end;
  const dates = workingDays(start, end);
  if (!dates.length) return null;

  const availability = availabilityFor(person, mission, moves, excludeId);
  const hours = dates.map(availability);
  const weeklyHours = Math.max(...hours);
  if (weeklyHours <= 0) return null;

  let bestStart = 0;
  let bestLength = 0;
  let runStart = 0;
  let runLength = 0;
  for (let index = 0; index < dates.length; index++) {
    if (hours[index] < weeklyHours) {
      runLength = 0;
      continue;
    }
    if (!runLength) runStart = index;
    runLength++;
    if (runLength > bestLength) {
      bestStart = runStart;
      bestLength = runLength;
    }
  }

  return {
    start: dates[bestStart],
    end: addDays(dates[bestStart + bestLength - 1], 1),
    weeklyHours,
  };
}
