"use client";

import { useId, useMemo } from "react";
import { BriefcaseBusiness, Check, CircleHelp } from "lucide-react";
import type { AdminCapability } from "@/lib/admin/contracts";
import { createCapabilityResolver } from "@/lib/admin/capability-resolution";
import { byName } from "@/lib/alphabetical";

export type RoleAlignmentProps = {
  name: string;
  sourceName?: string;
  capabilities: AdminCapability[];
  onChange: (name: string) => void;
  disabled?: boolean;
};

export function RoleAlignment({ name, sourceName, capabilities, onChange, disabled = false }: RoleAlignmentProps) {
  const id = useId();
  const resolver = useMemo(() => createCapabilityResolver(capabilities, { includeInactive: false }), [capabilities]);
  const options = useMemo(() => capabilities.filter(entry => entry.active && entry.kind === "role").sort(byName), [capabilities]);
  const resolution = resolver.resolve("role", name);
  const aligned = resolution.status === "resolved";
  const selected = aligned ? resolution.capability.id : "";
  const status = aligned ? "Role aligned" : resolution.status === "ambiguous" ? "Choose the right role" : "Needs a workspace role";
  const suggestions = aligned ? [] : resolution.suggestions.slice(0, 3);
  const help = !options.length
    ? "Add delivery roles in Admin → Roles & skills, then return to this plan."
    : resolution.status === "ambiguous"
      ? "More than one role could fit this title. Choose the intended role."
      : "Choose the role your teammates have on their profiles.";

  return <div className={`role-alignment ${aligned ? "role-alignment-resolved" : "role-alignment-review"}`}>
    <div className="role-alignment-heading">
      <label htmlFor={`${id}-select`}><BriefcaseBusiness size={14} aria-hidden="true" /> Workspace role</label>
      <span className="role-alignment-status" role="status">{aligned ? <Check size={12} aria-hidden="true" /> : <CircleHelp size={12} aria-hidden="true" />}{status}</span>
    </div>
    {sourceName && <p className="role-alignment-source"><span>SOW title</span><strong>{sourceName}</strong></p>}
    <select
      id={`${id}-select`}
      value={selected}
      disabled={disabled || !options.length}
      aria-label={`Workspace role for ${sourceName || name}`}
      aria-describedby={!aligned ? `${id}-help` : undefined}
      onChange={event => {
        const role = options.find(option => option.id === event.target.value);
        if (role) onChange(role.name);
      }}
    >
      <option value="" disabled>{options.length ? "Choose a configured role…" : "No active delivery roles"}</option>
      {options.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
    </select>
    {!aligned && <p className="role-alignment-help" id={`${id}-help`}>{help}</p>}
    {suggestions.length > 0 && <div className="role-alignment-suggestions" role="group" aria-label={`Suggested roles for ${sourceName || name}`}>
      <span>Possible fit</span>
      {suggestions.map(role => <button type="button" key={role.id} disabled={disabled} onClick={() => onChange(role.name)} aria-label={`Use ${role.name} for ${sourceName || name}`}><BriefcaseBusiness size={12} aria-hidden="true" />{role.name}</button>)}
    </div>}
  </div>;
}
