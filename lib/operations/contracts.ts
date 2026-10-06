import type { Journey, JourneyKind, JourneyReadiness, JourneyRole, JourneyTemplate, ObligationCommand } from "../journeys/types";

export type OperationsResource = { id: string; name: string; home: string; ownerId: string; linkedMemberId: string | null; active: boolean };
export type OperationsMission = { id: string; name: string; clientId: string; clientName: string; active: boolean };
export type OperationsNotice = { id: string; journeyId: string; title: string; body: string; publishedAt: string; acknowledgedAt: string | null; revision: number };
export type OperationsBootstrap = {
  organization: { id: string; name: string };
  viewer: { id: string; name: string; role: JourneyRole; resourceId: string | null; canCoordinate: boolean; canApprovePolicies: boolean };
  resources: OperationsResource[];
  missions: OperationsMission[];
  clients: { id: string; name: string }[];
  homes: { code: string; name: string }[];
  members: { id: string; name: string }[];
  journeys: Journey[];
  readinessByJourney: Record<string, JourneyReadiness>;
  templates: JourneyTemplate[];
  notices: OperationsNotice[];
  asOf: string;
  hasMore: boolean;
};

export type OperationsCommand =
  | { type: "create_resource"; name: string; home: string; ownerId: string }
  | { type: "create_mission"; name: string; clientId: string }
  | { type: "approve_template"; kind: JourneyKind; sourceReference: string }
  | { type: "create_journey"; templateId: string; resourceId: string; missionId?: string; assignmentReference?: string; ownerId: string; fulfillerId: string; verifierId: string; owners?: Record<string, { ownerId: string; fulfillerId: string; verifierId: string }>; openingAt: string | null; releaseAt: string | null; closeoutAt: string | null }
  | { type: "obligation"; journeyId: string; obligationId: string; expectedRevision: number; command: ObligationCommand }
  | { type: "acknowledge_notice"; noticeId: string; expectedRevision: number };
export type OperationsRequest = { idempotencyKey: string; command: OperationsCommand };
