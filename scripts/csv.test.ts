// Offline tests for the CSV writer and the file splitter behind /downloads/. Run:
//   npx tsx --test scripts/csv.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv, parseCsv, BOM, type Column } from "../web/src/lib/csv";

test("csvCell: plain values, blanks, numbers and booleans", () => {
  assert.equal(csvCell("NVDA"), "NVDA");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(15000), "15000");
  assert.equal(csvCell(467.44), "467.44");
  assert.equal(csvCell(NaN), "");
  assert.equal(csvCell(true), "true");
  assert.equal(csvCell(false), "false");
  assert.equal(csvCell(0), "0");
});
test("csvCell: commas, quotes and line breaks are quoted", () => {
  assert.equal(csvCell("Representative (TX, District 8)"), '"Representative (TX, District 8)"');
  assert.equal(csvCell('The "Big" Fund'), '"The ""Big"" Fund"');
  assert.equal(csvCell("line one\r\nline two"), '"line one\nline two"');
  assert.equal(csvCell("  padded  "), "padded");
});
test("csvCell: a text cell can never start a formula", () => {
  for (const bad of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)"]) assert.ok(csvCell(bad).replace(/^"/, "").startsWith("'"), bad);
  assert.equal(csvCell(-5), "-5"); // a real negative number stays a number
  assert.equal(csvCell("-ACME CORP"), "'-ACME CORP");
});
test("toCsv writes a BOM, a header, CRLF lines, and parseCsv reads it back exactly", () => {
  type R = { a: string | null; b: number | null; c: boolean };
  const cols: Column<R>[] = [{ key: "name", about: "", get: (r) => r.a }, { key: "amount", about: "", get: (r) => r.b }, { key: "late", about: "", get: (r) => r.c }];
  const rows: R[] = [{ a: 'Smith, "Jo"', b: 1001, c: true }, { a: null, b: null, c: false }, { a: "multi\nline", b: 2.5, c: false }];
  const text = toCsv(cols, rows);
  assert.ok(text.startsWith(BOM));
  assert.ok(text.endsWith("\r\n"));
  assert.equal(text.split("\r\n")[0], BOM + "name,amount,late");
  assert.deepEqual(parseCsv(text), [["name", "amount", "late"], ['Smith, "Jo"', "1001", "true"], ["", "", "false"], ["multi\nline", "2.5", "false"]]);
  assert.deepEqual(parseCsv(toCsv(cols, [])), [["name", "amount", "late"]]);
});
