// Two SEC filing types the database collects and no page shows yet: Form 144 notices of proposed
// sales (form144_notices, source sec_form144) and Schedules 13D and 13G (schedule13_filings,
// source sec_schedule13). Their counts go into /data/coverage.json (key storedNotShown) and the
// methodology's coverage list, so a reader, and a session without SQL, can see how far each
// load has got. Counts and dates only: no names, no amounts.
//
// Pure: lib/coverage.ts runs the queries and passes the result in. The wording lives here so it
// is true while a load is still working forward from its start date and after it has caught up.

export interface StoredSource {
  /** Rows on file (one per submission). */
  rows: number;
  /** Of those, amendments (144/A; 13D/A and 13G/A). */
  amendments: number;
  /** Distinct companies the filings are about (by SEC number). */
  issuers: number;
  /** Rows about a company the site tracks. */
  trackedRows: number;
  /** Earliest and newest filing date on file, YYYY-MM-DD. */
  firstFiled: string | null;
  lastFiled: string | null;
  /** Rows per month filed, oldest first. They add up to rows. */
  months: { month: string; rows: number }[];
  /** Rows per kind: form144 "144" and "144/A"; schedule13 "13D" and "13G". They add up to rows. */
  kinds: Record<string, number>;
}
export interface StoredNotShown { form144: StoredSource; schedule13: StoredSource }

export const emptyStored = (): StoredSource => ({ rows: 0, amendments: 0, issuers: 0, trackedRows: 0, firstFiled: null, lastFiled: null, months: [], kinds: {} });
export const emptyStoredNotShown = (): StoredNotShown => ({ form144: emptyStored(), schedule13: emptyStored() });

/** A load counts as caught up when its newest filing is at most this many days before the build. */
export const CAUGHT_UP_DAYS = 10;

const DAY = 86_400_000;
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

/** True while the newest filing on file is more than CAUGHT_UP_DAYS before the build day (or nothing is on file). */
export function catchingUp(s: StoredSource, builtAt: string): boolean {
  if (!s.rows || !isDate(s.lastFiled)) return true;
  const built = Date.parse(builtAt.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(built)) return true;
  return built - Date.parse(s.lastFiled + "T00:00:00Z") > CAUGHT_UP_DAYS * DAY;
}

const n = (x: number) => x.toLocaleString("en-US");
const day = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const many = (x: number, one: string, more: string) => `${n(x)} ${x === 1 ? one : more}`;
const filedSpan = (s: StoredSource) => (isDate(s.firstFiled) && isDate(s.lastFiled) ? (s.firstFiled === s.lastFiled ? `, filed ${day(s.firstFiled)}` : `, filed ${day(s.firstFiled)} to ${day(s.lastFiled)}`) : "");
const tail = (s: StoredSource, builtAt: string) =>
  ` They are stored and not shown on any page yet.${catchingUp(s, builtAt) && isDate(s.lastFiled) ? ` The load is still working forward to today: filings after ${day(s.lastFiled)} are not on file yet.` : ""}`;

/** The methodology's sentence for Form 144, or "" with nothing on file. */
export function form144Sentence(s: StoredSource, builtAt: string): string {
  if (!s.rows) return "";
  return `${many(s.rows, "notice", "notices")} of a proposed sale on file${filedSpan(s)}, about ${many(s.issuers, "company", "companies")}; ${many(s.amendments, "is an amendment", "are amendments")}. A notice states a plan to sell, not a sale.${tail(s, builtAt)}`;
}

/** The methodology's sentence for Schedules 13D and 13G, or "" with nothing on file. */
export function schedule13Sentence(s: StoredSource, builtAt: string): string {
  if (!s.rows) return "";
  const d = s.kinds["13D"] ?? 0, g = s.kinds["13G"] ?? 0;
  return `${many(s.rows, "ownership statement", "ownership statements")} on file (${n(d)} on Schedule 13D, ${n(g)} on Schedule 13G)${filedSpan(s)}, about ${many(s.issuers, "company", "companies")}; ${many(s.amendments, "is an amendment", "are amendments")}. They are filed by a holder of more than 5% of a class of shares, or by one reporting that it has fallen below that. A statement gives what the filer says it owned on a date, not a trade.${tail(s, builtAt)}`;
}

/** Faults in the counts themselves (months and kinds must add up to rows). Empty when sound. */
export function storedProblems(name: string, s: StoredSource): string[] {
  const out: string[] = [];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  if (sum(s.months.map((m) => m.rows)) !== s.rows) out.push(`${name}: the months add up to ${sum(s.months.map((m) => m.rows))}, not ${s.rows}`);
  if (s.rows && sum(Object.values(s.kinds)) !== s.rows) out.push(`${name}: the kinds add up to ${sum(Object.values(s.kinds))}, not ${s.rows}`);
  if (s.amendments > s.rows || s.trackedRows > s.rows) out.push(`${name}: a part is larger than the whole`);
  if (isDate(s.firstFiled) && isDate(s.lastFiled) && s.firstFiled > s.lastFiled) out.push(`${name}: first filing after the last`);
  return out;
}

/** One build-log line to compare with SQL. */
export function storedLog(st: StoredNotShown, builtAt: string): string {
  const part = (label: string, s: StoredSource, kinds: string[]) =>
    `${label} ${s.rows} rows (${kinds.map((k) => `${k} ${s.kinds[k] ?? 0}`).join(", ")}; ${s.amendments} amendments, ${s.issuers} issuers, ${s.trackedRows} for tracked companies), filed ${s.firstFiled ?? "none"} to ${s.lastFiled ?? "none"}, ${s.months.length} months${catchingUp(s, builtAt) ? ", catching up" : ", current"}`;
  return `stored, not shown: ${part("Form 144", st.form144, ["144", "144/A"])}; ${part("Schedule 13", st.schedule13, ["13D", "13G"])}`;
}
