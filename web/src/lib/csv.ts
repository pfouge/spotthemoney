// CSV writer for the free downloads (/downloads/). RFC 4180: comma-separated, CRLF line ends,
// a field is quoted when it holds a comma, a quote or a line break, and a quote inside a field
// is doubled. Two additions for people who open the file in a spreadsheet:
//   - a UTF-8 byte-order mark, so Excel reads accented names correctly;
//   - a text cell that starts with = + - @ (or a tab / carriage return) gets a leading
//     apostrophe, so a name copied from a filing can never run as a formula.
// Numbers are written plain (no thousands separators, no currency sign), dates as YYYY-MM-DD,
// true/false as words, and a missing value as an empty field.
export type Cell = string | number | boolean | null | undefined;
export interface Column<T> { key: string; about: string; get: (row: T) => Cell }

const RISKY = /^[=+\-@\t\r]/;
export function csvCell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = String(v).replace(/\r\n?/g, "\n").trim();
  if (RISKY.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const BOM = "﻿";
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.key)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.get(r))).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}
/** Minimal RFC 4180 reader, for tests and scripts/verify-downloads.mjs (kept in step with toCsv). */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const out: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out;
}
export function csvResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8" } });
}
