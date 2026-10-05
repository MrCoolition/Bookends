import type { Assignment, DemoState, Home, Mission, Person } from "./types";
export const TODAY = "2026-10-05";
export const HOMES: Home[] = ["Data", "AI", "Software Engineering", "Transformation"];
export const HOME_META: Record<Home, { color: string; short: string; glyph: string }> = {
  Data: { color: "#315be3", short: "DATA", glyph: "◈" },
  AI: { color: "#8150bc", short: "AI", glyph: "✳" },
  "Software Engineering": { color: "#17756e", short: "ENGINEERING", glyph: "⌘" },
  Transformation: { color: "#b84a27", short: "TRANSFORMATION", glyph: "↗" },
};
export const PEOPLE: Person[] = [
  { id: "p1", name: "Alex Morgan", initials: "AM", home: "Data", grade: "Senior Consultant", employment: "W2", weeklyHours: 40, skills: ["Python", "dbt", "Snowflake"], owner: "Jordan Lee", avatar: "blue", note: "Building thoughtful data systems. Ready for the next challenge." },
  { id: "p2", name: "Maya Patel", initials: "MP", home: "Data", grade: "Manager", employment: "W2", weeklyHours: 40, skills: ["Python", "SQL", "Strategy"], owner: "Jordan Lee", avatar: "pink", note: "Bridges the space between data and better decisions." },
  { id: "p3", name: "James Okafor", initials: "JO", home: "Data", grade: "Consultant", employment: "1099", weeklyHours: 32, skills: ["dbt", "Snowflake", "SQL"], owner: "Jordan Lee", avatar: "orange", note: "Available for focused, high-impact analytics engagements." },
  { id: "p4", name: "Sofia Chen", initials: "SC", home: "AI", grade: "Senior Consultant", employment: "W2", weeklyHours: 40, skills: ["Python", "Machine learning", "MLOps"], owner: "Priya Shah", avatar: "purple", note: "Turning prototypes into AI that works in the real world." },
  { id: "p5", name: "Ethan Brooks", initials: "EB", home: "AI", grade: "Manager", employment: "W2", weeklyHours: 40, skills: ["Python", "Machine learning", "Strategy"], owner: "Priya Shah", avatar: "green", note: "Leading responsible AI from the first question to launch." },
  { id: "p6", name: "Isabella Rossi", initials: "IR", home: "AI", grade: "Consultant", employment: "W2", weeklyHours: 40, skills: ["Python", "MLOps"], owner: "Priya Shah", avatar: "peach", note: "A sharp eye for models and the infrastructure behind them." },
  { id: "p7", name: "Noah Williams", initials: "NW", home: "Software Engineering", grade: "Senior Consultant", employment: "W2", weeklyHours: 40, skills: ["TypeScript", "React", "AWS"], owner: "Sam Rivera", avatar: "teal", note: "Shipping software that people love using." },
  { id: "p8", name: "Olivia Park", initials: "OP", home: "Software Engineering", grade: "Consultant", employment: "1099", weeklyHours: 24, skills: ["TypeScript", "React"], owner: "Sam Rivera", avatar: "blue", note: "Front-end craft, with a human-centered perspective." },
  { id: "p9", name: "Liam Davis", initials: "LD", home: "Transformation", grade: "Senior Manager", employment: "W2", weeklyHours: 40, skills: ["Strategy", "Change management"], owner: "Avery Johnson", avatar: "orange", note: "Making change feel possible, one team at a time." },
  { id: "p10", name: "Zoe Thompson", initials: "ZT", home: "Transformation", grade: "Senior Consultant", employment: "W2", weeklyHours: 32, skills: ["Strategy", "Change management", "SQL"], owner: "Avery Johnson", avatar: "pink", note: "Connecting people, processes, and what comes next." },
];
export const MISSIONS: Mission[] = [
  { id: "m1", name: "Data foundation", client: "Meridian", initials: "M", home: "Data", start: "2026-08-03", end: "2026-10-31", weeklyHours: 80, skills: ["Python", "SQL"], commercial: "authorized", owner: "Jordan Lee", description: "A trusted data foundation for the next chapter of financial services." },
  { id: "m2", name: "Analytics engine", client: "Northstar", initials: "N", home: "Data", start: "2026-11-02", end: "2027-01-30", weeklyHours: 80, skills: ["dbt", "Snowflake"], commercial: "authorized", owner: "Jordan Lee", description: "Build a modern analytics platform that puts insight in everyone's hands." },
  { id: "m3", name: "Customer intelligence", client: "Forma", initials: "F", home: "Data", start: "2026-09-07", end: "2026-11-14", weeklyHours: 32, skills: ["SQL"], commercial: "authorized", owner: "Jordan Lee", description: "Connect the customer journey through useful, accessible intelligence." },
  { id: "m4", name: "Applied AI lab", client: "Atlas", initials: "A", home: "AI", start: "2026-08-17", end: "2026-11-07", weeklyHours: 80, skills: ["Python", "Machine learning"], commercial: "authorized", owner: "Priya Shah", description: "Bring practical, responsible AI into the everyday operations of Atlas." },
  { id: "m5", name: "Intelligent operations", client: "Helix", initials: "H", home: "AI", start: "2026-11-09", end: "2027-02-27", weeklyHours: 80, skills: ["Python", "MLOps"], commercial: "authorized", owner: "Priya Shah", description: "Turn a promising AI pilot into a resilient production capability." },
  { id: "m6", name: "AI discovery", client: "Aperture", initials: "a", home: "AI", start: "2026-10-05", end: "2026-12-19", weeklyHours: 40, skills: ["Python"], commercial: "contingent", owner: "Priya Shah", description: "Explore what AI could unlock. Commercial authorization is still pending." },
  { id: "m7", name: "Digital experience", client: "Orbit", initials: "O", home: "Software Engineering", start: "2026-09-01", end: "2026-12-05", weeklyHours: 64, skills: ["TypeScript", "React"], commercial: "authorized", owner: "Sam Rivera", description: "A new digital home for a brand that keeps moving forward." },
  { id: "m8", name: "Platform evolution", client: "Northstar", initials: "N", home: "Software Engineering", start: "2026-12-07", end: "2027-03-27", weeklyHours: 80, skills: ["TypeScript", "AWS"], commercial: "authorized", owner: "Sam Rivera", description: "Reimagine the platform for the next wave of products and growth." },
  { id: "m9", name: "Future of work", client: "Evergreen", initials: "E", home: "Transformation", start: "2026-09-07", end: "2026-11-21", weeklyHours: 72, skills: ["Strategy", "Change management"], commercial: "authorized", owner: "Avery Johnson", description: "Help teams build a more adaptable, connected way of working." },
  { id: "m10", name: "Operating model", client: "Solstice", initials: "S", home: "Transformation", start: "2026-11-23", end: "2027-03-06", weeklyHours: 40, skills: ["Strategy"], commercial: "authorized", owner: "Avery Johnson", description: "Design the operating model for a new era of sustainable growth." },
];
export const ASSIGNMENTS: Assignment[] = [
  { id: "a1", personId: "p1", missionId: "m1", start: "2026-08-03", end: "2026-10-31", weeklyHours: 40, staffing: "committed", readiness: "ready" },
  { id: "a2", personId: "p2", missionId: "m1", start: "2026-08-03", end: "2026-10-31", weeklyHours: 40, staffing: "committed", readiness: "ready" },
  { id: "a3", personId: "p2", missionId: "m2", start: "2026-11-02", end: "2027-01-30", weeklyHours: 40, staffing: "committed", readiness: "ready" },
  { id: "a4", personId: "p3", missionId: "m3", start: "2026-09-07", end: "2026-11-14", weeklyHours: 32, staffing: "committed", readiness: "ready" },
  { id: "a5", personId: "p4", missionId: "m4", start: "2026-08-17", end: "2026-11-07", weeklyHours: 40, staffing: "committed", readiness: "ready" },
  { id: "a6", personId: "p4", missionId: "m5", start: "2026-11-09", end: "2027-02-27", weeklyHours: 40, staffing: "committed", readiness: "blocked" },
  { id: "a7", personId: "p5", missionId: "m4", start: "2026-08-17", end: "2026-11-07", weeklyHours: 20, staffing: "committed", readiness: "ready" },
  { id: "a8", personId: "p5", missionId: "m6", start: "2026-10-05", end: "2026-12-19", weeklyHours: 20, staffing: "proposed", readiness: "conditional" },
  { id: "a9", personId: "p6", missionId: "m4", start: "2026-08-17", end: "2026-10-17", weeklyHours: 20, staffing: "committed", readiness: "ready" },
  { id: "a10", personId: "p7", missionId: "m7", start: "2026-09-01", end: "2026-12-05", weeklyHours: 40, staffing: "committed", readiness: "ready" },
  { id: "a11", personId: "p7", missionId: "m8", start: "2026-12-07", end: "2027-03-27", weeklyHours: 40, staffing: "proposed", readiness: "ready" },
  { id: "a12", personId: "p8", missionId: "m7", start: "2026-09-01", end: "2026-12-05", weeklyHours: 24, staffing: "committed", readiness: "ready" },
  { id: "a13", personId: "p9", missionId: "m9", start: "2026-09-07", end: "2026-11-21", weeklyHours: 40, staffing: "committed", readiness: "ready" },
  { id: "a14", personId: "p9", missionId: "m10", start: "2026-11-23", end: "2027-03-06", weeklyHours: 40, staffing: "committed", readiness: "ready" },
  { id: "a15", personId: "p10", missionId: "m9", start: "2026-09-07", end: "2026-11-21", weeklyHours: 32, staffing: "committed", readiness: "ready" },
];
export const INITIAL_STATE: DemoState = {
  version: 1, moves: [], scenarioName: "Next chapter", scenarioStatus: "draft", reported: [],
  obligations: [
    { id: "b1", personId: "p1", title: "Return Meridian laptop", detail: "Arrange a return with the asset owner after your final working day. This does not block your next mission.", due: "2026-11-04", category: "equipment", blocksStart: false, state: "open", owner: "Jordan Lee" },
    { id: "b2", personId: "p4", title: "Helix access approval", detail: "Client security approval is required before the Helix start. The accepted assignment remains reserved.", due: "2026-11-04", category: "access", blocksStart: true, state: "open", owner: "Priya Shah" },
    { id: "b3", personId: "p6", title: "Verify MLOps qualification", detail: "The recorded certification is stale. Submit an updated verification before a start requiring this skill.", due: "2026-10-09", category: "access", blocksStart: true, state: "open", owner: "Priya Shah" },
    { id: "b4", personId: "p7", title: "Northstar device provisioning", detail: "The new client device must be provisioned before the proposed start.", due: "2026-11-30", category: "equipment", blocksStart: true, state: "open", owner: "Sam Rivera" },
    { id: "b5", personId: "p1", title: "Complete the knowledge handoff", detail: "Document pipelines and confirm the receiving owner's acceptance. Handoff time is already included in your current assignment.", due: "2026-10-28", category: "handoff", blocksStart: false, state: "open", owner: "Jordan Lee" },
  ],
  notices: [
    { id: "n1", personId: "p1", title: "Your next chapter is taking shape", body: "Your Meridian mission finishes on October 30. Jordan is reviewing the Northstar analytics opportunity with you. No next assignment is confirmed yet. Your next update is October 9.", date: "2026-10-05", acknowledged: false, delivery: "delivered" },
    { id: "n2", personId: "p4", title: "Helix start confirmed · access still pending", body: "Your staffing is accepted for November 9. Client access remains a start prerequisite. Priya is coordinating approval and will update you by November 4.", date: "2026-10-02", acknowledged: false, delivery: "delivered" },
    { id: "n3", personId: "p6", title: "Let’s review your next landing", body: "Your partial Atlas assignment ends on October 16. Priya is reviewing suitable next missions and your qualification evidence.", date: "2026-10-02", acknowledged: false, delivery: "bounced" },
  ],
  activity: [
    { id: "ev1", title: "A next chapter, confirmed", detail: "Maya → Northstar · Nov 2", time: "09:42" },
    { id: "ev2", title: "One team. New possibilities.", detail: "Helix · 40 h/week still open", time: "09:18" },
    { id: "ev3", title: "Plan ahead. Land together.", detail: "October planning workspace opened", time: "09:00" },
  ],
};
