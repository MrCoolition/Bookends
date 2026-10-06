import type { BaggageCategory, BlockedAction, JourneyKind, JourneyRole, JourneyTemplate, RequirementTemplate } from "./types";

const SOURCE = "BOOKENDS journey starter catalog v1 — proposed operational guidance; owner approval required";
type Step = {
  key: string; title: string; description: string; category: BaggageCategory;
  actions?: BlockedAction[]; role?: JourneyRole; receipt?: boolean;
  severity?: RequirementTemplate["severity"]; prerequisite?: string; nonwaivable?: boolean;
  anchor?: RequirementTemplate["dueRule"]["anchor"];
};
const ARRIVAL: Step[] = [
  { key: "welcome", title: "A warm welcome and a named guide", description: "Share what to expect, ask about working preferences, and make the support contact easy to reach.", category: "transition" },
  { key: "mentor", title: "Meet your mentor and the people around you", description: "Make personal introductions and agree on a first-week check-in. Make room for questions before work begins.", category: "transition" },
  { key: "brief", title: "A clear brief, with room for your questions", description: "Review the purpose, role, expectations, working arrangements, and the person who owns unresolved questions.", category: "constraints", actions: ["confirm_assignment"], severity: "soft" },
  { key: "equipment", title: "Equipment ready for your first day", description: "Confirm approved equipment is received and ready to use. Existing equipment does not imply permission to reuse it here.", category: "physical_custody", actions: ["start_assignment"], role: "asset_access_owner", receipt: true },
  { key: "access", title: "The right access, ready when you are", description: "Verify the approved identities, tools, and access needed for this scope. Keep credentials in their approved systems.", category: "access_and_licensing", actions: ["start_assignment"], role: "asset_access_owner" },
  { key: "learning", title: "Time and support for required learning", description: "Confirm the specific approved training and eligibility requirements, their validity, and the help available to meet them.", category: "eligibility", actions: ["start_assignment"], nonwaivable: true },
  { key: "check_in", title: "Your first-week check-in", description: "Check how the landing feels, remove friction, and agree on the next support check-in. Asking for help is welcome.", category: "transition", anchor: "manual" },
];
const DEPARTURE: Step[] = [
  { key: "handoff", title: "Leave a useful handoff", description: "Agree on what should carry forward, who receives it, and time to share context. Record work in an explicit reservation if extra time is needed.", category: "transition", actions: ["close_mission"], anchor: "release" },
  { key: "knowledge", title: "Confirm the next person has what they need", description: "Ask the receiving owner to accept the documentation, deliverables, and knowledge transfer. An upload alone is not acceptance.", category: "transition", actions: ["close_mission"], prerequisite: "handoff" },
  { key: "access", title: "Close scoped access with confirmation", description: "Have the access owner verify externally completed access removal for this scope, preserving access needed for other current work.", category: "access_and_licensing", actions: ["close_mission"], role: "asset_access_owner" },
  { key: "equipment", title: "An easy return, with a confirmed receipt", description: "Give clear return instructions and support. The receiving owner confirms receipt; a shipment label is only progress.", category: "physical_custody", actions: ["close_mission"], role: "asset_access_owner", receipt: true },
  { key: "data", title: "Confirm the agreed data disposition", description: "Verify approved return, deletion, retention, or archive instructions externally. A retention hold must be resolved by its owner; no automated deletion is performed.", category: "data_disposition", actions: ["close_mission"], role: "asset_access_owner", nonwaivable: true },
  { key: "time_expense", title: "Wrap up time and expenses with support", description: "Confirm final submissions and route questions to a named owner. This closeout does not implicitly delay capacity release.", category: "transition", actions: ["close_mission"] },
  { key: "reflection", title: "Recognize the contribution and learn together", description: "Offer a thoughtful reflection conversation, recognize contributions, and capture helpful feedback without making praise or personal disclosure a prerequisite.", category: "transition", anchor: "manual" },
  { key: "next_chapter", title: "Know your next chapter and your contact", description: "Share the confirmed next step or explicitly unresolved plan, its named owner, and the next update. An assignment ending is not an employment decision.", category: "transition", anchor: "release" },
];

function build(kind: JourneyKind, name: string, description: string): JourneyTemplate {
  const arrival = kind.endsWith("onboarding");
  const company = kind.startsWith("company");
  const steps = arrival ? ARRIVAL : DEPARTURE;
  const requirements = steps.map((step): RequirementTemplate => {
    const anchor = step.anchor ?? (arrival ? "opening" : "closeout");
    const role = step.role ?? (company ? "administrator" : "mission_owner");
    return {
      id: `${kind}.${step.key}`, version: 1, title: step.title, description: step.description,
      category: step.category, sourceReference: SOURCE, applicableScope: company ? "person" : "assignment",
      trigger: anchor === "opening" ? "before_open" : anchor === "release" ? "before_release" : anchor === "closeout" ? "after_close" : "manual",
      leadTimeDays: null,
      // Owners configure dates from verified instructions. No contractual lead time is invented.
      dueRule: { anchor, offsetDays: anchor === "manual" ? null : 0 },
      approverRole: role,
      evidencePolicy: { required: !!step.actions?.length, acceptedKinds: step.receipt ? ["accepted_receipt"] : ["attestation", "restricted_reference", "acceptance"], independentVerification: true },
      blockedActions: step.actions ? (company ? [arrival ? "open_journey" : "close_journey"] : [...step.actions]) : [], severity: step.severity ?? (step.actions?.length ? "hard" : "information"),
      overridePolicy: { allowed: !!step.actions?.length && !step.nonwaivable, approverRoles: [role], evidenceRequired: !!step.actions?.length },
      prerequisiteTemplateIds: step.prerequisite ? [`${kind}.${step.prerequisite}`] : [], active: true,
    };
  });
  return { id: `bookends.${kind}`, kind, version: 1, name, description, status: "draft", sourceReference: SOURCE, policyOwnerId: null, approvedBy: null, approvedAt: null, approvedScope: null, requirements };
}

/** Draft suggestions. Their categories and wording do not establish binding organizational policy. */
export const JOURNEY_TEMPLATE_CATALOG: JourneyTemplate[] = [
  build("mission_onboarding", "A great landing", "A supported start with a clear brief, helpful people, and the right tools."),
  build("mission_offboarding", "A thoughtful handoff", "A supported finish that recognizes the contribution and leaves the next team ready."),
  build("company_onboarding", "Welcome to your next chapter", "Coordinate a warm company welcome and operational readiness. Employment decisions stay in their authorized source systems."),
  build("company_offboarding", "A supported company transition", "Coordinate approved operational handoffs and support. This journey does not initiate termination, payroll changes, or other employment actions."),
];

export function getJourneyTemplate(kind: JourneyKind): JourneyTemplate {
  const template = JOURNEY_TEMPLATE_CATALOG.find(item => item.kind === kind);
  if (!template) throw new Error("Unknown journey kind.");
  return structuredClone(template);
}
