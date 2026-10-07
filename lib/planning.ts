import { ASSIGNMENTS, MISSIONS, PEOPLE, TODAY } from "./data";
import { addDays, daysBetween, evaluateMove, formatDate, validDate, workingDays } from "./domain";
import type { Mission, Person, ScenarioMove } from "./types";

export type MoveRecommendation = Pick<ScenarioMove, "start" | "end" | "weeklyHours">;

export type PlanningReservation = {
  id: string; personId: string; personName: string; missionId: string;
  missionName: string; client: string; start: string; end: string; weeklyHours: number;
  source: "committed" | "scenario";
};
export type PlanningBlocker = {
  kind: "invalid_dates" | "outside_mission" | "past_start" | "span_too_long" | "no_working_days" | "invalid_hours" | "person_capacity" | "mission_capacity";
  message: string;
  reservations: PlanningReservation[];
};
export type PlanningOption = MoveRecommendation & {
  kind: "reduce_hours" | "change_dates" | "change_mission";
  missionId: string; missionName: string; client: string;
  title: string; reason: string; missingSkills: string[]; commercial: Mission["commercial"];
};
export type MoveGuidance = {
  availableHours: number; personAvailableHours: number; missionAvailableHours: number;
  blockers: PlanningBlocker[]; options: PlanningOption[];
};

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

const quarterHours = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value * 4) / 4) : 0;
const missionLabel = (mission: Pick<Mission, "client" | "name">) => `${mission.client} · ${mission.name}`;
const windowLabel = (move: MoveRecommendation) => `${formatDate(move.start)}–${formatDate(addDays(move.end, -1))}`;

function reservationsFor(person: Person, mission: Mission, moves: ScenarioMove[], excludeId?: string): PlanningReservation[] {
  const placements = [
    ...ASSIGNMENTS.filter(assignment => assignment.staffing === "committed").map(assignment => ({ ...assignment, source: "committed" as const })),
    ...moves.filter(move => move.id !== excludeId).map(move => ({ ...move, source: "scenario" as const })),
  ];
  return placements.filter(placement => placement.personId === person.id || placement.missionId === mission.id).map(placement => {
    const assignedPerson = placement.personId === person.id ? person : PEOPLE.find(value => value.id === placement.personId);
    const assignedMission = placement.missionId === mission.id ? mission : MISSIONS.find(value => value.id === placement.missionId);
    return { id: placement.id, personId: placement.personId, personName: assignedPerson?.name ?? "Another teammate", missionId: placement.missionId, missionName: assignedMission?.name ?? "Another mission", client: assignedMission?.client ?? "", start: placement.start, end: placement.end, weeklyHours: placement.weeklyHours, source: placement.source };
  });
}

/** An earlier part-time window complements the fullest allocation from recommendMove. */
function earliestWindow(person: Person, mission: Mission, moves: ScenarioMove[], excludeId?: string): MoveRecommendation | null {
  if (!validSpan(mission.start, mission.end)) return null;
  const start = mission.start > TODAY ? mission.start : TODAY;
  if (start >= mission.end) return null;
  const end = daysBetween(start, mission.end) > MAX_PLACEMENT_DAYS ? addDays(start, MAX_PLACEMENT_DAYS) : mission.end;
  const dates = workingDays(start, end), available = availabilityFor(person, mission, moves, excludeId);
  const first = dates.findIndex(day => available(day) > 0);
  if (first < 0) return null;
  const weeklyHours = available(dates[first]);
  let last = first;
  while (last + 1 < dates.length && available(dates[last + 1]) >= weeklyHours) last++;
  return { start: dates[first], end: addDays(dates[last], 1), weeklyHours };
}

/**
 * Explain the actual reservation that prevents this move and offer up to three
 * capacity-valid recoveries. These are draft possibilities, never readiness or
 * commercial approvals. All dates retain the domain's exclusive-end convention.
 */
