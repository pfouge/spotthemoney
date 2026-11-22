// The public data files in one catalogue (/developers/ and /data/catalog.json). Pure: the page
// and the endpoint pass in what lib/downloads.ts and lib/feeds.ts already built, so the
// catalogue can never list a file, a row count or a column the site does not serve.
//
// Two kinds of file, and the page says which is which:
//   - kept stable: the CSV downloads, the RSS feeds, the sitemaps, llms.txt and the catalogue
//     itself. An address stays, a column keeps its name and meaning, new columns can be added
//     (so a reader goes by column name, never by position).
//   - working files: the JSON files under /data/ that the site's own pages load. They are public
//     and listed here with what they hold, but their layout follows the pages and can change
//     without notice. scripts/verify-developers.mjs checks the top-level layout written below
//     against the served files, so this list cannot go out of date silently.
// No key, no account, nothing recorded. No prices, no donors: the files hold what the pages show.

export const DEVELOPERS_PATH = "/developers/";
export const CATALOG_PATH = "/data/catalog.json";
export const CATALOG_VERSION = 1;

export interface WorkingFile {
  path: string;
  title: string;
  about: string;
  /** Top-level layout: an object's keys in the file's order, or "array". */
  top: string[] | "array";
  usedBy: string;
  /** The stable file to use instead, when there is one. */
  instead?: string;
}

/** The /data/*.json files a reader may look at. Not listed: files that exist only for the site's own plumbing. */
export const WORKING_FILES: WorkingFile[] = [
  { path: "/data/coverage.json", title: "Coverage report", usedBy: "/methodology/#coverage",
    about: "What the database holds for each source: filings and rows per month, filings held for review, the last runs of each data job and row counts for lobbying, contracts and donations. It counts everything stored, including rows the pages do not show, and, under storedNotShown, counts and dates for Form 144 notices and Schedules 13D and 13G (each is shown on stock and company pages once its load is current).",
    top: ["builtAt", "connected", "filings", "txns", "runs", "tables", "totals", "quality", "tableSizes", "payloadMb", "noTicker", "marketScope", "storedNotShown", "errors"] },
  { path: "/data/congress-screener.json", title: "Congress trade screener rows", usedBy: "/congress-trades/", instead: "/downloads/congress-trades.csv",
    about: "Every published row of the House and Senate periodic transaction reports, packed: each member and each report address is written once and a row is a short list of values.",
    top: ["built", "members", "filings", "rows"] },
  { path: "/data/heatmap-congress.json", title: "Trade map rows, Congress", usedBy: "/congress/", instead: "/downloads/congress-trades.csv",
    about: "Congressional rows with a ticker disclosed in the last 12 months, as the trade map counts them.",
    top: ["kind", "builtAt", "windowDays", "caps", "rows"] },
  { path: "/data/heatmap-insiders.json", title: "Trade map rows, insiders, last 90 days", usedBy: "/insiders/", instead: "/downloads/insider-trades-latest.csv",
    about: "Form 4 rows disclosed in the last 90 days, packed the same way.",
    top: ["kind", "builtAt", "windowDays", "caps", "recentDays", "older", "v", "base", "tk", "pp", "fl", "ow", "rows"] },
  { path: "/data/heatmap-insiders-older.json", title: "Trade map rows, insiders, the rest of the year", usedBy: "/insiders/",
    about: "Form 4 rows disclosed more than 90 days and up to 12 months ago. The quarterly insider CSV files hold the same rows.",
    top: ["kind", "builtAt", "windowDays", "caps", "part", "v", "base", "tk", "pp", "fl", "ow", "rows"] },
  { path: "/data/trade-cross.json", title: "Bought and sold per ticker, both groups", usedBy: "/congress/",
    about: "Dollars bought and sold per ticker by members of Congress and by corporate insiders over 7, 30, 90 and 365 days, for the scatter view of the trade map.",
    top: ["builtAt", "windows", "congress", "insiders"] },
  { path: "/data/notable.json", title: "Home page feed", usedBy: "/",
    about: "The notable trades and cluster purchases of the last 30 days that the home page lists.",
    top: ["built", "newest", "companies", "senateThrough", "items", "clusters"] },
  { path: "/data/financials-screener.json", title: "Company financials screener rows", usedBy: "/company-financials/", instead: "/downloads/company-financials.csv",
    about: "One short list per company this site tracks with the figures of its newest fiscal year and its newest quarter, as filed with the SEC. A figure a page holds back is left out of this file; the CSV file keeps it.",
    top: ["built", "divisions", "companies"] },
  { path: "/data/company-events.json", title: "Company events rows", usedBy: "/company-events/", instead: "/downloads/company-events.csv",
    about: "Every Form 8-K report filed in the last 12 months by a company with a page here: one short list per report with its filing and event dates, item numbers and the address of the report at the SEC. The CSV file has every report on record.",
    top: ["built", "divisions", "companies", "rows"] },
  { path: "/data/executive-pay.json", title: "Executive pay rows", usedBy: "/executive-pay/", instead: "/downloads/executive-pay.csv",
    about: "One short list per company with executive pay figures: its newest fiscal year as the company tagged it, the four figures in dollars and the filing they came from. The CSV file has every fiscal year on file.",
    top: ["built", "divisions", "companies", "rows", "pages"] },
  { path: "/data/search.json", title: "Search index", usedBy: "/",
    about: "One row per page the header search can find: kind, title, subtitle, address and a weight.",
    top: "array" },
];

