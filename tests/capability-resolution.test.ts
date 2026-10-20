import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdminCapability } from "../lib/admin/contracts";
import { capabilityResolutionKey, createCapabilityResolver, resolveCapability } from "../lib/admin/capability-resolution";

const capability = (id: string, name: string, patch: Partial<AdminCapability> = {}): AdminCapability => ({
  id, name, kind: "role", description: "", active: true, revision: 1, ...patch,
});

test("configured names and aliases resolve to the same canonical record before looser presentation rules", () => {
  const businessAnalyst = capability("ba", "Business Analyst", { aliases: ["BA", "Business Analysis Specialist"] });
  const resolver = createCapabilityResolver([businessAnalyst, capability("punctuated", "Business-Analyst")]);
  assert.deepEqual(resolver.resolve("role", " business ANALYST "), { status: "resolved", input: " business ANALYST ", capability: businessAnalyst, matchedBy: "name", suggestions: [] });
  const alias = resolver.resolve("role", "BA");
  assert.equal(alias.status, "resolved");
  assert.equal(alias.status === "resolved" && alias.matchedBy, "alias");
  assert.equal(resolver.key("role", "Business Analysis Specialist"), resolver.key("role", "Business Analyst"));
});

test("safe spacing and typographic punctuation align without erasing meaningful skill symbols", () => {
  const resolver = createCapabilityResolver([
    capability("fullstack", "Full Stack Developer"),
    capability("sql", "SQL", { kind: "skill" }),
    capability("c", "C", { kind: "skill" }),
    capability("cpp", "C++", { kind: "skill" }),
    capability("csharp", "C#", { kind: "skill" }),
    capability("dotnet", ".NET", { kind: "skill" }),
  ]);
  assert.equal(resolver.key("role", "Full–Stack   Developer"), resolver.key("role", "Full Stack Developer"));
  assert.equal(resolver.key("skill", " sql "), "skill:id:sql");
  assert.notEqual(resolver.key("skill", "C++"), resolver.key("skill", "C"));
  assert.notEqual(resolver.key("skill", "C#"), resolver.key("skill", "C"));
  assert.notEqual(resolver.key("skill", "C--"), resolver.key("skill", "C"));
  assert.notEqual(resolver.key("skill", ".NET"), resolver.key("skill", "NET"));
  assert.equal(capabilityResolutionKey("BA / PM"), "ba/pm");
});

test("a verified parenthesized acronym resolves to an unambiguous full role name", () => {
  const resolver = createCapabilityResolver([capability("ba", "Business Analyst")]);
  for (const name of ["Business Analyst (BA)", "Business Analyst (B.A.)", "Business Analyst (ba)"]) {
    const result = resolver.resolve("role", name);
    assert.equal(result.status, "resolved");
    assert.equal(result.status === "resolved" && result.capability.id, "ba");
    assert.equal(result.status === "resolved" && result.matchedBy, "acronym");
  }
  assert.equal(resolver.resolve("role", "Business Analyst (PM)").status, "unmatched");
  assert.equal(resolver.resolve("role", "Business Analyst (Senior)").status, "unmatched");
  assert.equal(resolver.resolve("role", "Business Analyst / PM").status, "unmatched");
});

test("a configured expanded acronym can resolve full wording, but standalone abbreviations need an explicit alias", () => {
  const resolver = createCapabilityResolver([capability("ba", "Business Analyst (BA)")]);
  assert.equal(resolver.key("role", "Business Analyst"), "role:id:ba");
  const abbreviation = resolver.resolve("role", "BA");
  assert.equal(abbreviation.status, "unmatched");
  assert.deepEqual(abbreviation.suggestions.map(item => item.id), ["ba"]);
});

test("lead and seniority differences are suggestions only and never silently collapsed", () => {
  const resolver = createCapabilityResolver([
    capability("engineering-lead", "Data Engineering Lead"),
    capability("engineer", "Data Engineer"),
    capability("manager", "Data Engineering Manager"),
    capability("senior", "Senior Data Engineer"),
  ]);
  const result = resolver.resolve("role", "Data Lead");
  assert.equal(result.status, "unmatched");
  assert.ok(result.suggestions.some(item => item.id === "engineering-lead"));
  assert.notEqual(resolver.key("role", "Data Lead"), resolver.key("role", "Data Engineering Lead"));
  assert.notEqual(resolver.key("role", "Senior Data Engineer"), resolver.key("role", "Data Engineer"));
  assert.notEqual(resolver.key("role", "Data Engineering Manager"), resolver.key("role", "Data Engineering Lead"));
  assert.equal(resolver.resolve("role", "Data Engineer (Lead)").status, "unmatched");
});

