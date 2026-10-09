import type { AdminBootstrap, AdminResource } from "../admin/contracts";
import { isEngagementDate } from "../admin/engagement";
import { emptyForecast, type ForecastCandidate, type ForecastMonth, type ForecastResult, type ForecastRoleResult, type ForecastScenario } from "./types";

const DAY = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const MAX_FORECAST_CHECKS = 15_000_000;
const tooLarge = () => new Error("This forecast is too large for an interactive calculation. Shorten the horizon or include fewer potential SOWs.");
export function shiftForecastDate(date: string, days: number): string {
  const shifted = iso(time(date) + days * DAY);
  if (!isEngagementDate(shifted)) throw new Error("The shifted dates fall outside the supported calendar. Use dates from year 0001 through 9999.");
  return shifted;
}
type Demand = ForecastRoleResult & { from: number; until: number; matches: AdminResource[]; seen: boolean; candidateMinimum: Map<string, number>; candidateReservedMinimum: Map<string, number> };

/** Deterministic, conservative seat fitting, not a staffing optimizer. Explicit
 * commitments reserve capacity; proposed team names never do. The second pass
 * uses unknown-capacity people only to distinguish uncertainty from roster gaps. */
export function analyzeForecast(data: AdminBootstrap, scenario: ForecastScenario, asOf: string, horizonMonths = 12): ForecastResult {
  if (!isEngagementDate(asOf)) throw new Error("Choose a valid forecast start date.");
  if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > 36) throw new Error("Choose a planning horizon from 1 to 36 months.");
  const forecast = data.forecast ?? emptyForecast(), startTime = time(asOf);
  const horizonDate = new Date(startTime); horizonDate.setUTCDate(1); horizonDate.setUTCMonth(horizonDate.getUTCMonth() + horizonMonths);
  if (horizonDate.getUTCFullYear() > 9999) throw new Error("Choose a planning horizon within the supported calendar (years 0001 through 9999).");
  const horizon = horizonDate.getTime();
  const people = data.resources.filter(person => person.active).sort((a, b) => a.name.localeCompare(b.name, "en-US") || a.id.localeCompare(b.id));
  const aliases = new Map<string, string>();
  const nameKey = (kind: "role" | "skill", value: string) => `${kind}:${value.trim().toLocaleLowerCase("en-US")}`;
  for (const capability of data.capabilities ?? []) for (const name of [capability.name, ...(capability.aliases ?? [])]) aliases.set(nameKey(capability.kind, name), capability.id);
  const canonical = (kind: "role" | "skill", value: string) => aliases.get(nameKey(kind, value)) ?? nameKey(kind, value);
  const profiles = new Map(people.map(person => [person.id, { roles: new Set((person.profile?.roles ?? []).map(name => canonical("role", name))), skills: new Set((person.profile?.skills ?? []).map(name => canonical("skill", name))) }]));
  const capacities = new Map(forecast.capacities.map(row => [row.resourceId, row]));
  const known = people.filter(person => capacities.has(person.id));
  const warningSet = new Set<string>();
  const unprofiled = people.filter(person => !person.profile?.roles.length).length;
  if (unprofiled) warningSet.add(`${unprofiled} active teammate${unprofiled === 1 ? " has" : "s have"} no delivery roles recorded. Hiring gaps describe the recorded roster; complete these profiles before a hiring decision.`);
  const noSkills = people.filter(person => person.profile?.roles.length && !person.profile.skills.length).length;
  if (noSkills) warningSet.add(`${noSkills} active teammate${noSkills === 1 ? " has" : "s have"} no skills recorded. Missing skills are not assumed to match.`);
  const selections = new Map(scenario.selections.map(selection => [selection.missionId, selection]));
  const matchCache = new Map<string, AdminResource[]>();
  let matchingChecks = 0;
  const demand: Demand[] = [];
  const baselines = new Set<string>(), potentials = new Set<string>();
  for (const mission of data.missions) {
    const plan = mission.engagement;
    if (!mission.active || !plan || !data.clients.some(client => client.id === mission.clientId && client.active)) continue;
    const baseline = plan.status === "signed" && plan.source !== "direct";
    const potential = plan.status === "draft" && plan.source !== "direct" && plan.pipeline && plan.pipeline.stage !== "lost";
    const selection = selections.get(mission.id);
    if (!baseline && (!potential || !selection?.included)) continue;
    const shift = baseline ? 0 : selection!.shiftDays, scale = baseline ? 1 : selection!.teamScale;
    for (const role of plan.roles) {
      const first = shiftForecastDate(role.start, shift), last = shiftForecastDate(role.end, shift);
      if (time(last) < startTime || time(first) >= horizon) continue;
      const matchKey = JSON.stringify([role.name.toLocaleLowerCase("en-US"), [...role.skills].map(skill => skill.toLocaleLowerCase("en-US")).sort()]);
      let matches = matchCache.get(matchKey);
      if (!matches) {
        matchingChecks += people.length * (role.skills.length + 1);
        if (matchingChecks > MAX_FORECAST_CHECKS) throw tooLarge();
        const roleKey = canonical("role", role.name), skills = role.skills.map(skill => canonical("skill", skill));
        matches = people.filter(person => { const profile = profiles.get(person.id)!; return profile.roles.has(roleKey) && skills.every(skill => profile.skills.has(skill)); });
        matchCache.set(matchKey, matches);
      }
      demand.push({ key: `${mission.id}:${role.id}`, missionId: mission.id, missionName: mission.name,
        clientName: data.clients.find(client => client.id === mission.clientId)?.name ?? "Client", roleId: role.id, roleName: role.name,
        baseline, start: first, end: last, seats: Math.ceil(role.headcount * scale), allocationPercent: role.allocationPercent, skills: role.skills,
        confidence: baseline ? null : plan.pipeline!.confidence, confirmedSeats: 0, unknownSeats: 0, hiringGapSeats: 0, firstGapDate: null, hireBy: null,
        candidates: [], from: Math.max(startTime, time(first)), until: Math.min(horizon, time(last) + DAY), matches, seen: false, candidateMinimum: new Map(), candidateReservedMinimum: new Map() });
      (baseline ? baselines : potentials).add(mission.id);
    }
  }
  demand.sort((a, b) => Number(b.baseline) - Number(a.baseline) || a.matches.length - b.matches.length || a.from - b.from || a.key.localeCompare(b.key));
  // Source windows can span years. Date events avoid daily iteration while
  // retaining every overlap boundary, including inclusive final working dates.
  const events = new Set<number>([startTime, horizon]);
  const boundary = (value: number) => { if (value >= startTime && value <= horizon) events.add(value); };
  demand.forEach(row => { boundary(row.from); boundary(row.until); });
  for (const row of forecast.capacities) { boundary(time(row.availableFrom)); if (row.availableUntil) boundary(time(row.availableUntil) + DAY); }
  const activeIds = new Set(people.map(person => person.id));
  const commitments = forecast.commitments.filter(row => activeIds.has(row.resourceId)).map(row => ({ ...row, from: time(row.start), until: time(row.end) + DAY })).sort((a, b) => a.id.localeCompare(b.id));
  const bookingsByPerson = new Map<string, typeof commitments>();
  for (const row of commitments) { boundary(row.from); boundary(row.until); const values = bookingsByPerson.get(row.resourceId) ?? []; values.push(row); bookingsByPerson.set(row.resourceId, values); }
  const monthStart = new Date(startTime); monthStart.setUTCDate(1); monthStart.setUTCMonth(monthStart.getUTCMonth() + 1);
  while (monthStart.getTime() < horizon) { boundary(monthStart.getTime()); monthStart.setUTCMonth(monthStart.getUTCMonth() + 1); }
  const ordered = [...events].sort((a, b) => a - b), months = new Map<string, ForecastMonth>();
  const eventIndex = (value: number) => { let lo = 0, hi = ordered.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (ordered[mid] < value) lo = mid + 1; else hi = mid; } return lo; };
  const estimatedChecks = matchingChecks + ordered.length * (people.length + commitments.length + demand.length) + demand.reduce((sum, row) => sum + (eventIndex(row.until) - eventIndex(row.from)) * row.matches.length, 0);
  if (estimatedChecks > MAX_FORECAST_CHECKS) throw tooLarge();
  const previous = new Map<string, Set<string>>();
  const overbooked = new Set<string>();
  let peakGapSeats = 0, peakDemandFte = 0;
  for (let index = 0; index < ordered.length - 1; index++) {
    const now = ordered[index];
    if (ordered[index + 1] <= now) continue;
    const active = demand.filter(row => row.from <= now && row.until > now);
    const confirmedFree = new Map<string, number>(), unknownFree = new Map<string, number>();
    const bound = new Map<string, number>();
    for (const person of people) {
      const capacity = capacities.get(person.id);
      const limit = capacity ? (time(capacity.availableFrom) <= now && (!capacity.availableUntil || time(capacity.availableUntil) + DAY > now) ? capacity.allocationPercent : 0) : 100;
      const bookings = (bookingsByPerson.get(person.id) ?? []).filter(row => row.from <= now && row.until > now);
      const booked = bookings.reduce((sum, row) => sum + row.allocationPercent, 0);
      if (booked > limit && !overbooked.has(person.id)) { warningSet.add(`${person.name} has commitments above ${capacity ? "recorded capacity" : "100%"} starting ${iso(now)}. Resolve the overlap before relying on this forecast.`); overbooked.add(person.id); }
      let assigned = limit;
      for (const booking of bookings) {
        const allowed = Math.min(assigned, booking.allocationPercent); assigned -= allowed;
        if (booking.missionId) { const key = `${person.id}:${booking.missionId}`; bound.set(key, (bound.get(key) ?? 0) + allowed); }
      }
      if (capacity) confirmedFree.set(person.id, Math.max(0, limit - booked));
      else unknownFree.set(person.id, Math.max(0, limit - booked));
    }
    let baselineFte = 0, potentialFte = 0, confirmedFte = 0, unknownFte = 0, gapFte = 0, gapSeats = 0;
    for (const row of active) {
      const occupied = new Set<string>(), carried = previous.get(row.key) ?? new Set<string>();
      const availableBound = (person: AdminResource) => row.baseline ? bound.get(`${person.id}:${row.missionId}`) ?? 0 : 0;
      const candidates = [...row.matches].sort((a, b) => Number(availableBound(b) > 0) - Number(availableBound(a) > 0) || Number(carried.has(b.id)) - Number(carried.has(a.id)) || a.name.localeCompare(b.name, "en-US") || a.id.localeCompare(b.id));
      // Candidate availability includes this signed role's own reserved portion.
      for (const person of candidates) {
        const availability = availableBound(person) + (capacities.has(person.id) ? confirmedFree.get(person.id) ?? 0 : unknownFree.get(person.id) ?? 0);
        row.candidateMinimum.set(person.id, Math.min(row.candidateMinimum.get(person.id) ?? 100, availability));
        row.candidateReservedMinimum.set(person.id, Math.min(row.candidateReservedMinimum.get(person.id) ?? 100, availableBound(person)));
      }
      const take = (person: AdminResource, uncertain: boolean) => {
        const reserved = availableBound(person), pool = uncertain ? unknownFree : confirmedFree;
        const available = pool.get(person.id) ?? 0;
        if (reserved + available + 0.00001 < row.allocationPercent) return false;
        const usedReserved = Math.min(reserved, row.allocationPercent);
        if (usedReserved) bound.set(`${person.id}:${row.missionId}`, reserved - usedReserved);
        pool.set(person.id, Math.max(0, available - (row.allocationPercent - usedReserved)));
        occupied.add(person.id); return true;
      };
      let confirmed = 0, uncertain = 0;
      for (const person of candidates) {
        if (confirmed >= row.seats) break;
        // A full explicit commitment is evidence even when the wider capacity
        // window is unknown. Partial commitments cannot establish the remainder.
        if ((capacities.has(person.id) || availableBound(person) >= row.allocationPercent) && take(person, false)) confirmed++;
      }
      for (const person of candidates) {
        if (confirmed + uncertain >= row.seats) break;
        if (!occupied.has(person.id) && !capacities.has(person.id) && take(person, true)) uncertain++;
      }
      previous.set(row.key, occupied);
      const gap = row.seats - confirmed - uncertain, fte = row.allocationPercent / 100;
      if (!row.seen || gap > row.hiringGapSeats || (gap === row.hiringGapSeats && uncertain > row.unknownSeats)) { row.confirmedSeats = confirmed; row.unknownSeats = uncertain; row.hiringGapSeats = gap; }
      row.seen = true;
      if (gap > 0 && !row.firstGapDate) { row.firstGapDate = iso(now); row.hireBy = shiftForecastDate(row.firstGapDate, -scenario.hiringLeadWeeks * 7); }
      if (row.baseline) baselineFte += row.seats * fte; else potentialFte += row.seats * fte;
      confirmedFte += confirmed * fte; unknownFte += uncertain * fte; gapFte += gap * fte; gapSeats += gap;
    }
    peakGapSeats = Math.max(peakGapSeats, gapSeats);
    peakDemandFte = Math.max(peakDemandFte, baselineFte + potentialFte);
    const totalCapacity = confirmedFte + [...confirmedFree.values()].reduce((sum, value) => sum + value / 100, 0);
    const month = iso(now).slice(0, 7), snapshot: ForecastMonth = { month, label: new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }), demandFte: round(baselineFte + potentialFte), baselineFte: round(baselineFte), potentialFte: round(potentialFte), confirmedCoverageFte: round(confirmedFte), unknownCoverageFte: round(unknownFte), hiringGapFte: round(gapFte), capacityFte: round(totalCapacity) };
    const existing = months.get(month);
    // Pick the highest-gap event in a month, then highest demand, so every bar's
    // stacked coverage adds up and a brief collision cannot disappear in averages.
    if (!existing || snapshot.hiringGapFte > existing.hiringGapFte || (snapshot.hiringGapFte === existing.hiringGapFte && (snapshot.unknownCoverageFte > existing.unknownCoverageFte || (snapshot.unknownCoverageFte === existing.unknownCoverageFte && snapshot.demandFte > existing.demandFte)))) months.set(month, snapshot);
  }
  const rows: ForecastRoleResult[] = demand.map(({ from: _from, until: _until, matches, seen: _seen, candidateMinimum, candidateReservedMinimum, ...row }) => ({ ...row, candidates: matches.map(person => {
    const minimum = round(candidateMinimum.get(person.id) ?? 0), unknown = !capacities.has(person.id);
    const reserved = (candidateReservedMinimum.get(person.id) ?? 0) >= row.allocationPercent;
    const status: ForecastCandidate["status"] = minimum + 0.00001 < row.allocationPercent ? "busy" : unknown && !reserved ? "unknown" : "available";
    return { resourceId: person.id, name: person.name, status, minimumAvailablePercent: minimum,
      reason: status === "unknown" ? "Role and skills match; capacity has not been confirmed." : status === "busy" ? "Capacity, commitments, or competing roles prevent a continuous fit." : unknown && reserved ? "A confirmed commitment covers this signed role throughout its window; other capacity remains unknown." : "Role and skills match with recorded capacity throughout this window." };
  }) }));
  if (people.length - known.length) warningSet.add("Unknown capacity is an optimistic possibility, not a staffed position. Confirm these teammates before treating them as available.");
  const monthly = [...months.values()];
  return { asOf, months: monthly, roles: rows, summary: { potentialCount: potentials.size, baselineCount: baselines.size, peakDemandFte: round(peakDemandFte), peakHiringGapFte: Math.max(0, ...monthly.map(row => row.hiringGapFte)), hiringGapSeats: peakGapSeats, unknownCapacityPeople: people.length - known.length, confirmedCapacityPeople: known.length, firstHireBy: rows.map(row => row.hireBy).filter((date): date is string => !!date).sort()[0] ?? null }, warnings: [...warningSet], method: "Signed work first; then scarce role-and-skill matches, dates, and stable IDs. Full seats use each role's allocation percentage. Recorded commitments reserve capacity once. Unknown capacity is shown separately. Dates are inclusive. Monthly bars show the event with the largest roster gap, then uncertainty, then demand. Capacity excludes commitments outside these fitted roles. This deterministic fit is conservative, not an optimal staffing plan; review handoffs and hiring before acting." };
}
