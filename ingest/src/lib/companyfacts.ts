// Pure reader for the SEC XBRL "companyfacts" answer (data.sec.gov/api/xbrl/companyfacts/CIK##########.json).
// Used by the source `sec_company_financials`. No network, no database.
//
// Shape of an answer:
//   { cik, entityName, facts: { "us-gaap": { "<Tag>": { label, description, units: { "<unit>": [
//       { start?, end, val, accn, fy, fp, form, filed, frame? } ] } } }, "ifrs-full": {...}, "dei": {...} } }
// `start` is absent on an instant (balance sheet) fact. `fy` and `fp` describe the FILING, not the
// period: the same period is repeated in later filings as a comparative, so one period can appear
// many times, under different accessions and values (restatements).
//
// Rules (shared/src/fundamentals.ts holds the concepts, tags, forms and floor):
//   - a fact is kept when its form is a report form, its period ends on or after FIN_FLOOR, its value
//     is a finite number, its dates are real calendar dates and it names an accession;
//   - for each concept, unit and period the concept's tags are walked in order and the first tag with
//     a kept fact for that exact unit and period wins; among that tag's facts for the period the one
//     filed last is taken (a tie goes to the greater accession);
//   - one row per concept, unit and period.

import { FIN_CONCEPTS, FIN_FLOOR, FIN_FORMS } from "@stm/shared";

export interface FinRow {
  concept: string;
  tag: string;
  unit: string;
  /** null for an instant (balance sheet) figure */
  periodStart: string | null;
  periodEnd: string;
  value: number;
  form: string;
  fy: number | null;
  fp: string | null;
  filed: string;
  accession: string;
}

export interface PickResult {
  rows: FinRow[];
  /** True when the answer has the layout this reader expects, even if no row survives the filters. */
  hasShape: boolean;
  /** True when the answer carries a `facts` object at all with something in it (possibly no us-gaap or ifrs-full block: funds and trusts). */
  hasFacts: boolean;
}

const FORMS = new Set(FIN_FORMS);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` that is a real calendar date, else null. */
export function calendarDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = DATE_RE.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? v : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** True when some tag under us-gaap or ifrs-full has a units array whose first entry has the expected keys. */
function detectShape(facts: unknown): boolean {
  if (!isObject(facts)) return false;
  for (const tax of ["us-gaap", "ifrs-full"]) {
    const t = facts[tax];
    if (!isObject(t)) continue;
    for (const tagBody of Object.values(t)) {
      if (!isObject(tagBody) || !isObject(tagBody["units"])) continue;
      for (const arr of Object.values(tagBody["units"] as Record<string, unknown>)) {
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const first = arr[0];
        if (isObject(first) && ["end", "val", "accn", "form", "filed"].every((k) => k in first)) return true;
      }
    }
  }
  return false;
}

interface Kept { start: string | null; end: string; val: number; accn: string; fy: number | null; fp: string | null; form: string; filed: string }

function keep(f: unknown): Kept | null {
  if (!isObject(f)) return null;
  const form = f["form"];
  if (typeof form !== "string" || !FORMS.has(form)) return null;
  const end = calendarDate(f["end"]);
  if (!end || end < FIN_FLOOR) return null;
  const filed = calendarDate(f["filed"]);
  if (!filed) return null;
  let start: string | null = null;
  if (f["start"] !== undefined && f["start"] !== null) {
    start = calendarDate(f["start"]);
    if (!start) return null;
  }
  const val = f["val"];
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  const accn = f["accn"];
  if (typeof accn !== "string" || accn.trim() === "") return null;
  const fy = typeof f["fy"] === "number" && Number.isInteger(f["fy"]) ? (f["fy"] as number) : null;
  const fp = typeof f["fp"] === "string" && f["fp"] !== "" ? (f["fp"] as string) : null;
  return { start, end, val, accn, fy, fp, form, filed };
}

function newer(a: Kept, b: Kept): boolean {
  return a.filed > b.filed || (a.filed === b.filed && a.accn > b.accn);
}

export function pickFacts(json: unknown): PickResult {
  const facts = isObject(json) ? json["facts"] : undefined;
  const hasShape = detectShape(facts);
  const rows: FinRow[] = [];
  if (!isObject(facts)) return { rows, hasShape, hasFacts: false };

  for (const concept of FIN_CONCEPTS) {
    // unit + period → winning fact; an earlier tag's period is never replaced by a later tag's.
    const taken = new Set<string>();
    for (const full of concept.tags) {
      const [taxonomy, tag] = full.split(":") as [string, string];
      const tax = facts[taxonomy];
      const body = isObject(tax) ? tax[tag] : undefined;
      const units = isObject(body) ? body["units"] : undefined;
      if (!isObject(units)) continue;
      for (const [unit, arr] of Object.entries(units)) {
        if (!Array.isArray(arr)) continue;
        const best = new Map<string, Kept>();
        for (const raw of arr) {
          const k = keep(raw);
          if (!k) continue;
          const pk = `${unit}|${k.start ?? ""}|${k.end}`;
          if (taken.has(pk)) continue;
          const cur = best.get(pk);
          if (!cur || newer(k, cur)) best.set(pk, k);
        }
        for (const [pk, k] of best) {
          taken.add(pk);
          rows.push({
            concept: concept.key, tag: full, unit, periodStart: k.start, periodEnd: k.end,
            value: k.val, form: k.form, fy: k.fy, fp: k.fp, filed: k.filed, accession: k.accn,
          });
        }
      }
    }
  }
  return { rows, hasShape, hasFacts: Object.keys(facts).length > 0 };
}
