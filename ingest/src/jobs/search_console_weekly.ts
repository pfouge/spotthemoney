// Measurement job: weekly Google Search Console export, aggregated by page_type, so we can
// see organic visibility trend alongside the citation-count job (roadmap B.7). Cadence:
// weekly (Search Console data itself lags a few days, hence the week-selection rule below).
//
// Auth: a Google service account (Search Console API access granted to it as a user on the
// property) via env GSC_SERVICE_ACCOUNT_JSON — the whole downloaded key JSON, as one string.
// We hand-roll the JWT-bearer OAuth flow with node:crypto (no googleapis dependency: this repo
// takes on no new dependencies) — sign a short-lived JWT with the service account's private
// key, exchange it at Google's token endpoint for an access token scoped to
// webmasters.readonly, then call the searchAnalytics.query REST endpoint directly.
//
// Property: env GSC_SITE_URL, default "sc-domain:spotthemoney.com" (a domain property; the
// site URL is URL-encoded into the request path, since a domain property's identifier
// contains a colon).
//
// Week selection: Search Console data typically lags a few days, so we never ask for the
// current, still-filling week. We take the most recent full Monday–Sunday week whose Sunday
// is at least 3 days before today (UTC) — or, to backfill a specific week, set
// GSC_WEEK_START to that week's Monday (YYYY-MM-DD).
//
// If GSC_SERVICE_ACCOUNT_JSON is absent entirely, this is a dry run: compute and print the
// target week and the query plan, write nothing, and return success with stats.dry_run =
// true. That's what a fresh clone / CI run without the secret should see.

import { createSign } from "node:crypto";
import { getDb, closeDb } from "../lib/db.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "search_console_weekly";
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const QUERY_PAGE_SIZE = 25000;
const MIN_LAG_DAYS = 3;

type PageType =
  | "home" | "rates" | "insiders" | "companies" | "stocks" | "congress"
  | "donations" | "lobbying" | "contracts" | "disclosures" | "other";

interface GscRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * The most recent full Monday–Sunday week whose Sunday is >= MIN_LAG_DAYS before `today`,
 * or the week starting GSC_WEEK_START if that env var is set (backfill).
 */
function computeWeek(today: Date): { weekStart: string; weekEnd: string } {
  const override = process.env.GSC_WEEK_START;
  if (override) {
    const monday = new Date(`${override}T00:00:00Z`);
    if (Number.isNaN(monday.getTime())) {
      throw new Error(`GSC_WEEK_START "${override}" is not a valid YYYY-MM-DD date`);
    }
    return { weekStart: isoDate(monday), weekEnd: isoDate(addDays(monday, 6)) };
  }

  const cutoff = addDays(today, -MIN_LAG_DAYS);
  // getUTCDay(): Sunday=0 .. Saturday=6. Subtracting that many days from `cutoff` always
  // lands on the most recent Sunday on or before `cutoff` (0 is a no-op when cutoff itself
  // is a Sunday).
  const sunday = addDays(cutoff, -cutoff.getUTCDay());
  const monday = addDays(sunday, -6);
  return { weekStart: isoDate(monday), weekEnd: isoDate(sunday) };
}

function classifyPageType(pageUrl: string): PageType {
  let pathname: string;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return "other";
  }
  if (pathname === "/" || pathname === "") return "home";
  const prefixes: Array<[string, PageType]> = [
    ["/rates/", "rates"],
    ["/insiders/", "insiders"],
    ["/companies/", "companies"],
    ["/stocks/", "stocks"],
    ["/congress/", "congress"],
    ["/donations/", "donations"],
    ["/lobbying/", "lobbying"],
    ["/contracts/", "contracts"],
    ["/disclosures/", "disclosures"],
  ];
  for (const [prefix, type] of prefixes) {
    if (pathname.startsWith(prefix)) return type;
  }
  return "other";
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseServiceAccount(json: string): ServiceAccount {
  const parsed = JSON.parse(json) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GSC_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

function buildAssertion(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope: GSC_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(account.private_key));
  return `${signingInput}.${signature}`;
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const assertion = buildAssertion(account);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`GSC token exchange failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("GSC token exchange: response had no access_token");
  return data.access_token;
}

async function fetchAllRows(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
): Promise<GscRow[]> {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const rows: GscRow[] = [];
  let startRow = 0;

  for (;;) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: QUERY_PAGE_SIZE,
        startRow,
      }),
    });
    if (!res.ok) {
      throw new Error(`GSC searchAnalytics.query failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { rows?: GscRow[] };
    const page = data.rows ?? [];
    rows.push(...page);
    if (page.length < QUERY_PAGE_SIZE) break;
    startRow += QUERY_PAGE_SIZE;
  }

  return rows;
}

