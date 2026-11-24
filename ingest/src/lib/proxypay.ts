// Pure readers for the source `sec_proxy_pay`: which proxy statements a company's SEC submissions
// file names, which file in a filing's folder is the extracted XBRL instance, and the Pay Versus
// Performance figures in that instance. No network, no database. Tested in proxypay.test.ts.
//
// THE INSTANCE. EDGAR extracts a plain XBRL instance from every inline XBRL document and puts it
// in the filing's folder as <primary document name>_htm.xml ("EXTRACTED XBRL INSTANCE DOCUMENT").
// In it a fact is an element named after its tag,
//   <ecd:PeoTotalCompAmt contextRef="c-12" unitRef="usd" decimals="0">63209845</ecd:PeoTotalCompAmt>
// and a context says whose fact it is and for which period:
//   <context id="c-12">
//     <entity><identifier scheme="http://www.sec.gov/CIK">0000320193</identifier>
//       <segment><xbrldi:explicitMember dimension="ecd:IndividualAxis">aapl:MrCookMember</xbrldi:explicitMember></segment>
//     </entity>
//     <period><startDate>2023-10-01</startDate><endDate>2024-09-28</endDate></period>
//   </context>
// Prefixes are whatever the file declares; the ecd prefix is found from its namespace
// (http://xbrl.sec.gov/ecd/<year>), elements of the XBRL namespaces are matched with any prefix.
//
// WHAT IS KEPT. The four tags of shared/src/execpay.ts, in a context that is about this company,
// covers about a year (PERIOD_MIN_DAYS to PERIOD_MAX_DAYS) and has no dimension, or only
//   ecd:IndividualAxis         the person the figure belongs to, and
//   ecd:ExecutiveCategoryAxis  with the member that matches the tag (PeoMember, NonPeoNeoMember).
// A fact under any other axis (the adjustment tables) is a part of a figure, not the figure, and is
// skipped; the axis names met are reported (taxonomy names only).
//
// PER MEASURE AND FISCAL YEAR:
//   * a figure with no person: one row, seq 0, `persons` = how many people the tag was also filed for;
//   * a principal executive's figure filed only per person: one row per person, largest first;
//   * an average for the other executives filed only per person: skipped and counted (an average
//     is not a person's figure).
// THE PERSON IS NEVER RETURNED: the member name is used to tell people apart and then dropped.

import { EXEC_PAY_MEASURES } from "@stm/shared";
import { calendarDate } from "./companyfacts.js";

export const PROXY_FORM = "DEF 14A";
/** Pay Versus Performance tables are required in proxy statements for fiscal years ending on or after 2022-12-16. */
export const PROXY_FLOOR = "2023-01-01";
export const PROXY_CANDIDATES = 3;
export const PERIOD_MIN_DAYS = 300;
export const PERIOD_MAX_DAYS = 380;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// ── The submissions file ────────────────────────────────────────────────────

export interface ProxyFiling {
  accession: string;
  filed: string;
}

export interface PickedProxies {
  /** False when the answer has no filings.recent with form and accessionNumber arrays of one length. */
  hasShape: boolean;
  /** Newest first, at most PROXY_CANDIDATES. */
  proxies: ProxyFiling[];
}

export function pickProxies(answer: unknown, floor: string = PROXY_FLOOR, max: number = PROXY_CANDIDATES): PickedProxies {
  const recent = (answer as { filings?: { recent?: Record<string, unknown> } } | null)?.filings?.recent;
  if (!recent || typeof recent !== "object") return { hasShape: false, proxies: [] };
  const forms = recent["form"];
  const acc = recent["accessionNumber"];
  const filedA = recent["filingDate"];
  if (!Array.isArray(forms) || !Array.isArray(acc) || !Array.isArray(filedA) || forms.length !== acc.length) return { hasShape: false, proxies: [] };
  const out: ProxyFiling[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < forms.length; i++) {
    if (str(forms[i]) !== PROXY_FORM) continue;
    const accession = str(acc[i]);
    const filed = str(filedA[i]);
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !DATE.test(filed) || filed < floor || seen.has(accession)) continue;
    seen.add(accession);
    out.push({ accession, filed });
  }
  out.sort((a, b) => (a.filed === b.filed ? b.accession.localeCompare(a.accession) : b.filed.localeCompare(a.filed)));
  return { hasShape: true, proxies: out.slice(0, Math.max(1, max)) };
}

