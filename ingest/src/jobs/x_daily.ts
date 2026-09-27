// Job: the daily X (Twitter) thread of notable filings (roadmap B.4). Run explicitly:
//   npm run ingest -- x_daily            (posts when X credentials exist, else dry-runs)
//
// SELECTION (window = the last X_LOOKBACK_HOURS, default 24; X_SINCE=YYYY-MM-DD overrides the
// window start for backfills and dry-runs):
//   largest      the biggest disclosed trades by dollar value (insiders: shares × price;
//                Congress: the top of the disclosed range)
//   late_filer   Congress rows disclosed more than 45 days after the trade (the STOCK Act
//                deadline) and Form 4s filed more than 4 calendar days after the trade
//   first_time   a person whose first filing we have ever seen landed in the window
//   cluster_buy  a ticker with ≥3 distinct insiders buying (code P) in the last 30 days,
//                at least one of them in the window
// Only PUBLISHED filings (filings.is_published) with approved review and confidence ≥ 0.9
// are eligible — this is public distribution, so the sample-approval gate applies strictly.
// A filing is never posted twice (social_posts ledger), and a day's thread is posted once.
//
// COPY RULES (docs/01 §8): facts only — who, what, how much, when, and the link. No
// characterisation, no inference of motive or wrongdoing, no advice. Every thread ends with
// the disclaimer and the methodology link.
//
// POSTING: X API v2 `POST /2/tweets`, OAuth 1.0a user context (lib/oauth1.ts). Secrets:
// X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET. Without all four the job writes
// the thread to X_DRY_RUN_OUT (default ingest/out/x-thread-<date>.md), records the posts in
// social_posts with status 'dry_run', and exits 0 — never a failure, so the schedule can be
// enabled before the credentials exist.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../lib/db.js";
import { createRunContext } from "../lib/run.js";
import { oauth1AuthorizationHeader } from "../lib/oauth1.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "x_daily";
const SITE = (process.env.PUBLIC_SITE_URL ?? "https://spotthemoney.com").replace(/\/$/, "");
const TWEET_LIMIT = 280;
const URL_WEIGHT = 23; // t.co wraps every URL to 23 characters

export interface Notable {
  kind: "largest" | "late_filer" | "first_time" | "cluster_buy";
  filingId: number | null;
  text: string;
  url: string;
}

interface TxnRow {
  filing_id: number;
  filing_source: string;
  person_id: number | null;
  person_name: string | null;
  person_slug: string | null;
  role_kind: string | null;
  ticker: string | null;
  company_name: string | null;
  side: string;
  txn_code: string | null;
  txn_date: string | null;
  disclosed_at: string | null;
  filed_at: string | null;
  lag_days: number | null;
  value: number | null;
  first_filing_at: string | null;
}

