const alphabetical = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export const compareNames = (left: string, right: string) => alphabetical.compare(left.trim(), right.trim());

export function byName(left: { name: string; id?: string }, right: { name: string; id?: string }): number {
  return compareNames(left.name, right.name) || (left.id ?? "").localeCompare(right.id ?? "");
}
