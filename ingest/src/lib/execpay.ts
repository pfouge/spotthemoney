// Pure reader for one SEC XBRL "frames" answer of the `ecd` taxonomy
// (data.sec.gov/api/xbrl/frames/ecd/<Tag>/USD/CY<year>.json). Used by the source `sec_exec_pay`.
// No network, no database.
//
// Shape of an answer:
//   { taxonomy, tag, ccp, uom, label, description, pts, data: [
//       { accn, cik, entityName, loc, end, val, start? } ] }
// One fact per filer. `start` is present for a duration fact. `val` is US dollars.
//
// A fact is kept when its CIK, end date, value and accession are usable. Values are kept as filed
// (a negative "compensation actually paid" is real); only a non-finite value is dropped.

import { calendarDate } from "./companyfacts.js";

export interface ExecPayFact {
  /** 10 digits, zero padded */
  cik: string;
  fiscalYearEnd: string;
  periodStart: string | null;
  value: number;
  accession: string;
}

export interface FrameRead {
  /** True when the answer has a `data` array whose first entry carries cik, end, val and accn. */
  hasShape: boolean;
  /** True when `data` is an array at all (possibly empty). */
  isArray: boolean;
  /** Entries in `data`. */
  seen: number;
  facts: ExecPayFact[];
  /** Entries dropped as unusable. */
  dropped: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function cik10(v: unknown): string | null {
  const s = typeof v === "number" && Number.isInteger(v) && v >= 0 ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^\d{1,10}$/.test(s) ? s.padStart(10, "0") : null;
}

export function readFrame(answer: unknown): FrameRead {
  const out: FrameRead = { hasShape: false, isArray: false, seen: 0, facts: [], dropped: 0 };
  if (!isObject(answer) || !Array.isArray(answer["data"])) return out;
  const data = answer["data"] as unknown[];
  out.isArray = true;
  out.seen = data.length;
  const first = data[0];
  out.hasShape = isObject(first) && ["cik", "end", "val", "accn"].every((k) => k in first);

  // One fact per company and period: if a frame repeats one, the greater accession wins.
  const byKey = new Map<string, ExecPayFact>();
  for (const e of data) {
    if (!isObject(e)) { out.dropped++; continue; }
    const cik = cik10(e["cik"]);
    const end = calendarDate(e["end"]);
    const val = e["val"];
    const accn = typeof e["accn"] === "string" ? e["accn"].trim() : "";
    if (!cik || !end || typeof val !== "number" || !Number.isFinite(val) || !accn) { out.dropped++; continue; }
    const startRaw = e["start"];
    const start = startRaw == null ? null : calendarDate(startRaw);
    const key = `${cik}|${end}`;
    const prev = byKey.get(key);
    if (!prev || accn > prev.accession) byKey.set(key, { cik, fiscalYearEnd: end, periodStart: start, value: val, accession: accn });
  }
  out.facts = [...byKey.values()];
  return out;
}
