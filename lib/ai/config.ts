import { SOW_MAX_FILE_BYTES, SOW_MAX_TEXT_CHARACTERS, type SowCapability } from "./contracts";

/** Exposes readiness only. Keys and deployment identity never leave the server. */
export function sowCapability(env: Readonly<Record<string, string | undefined>> = process.env): SowCapability {
  const limits = { maxFileBytes: SOW_MAX_FILE_BYTES, maxTextCharacters: SOW_MAX_TEXT_CHARACTERS, formats: ["pdf", "docx", "txt"] as const };
  if (env.BOOKENDS_AI_ENABLED === "false") return { ...limits, available: false, reason: "SOW reading is paused. You can still build your team directly." };
  if (!env.BOOKENDS_AI_MODEL?.trim()) return { ...limits, available: false, reason: "SOW reading needs a model connection. You can still build your team directly." };
  if (!env.chaz_gpt?.trim() && !env.OPENAI_API_KEY?.trim()) return { ...limits, available: false, reason: "SOW reading is not connected to OpenAI yet. You can still build your team directly." };
  return { ...limits, available: true };
}