export function filingFolder(base: string, cik: string, accession: string): string {
  return `${base}/Archives/edgar/data/${cik.replace(/^0+/, "") || "0"}/${accession.replace(/-/g, "")}`;
}

// ── The filing folder ───────────────────────────────────────────────────────

export interface PickedInstance {
  /** False when the answer has no directory.item array. */
  hasShape: boolean;
  /** File name of the extracted instance, or null when the folder has none. */
  name: string | null;
}

export function pickInstance(index: unknown): PickedInstance {
  const items = (index as { directory?: { item?: unknown } } | null)?.directory?.item;
  if (!Array.isArray(items)) return { hasShape: false, name: null };
  const names = items.map((it) => str((it as { name?: unknown } | null)?.name)).filter((n) => /^[\w.\-]+$/.test(n));
  const hit = names.filter((n) => /_htm\.xml$/i.test(n)).sort()[0];
  return { hasShape: true, name: hit ?? null };
}

// ── The instance ────────────────────────────────────────────────────────────

export type ProxyMeasure = (typeof EXEC_PAY_MEASURES)[number]["key"];

export interface ProxyFact {
  measure: ProxyMeasure;
  tag: string;
  fiscalYearEnd: string;
  periodStart: string;
  value: number;
  seq: number;
  persons: number;
  dimensioned: boolean;
}

export interface ProxyRead {
  /** True when the text has XBRL contexts at all. */
  hasShape: boolean;
  /** True when it declares the ecd namespace. */
  hasEcd: boolean;
  contexts: number;
  /** Elements of the four tags met, kept or not. */
  seen: number;
  facts: ProxyFact[];
  skipped: { otherAxis: number; otherMember: number; badPeriod: number; otherEntity: number; noContext: number; notNumber: number; conflicts: number; neoPerPerson: number };
  /** Local names of the other axes met (taxonomy names, never a person). */
  axes: string[];
}

interface Ctx {
  cik: string | null;
  start: string | null;
  end: string | null;
  /** axis local name → member local name */
  dims: Map<string, string>;
  typed: boolean;
}

const local = (qname: string): string => {
  const s = qname.trim();
  const i = s.indexOf(":");
  return i < 0 ? s : s.slice(i + 1);
};

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() : null;
}

function days(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function readContexts(xml: string): Map<string, Ctx> {
  const out = new Map<string, Ctx>();
  const re = /<(?:[\w.\-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w.\-]+:)?context\s*>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const id = attr(m[1] ?? "", "id");
    if (!id) continue;
    const body = m[2] ?? "";
    const ident = /<(?:[\w.\-]+:)?identifier\b[^>]*>\s*([^<]*?)\s*</.exec(body)?.[1] ?? "";
    const digits = ident.replace(/\D/g, "");
    const start = calendarDate(/<(?:[\w.\-]+:)?startDate\s*>\s*(\d{4}-\d{2}-\d{2})/.exec(body)?.[1]);
    const end = calendarDate(/<(?:[\w.\-]+:)?endDate\s*>\s*(\d{4}-\d{2}-\d{2})/.exec(body)?.[1]);
    const dims = new Map<string, string>();
    const dre = /<(?:[\w.\-]+:)?explicitMember\b([^>]*)>\s*([^<]*?)\s*</g;
    for (let d = dre.exec(body); d; d = dre.exec(body)) {
      const axis = attr(d[1] ?? "", "dimension");
      if (axis) dims.set(local(axis), (d[2] ?? "").trim());
    }
    out.set(id, {
      cik: /^\d{1,10}$/.test(digits) ? digits.padStart(10, "0") : null,
      start, end, dims,
      typed: /<(?:[\w.\-]+:)?typedMember\b/.test(body),
    });
  }
  return out;
}

const PERSON_AXIS = "IndividualAxis";
const CATEGORY_AXIS = "ExecutiveCategoryAxis";

