import type { AdminCapability, AdminResource } from "../admin/contracts";
import { findRoleMatches, type EngagementPlan } from "../admin/engagement";

type ResourceReference = Pick<AdminResource, "id" | "active">;
export type PlannedTeamReferenceIssue = { roleId: string; resourceId: string; code: "missing_resource" | "inactive_resource"; message: string };

/** New selections must be active and belong to this workspace. A person archived
 * after selection may stay in that same recorded role, so history remains editable. */
export function plannedTeamReferenceIssues(plan: EngagementPlan, resources: ResourceReference[], previous?: EngagementPlan): PlannedTeamReferenceIssue[] {
  const available = new Map(resources.map(resource => [resource.id, resource]));
  const previousRoles = new Map(previous?.roles.map(role => [role.id, new Set(role.selectedResourceIds ?? [])]) ?? []);
  const issues: PlannedTeamReferenceIssue[] = [];
  for (const role of plan.roles) for (const resourceId of role.selectedResourceIds ?? []) {
    const resource = available.get(resourceId);
    if (!resource) issues.push({ roleId: role.id, resourceId, code: "missing_resource", message: "A proposed teammate is no longer in this workspace. Choose an existing person." });
    else if (!resource.active && !previousRoles.get(role.id)?.has(resourceId)) issues.push({ roleId: role.id, resourceId, code: "inactive_resource", message: "Choose an active teammate for a new team position. Previously recorded archived teammates may remain in their original role." });
  }
  return issues;
}

export type PlannedTeamWarning = {
  code: "missing_resource" | "inactive_resource" | "overlapping_roles";
  resourceId: string;
  roleIds: string[];
  message: string;
};

/** Counts proposed names, never confirmed assignments or available capacity.
 * Cross-role overlap is surfaced for review rather than rejecting valid multi-role work. */
export function summarizePlannedTeam(plan: EngagementPlan, resources: AdminResource[], capabilities: AdminCapability[] = []) {
  const byId = new Map(resources.map(resource => [resource.id, resource]));
  const warnings: PlannedTeamWarning[] = [];
  const uniquePeople = new Set<string>();
  const roles = plan.roles.map(role => {
    // Include archived people when explaining an existing selection's recorded skills.
    // findRoleMatches still excludes them from the picker elsewhere in the app.
    const matches = new Map(findRoleMatches(role, resources.map(resource => ({ ...resource, active: true })), capabilities).map(match => [match.resource.id, match]));
    const selections = (role.selectedResourceIds ?? []).map(resourceId => {
      const resource = byId.get(resourceId), match = matches.get(resourceId);
      if (resource) uniquePeople.add(resourceId);
      if (!resource || !resource.active) warnings.push({ code: resource ? "inactive_resource" : "missing_resource", resourceId, roleIds: [role.id], message: resource ? `${resource.name} is archived. Review this proposed position.` : "A proposed teammate is missing from this workspace." });
      return { resourceId, resource, roleMatch: match?.roleMatch ?? false, matchedSkills: match?.matchedSkills ?? [], missingSkills: match?.missingSkills ?? role.skills, skillsKnown: Boolean(resource?.profile?.skills.length) };
    });
    const namedSeats = selections.filter(selection => selection.resource).length;
    return { roleId: role.id, headcount: role.headcount, namedSeats, openSeats: Math.max(0, role.headcount - namedSeats), selections };
  });
  for (const resourceId of uniquePeople) {
    const selectedRoles = plan.roles.filter(role => role.selectedResourceIds?.includes(resourceId));
    const overlapping = selectedRoles.filter((role, index) => selectedRoles.some((other, otherIndex) => index !== otherIndex && role.start <= other.end && other.start <= role.end));
    if (overlapping.length > 1) warnings.push({ code: "overlapping_roles", resourceId, roleIds: overlapping.map(role => role.id), message: `${byId.get(resourceId)!.name} appears in overlapping role windows. Review the combined workload before assigning.` });
  }
  const totalSeats = roles.reduce((sum, role) => sum + role.headcount, 0);
  const namedSeats = roles.reduce((sum, role) => sum + role.namedSeats, 0);
  return { totalSeats, namedSeats, openSeats: totalSeats - namedSeats, uniquePeople: uniquePeople.size, roles, warnings };
}
