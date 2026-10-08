import { z } from "zod";

export const SOW_MAX_FILE_BYTES = 3 * 1024 * 1024;
export const SOW_MAX_TEXT_CHARACTERS = 60_000;
export const SOW_MAX_REQUEST_BYTES = SOW_MAX_FILE_BYTES + 64 * 1024;
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
export const sowRoleDraftSchema = z.object({
  name: optionalText(160), headcount: z.int().min(1).max(1000).nullable(),
  allocationPercent: z.number().min(1).max(100).nullable(),
  skills: z.array(text(100)).max(40), responsibilities: optionalText(3000), start: date, end: date,
}).strict();
export const sowDraftSchema = z.object({
  clientName: optionalText(160), name: optionalText(160), sowReference: optionalText(200),
  status: z.enum(["draft", "signed"]), signedOn: date, start: date, end: date,
  outcomes: optionalText(4000), roles: z.array(sowRoleDraftSchema).max(30),
}).strict();
export const sowEvidenceFieldSchema = z.string().regex(/^(clientName|name|sowReference|status|signedOn|start|end|outcomes|roles\.(?:[0-9]|[12][0-9])\.(?:name|headcount|allocationPercent|skills|responsibilities|start|end))$/);
export const sowModelOutputSchema = z.object({
  draft: sowDraftSchema,
  evidence: z.array(z.object({ field: sowEvidenceFieldSchema, quote: text(600) }).strict()).max(220),
  uncertainties: z.array(text(500)).max(40),
}).strict();
export type SowDraft = z.infer<typeof sowDraftSchema>;
export type SowModelOutput = z.infer<typeof sowModelOutputSchema>;
export type SowSource = { name: string; kind: "pdf" | "docx" | "text" };
export type SowIntakeResult = Omit<SowModelOutput, "evidence"> & {
  evidence: (SowModelOutput["evidence"][number] & { verified: boolean })[];
  source: SowSource; draftOnly: true;
};
export type SowCapability = {
  available: boolean; reason?: string; maxFileBytes: number; maxTextCharacters: number;
  formats: readonly ["pdf", "docx", "txt"];
};
export class SowIntakeError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) { super(message); this.name = "SowIntakeError"; }
}
