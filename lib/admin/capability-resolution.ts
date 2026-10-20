import type { AdminCapability } from "./contracts";

export type CapabilityKind = AdminCapability["kind"];
export type CapabilityResolution =
  | { status: "resolved"; input: string; capability: AdminCapability; matchedBy: "name" | "alias" | "normalized" | "acronym"; suggestions: AdminCapability[] }
  | { status: "unmatched" | "ambiguous"; input: string; suggestions: AdminCapability[] };
export type CapabilityResolutionOptions = {
  /** Historical profiles and plans keep their meaning after an item is retired. */
  includeInactive?: boolean;
};

const exactKey = (value: string) => value.trim().toLocaleLowerCase("en-US");

/** Normalize presentation, not meaning. Keep +, #, /, &, and periods because
 * they distinguish skills such as C, C++, C#, .NET, and Node.js. */
export function capabilityResolutionKey(value: string): string {
  return exactKey(value)
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u2010-\u2015]/gu, "-")
    .replace(/(?<=[\p{L}\p{N}])\s*-\s*(?=[\p{L}\p{N}])/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\s*([/+,&#])\s*/gu, "$1")
    .trim();
}

function withoutDeclaredAcronym(value: string): string | null {
  const match = /^(.*?)\s*\(([A-Za-z][A-Za-z.\s]{0,29})\)\s*$/u.exec(value.trim());
  if (!match) return null;
  const words = match[1].match(/[\p{L}\p{N}]+/gu) ?? [];
  const acronym = match[2].replace(/[.\s]/gu, "").toLocaleLowerCase("en-US");
  const initials = words.map(word => word[0]).join("").toLocaleLowerCase("en-US");
  // A description or level in parentheses is not an alias. The acronym must
  // spell the initials of the full title, without dropping seniority or words.
  return words.length >= 2 && acronym.length >= 2 && acronym === initials
    ? capabilityResolutionKey(match[1])
    : null;
}

type Entry = { capability: AdminCapability; text: string; alias: boolean };
type Index = Map<string, Entry[]>;
const indexKey = (kind: CapabilityKind, value: string) => `${kind}:${value}`;
function add(index: Index, kind: CapabilityKind, value: string, entry: Entry) {
  if (!value) return;
  const key = indexKey(kind, value);
  index.set(key, [...(index.get(key) ?? []), entry]);
}
function ordered(entries: Entry[]): AdminCapability[] {
  return [...new Map(entries.map(entry => [entry.capability.id, entry.capability])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "en-US") || a.id.localeCompare(b.id));
}
const wordsOf = (value: string) => new Set(capabilityResolutionKey(value).match(/[\p{L}\p{N}+#.]+/gu) ?? []);

/** Shared deterministic resolution for intake, team matching, and forecasts.
 * Suggestions are manual choices only; lexical similarity never resolves a
 * title or assigns a person's skills. Neither names nor aliases cross kinds. */
export function createCapabilityResolver(capabilities: readonly AdminCapability[], options: CapabilityResolutionOptions = {}) {
  const catalog = capabilities.filter(capability => options.includeInactive !== false || capability.active);
  const entries: Entry[] = catalog.flatMap(capability => [capability.name, ...(capability.aliases ?? [])]
    .map((text, index) => ({ capability, text, alias: index > 0 })));
  const exact: Index = new Map(), normalized: Index = new Map(), acronym: Index = new Map();
  const keys = new Map<string, string | null>();
  for (const entry of entries) {
    const kind = entry.capability.kind;
    add(exact, kind, exactKey(entry.text), entry);
    add(normalized, kind, capabilityResolutionKey(entry.text), entry);
    // Skill abbreviations must be explicitly configured; no expansion inference.
    const expanded = kind === "role" ? withoutDeclaredAcronym(entry.text) : null;
    if (expanded) add(acronym, kind, expanded, entry);
  }

  function suggestions(kind: CapabilityKind, input: string): AdminCapability[] {
    const query = wordsOf(input), queryKey = capabilityResolutionKey(input);
    if (!query.size) return [];
    const scored = new Map<string, { capability: AdminCapability; score: number }>();
    for (const entry of entries) {
      if (entry.capability.kind !== kind) continue;
      const words = wordsOf(entry.text);
      const common = [...query].filter(word => words.has(word)).length;
      const initials = [...words].map(word => word[0]).join("");
      const score = common ? common / new Set([...query, ...words]).size : kind === "role" && queryKey.length >= 2 && queryKey === initials ? 0.5 : 0;
      if (score > (scored.get(entry.capability.id)?.score ?? 0)) scored.set(entry.capability.id, { capability: entry.capability, score });
    }
    return [...scored.values()].sort((a, b) => b.score - a.score || a.capability.name.localeCompare(b.capability.name, "en-US") || a.capability.id.localeCompare(b.capability.id))
      .slice(0, 5).map(entry => entry.capability);
  }

  function resolve(kind: CapabilityKind, input: string): CapabilityResolution {
    const direct = exact.get(indexKey(kind, exactKey(input))) ?? [];
    const normalizedInput = capabilityResolutionKey(input);
    const presentation = normalized.get(indexKey(kind, normalizedInput)) ?? [];
    const expanded = kind === "role" ? withoutDeclaredAcronym(input) : null;
    const expandedMatches = kind === "role"
      ? [...(acronym.get(indexKey(kind, expanded ?? normalizedInput)) ?? []), ...(expanded ? normalized.get(indexKey(kind, expanded)) ?? [] : [])]
      : [];
    // An explicit configured name or alias takes precedence over formatting or
    // acronym rules. A collision at the winning level must be resolved by a user.
    const matches = direct.length ? direct : presentation.length ? presentation : expandedMatches;
    const distinct = ordered(matches);
    if (distinct.length > 1) return { status: "ambiguous", input, suggestions: distinct };
    if (distinct.length === 1) {
      const capability = distinct[0];
      const matchedBy = direct.length ? direct.some(entry => !entry.alias) ? "name" : "alias" : presentation.length ? "normalized" : "acronym";
      return { status: "resolved", input, capability, matchedBy, suggestions: [] };
    }
    return { status: "unmatched", input, suggestions: suggestions(kind, input) };
  }

  return {
    resolve,
    /** Null is deliberately unmatchable: filter it out of profile sets and do
     * not compare two nulls. Unconfigured text can match only its normalized
     * wording, retaining legacy direct plans without a catalog. */
    key(kind: CapabilityKind, value: string): string | null {
      const cacheKey = indexKey(kind, value);
      if (keys.has(cacheKey)) return keys.get(cacheKey)!;
      const resolution = resolve(kind, value);
      const normalized = capabilityResolutionKey(value);
      const key = resolution.status === "ambiguous" ? null
        : resolution.status === "resolved" ? `${kind}:id:${resolution.capability.id}`
          : normalized ? `${kind}:text:${normalized}` : null;
      keys.set(cacheKey, key);
      return key;
    },
  };
}

export function resolveCapability(kind: CapabilityKind, value: string, capabilities: readonly AdminCapability[], options: CapabilityResolutionOptions = {}): CapabilityResolution {
  return createCapabilityResolver(capabilities, options).resolve(kind, value);
}