test("same-kind aliases cannot collide silently with names or other aliases", () => {
  const entries = [capability("a", "Architect", { aliases: ["Technical Lead"] }), capability("b", "Technical Lead")];
  for (const catalog of [entries, [...entries].reverse()]) {
    const resolver = createCapabilityResolver(catalog);
    const resolution = resolver.resolve("role", "Technical Lead");
    assert.equal(resolution.status, "ambiguous");
    assert.deepEqual(resolution.suggestions.map(item => item.id), ["a", "b"]);
    assert.equal(resolver.key("role", "Technical Lead"), null);
  }
});

test("normalized-name and acronym collisions require manual confirmation", () => {
  const resolver = createCapabilityResolver([
    capability("a", "Business-Analyst"),
    capability("b", "Business Analyst"),
    capability("c", "Business Analyst (BA)"),
  ]);
  assert.equal(resolver.resolve("role", "Business   Analyst").status, "ambiguous");
  assert.equal(resolver.resolve("role", "Business Analyst (B.A.)").status, "ambiguous");
  assert.equal(resolver.key("role", "Business Analyst (B.A.)"), null);
  // Exact configured wording remains authoritative.
  assert.equal(resolver.key("role", "Business Analyst"), "role:id:b");
});

test("role and skill catalogs stay separate for names, aliases, suggestions, and identities", () => {
  const resolver = createCapabilityResolver([
    capability("role-python", "Python", { aliases: ["Python Developer"] }),
    capability("skill-python", "Python", { kind: "skill", aliases: ["CPython"] }),
    capability("ba-skill", "Business Analysis", { kind: "skill" }),
  ]);
  assert.equal(resolver.key("role", "Python"), "role:id:role-python");
  assert.equal(resolver.key("skill", "Python"), "skill:id:skill-python");
  assert.equal(resolver.resolve("role", "CPython").status, "unmatched");
  assert.equal(resolver.resolve("skill", "Python Developer").status, "unmatched");
  assert.deepEqual(resolver.resolve("role", "Business Analyst").suggestions, []);
});

test("skills use only configured names or aliases and never inherit a role's suggested expertise", () => {
  const resolver = createCapabilityResolver([
    capability("etl", "Extract Transform Load", { kind: "skill" }),
    capability("engineer", "Data Engineer", { description: "Build data pipelines in SQL and Python." }),
    capability("python", "Python", { kind: "skill" }),
  ]);
  assert.equal(resolver.resolve("skill", "Extract Transform Load (ETL)").status, "unmatched");
  assert.equal(resolver.resolve("skill", "SQL").status, "unmatched");
  assert.equal(resolver.resolve("skill", "Data Engineer").status, "unmatched");
});

test("archived names and aliases resolve historical profiles but may be excluded from new choices", () => {
  const archived = capability("former", "Data Platform Engineer", { active: false, aliases: ["Data Engineer"] });
  const history = createCapabilityResolver([archived]);
  assert.equal(history.key("role", "Data Engineer"), "role:id:former");
  assert.equal(history.key("role", "Data Platform Engineer"), "role:id:former");
  const activeOnly = createCapabilityResolver([archived], { includeInactive: false });
  assert.equal(activeOnly.resolve("role", "Data Engineer").status, "unmatched");
  assert.deepEqual(activeOnly.resolve("role", "Data Engineer").suggestions, []);
});

test("archived and active collisions still require confirmation when preserving history", () => {
  const entries = [
    capability("old", "Data Engineer", { active: false }),
    capability("new", "Data Platform Engineer", { aliases: ["Data Engineer"] }),
  ];
  assert.equal(createCapabilityResolver(entries).key("role", "Data Engineer"), null);
  assert.equal(createCapabilityResolver(entries, { includeInactive: false }).key("role", "Data Engineer"), "role:id:new");
});

test("unknown legacy wording matches only the same safely normalized wording; empty and ambiguous keys do not match", () => {
  const resolver = createCapabilityResolver([]);
  assert.equal(resolver.key("role", " Data  Lead "), "role:text:data lead");
  assert.notEqual(resolver.key("role", "Data Lead"), resolver.key("skill", "Data Lead"));
  assert.notEqual(resolver.key("role", "Data Lead"), resolver.key("role", "Data Engineering Lead"));
  assert.equal(resolver.key("role", "  "), null);
  assert.equal(resolveCapability("skill", "SQL", []).status, "unmatched");
});

test("duplicate aliases for the same record do not create an artificial ambiguity", () => {
  const record = capability("a", "Data Engineer", { aliases: ["Data-Engineer", "data engineer"] });
  const resolution = createCapabilityResolver([record]).resolve("role", "DATA ENGINEER");
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.status === "resolved" && resolution.capability.id, "a");
});
