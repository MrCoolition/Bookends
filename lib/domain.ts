import { ASSIGNMENTS, MISSIONS, TODAY } from "./data";
import type { Assignment, Mission, Obligation, Person, ScenarioMove } from "./types";
const DAY = 86_400_000;
// Business dates remain date-only strings. UTC is used exclusively for calendar arithmetic.
export function dateNumber(date: string) { return Date.parse(`${date}T12:00:00Z`); }
export function validDate(date: string) { const n = dateNumber(date); return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === date; }
export function addDays(date: string, days: number) { return new Date(dateNumber(date) + days * DAY).toISOString().slice(0, 10); }
export function daysBetween(start: string, end: string) { return Math.round((dateNumber(end) - dateNumber(start)) / DAY); }
export function formatDate(date: string, long = false) { return new Intl.DateTimeFormat("en-US", { month: long ? "long" : "short", day: "numeric", timeZone: "UTC" }).format(new Date(dateNumber(date))); }
export function inclusiveEnd(end: string) { return addDays(end, -1); }
export function isWorkingDay(date: string) { const day = new Date(dateNumber(date)).getUTCDay(); return day !== 0 && day !== 6; }
export function workingDays(start: string, end: string) { const dates: string[] = []; for (let d = start; d < end; d = addDays(d, 1)) if (isWorkingDay(d)) dates.push(d); return dates; }
export function assignmentsFor(personId: string) { return ASSIGNMENTS.filter(a => a.personId === personId); }
export function missionFor(id: string) { return MISSIONS.find(m => m.id === id)!; }
export function committedHours(personId: string, day: string, assignments = ASSIGNMENTS) {
  return assignments.filter(a => a.personId === personId && a.staffing === "committed" && a.start <= day && a.end > day).reduce((sum, a) => sum + a.weeklyHours * 4, 0) / 4;
}
export function uncoveredHours(person: Person, start: string, end: string, assignments = ASSIGNMENTS) {
  // All demo calendars are an explicit equal-hours Monday–Friday pattern.
  return workingDays(start, end).reduce((sum, d) => sum + Math.max(0, person.weeklyHours - assignments.filter(a => a.personId === person.id && a.staffing === "committed" && missionFor(a.missionId).commercial === "authorized" && a.start <= d && a.end > d).reduce((h, a) => h + a.weeklyHours, 0)), 0) / 5;
}
export function coverageFor(people: Person[], start: string, end: string, assignments = ASSIGNMENTS) {
  const days = workingDays(start, end).length;
  const total = people.reduce((sum, p) => sum + p.weeklyHours * days / 5, 0);
  const uncovered = people.reduce((sum, p) => sum + uncoveredHours(p, start, end, assignments), 0);
  return { total, uncovered, covered: total - uncovered, percent: total ? Math.round((total - uncovered) / total * 100) : 0 };
}
export function openMissionHours(mission: Mission, start = TODAY, end = "2027-01-04") {
  const dates = workingDays(start > mission.start ? start : mission.start, end < mission.end ? end : mission.end);
  if (!dates.length) return 0;
  return Math.max(...dates.map(day => Math.max(0, mission.weeklyHours - ASSIGNMENTS.filter(a => a.missionId === mission.id && a.staffing === "committed" && a.start <= day && a.end > day).reduce((sum, a) => sum + a.weeklyHours, 0))));
}
export function nextRelease(personId: string) { return assignmentsFor(personId).filter(a => a.staffing === "committed" && a.end > TODAY).sort((a, b) => a.end.localeCompare(b.end))[0]; }
export function matching(person: Person, mission: Mission, obligations: Obligation[]) {
  const missing = mission.skills.filter(skill => !person.skills.includes(skill));
  const blockers = obligations.filter(o => o.personId === person.id && o.blocksStart && o.state !== "satisfied");
  return { missing, blockers, label: missing.length ? "Skills to verify" : blockers.length ? "Fits after prerequisites" : mission.commercial !== "authorized" ? "Commercial approval needed" : "Skills aligned" };
}
export function evaluateMove(move: ScenarioMove, person: Person, mission: Mission, otherMoves: ScenarioMove[] = []) {
  const issues: string[] = [];
  if (!validDate(move.start) || !validDate(move.end) || move.start >= move.end) return ["Choose a valid start date and a later end date."];
  if (!Number.isFinite(move.weeklyHours) || move.weeklyHours <= 0 || !Number.isInteger(move.weeklyHours * 4)) issues.push("Use positive hours in 0.25-hour increments.");
  if (move.start < mission.start || move.end > mission.end) issues.push("The proposed dates fall outside this mission’s approved span.");
  if (move.start < TODAY) issues.push("A new scenario placement must start today or later.");
  if (daysBetween(move.start, move.end) > 730) return [...issues, "Limit placements to two years."];
  const dates = workingDays(move.start, move.end);
  if (!dates.length) issues.push("The selected dates contain no working days.");
  const other = otherMoves.filter(m => m.id !== move.id);
  const conflicts = dates.filter(day => committedHours(person.id, day) + other.filter(m => m.personId === person.id && m.start <= day && m.end > day).reduce((sum, m) => sum + m.weeklyHours, 0) + move.weeklyHours > person.weeklyHours);
  if (conflicts.length) issues.push(`Capacity conflict: ${person.name} exceeds ${person.weeklyHours} h/week from ${formatDate(conflicts[0])}.`);
  const seatConflict = dates.some(day => ASSIGNMENTS.filter(a => a.missionId === mission.id && a.staffing === "committed" && a.start <= day && a.end > day).reduce((s, a) => s + a.weeklyHours, 0) + other.filter(m => m.missionId === mission.id && m.start <= day && m.end > day).reduce((s, m) => s + m.weeklyHours, 0) + move.weeklyHours > mission.weeklyHours);
  if (seatConflict) issues.push("These hours exceed the mission’s remaining funded demand.");
  return issues;
}
export function scenarioAssignments(moves: ScenarioMove[]): Assignment[] { return moves.map(m => ({ ...m, staffing: "proposed", readiness: "conditional" })); }