/** Read the Pay Versus Performance figures of one extracted XBRL instance. Never throws. */
export function readProxyInstance(xml: string, cik: string): ProxyRead {
  const out: ProxyRead = {
    hasShape: false, hasEcd: false, contexts: 0, seen: 0, facts: [],
    skipped: { otherAxis: 0, otherMember: 0, badPeriod: 0, otherEntity: 0, noContext: 0, notNumber: 0, conflicts: 0, neoPerPerson: 0 },
    axes: [],
  };
  if (typeof xml !== "string" || xml.length === 0) return out;
  const contexts = readContexts(xml);
  out.contexts = contexts.size;
  out.hasShape = contexts.size > 0;
  const prefixes = new Set<string>();
  const nre = /xmlns:([\w.\-]+)\s*=\s*["']http:\/\/xbrl\.sec\.gov\/ecd\/\d{4}[^"']*["']/g;
  for (let m = nre.exec(xml); m; m = nre.exec(xml)) prefixes.add(m[1]!);
  out.hasEcd = prefixes.size > 0;
  if (!out.hasShape || !out.hasEcd) return out;

  const axes = new Set<string>();
  // measure|fiscal year end → what was filed
  const groups = new Map<string, { measure: ProxyMeasure; tag: string; end: string; start: string; plain: number[]; people: Map<string, number> }>();
  for (const prefix of prefixes) {
    for (const m of EXEC_PAY_MEASURES) {
      const isPeo = m.key.startsWith("peo");
      const p = prefix.replace(/[.\-]/g, "\\$&");
      const re = new RegExp(`<${p}:${m.tag}\\b([^>]*)>([^<]*)</${p}:${m.tag}\\s*>`, "g");
      for (let f = re.exec(xml); f; f = re.exec(xml)) {
        out.seen++;
        const ctx = contexts.get(attr(f[1] ?? "", "contextRef") ?? "");
        if (!ctx) { out.skipped.noContext++; continue; }
        if (ctx.cik !== cik) { out.skipped.otherEntity++; continue; }
        const text = (f[2] ?? "").trim();
        const value = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
        if (!Number.isFinite(value)) { out.skipped.notNumber++; continue; }
        if (!ctx.start || !ctx.end) { out.skipped.badPeriod++; continue; }
        const len = days(ctx.start, ctx.end);
        if (len < PERIOD_MIN_DAYS || len > PERIOD_MAX_DAYS) { out.skipped.badPeriod++; continue; }
        const other = [...ctx.dims.keys()].filter((a) => a !== PERSON_AXIS && a !== CATEGORY_AXIS);
        if (other.length > 0 || ctx.typed) {
          out.skipped.otherAxis++;
          other.forEach((a) => { if (/^\w{1,80}$/.test(a)) axes.add(a); });
          continue;
        }
        const category = ctx.dims.get(CATEGORY_AXIS);
        if (category != null && local(category) !== (isPeo ? "PeoMember" : "NonPeoNeoMember")) { out.skipped.otherMember++; continue; }
        const key = `${m.key}|${ctx.end}`;
        let g = groups.get(key);
        if (!g) { g = { measure: m.key, tag: m.tag, end: ctx.end, start: ctx.start, plain: [], people: new Map() }; groups.set(key, g); }
        const person = ctx.dims.get(PERSON_AXIS);
        if (person == null) {
          if (g.plain.length === 0) g.plain.push(value);
          else if (g.plain[0] !== value) out.skipped.conflicts++;
        } else {
          const had = g.people.get(person);
          if (had == null) g.people.set(person, value);
          else if (had !== value) out.skipped.conflicts++;
        }
      }
    }
  }

  for (const g of groups.values()) {
    const base = { measure: g.measure, tag: g.tag, fiscalYearEnd: g.end, periodStart: g.start };
    if (g.plain.length > 0) {
      out.facts.push({ ...base, value: g.plain[0]!, seq: 0, persons: g.people.size, dimensioned: false });
    } else if (g.measure.startsWith("peo")) {
      const values = [...g.people.values()].sort((a, b) => b - a);
      values.forEach((value, seq) => out.facts.push({ ...base, value, seq, persons: values.length, dimensioned: true }));
    } else {
      out.skipped.neoPerPerson += g.people.size;
    }
  }
  out.facts.sort((a, b) => a.measure.localeCompare(b.measure) || b.fiscalYearEnd.localeCompare(a.fiscalYearEnd) || a.seq - b.seq);
  out.axes = [...axes].sort().slice(0, 12);
  return out;
}
