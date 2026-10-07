import { test } from "node:test";
import assert from "node:assert/strict";
import { formatNamedList, parseNamedList } from "../lib/admin/named-list";

test("named lists accept familiar separators and ignore surrounding or empty whitespace", () => {
  assert.deepEqual(parseNamedList(" SQL,  Python; React\r\nAgile delivery\n ; , "), { values: ["SQL", "Python", "React", "Agile delivery"] });
  assert.deepEqual(parseNamedList('  "" , "   " ; \n'), { values: [] });
  assert.deepEqual(parseNamedList(""), { values: [] });
});

test("quoted names preserve their delimiters, escaped quotes, and line breaks", () => {
  const values = ["Cloud (AWS, Azure)", "Boards; ceremonies", 'Agile "facilitation"', "Two\nlines", "Windows\r\nline", " padded name ", "C++", "日本語"];
  assert.deepEqual(parseNamedList(formatNamedList(values)), { values });
  assert.deepEqual(parseNamedList('  "Cloud (AWS, Azure)"  ; SQL'), { values: ["Cloud (AWS, Azure)", "SQL"] });
  assert.equal(formatNamedList(['Agile "facilitation"']), '"Agile ""facilitation"""');
});

test("malformed quoting produces an error instead of silently splitting or accepting a partial name", () => {
  for (const invalid of ['SQL, "Unclosed', 'SQL, "Closed"tail', 'SQL, Agile "facilitation"']) {
    const parsed = parseNamedList(invalid);
    assert.deepEqual(parsed.values, ["SQL"]);
    assert.ok(parsed.error);
  }
  assert.ok(parseNamedList('"Name" "Another"').error);
  assert.deepEqual(parseNamedList('"A ""quoted"" name", B'), { values: ['A "quoted" name', "B"] });
});

test("large valid lists preserve every value without changing their order or case", () => {
  const values = Array.from({ length: 1000 }, (_, index) => `Skill ${index}, "detail"; phase\n${index}`);
  assert.deepEqual(parseNamedList(formatNamedList(values)), { values });
});