export function getMoveGuidance(
  person: Person,
  mission: Mission,
  selected: MoveRecommendation,
  moves: ScenarioMove[] = [],
  excludeId?: string,
): MoveGuidance {
  const blockers: PlanningBlocker[] = [], options: PlanningOption[] = [];
  const addBlocker = (kind: PlanningBlocker["kind"], message: string, reservations: PlanningReservation[] = []) => blockers.push({ kind, message, reservations });
  const missionSpanValid = validSpan(mission.start, mission.end), spanValid = validSpan(selected.start, selected.end);
  const hoursValid = Number.isFinite(selected.weeklyHours) && selected.weeklyHours > 0 && Number.isInteger(selected.weeklyHours * 4);
  if (!missionSpanValid) addBlocker("invalid_dates", "This mission needs a valid approved start and end before a move can fit.");
  if (!spanValid) addBlocker("invalid_dates", "Choose a valid first day and a last day on or after it.");
  if (!hoursValid) addBlocker("invalid_hours", "Choose positive weekly hours in 0.25-hour steps.");
  let dates: string[] = [];
  if (spanValid) {
    if (selected.start < TODAY) addBlocker("past_start", `A new move must start on ${formatDate(TODAY)} or later.`);
    if (missionSpanValid && (selected.start < mission.start || selected.end > mission.end)) addBlocker("outside_mission", `${missionLabel(mission)} runs ${windowLabel({ ...mission, weeklyHours: mission.weeklyHours })}. Choose dates inside that window.`);
    if (daysBetween(selected.start, selected.end) > MAX_PLACEMENT_DAYS) addBlocker("span_too_long", "Keep this move within a two-year window.");
    else {
      dates = workingDays(selected.start, selected.end);
      if (!dates.length) addBlocker("no_working_days", "These dates contain no Monday–Friday working days. Pick a window with a working day.");
    }
  }
  const reservations = reservationsFor(person, mission, moves, excludeId);
  const personRemaining = dates.map(day => quarterHours(person.weeklyHours - reservations.filter(value => value.personId === person.id && value.start <= day && value.end > day).reduce((sum, value) => sum + value.weeklyHours, 0)));
  const missionRemaining = dates.map(day => quarterHours(mission.weeklyHours - reservations.filter(value => value.missionId === mission.id && value.start <= day && value.end > day).reduce((sum, value) => sum + value.weeklyHours, 0)));
  const personAvailableHours = personRemaining.length ? Math.min(...personRemaining) : 0;
  const missionAvailableHours = missionRemaining.length ? Math.min(...missionRemaining) : 0;
  const availableHours = availableWeeklyHours(person, mission, selected.start, selected.end, moves, excludeId);
  if (dates.length && hoursValid) {
    const relevant = (kind: "person" | "mission", remaining: number[]) => reservations.filter(value => (kind === "person" ? value.personId === person.id : value.missionId === mission.id) && dates.some((day, index) => remaining[index] < selected.weeklyHours && value.start <= day && value.end > day));
    if (selected.weeklyHours > personAvailableHours) {
      const holds = relevant("person", personRemaining), first = holds[0];
      const detail = first ? ` ${first.client ? `${first.client} · ` : ""}${first.missionName} already uses ${first.weeklyHours} h/week in ${first.source === "scenario" ? "this scenario" : "the committed plan"}${holds.length > 1 ? `, with ${holds.length - 1} other reservation${holds.length > 2 ? "s" : ""}` : ""}.` : ` Their weekly capacity is ${person.weeklyHours} hours.`;
      addBlocker("person_capacity", `${person.name} has ${personAvailableHours} h/week available across these dates.${detail}`, holds);
    }
    if (selected.weeklyHours > missionAvailableHours) {
      const holds = relevant("mission", missionRemaining), first = holds[0];
      const detail = first ? ` ${first.personName} already holds ${first.weeklyHours} h/week in ${first.source === "scenario" ? "this scenario" : "the committed plan"}${holds.length > 1 ? `, with ${holds.length - 1} other reservation${holds.length > 2 ? "s" : ""}` : ""}.` : ` This mission funds ${mission.weeklyHours} h/week in total.`;
      addBlocker("mission_capacity", `${missionLabel(mission)} has ${missionAvailableHours} funded h/week left across these dates.${detail}`, holds);
    }
  }
  // Every displayed recovery must independently pass the authoritative validator.
  let candidateId = excludeId ?? "guidance";
  while (!excludeId && moves.some(move => move.id === candidateId)) candidateId += "_";
  const addOption = (kind: PlanningOption["kind"], target: Mission, recommendation: MoveRecommendation | null, title?: string) => {
    if (!recommendation || options.length >= 3) return;
    if (target.id === mission.id && recommendation.start === selected.start && recommendation.end === selected.end && recommendation.weeklyHours === selected.weeklyHours) return;
    if (options.some(option => option.missionId === target.id && option.start === recommendation.start && option.end === recommendation.end && option.weeklyHours === recommendation.weeklyHours)) return;
    if (evaluateMove({ ...recommendation, id: candidateId, personId: person.id, missionId: target.id }, person, target, moves).length) return;
    const missingSkills = target.skills.filter(skill => !person.skills.includes(skill));
    const sameDates = recommendation.start === selected.start && recommendation.end === selected.end;
    const approval = target.commercial === "authorized" ? "" : target.commercial === "contingent" ? " Commercial approval is still pending." : " Commercial authority still needs verification.";
    options.push({ ...recommendation, kind, missionId: target.id, missionName: target.name, client: target.client, title: title ?? (kind === "reduce_hours" ? `Use ${recommendation.weeklyHours} h/week` : kind === "change_mission" ? `Try ${missionLabel(target)}` : "Move to an open window"), reason: `${sameDates ? "Keeps your dates. " : `${windowLabel(recommendation)}. `}${recommendation.weeklyHours} h/week fits the recorded reservations.${approval}`, missingSkills, commercial: target.commercial });
  };
  if (availableHours > 0 && (!hoursValid || selected.weeklyHours > availableHours)) addOption("reduce_hours", mission, { ...selected, weeklyHours: availableHours });
  const fullest = recommendMove(person, mission, moves, excludeId), earliest = earliestWindow(person, mission, moves, excludeId);
  addOption("change_dates", mission, fullest);
  if (earliest && fullest && earliest.start < fullest.start) addOption("change_dates", mission, earliest, `Start earlier at ${earliest.weeklyHours} h/week`);
  const alternatives = MISSIONS.filter(target => target.id !== mission.id).map(target => {
    const sameDatesHours = availableWeeklyHours(person, target, selected.start, selected.end, moves, excludeId);
    const recommendation = sameDatesHours > 0 ? { ...selected, weeklyHours: hoursValid ? Math.min(selected.weeklyHours, sameDatesHours) : sameDatesHours } : recommendMove(person, target, moves, excludeId);
    const missing = target.skills.filter(skill => !person.skills.includes(skill)).length;
    const score = (target.commercial === "authorized" ? 0 : 1000) + missing * 20 + (target.home === person.home ? 0 : 5) + (sameDatesHours > 0 ? 0 : 2);
    return { target, recommendation, score };
  }).filter(value => value.recommendation).sort((left, right) => left.score - right.score || left.recommendation!.start.localeCompare(right.recommendation!.start) || left.target.id.localeCompare(right.target.id));
  for (const alternative of alternatives) addOption("change_mission", alternative.target, alternative.recommendation);
  return { availableHours, personAvailableHours, missionAvailableHours, blockers, options };
}
