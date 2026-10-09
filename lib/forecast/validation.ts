import { z } from "zod";
import { isEngagementDate } from "../admin/engagement";
import type { AdminBootstrap } from "../admin/contracts";
import type { ForecastWorkspace } from "./types";

const date = z.string().refine(isEngagementDate, "Use a valid date (YYYY-MM-DD).");
const text = (max: number, required = true) => z.string().trim().min(required ? 1 : 0).max(max).refine(value => !value.includes("\u0000"));
export const forecastWorkspaceSchema = z.object({
  version: z.literal(1), revision: z.int().min(0).max(2_147_483_646),
  scenarios: z.array(z.object({ id: z.uuid(), name: text(160), hiringLeadWeeks: z.int().min(1).max(52), asOf: date.optional(), horizonMonths: z.int().min(1).max(36).optional(), selections: z.array(z.object({
    missionId: z.uuid(), included: z.boolean(), shiftDays: z.int().min(-730).max(730), teamScale: z.number().finite().min(0.25).max(3),
  }).strict()).max(1000) }).strict()).max(40),
  capacities: z.array(z.object({ resourceId: z.uuid(), allocationPercent: z.number().finite().min(0).max(100), availableFrom: date, availableUntil: date.nullable(), notes: text(2000, false) }).strict()
    .refine(value => !value.availableUntil || value.availableUntil >= value.availableFrom, "Capacity end must follow its start.")).max(1000),
  commitments: z.array(z.object({ id: z.uuid(), resourceId: z.uuid(), missionId: z.uuid().nullable(), name: text(160), start: date, end: date, allocationPercent: z.number().finite().min(1).max(100) }).strict()
    .refine(value => value.end >= value.start, "Commitment end must follow its start.")).max(3000),
}).strict().superRefine((forecast, ctx) => {
  const unique = (values: string[], path: (string | number)[]) => { if (new Set(values.map(value => value.toLowerCase())).size !== values.length) ctx.addIssue({ code: "custom", path, message: "Every record must have a unique ID." }); };
  unique(forecast.scenarios.map(row => row.id), ["scenarios"]);
  unique(forecast.capacities.map(row => row.resourceId), ["capacities"]);
  unique(forecast.commitments.map(row => row.id), ["commitments"]);
  forecast.scenarios.forEach((scenario, index) => unique(scenario.selections.map(row => row.missionId), ["scenarios", index, "selections"]));
});
export const saveForecastCommandSchema = z.object({ type: z.literal("save_forecast"), expectedRevision: z.int().min(0).max(2_147_483_646), forecast: forecastWorkspaceSchema }).strict();

/** Archived records may stay referenced as history; the engine excludes them. */
export function forecastReferenceIssues(forecast: ForecastWorkspace, data: AdminBootstrap): string[] {
  const people = new Set(data.resources.map(row => row.id)), missions = new Set(data.missions.map(row => row.id));
  const issues: string[] = [];
  if (forecast.capacities.some(row => !people.has(row.resourceId)) || forecast.commitments.some(row => !people.has(row.resourceId))) issues.push("Capacity and commitments must refer to a saved teammate.");
  if (forecast.scenarios.some(row => row.selections.some(selection => !missions.has(selection.missionId))) || forecast.commitments.some(row => row.missionId && !missions.has(row.missionId))) issues.push("A scenario or commitment refers to an engagement that no longer exists.");
  return issues;
}
