// Reader for the SEC submissions answer: Form 8-K and 8-K/A filings from `filings.recent`.
// Pure; tested in events8k.test.ts.
//
// `filings.recent` is a set of parallel arrays (accessionNumber, filingDate, reportDate,
// acceptanceDateTime, form, items, primaryDocument ...). `items` is one comma-separated string
// per filing ("2.02,9.01"; "" for forms without items). reportDate is "" when there is none.

export interface EventRow {
  accession: string;
  form: "8-K" | "8-K/A";
  filed: string;
  reportDate: string | null;
  acceptedAt: string | null;
  items: string[];
  primaryDocument: string | null;
  sourceUrl: string;
}

export interface PickedEvents {
  hasShape: boolean;
  events: EventRow[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function splitItems(raw: unknown): string[] {
  const out: string[] = [];
  for (const part of str(raw).split(",")) {
    const p = part.trim();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

export function eventSourceUrl(cik: string, accession: string, primaryDocument: string | null): string {
  const base = `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, "") || "0"}/${accession.replace(/-/g, "")}`;
  return primaryDocument ? `${base}/${primaryDocument}` : `${base}/`;
}

function validTimestamp(s: string): string | null {
  if (!s) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

export function pickEvents(answer: unknown, cik: string, floor: string): PickedEvents {
  const recent = (answer as { filings?: { recent?: Record<string, unknown> } } | null)?.filings?.recent;
  if (!recent || typeof recent !== "object") return { hasShape: false, events: [] };
  const forms = recent["form"];
  const acc = recent["accessionNumber"];
  const items = recent["items"];
  if (!Array.isArray(forms) || !Array.isArray(acc) || !Array.isArray(items)) return { hasShape: false, events: [] };
  if (forms.length !== acc.length) return { hasShape: false, events: [] };
  const filedA = Array.isArray(recent["filingDate"]) ? (recent["filingDate"] as unknown[]) : [];
  const reportA = Array.isArray(recent["reportDate"]) ? (recent["reportDate"] as unknown[]) : [];
  const acceptA = Array.isArray(recent["acceptanceDateTime"]) ? (recent["acceptanceDateTime"] as unknown[]) : [];
  const docA = Array.isArray(recent["primaryDocument"]) ? (recent["primaryDocument"] as unknown[]) : [];
  const events: EventRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < forms.length; i++) {
    const form = str(forms[i]);
    if (form !== "8-K" && form !== "8-K/A") continue;
    const accession = str(acc[i]);
    const filed = str(filedA[i]);
    if (!accession || !DATE.test(filed) || filed < floor || seen.has(accession)) continue;
    seen.add(accession);
    const rd = str(reportA[i]);
    const doc = str(docA[i]) || null;
    events.push({
      accession,
      form,
      filed,
      reportDate: DATE.test(rd) ? rd : null,
      acceptedAt: validTimestamp(str(acceptA[i])),
      items: splitItems(items[i]),
      primaryDocument: doc,
      sourceUrl: eventSourceUrl(cik, accession, doc),
    });
  }
  return { hasShape: true, events };
}
