import type { AdminClient } from "../admin/contracts";
import { engagementPlanSchema, engagementWindowError, isEngagementDate, type EngagementPlan } from "../admin/engagement";
import { evaluateClientBookends } from "./client-bookends";

export type ClientTimingAssessment = ReturnType<typeof evaluateClientBookends>;
export type RoleBookends = { roleId: string; roleName: string; start: ClientTimingAssessment; end: ClientTimingAssessment };

/** Timing is a planning constraint, never proof that onboarding is complete. */
export function assessEngagementBookends(client: AdminClient | undefined, plan: EngagementPlan, readyOn: string): RoleBookends[] {
  if (!client?.bookends?.some(rule => rule.active) || !isEngagementDate(readyOn)) return [];
  const roles = plan.roles.length ? plan.roles : [{ id: "engagement", name: "Engagement", start: plan.start, end: plan.end }];
  const cache = new Map<string, ClientTimingAssessment>();
  const evaluate = (date: string, phase: "start" | "end") => {
    const key = `${phase}:${date}`;
    let result = cache.get(key);
    if (!result) { result = evaluateClientBookends(client.bookends, date, { phase, readyOn }); cache.set(key, result); }
    return result;
  };
  return roles.filter(role => isEngagementDate(role.start) && isEngagementDate(role.end)).map(role => ({
    roleId: role.id, roleName: role.name || "New role",
    start: evaluate(role.start, "start"),
    end: evaluate(role.end, "end"),
  }));
}

export const needsTimingChange = (result: ClientTimingAssessment) => result.status === "delayed" || result.status === "blocked";

/** An explicit draft edit: entry shifts preserve duration; exit changes extend it. */
export function applyRoleBookendDate(plan: EngagementPlan, roleId: string, phase: "start" | "end", eligibleDate: string): EngagementPlan {
  if (plan.status !== "draft") throw new Error("Review client timing with the engagement owner before changing signed work.");
  if (!isEngagementDate(eligibleDate)) throw new Error("Choose a valid client window.");
  const shift = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const move = <T extends { start: string; end: string }>(row: T): T => {
    const days = (Date.parse(`${eligibleDate}T00:00:00Z`) - Date.parse(`${row[phase]}T00:00:00Z`)) / 86400000;
    if (days < 0) throw new Error("Use a window on or after the planned date.");
    return { ...row, [phase]: eligibleDate, ...(phase === "start" ? { end: shift(row.end, days) } : {}) };
  };
  let next: EngagementPlan;
  if (roleId === "engagement" && !plan.roles.length) next = move(plan);
  else {
    if (!plan.roles.some(role => role.id === roleId)) throw new Error("This role is no longer in the plan.");
    const roles = plan.roles.map(role => role.id === roleId ? move(role) : role);
    next = { ...plan, roles, start: [plan.start, ...roles.map(role => role.start)].sort()[0], end: [plan.end, ...roles.map(role => role.end)].sort().at(-1)! };
  }
  // Do not allow a timing suggestion to bypass the existing plan/date limits.
  if (next.roles.length) return engagementPlanSchema.parse(next);
  const dateError = engagementWindowError(next.start, next.end);
  if (dateError) throw new Error(dateError);
  return next;
}
