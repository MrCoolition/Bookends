import { z } from "zod";
import type { AdminCapability, AdminResource } from "./contracts";

const text = (maximum: number, required = true) => z.string().trim().min(required ? 1 : 0).max(maximum).refine(value => !value.includes("\u0000"), "Text cannot contain null characters.");
const DAY = 86_400_000;
const normalized = (value: string) => value.trim().toLocaleLowerCase("en-US");
const distinct = (values: string[]) => new Set(values.map(normalized)).size === values.length;
export const capabilitySchema = z.object({
  id: z.uuid(), kind: z.enum(["role", "skill"]), name: text(160), description: text(2000, false),
  active: z.boolean(), revision: z.int().positive().max(2_147_483_647), aliases: z.array(text(160)).max(50).optional(),
}).strict().refine(value => distinct([value.name, ...(value.aliases ?? [])]), "A capability's name and former names must be distinct.")
  .refine(value => value.kind !== "skill" || [value.name, ...(value.aliases ?? [])].every(name => name.length <= 100), "Skill names must be 100 characters or fewer.");
export const capabilityNameKey = normalized;
export function capabilityAliasesAfterRename(record: AdminCapability | null, name: string): string[] {
  if (!record) return [];
  const aliases = (record.aliases ?? []).filter(alias => normalized(alias) !== normalized(name));
  if (normalized(record.name) !== normalized(name)) aliases.push(record.name);
  return aliases;
}
export const profileSchema = z.object({
  roles: z.array(text(160)).max(30).refine(distinct, "List each delivery role once."),
  skills: z.array(text(100)).max(100).refine(distinct, "List each skill once."),
}).strict();
export type ResourceProfile = z.infer<typeof profileSchema>;

/** Engagement and role dates are inclusive calendar dates, without a timezone. */
export function isEngagementDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const date = z.string().refine(isEngagementDate, "Choose a valid calendar date (YYYY-MM-DD).");

/** Shared brief/editor rule so step validation agrees with saved-plan validation. */
export function engagementWindowError(start: string, end: string): string {
  if (!isEngagementDate(start) || !isEngagementDate(end)) return "Choose valid engagement dates (YYYY-MM-DD).";
  if (end < start) return "The engagement's last day must be on or after its first day.";
  const tenthAnniversary = new Date(`${start}T00:00:00.000Z`);
  tenthAnniversary.setUTCFullYear(tenthAnniversary.getUTCFullYear() + 10);
  if (new Date(`${end}T00:00:00.000Z`).getTime() >= tenthAnniversary.getTime()) return "Keep each engagement within a ten-year window; use a new engagement for a later extension.";
  return "";
}

export const engagementRoleSchema = z.object({
  id: z.uuid(), name: text(160), headcount: z.int().min(1).max(1000),
  allocationPercent: z.number().finite().min(1).max(100),
  skills: z.array(text(100)).max(40).refine(values => new Set(values.map(value => value.toLocaleLowerCase("en-US"))).size === values.length, "List each skill once for this role."),
  responsibilities: text(3000, false), start: date, end: date,
}).strict().superRefine((role, ctx) => {
  if (isEngagementDate(role.start) && isEngagementDate(role.end) && role.end < role.start) ctx.addIssue({ code: "custom", path: ["end"], message: "The role's last day must be on or after its first day." });
});
export type EngagementRole = z.infer<typeof engagementRoleSchema>;

export const engagementPlanSchema = z.object({
  version: z.literal(1), sowReference: text(200, false), status: z.enum(["draft", "signed", "complete"]),
  signedOn: date.nullable(), start: date, end: date, outcomes: text(4000, false),
  roles: z.array(engagementRoleSchema).min(1, "Add at least one delivery role to the team.").max(100),
}).strict().superRefine((plan, ctx) => {
  if (isEngagementDate(plan.start) && isEngagementDate(plan.end)) {
    const windowError = engagementWindowError(plan.start, plan.end);
    if (windowError) ctx.addIssue({ code: "custom", path: ["end"], message: windowError });
    plan.roles.forEach((role, index) => {
      if (isEngagementDate(role.start) && role.start < plan.start) ctx.addIssue({ code: "custom", path: ["roles", index, "start"], message: "This role must start within the engagement's dates." });
      if (isEngagementDate(role.end) && role.end > plan.end) ctx.addIssue({ code: "custom", path: ["roles", index, "end"], message: "This role must end within the engagement's dates." });
    });
  }
  if (plan.status !== "draft") {
    if (!plan.sowReference) ctx.addIssue({ code: "custom", path: ["sowReference"], message: "Add the signed SOW reference." });
    if (!plan.signedOn) ctx.addIssue({ code: "custom", path: ["signedOn"], message: "Add the SOW signature date." });
  }
  const ids = new Set<string>();
  plan.roles.forEach((role, index) => {
    if (ids.has(role.id)) ctx.addIssue({ code: "custom", path: ["roles", index, "id"], message: "Every delivery role needs a unique identifier." });
    ids.add(role.id);
  });
});
export type EngagementPlan = z.infer<typeof engagementPlanSchema>;