interface Aggregate {
  impressions: number;
  clicks: number;
  positionWeighted: number; // sum(position * impressions)
  pages: number;
}

export async function ingestSearchConsoleWeekly(): Promise<IngestRunResult> {
  const ctx = createRunContext(SOURCE);

  let week: { weekStart: string; weekEnd: string };
  try {
    week = computeWeek(new Date());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "failed", error: message };
  }

  const siteUrl = process.env.GSC_SITE_URL ?? "sc-domain:spotthemoney.com";
  ctx.extra["week_start"] = week.weekStart;
  ctx.extra["week_end"] = week.weekEnd;
  ctx.extra["site_url"] = siteUrl;

  const secret = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!secret) {
    console.log(`[${SOURCE}] dry run — GSC_SERVICE_ACCOUNT_JSON not set.`);
    console.log(`  target week: ${week.weekStart} .. ${week.weekEnd}`);
    console.log(`  property: ${siteUrl}`);
    console.log(`  plan: POST searchAnalytics.query with dimensions=["page"], rowLimit=${QUERY_PAGE_SIZE}, paged`);
    return {
      source: SOURCE,
      rowsSeen: 0,
      rowsChanged: 0,
      status: "success",
      stats: { ...ctx.stats(), dry_run: true, plan: { week_start: week.weekStart, week_end: week.weekEnd, site_url: siteUrl } },
    };
  }

  const account = parseServiceAccount(secret);
  const accessToken = await getAccessToken(account);
  const rows = await fetchAllRows(accessToken, siteUrl, week.weekStart, week.weekEnd);
  ctx.rowsSeen = rows.length;

  const byType = new Map<PageType, Aggregate>();
  const pageDetails: Array<{ url: string; page_type: PageType; clicks: number; impressions: number; ctr: number; position: number }> = [];

  for (const row of rows) {
    const url = row.keys?.[0];
    if (!url) {
      ctx.quarantine("row:missing-url", "searchAnalytics row had no page key");
      continue;
    }
    const pageType = classifyPageType(url);
    const impressions = row.impressions ?? 0;
    const clicks = row.clicks ?? 0;
    const position = row.position ?? 0;

    const agg = byType.get(pageType) ?? { impressions: 0, clicks: 0, positionWeighted: 0, pages: 0 };
    agg.impressions += impressions;
    agg.clicks += clicks;
    agg.positionWeighted += position * impressions;
    agg.pages += 1;
    byType.set(pageType, agg);

    pageDetails.push({
      url,
      page_type: pageType,
      clicks,
      impressions,
      ctr: row.ctr ?? (impressions > 0 ? clicks / impressions : 0),
      position,
    });
  }

  const topPages = [...pageDetails].sort((a, b) => b.clicks - a.clicks).slice(0, 50);
  ctx.extra["top_pages"] = topPages;
  ctx.extra["page_types_seen"] = [...byType.keys()];

  const sql = getDb();
  let changed = 0;

  for (const [pageType, agg] of byType) {
    const ctrVal = agg.impressions > 0 ? agg.clicks / agg.impressions : 0;
    const positionVal = agg.impressions > 0 ? agg.positionWeighted / agg.impressions : 0;

    const row = scrubDeep({
      week_start: week.weekStart,
      page_type: pageType,
      impressions: agg.impressions,
      clicks: agg.clicks,
      ctr: ctrVal,
      position: positionVal,
      pages: agg.pages,
    });

    const result = await sql`
      insert into metrics_search (week_start, page_type, impressions, clicks, ctr, position, pages)
      values (${row.week_start}, ${row.page_type}, ${row.impressions}, ${row.clicks}, ${row.ctr}, ${row.position}, ${row.pages})
      on conflict (week_start, page_type) do update
        set impressions = excluded.impressions,
            clicks = excluded.clicks,
            ctr = excluded.ctr,
            position = excluded.position,
            pages = excluded.pages
    `;
    changed += result.count ?? 0;
  }

  ctx.rowsChanged = changed;

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: "success",
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- search_console_weekly`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSearchConsoleWeekly()
    .then((r) => {
      console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`);
      if (r.error) console.warn("  note:", r.error);
    })
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
