export type NamedListResult = { values: string[]; error?: string };

/** Commas, semicolons and newlines separate values outside double quotes.
 * Quoted values retain their contents; double a quote inside a quoted value.
 * On an error, only previously completed values are returned. Callers must
 * reject the whole edit/import rather than save those partial values. */
export function parseNamedList(value: string): NamedListResult {
  const values: string[] = [];
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let characters: string[] = [];
  const separator = (character: string) => character === "," || character === ";" || character === "\n" || character === "\r";
  const finish = () => {
    const joined = characters.join("");
    const item = state === "closed" ? joined : joined.trim();
    if (item.trim()) values.push(item);
    characters = []; state = "start";
  };
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (state === "quoted") {
      if (character !== '"') characters.push(character);
      else if (value[index + 1] === '"') { characters.push('"'); index++; }
      else state = "closed";
      continue;
    }
    if (separator(character)) { finish(); continue; }
    if (state === "closed") {
      if (character.trim()) return { values, error: "After a closing quote, use a comma, semicolon, or new line before the next value." };
      continue;
    }
    if (state === "start") {
      if (!character.trim()) continue;
      if (character === '"') { state = "quoted"; continue; }
      state = "plain";
    }
    if (character === '"') return { values, error: "Put a value containing quotes inside double quotes, and double each quote inside that value." };
    characters.push(character);
  }
  if (state === "quoted") return { values, error: "Close the double quote around this value." };
  finish();
  return { values };
}

/** Render values without losing names that contain a separator or quote. */
export function formatNamedList(values: readonly string[]): string {
  return values.filter(value => value.trim()).map(value => /[,;\r\n"]/.test(value) || value !== value.trim() ? `"${value.replaceAll('"', '""')}"` : value).join(", ");
}