/** Evidence of role/skill alignment only; this makes no claim about availability. */
export function findRoleMatches(role: EngagementRole, resources: AdminResource[], capabilities: AdminCapability[] = []) {
  const catalog = new Map<string, string>();
  // Archived names still resolve so retiring or renaming a catalog item does not
  // rewrite the meaning of earlier signed SOWs or recorded teammate profiles.
  for (const capability of capabilities) for (const name of [capability.name, ...(capability.aliases ?? [])]) catalog.set(`${capability.kind}:${normalized(name)}`, capability.id);
  const canonical = (kind: "role" | "skill", value: string) => catalog.get(`${kind}:${normalized(value)}`) ?? `${kind}:${normalized(value)}`;
  return resources.filter(resource => resource.active && resource.profile).map(resource => {
    const profile = resource.profile!;
    const skills = new Set(profile.skills.map(skill => canonical("skill", skill)));
    return {
      resource, roleMatch: profile.roles.some(name => canonical("role", name) === canonical("role", role.name)),
      matchedSkills: role.skills.filter(skill => skills.has(canonical("skill", skill))),
      missingSkills: role.skills.filter(skill => !skills.has(canonical("skill", skill))), skillsKnown: profile.skills.length > 0,
    };
  }).filter(match => match.roleMatch || match.matchedSkills.length > 0)
    .sort((a, b) => a.missingSkills.length - b.missingSkills.length || Number(b.roleMatch) - Number(a.roleMatch) || a.resource.name.localeCompare(b.resource.name, "en-US") || a.resource.id.localeCompare(b.resource.id));
}

/** Inclusive duration in calendar months, rounded to one decimal. Full month
 * anniversaries preserve the starting day, clamped for shorter months. */
export function engagementDuration(start: string, end: string): { days: number; months: number } {
  if (!isEngagementDate(start) || !isEngagementDate(end) || end < start) return { days: 0, months: 0 };
  const first = new Date(`${start}T00:00:00.000Z`), last = new Date(`${end}T00:00:00.000Z`);
  const exclusiveEnd = new Date(last.getTime() + DAY);
  const anniversary = (months: number) => {
    const value = new Date(first); value.setUTCDate(1); value.setUTCMonth(first.getUTCMonth() + months);
    const lastInMonth = new Date(value); lastInMonth.setUTCMonth(value.getUTCMonth() + 1); lastInMonth.setUTCDate(0);
    value.setUTCDate(Math.min(first.getUTCDate(), lastInMonth.getUTCDate()));
    return value.getTime();
  };
  let wholeMonths = (exclusiveEnd.getUTCFullYear() - first.getUTCFullYear()) * 12 + exclusiveEnd.getUTCMonth() - first.getUTCMonth();
  if (anniversary(wholeMonths) > exclusiveEnd.getTime()) wholeMonths--;
  const anchor = anniversary(wholeMonths), next = anniversary(wholeMonths + 1);
  const months = wholeMonths + (exclusiveEnd.getTime() - anchor) / (next - anchor);
  return { days: Math.round((last.getTime() - first.getTime()) / DAY) + 1, months: Math.max(0.1, Math.round(months * 10) / 10) };
}

/** Demand only: FTE is role headcount × allocation, never an assumed 40-hour week. */
export function summarizeEngagement(plan: EngagementPlan) {
  const events = new Map<number, { heads: number; fte: number }>();
  for (const role of plan.roles) {
    if (!isEngagementDate(role.start) || !isEngagementDate(role.end) || role.end < role.start || !Number.isFinite(role.headcount) || !Number.isFinite(role.allocationPercent)) continue;
    const fte = role.headcount * role.allocationPercent / 100;
    for (const [when, sign] of [[Date.parse(`${role.start}T00:00:00Z`), 1], [Date.parse(`${role.end}T00:00:00Z`) + DAY, -1]]) {
      const event = events.get(when) ?? { heads: 0, fte: 0 };
      events.set(when, { heads: event.heads + role.headcount * sign, fte: event.fte + fte * sign });
    }
  }
  let heads = 0, fte = 0, peakHeadcount = 0, peakFte = 0;
  for (const [, event] of [...events].sort((a, b) => a[0] - b[0])) {
    heads += event.heads; fte += event.fte;
    peakHeadcount = Math.max(peakHeadcount, heads); peakFte = Math.max(peakFte, fte);
  }
  return { roleCount: plan.roles.length, totalSeats: plan.roles.reduce((sum, role) => sum + role.headcount, 0), peakHeadcount, peakFte: Math.round(peakFte * 10_000) / 10_000, ...engagementDuration(plan.start, plan.end) };
}
