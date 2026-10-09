import type { JourneyKind, JourneyRole, JourneyTemplate, PermissionScope, RequirementTemplate } from "../journeys/types";
import type { EngagementPlan, ResourceProfile } from "./engagement";
import type { ForecastWorkspace } from "../forecast/types";

export type AdminClient = { id: string; name: string; code: string; contactName: string; contactEmail: string; notes: string; active: boolean; revision: number };
export type AdminHome = { id: string; code: string; name: string; description: string; active: boolean; revision: number };
export type AdminResource = { id: string; name: string; home: string; ownerId: string; active: boolean; revision: number; profile?: ResourceProfile };
export type AdminMission = { id: string; name: string; clientId: string; active: boolean; revision: number; engagement?: EngagementPlan };
export type AdminCapability = { id: string; kind: "role" | "skill"; name: string; description: string; active: boolean; revision: number; aliases?: string[] };
export type AdminGrant = { role: JourneyRole; scope: Omit<PermissionScope, "organizationId"> };
export type AdminMember = { id: string; name: string; role: JourneyRole; resourceId: string | null; homeScope: string | null; active: boolean; revision: number; grants: AdminGrant[] };
export type AdminPlaybook = JourneyTemplate & { revision: number; persisted: boolean };
export type AdminBootstrap = {
  organization: { id: string; name: string; revision: number };
  viewer: { id: string; name: string };
  clients: AdminClient[];
  homes: AdminHome[];
  resources: AdminResource[];
  missions: AdminMission[];
  capabilities?: AdminCapability[];
  members: AdminMember[];
  templates: AdminPlaybook[];
  asOf: string;
  hasMore?: boolean;
  forecast?: ForecastWorkspace;
};
type EditIdentity = { id?: string; expectedRevision?: number };
type Toggle = { id: string; expectedRevision: number; active: boolean };
type MemberFields = { name: string; role: JourneyRole; resourceId: string | null; homeScope: string | null; grants: AdminGrant[] };
export type AdminCommand =
  | { type: "set_organization"; name: string; expectedRevision: number }
  | (EditIdentity & { type: "save_client"; name: string; code: string; contactName: string; contactEmail: string; notes: string })
  | (Toggle & { type: "set_client_active" })
  | (EditIdentity & { type: "save_home"; code: string; name: string; description: string })
  | (Toggle & { type: "set_home_active" })
  | (EditIdentity & { type: "save_resource"; name: string; home: string; ownerId: string; profile?: ResourceProfile })
  | (Toggle & { type: "set_resource_active" })
  | (EditIdentity & { type: "save_mission"; name: string; clientId: string; engagement?: EngagementPlan })
  | (Toggle & { type: "set_mission_active" })
  | (EditIdentity & { type: "save_capability"; kind: "role" | "skill"; name: string; description: string })
  | (Toggle & { type: "set_capability_active" })
  | (EditIdentity & { type: "save_playbook"; kind: JourneyKind; name: string; description: string; sourceReference: string; requirements: RequirementTemplate[] })
  | { type: "approve_playbook" | "retire_playbook"; id: string; expectedRevision: number }
  | (MemberFields & { type: "create_member"; subject: string; identityVerified: true })
  | (MemberFields & { type: "update_member"; id: string; expectedRevision: number; active: boolean });
export type AdminRequest = { idempotencyKey: string; command: AdminCommand };
