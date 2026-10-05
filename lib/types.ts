export type Home = "Data" | "AI" | "Software Engineering" | "Transformation";
export type Staffing = "committed" | "proposed" | "hold" | "pending_approval";
export type Commercial = "authorized" | "contingent" | "unknown";
export type Readiness = "ready" | "conditional" | "blocked" | "needs_verification";
export type Person = {
  id: string; name: string; initials: string; home: Home; grade: string;
  employment: "W2" | "1099"; weeklyHours: number; skills: string[];
  owner: string; avatar: string; note: string;
};
export type Mission = {
  id: string; name: string; client: string; initials: string; home: Home;
  start: string; end: string; weeklyHours: number; skills: string[];
  commercial: Commercial; owner: string; description: string;
};
export type Assignment = {
  id: string; personId: string; missionId: string; start: string; end: string;
  weeklyHours: number; staffing: Staffing; readiness: Readiness;
};
export type Obligation = {
  id: string; personId: string; title: string; detail: string; due: string;
  category: "access" | "equipment" | "handoff"; blocksStart: boolean;
  state: "open" | "submitted" | "satisfied"; owner: string; evidence?: string;
};
export type Notice = {
  id: string; personId: string; title: string; body: string; date: string;
  acknowledged: boolean; delivery: "delivered" | "queued" | "bounced";
};
export type ScenarioMove = {
  id: string; personId: string; missionId: string; start: string; end: string; weeklyHours: number;
};
export type Activity = { id: string; title: string; detail: string; time: string };
export type DemoState = {
  version: 1; obligations: Obligation[]; notices: Notice[];
  moves: ScenarioMove[]; scenarioName: string; scenarioStatus: "draft" | "pending_approval";
  activity: Activity[]; reported: { id: string; personId: string; text: string }[];
};
export type View = "runway" | "missions" | "decisions" | "my-bookends";
export type Focus = "all" | "closing" | "uncovered" | "open-seats" | "blocked";