export interface CsvEntry { path: string; url: string; name: string; group: string; kind: string; title: string; about: string; rows: number; bytes: number; updated: string | null; columns: { key: string; about: string }[] }
export interface OneFileEntry { key: string; path: string; rows: number; updated: string | null }
export interface FeedEntry { id: string; path: string; url: string; title: string; description: string; limit: number; items: number; newest: string | null }
export interface Catalog {
  version: number;
  built: string;
  site: string;
  docs: string;
  terms: string;
  credit: string;
  csv: {
    files: CsvEntry[];
    perMember: { pattern: string; columnsAs: string; count: number; files: OneFileEntry[] };
    perTicker: { pattern: string; columnsAs: string; count: number; files: OneFileEntry[] };
  };
  feeds: FeedEntry[];
  other: { path: string; url: string; about: string }[];
  workingFiles: { path: string; url: string; title: string; about: string; stable: false; instead: string | null }[];
}

export interface CatalogInput {
  site: string;                 // "https://spotthemoney.com"
  built: string;                // ISO time of the build
  files: Omit<CsvEntry, "url">[];
  member: OneFileEntry[];       // key = the member's page name
  stock: OneFileEntry[];        // key = lower-case ticker
  feeds: Omit<FeedEntry, "url">[];
}

export const OTHER_FILES: { path: string; about: string }[] = [
  { path: "/sitemap-index.xml", about: "The sitemap index: every page address on the site with its last change date, in five sitemaps." },
  { path: "/llms.txt", about: "A plain-text description of the site and its sections for answer engines and crawlers." },
  { path: "/robots.txt", about: "Which crawlers may read the site (all of the named ones may)." },
];

export function buildCatalog(i: CatalogInput): Catalog {
  const url = (p: string) => `${i.site}${p}`;
  const sortKey = (a: OneFileEntry, b: OneFileEntry) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return {
    version: CATALOG_VERSION,
    built: i.built,
    site: i.site,
    docs: url(DEVELOPERS_PATH),
    terms: url("/terms/#reuse"),
    credit: "Spot the Money (spotthemoney.com)",
    csv: {
      files: i.files.map((f) => ({ ...f, url: url(f.path) })),
      perMember: { pattern: url("/downloads/congress/{member-page-name}.csv"), columnsAs: "/downloads/congress-trades.csv", count: i.member.length, files: [...i.member].sort(sortKey) },
      perTicker: { pattern: url("/downloads/stocks/{ticker}.csv"), columnsAs: "/downloads/congress-trades.csv", count: i.stock.length, files: [...i.stock].sort(sortKey) },
    },
    feeds: i.feeds.map((f) => ({ ...f, url: url(f.path) })),
    other: OTHER_FILES.map((o) => ({ ...o, url: url(o.path) })),
    workingFiles: WORKING_FILES.map((w) => ({ path: w.path, url: url(w.path), title: w.title, about: w.about, stable: false as const, instead: w.instead && i.files.some((f) => f.path === w.instead) ? w.instead : null })),
  };
}

/** How a working file's top level reads on the page: "a list" or "an object with the keys a, b, c". */
export function topLabel(top: WorkingFile["top"]): string {
  if (top === "array") return "a list";
  return top.length ? `an object with the keys ${top.join(", ")}` : "an object";
}

/** Totals the page and the build log state, from the catalogue alone. */
export function catalogTotals(c: Catalog) {
  return {
    csvFiles: c.csv.files.length,
    csvRows: c.csv.files.reduce((n, f) => n + f.rows, 0),
    csvBytes: c.csv.files.reduce((n, f) => n + f.bytes, 0),
    memberFiles: c.csv.perMember.count,
    tickerFiles: c.csv.perTicker.count,
    feeds: c.feeds.length,
    feedItems: c.feeds.reduce((n, f) => n + f.items, 0),
    workingFiles: c.workingFiles.length,
  };
}
