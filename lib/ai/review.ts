import { isEngagementDate } from "../admin/engagement";
import { sowModelOutputSchema, type SowIntakeResult } from "./contracts";
import type { SowInput } from "./input";

const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
/** Quote verification means text was found, not that the model's interpretation is correct. */
export function reviewSowOutput(raw: unknown, input: SowInput): SowIntakeResult {
  const parsed = sowModelOutputSchema.parse(raw), draft = structuredClone(parsed.draft);
  const uncertainties = [...parsed.uncertainties];
  const sourceText = normalize(input.text);
  const evidence = parsed.evidence.map(item => ({ ...item, verified: input.source.kind !== "pdf" && sourceText.includes(normalize(item.quote)) }));
  const supported = new Set(evidence.filter(item => item.verified || input.source.kind === "pdf").map(item => item.field));
  const needsReview = (field: string) => uncertainties.push(`Confirm ${field.replace(/^roles\.(\d+)\./, (_, index: string) => `role ${Number(index) + 1} `)}: no matching source quote was available.`);
  for (const field of ["clientName", "name", "sowReference", "signedOn", "start", "end", "outcomes"] as const) {
    if (draft[field] !== null && !supported.has(field)) { draft[field] = null; needsReview(field); }
  }
  const validDate = (value: string | null, label: string) => {
    if (value && !isEngagementDate(value)) { uncertainties.push(`Confirm ${label}: the document did not yield a valid calendar date.`); return null; }
    return value;
  };
  draft.start = validDate(draft.start, "the engagement start"); draft.end = validDate(draft.end, "the engagement end"); draft.signedOn = validDate(draft.signedOn, "the signature date");
  if (draft.start && draft.end && draft.end < draft.start) { draft.end = null; uncertainties.push("Confirm the engagement end date: it appeared earlier than the start date."); }
  const signingEvidence = evidence.find(item => item.field === "status" && (item.verified || input.source.kind === "pdf"));
  if (draft.status === "signed" && (!draft.sowReference || !draft.signedOn || !signingEvidence || !/\b(signed|executed)\b/i.test(signingEvidence.quote) || /\b(not|never|un?signed|pending|awaiting|will|to be)\b/i.test(signingEvidence.quote))) {
    draft.status = "draft"; uncertainties.push("Confirm whether the SOW is signed, its reference, and its signature date. The proposed plan is kept as a draft.");
  }
  draft.roles.forEach((role, index) => {
    for (const field of ["name", "headcount", "allocationPercent", "responsibilities", "start", "end"] as const) {
      if (role[field] !== null && !supported.has(`roles.${index}.${field}`)) { role[field] = null; needsReview(`roles.${index}.${field}`); }
    }
    if (role.skills.length && !supported.has(`roles.${index}.skills`)) { role.skills = []; needsReview(`roles.${index}.skills`); }
    role.skills = [...new Map(role.skills.map(skill => [skill.toLocaleLowerCase("en-US"), skill])).values()];
    role.start = validDate(role.start, `role ${index + 1} start`); role.end = validDate(role.end, `role ${index + 1} end`);
    if (role.start && draft.start && role.start < draft.start) { role.start = null; uncertainties.push(`Confirm role ${index + 1} start: it appeared outside the engagement window.`); }
    if (role.end && ((draft.end && role.end > draft.end) || (role.start && role.end < role.start))) { role.end = null; uncertainties.push(`Confirm role ${index + 1} end: it appeared outside the role or engagement window.`); }
    if (role.headcount === null) uncertainties.push(`How many people are needed for role ${index + 1}?`);
    if (role.allocationPercent === null) uncertainties.push(`What allocation percentage is needed for role ${index + 1}?`);
  });
  if (!draft.clientName) uncertainties.push("Which client is this engagement for?");
  if (!draft.start || !draft.end) uncertainties.push("Confirm the engagement's first and last dates.");
  if (!draft.roles.length) uncertainties.push("Which delivery roles and headcounts does this engagement need?");
  if (input.source.kind === "pdf") uncertainties.push("PDF quotations were proposed by the model. Check them against the original PDF before relying on them.");
  else if (evidence.some(item => !item.verified)) uncertainties.push("Some proposed quotations were not found in the document. Related fields have been left open for your review.");
  return { draft, evidence, uncertainties: [...new Set(uncertainties)].slice(0, 60), source: input.source, draftOnly: true };
}