function money(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "an undisclosed amount";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function personUrl(r: TxnRow): string {
  if (!r.person_slug) return `${SITE}/disclosures/`;
  return r.role_kind === "congress" ? `${SITE}/congress/${r.person_slug}/` : `${SITE}/insiders/${r.person_slug}/`;
}
function tickerUrl(ticker: string): string {
  return `${SITE}/stocks/${ticker.toLowerCase()}/`;
}
function verb(r: TxnRow): string {
  if (r.side === "buy") return "bought";
  if (r.side === "sell") return "sold";
  if (r.side === "option") return "exercised or converted";
  if (r.side === "exchange") return "exchanged";
  return "reported a transaction in";
}
function who(r: TxnRow): string {
  const name = r.person_name ?? "An insider";
  return r.role_kind === "congress" ? `${name} (Congress)` : `${name}${r.company_name ? `, ${r.company_name}` : ""}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "an unstated date";
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Trim a tweet body so body + " " + url fits in 280 counting the URL at 23. */
export function fitTweet(body: string, url: string): string {
  const budget = TWEET_LIMIT - URL_WEIGHT - 1;
  const b = body.length <= budget ? body : body.slice(0, budget - 1).replace(/\s+\S*$/, "") + "…";
  return `${b} ${url}`;
}

export function composeThread(date: string, items: Notable[], counts: { filings: number; people: number }): string[] {
  const tweets: string[] = [];
  const first = tweets.push(
    fitTweet(`Disclosures for ${date}: ${counts.filings} new filing${counts.filings === 1 ? "" : "s"} from ${counts.people} filer${counts.people === 1 ? "" : "s"}. The notable ones, with the source document behind each:`, `${SITE}/disclosures/`),
  );
  void first;
  const labels: Record<Notable["kind"], string> = {
    largest: "Largest",
    late_filer: "Late filing",
    first_time: "First filing",
    cluster_buy: "Cluster buy",
  };
  for (const it of items) tweets.push(fitTweet(`${labels[it.kind]} — ${it.text}`, it.url));
  tweets.push(
    fitTweet("Public disclosures, shown as filed. Filings can lag the trade by weeks and are sometimes amended. Not investment advice. How we select and rank these:", `${SITE}/methodology/`),
  );
  return tweets;
}

export async function selectNotables(sql: ReturnType<typeof getDb>, sinceIso: string): Promise<{ items: Notable[]; counts: { filings: number; people: number }; window: string }> {
  const rows = await sql<TxnRow[]>`
    with elig as (
      select t.id, t.filing_id, f.source::text as filing_source, t.person_id, p.full_name as person_name,
             p.slug::text as person_slug,
             (select r.role_kind from person_roles r where r.person_id = p.id order by r.role_kind = 'congress' desc limit 1) as role_kind,
             s.ticker::text as ticker, c.name as company_name, t.side::text as side, t.txn_code,
             t.txn_date::text as txn_date, t.disclosed_at::text as disclosed_at, f.filed_at::text as filed_at,
             t.disclosure_lag_days as lag_days,
             case when t.shares is not null and t.price is not null then (t.shares * t.price)::float8
                  else t.amount_high::float8 end as value,
             (select min(f2.filed_at)::text from filings f2 where f2.filer_person_id = p.id) as first_filing_at
        from transactions t
        join filings f on f.id = t.filing_id
        left join people p on p.id = t.person_id
        left join securities s on s.id = t.security_id
        left join companies c on c.id = s.company_id
       where f.is_published
         and f.filed_at >= ${sinceIso}::timestamptz
         and t.review in ('auto_approved','approved') and t.confidence >= 0.9
         and t.side in ('buy','sell','option','exchange')
         and t.filing_id not in (select filing_id from social_posts where filing_id is not null and status = 'posted')
    )
    select * from elig order by value desc nulls last
  `;

  const filings = new Set(rows.map((r) => r.filing_id));
  const people = new Set(rows.map((r) => r.person_id).filter((x) => x != null));
  const used = new Set<number>();
  const items: Notable[] = [];
  const take = (r: TxnRow, kind: Notable["kind"], text: string, url: string) => {
    if (used.has(r.filing_id)) return;
    used.add(r.filing_id);
    items.push({ kind, filingId: r.filing_id, text, url });
  };

  // largest (top 3)
  for (const r of rows.filter((x) => x.value != null).slice(0, 3)) {
    const t = r.ticker ? ` $${r.ticker}` : "";
    take(r, "largest", `${who(r)} ${verb(r)} ${money(r.value)} of${t} on ${fmtDate(r.txn_date)}, disclosed ${fmtDate(r.disclosed_at ?? r.filed_at)}.`, r.ticker ? tickerUrl(r.ticker) : personUrl(r));
  }
  // late filers (top 2)
  const late = rows.filter((r) => r.lag_days != null && ((r.role_kind === "congress" && r.lag_days > 45) || (r.role_kind !== "congress" && r.lag_days > 4)))
    .sort((a, b) => (b.lag_days ?? 0) - (a.lag_days ?? 0));
  for (const r of late.slice(0, 2)) {
    const deadline = r.role_kind === "congress" ? "45-day STOCK Act deadline" : "2-business-day Form 4 deadline";
    take(r, "late_filer", `${who(r)} disclosed a ${fmtDate(r.txn_date)} ${r.side === "buy" ? "purchase" : r.side === "sell" ? "sale" : "transaction"}${r.ticker ? ` in $${r.ticker}` : ""} ${r.lag_days} days after the trade (${deadline}).`, personUrl(r));
  }
  // first-time filers (top 2 by value)
  const firsts = rows.filter((r) => r.first_filing_at && r.first_filing_at >= sinceIso.slice(0, 10) && r.person_slug);
  for (const r of firsts.slice(0, 2)) {
    take(r, "first_time", `${who(r)} — first appearance in our records: ${verb(r)} ${money(r.value)}${r.ticker ? ` of $${r.ticker}` : ""} on ${fmtDate(r.txn_date)}.`, personUrl(r));
  }
  // cluster buys (≥3 distinct insiders, same ticker, 30 days, one in window)
  const clusters = await sql<{ ticker: string; buyers: number; total: number; latest_filing_id: number }[]>`
    with buys as (
      select s.ticker::text as ticker, t.person_id, t.filing_id, f.filed_at, (t.shares * t.price)::float8 as value
        from transactions t join filings f on f.id = t.filing_id join securities s on s.id = t.security_id
       where f.is_published and f.source = 'sec_form4' and t.txn_code = 'P' and t.review in ('auto_approved','approved')
         and f.filed_at >= now() - interval '30 days'
    )
    select ticker, count(distinct person_id)::int as buyers, coalesce(sum(value),0)::float8 as total,
           (select filing_id from buys b2 where b2.ticker = b.ticker order by filed_at desc limit 1) as latest_filing_id
      from buys b group by ticker
    having count(distinct person_id) >= 3 and max(filed_at) >= ${sinceIso}::timestamptz
     order by buyers desc, total desc limit 2
  `;
  for (const c of clusters) {
    // A cluster is a ticker-level fact; it may overlap a filing already featured above.
    items.push({ kind: "cluster_buy", filingId: c.latest_filing_id, text: `${c.buyers} insiders at $${c.ticker} bought ${money(c.total)} of stock on the open market in the last 30 days.`, url: tickerUrl(c.ticker) });
  }

  return { items, counts: { filings: filings.size, people: people.size }, window: sinceIso };
}

async function postTweet(text: string, replyTo: string | null): Promise<string> {
  const url = "https://api.x.com/2/tweets";
  const credentials = {
    consumerKey: process.env.X_API_KEY!, consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!, tokenSecret: process.env.X_ACCESS_SECRET!,
  };
  const body: Record<string, unknown> = { text };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: oauth1AuthorizationHeader({ method: "POST", url, credentials }), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
  if (!res.ok || !json.data?.id) throw new Error(`X API ${res.status}: ${json.detail ?? json.title ?? "no id returned"}`);
  return json.data.id;
}

export async function runXDaily(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const configured = !!(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET);
  const today = new Date().toISOString().slice(0, 10);
  const since = process.env.X_SINCE
    ? `${process.env.X_SINCE}T00:00:00Z`
    : new Date(Date.now() - Number(process.env.X_LOOKBACK_HOURS ?? 24) * 3600_000).toISOString();
  const threadKey = `x:${today}`;
  ctx.extra["configured"] = configured;
  ctx.extra["since"] = since;

  const [already] = await sql`select count(*)::int as n from social_posts where channel = 'x' and thread_key = ${threadKey} and status = 'posted'`;
  if ((already?.n as number) > 0) {
    ctx.warn(`thread ${threadKey} already posted — nothing to do`);
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }

  const { items, counts } = await selectNotables(sql, since);
  ctx.rowsSeen = items.length;
  ctx.extra["counts"] = counts;
  if (items.length === 0) {
    ctx.warn("no notable published filings in the window — no thread today");
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }
  const tweets = composeThread(today, items, counts);
  for (const t of tweets) if (t.length - (t.match(/https?:\/\/\S+/g) ?? []).reduce((n, u) => n + u.length - URL_WEIGHT, 0) > TWEET_LIMIT) ctx.warn(`tweet over limit after URL weighting: ${t.slice(0, 60)}…`);

  // ledger rows (kinds: intro, items…, outro)
  const kinds = ["intro", ...items.map((i) => i.kind), "outro"];
  const filingIds = [null, ...items.map((i) => i.filingId), null];
  const urls = [`${SITE}/disclosures/`, ...items.map((i) => i.url), `${SITE}/methodology/`];

  if (!configured) {
    const out = process.env.X_DRY_RUN_OUT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "out", `x-thread-${today}.md`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `# X thread dry-run — ${today} (window since ${since})\n\n` + tweets.map((t, i) => `## ${i + 1}/${tweets.length} (${kinds[i]}, ${t.length} chars)\n\n${t}\n`).join("\n"));
    console.log(`[dry-run] ${tweets.length} tweets written to ${out}`);
    for (const t of tweets) console.log(`  · ${t}`);
    for (let i = 0; i < tweets.length; i++) {
      await sql`
        insert into social_posts (channel, post_date, thread_key, seq, kind, filing_id, entity_url, body, status)
        values ('x', ${today}, ${threadKey}, ${i}, ${kinds[i]!}, ${filingIds[i] ?? null}, ${urls[i]!}, ${tweets[i]!}, 'dry_run')
        on conflict (channel, thread_key, seq) do update set body = excluded.body, kind = excluded.kind, filing_id = excluded.filing_id, entity_url = excluded.entity_url
      `;
      ctx.rowsChanged++;
    }
    ctx.extra["dry_run_out"] = out;
    ctx.warn("X credentials absent (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET) — dry-run only");
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
  }

  let replyTo: string | null = null;
  for (let i = 0; i < tweets.length; i++) {
    try {
      const id = await postTweet(tweets[i]!, replyTo);
      replyTo = id;
      await sql`
        insert into social_posts (channel, post_date, thread_key, seq, kind, filing_id, entity_url, body, external_post_id, status)
        values ('x', ${today}, ${threadKey}, ${i}, ${kinds[i]!}, ${filingIds[i] ?? null}, ${urls[i]!}, ${tweets[i]!}, ${id}, 'posted')
        on conflict (channel, thread_key, seq) do update set external_post_id = excluded.external_post_id, status = 'posted', body = excluded.body
      `;
      ctx.rowsChanged++;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sql`
        insert into social_posts (channel, post_date, thread_key, seq, kind, filing_id, entity_url, body, status, error)
        values ('x', ${today}, ${threadKey}, ${i}, ${kinds[i]!}, ${filingIds[i] ?? null}, ${urls[i]!}, ${tweets[i]!}, 'failed', ${msg})
        on conflict (channel, thread_key, seq) do update set status = 'failed', error = excluded.error
      `;
      return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "partial", error: `tweet ${i + 1} failed: ${msg}`, stats: ctx.stats() };
    }
  }
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}
