import type { AdminCapability } from "../admin/contracts";
import { createCapabilityResolver } from "../admin/capability-resolution";
import type { EngagementRole } from "../admin/engagement";
import type { SowDraft } from "../ai/contracts";

/** Reconcile evidenced SOW text locally. Never infer skills or fill missing facts. */
export function alignSowRoles(roles: SowDraft["roles"], capabilities: AdminCapability[]): EngagementRole[] {
  const resolver = createCapabilityResolver(capabilities, { includeInactive: false });
  return roles.map(role => {
    const sourceName = role.name?.trim() ?? "";
    const resolved = resolver.resolve("role", sourceName);
    const skills = role.skills.map(skill => {
      const match = resolver.resolve("skill", skill);
      return match.status === "resolved" ? match.capability.name : skill;
    }).filter((skill, index, all) => all.findIndex(value => value.toLocaleLowerCase("en-US") === skill.toLocaleLowerCase("en-US")) === index);
    return {
      id: crypto.randomUUID(),
      name: resolved.status === "resolved" ? resolved.capability.name : sourceName,
      ...(sourceName ? { sourceName } : {}),
      headcount: role.headcount ?? 0, allocationPercent: role.allocationPercent ?? 0,
      skills, responsibilities: role.responsibilities ?? "", start: role.start ?? "", end: role.end ?? "",
      selectedResourceIds: [],
    };
  });
}
