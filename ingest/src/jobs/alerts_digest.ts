// Job: build the email digests (email alerts stage 2, 2026-11-18). IT SENDS NOTHING. It writes
// what would be sent into alert_outbox (migration 0025); a later stage, with a provider Peter
// chooses, sends the rows whose status is 'pending'.
//
//   npm run ingest -- alerts_digest
//
// SWITCH. While app_settings 'alerts_enabled' is false (as shipped) the job writes no digest and
// reports a skip; the freshness check shows it as NOT CONFIGURED. Nobody can have a digest
// turned on while the switch is off (alert_save refuses), so there would be nothing to build.
// ALERTS_DRY_RUN=1 builds every digest and writes nothing at all, switch on or off; with
// ALERTS_DRY_RUN_OUT=<dir> it also saves each digest there as <account id>.txt and .html
// (local review only: those files show what an account follows, never commit them).
//
// WHAT IS NEW. For an account whose digest is daily or weekly: rows of PUBLISHED filings that
// were loaded (filings.created_at) after the account's last digest and up to `end`, for the
// pages on any of its watchlists. It is the watchlist feed's rule (watch_feed_rows, 0017) with
// three additions:
//   - end = the run time less SETTLE_MINUTES. A filing is published at the end of the job that
//     loaded it, minutes after it is created; a run that looked at the last few minutes could
//     pass over a filing that is about to be published and never come back to it. Anything
//     loaded in the settling time waits for the next digest.
//   - only rows disclosed within MAX_AGE_DAYS of the run. A backfill loads old filings as "new"
//     (130,000 in one week in November 2026); a digest is for what was just disclosed.
//   - a Senate report replaced by an amendment is left out.
// Known limit: a filing held for review and published more than SETTLE_MINUTES after it was
// loaded (a scanned House report approved by hand) is in no digest. It is on the watchlist page.
//
// WHEN. lib/digest.ts isDue: daily when the last digest is 12 hours old; weekly on Mondays
// (UTC), or on any day once the last one is 8 days old. Safe to run twice a day.
//
// EACH ACCOUNT, in one transaction: lock its setting, check the digest is still on, insert at
// most one outbox row (none when nothing is new), move last_digest_at to `end`. Turning the
// digest off or unsubscribing (0025) cancels pending rows, so a row written a moment before
// someone opts out is not sent.
//
// HOUSEKEEPING, every run, switch on or off: a pending row older than PENDING_MAX_AGE_DAYS is
// cancelled (a digest that old must not go out late), and the body of a row sent more than
// SENT_BODY_DAYS ago is blanked (a body shows what an account follows).
//
// The stats carry counts only: no address, no account id.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../lib/db.js";
import { buildItems, composeDigest, isDue, type DigestKind, type DigestRow } from "../lib/digest.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "alerts_digest";
const SITE = (process.env.PUBLIC_SITE_URL ?? "https://spotthemoney.com").replace(/\/$/, "");
export const SETTLE_MINUTES = 120;
export const MAX_AGE_DAYS = 30;
export const MAX_ROWS = 2000;
export const PENDING_MAX_AGE_DAYS = 3;
export const SENT_BODY_DAYS = 30;

interface Pref { account_id: string; digest: DigestKind; unsub_token: string; last_digest_at: Date; email: string | null }

type Sql = ReturnType<typeof getDb>;

async function rowsFor(sql: Sql, accountId: string, start: Date, end: Date): Promise<DigestRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    with mine as (
      select distinct on (i.kind, i.key) i.kind, i.key, coalesce(nullif(btrim(i.label), ''), i.key) as label
        from watchlist_items i join watchlists w on w.id = i.watchlist_id
       where w.account_id = ${accountId}
       order by i.kind, i.key, i.created_at
    ),
    hits as (
      select t.id, m.kind, m.key, m.label, 1 as pri from mine m
        join people p on m.kind in ('member', 'insider') and p.slug = m.key
        join transactions t on t.person_id = p.id
      union all
      select t.id, m.kind, m.key, m.label, 2 from mine m
        join securities s on m.kind = 'stock' and lower(s.ticker::text) = m.key
        join transactions t on t.security_id = s.id
      union all
      select t.id, m.kind, m.key, m.label, 3 from mine m
        join companies c on m.kind = 'company' and c.slug = m.key
        join securities s on s.company_id = c.id
        join transactions t on t.security_id = s.id
    )
    select * from (
      select distinct on (t.id)
             t.id::float8 as txn_id, f.id::float8 as filing_id, f.source::text as source, f.source_url,
             p.full_name as person_name, p.slug::text as person_slug,
             (select r.role_kind::text from person_roles r where r.person_id = p.id
               order by (r.role_kind::text = 'congress') desc limit 1) as person_kind,
             s.ticker::text as ticker, s.name as security_name, t.side::text as side, t.txn_code,
             coalesce(t.is_derivative, false) as is_derivative,
             t.txn_date::text as txn_date, t.disclosed_at::text as disclosed_at, t.disclosure_lag_days as lag_days,
             t.amount_low::float8 as amount_low, t.amount_high::float8 as amount_high,
             t.shares::float8 as shares, t.price::float8 as price, t.owner_type, t.asset_type,
             h.kind as match_kind, h.key as match_key, h.label as match_label
        from hits h
        join transactions t on t.id = h.id
        join filings f on f.id = t.filing_id and f.is_published
        left join people p on p.id = t.person_id
        left join securities s on s.id = t.security_id
       where f.created_at > ${start} and f.created_at <= ${end}
         and t.disclosed_at >= (${end}::timestamptz at time zone 'UTC')::date - ${MAX_AGE_DAYS}::int
         and t.disclosed_at <= (${end}::timestamptz at time zone 'UTC')::date + 1
         and (f.payload->>'superseded_by') is null
       order by t.id, h.pri
    ) x
    order by disclosed_at desc, txn_id desc
    limit ${MAX_ROWS + 1}`;
  return rows.map((r) => ({
    txnId: Number(r.txn_id), filingId: Number(r.filing_id), source: String(r.source), sourceUrl: (r.source_url as string) ?? null,
    personName: (r.person_name as string) ?? null, personSlug: (r.person_slug as string) ?? null,
    personKind: (r.person_kind as string) ?? null, ticker: (r.ticker as string) ?? null,
    securityName: (r.security_name as string) ?? null, side: String(r.side), txnCode: (r.txn_code as string) ?? null,
    isDerivative: r.is_derivative === true, txnDate: (r.txn_date as string) ?? null,
    disclosedAt: (r.disclosed_at as string) ?? null, lagDays: r.lag_days == null ? null : Number(r.lag_days),
    amountLow: r.amount_low == null ? null : Number(r.amount_low), amountHigh: r.amount_high == null ? null : Number(r.amount_high),
    shares: r.shares == null ? null : Number(r.shares), price: r.price == null ? null : Number(r.price),
    ownerType: (r.owner_type as string) ?? null, assetType: (r.asset_type as string) ?? null, matchKind: String(r.match_kind), matchKey: String(r.match_key),
    matchLabel: String(r.match_label),
  }));
}

export async function runAlertsDigest(): Promise<IngestRunResult> {
  const sql = getDb();
  const dryRun = process.env.ALERTS_DRY_RUN === "1";
  const outDir = dryRun ? process.env.ALERTS_DRY_RUN_OUT : undefined;
  // ALERTS_NOW is for tests only: the run time, as an ISO timestamp.
  const now = process.env.ALERTS_NOW ? new Date(process.env.ALERTS_NOW) : new Date();
  if (Number.isNaN(now.getTime())) {
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "failed", error: "ALERTS_NOW is not a date" };
  }
  const end = new Date(now.getTime() - SETTLE_MINUTES * 60_000);
  const postal = process.env.ALERTS_POSTAL_ADDRESS?.trim() || null;
  const stats: Record<string, unknown> = {
    dry_run: dryRun, period_end: end.toISOString(), settle_minutes: SETTLE_MINUTES, max_age_days: MAX_AGE_DAYS,
    postal_address_set: postal != null,
  };

  // Housekeeping first: it must happen even when the switch has been turned off again.
  if (!dryRun) {
    const stale = await sql`
      update alert_outbox set status = 'cancelled', error = ${`not sent within ${PENDING_MAX_AGE_DAYS} days`}
       where status = 'pending' and created_at < ${now}::timestamptz - make_interval(days => ${PENDING_MAX_AGE_DAYS})
      returning id`;
    const blanked = await sql`
      update alert_outbox set body_text = '', body_html = null
       where status = 'sent' and sent_at < ${now}::timestamptz - make_interval(days => ${SENT_BODY_DAYS})
         and (body_text <> '' or body_html is not null)
      returning id`;
    stats.pending_cancelled_as_stale = stale.length;
    stats.sent_bodies_blanked = blanked.length;
  }

  const [sw] = await sql<{ on: boolean }[]>`
    select coalesce((select value = 'true'::jsonb from app_settings where key = 'alerts_enabled'), false) as on`;
  stats.switch_on = sw?.on === true;
  if (!stats.switch_on && !dryRun) {
    stats.skipped = "email alerts are switched off (app_settings alerts_enabled is false)";
    console.log(`↷ ${SOURCE}: ${stats.skipped}`);
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats };
  }

  const prefs = await sql<Pref[]>`
    select p.account_id, p.digest, p.unsub_token, p.last_digest_at, nullif(btrim(a.email), '') as email
      from alert_prefs p join accounts a on a.id = p.account_id
     where p.digest in ('daily', 'weekly')
     order by p.account_id`;

  let due = 0, notDue = 0, noEmail = 0, written = 0, nothingNew = 0, optedOut = 0, truncated = 0;
  let rowsSeen = 0, itemsTotal = 0, daily = 0, weekly = 0, failed = 0;
  let firstError: string | null = null;
  if (outDir) mkdirSync(outDir, { recursive: true });

  for (const p of prefs) {
    const last = new Date(p.last_digest_at);
    if (!isDue(p.digest, last, end, now)) { notDue++; continue; }
    if (!p.email) { noEmail++; continue; }
    due++;
    try {
      let rows = await rowsFor(sql, p.account_id, last, end);
      if (rows.length > MAX_ROWS) { rows = rows.slice(0, MAX_ROWS); truncated++; }
      rowsSeen += rows.length;
      const items = buildItems(rows, SITE);
      const digest = items.length > 0
        ? composeDigest({ kind: p.digest, items, periodEnd: end, site: SITE, unsubToken: p.unsub_token, postalAddress: postal })
        : null;
      if (dryRun) {
        if (digest) {
          written++; itemsTotal += digest.itemCount; if (p.digest === "daily") daily++; else weekly++;
          if (outDir) {
            const safe = p.account_id.replace(/[^A-Za-z0-9_-]/g, "_");
            writeFileSync(join(outDir, `${safe}.txt`), `Subject: ${digest.subject}\n\n${digest.text}`);
            writeFileSync(join(outDir, `${safe}.html`), digest.html);
          }
        } else nothingNew++;
        continue;
      }
      const outcome = await sql.begin(async (tx) => {
        // The setting may have changed since it was read: lock it and look again.
        const [cur] = await tx<{ digest: string; last_digest_at: Date }[]>`
          select digest, last_digest_at from alert_prefs where account_id = ${p.account_id} for update`;
        if (!cur || cur.digest !== p.digest || new Date(cur.last_digest_at).getTime() !== last.getTime()) return "changed";
        let wrote = false;
        if (digest) {
          const ins = await tx`
            insert into alert_outbox (account_id, kind, period_start, period_end, to_email, subject, body_text, body_html, item_count)
            values (${p.account_id}, ${"digest_" + p.digest}, ${last}, ${end}, ${p.email}, ${digest.subject},
                    ${digest.text}, ${digest.html}, ${digest.itemCount})
            on conflict (account_id, kind, period_end) do nothing
            returning id`;
          wrote = ins.length > 0;
        }
        await tx`update alert_prefs set last_digest_at = ${end}, updated_at = now() where account_id = ${p.account_id}`;
        return wrote ? "written" : "nothing";
      });
      if (outcome === "changed") optedOut++;
      else if (outcome === "written") { written++; itemsTotal += digest!.itemCount; if (p.digest === "daily") daily++; else weekly++; }
      else nothingNew++;
    } catch (err) {
      // One account's failure must not stop the others; nothing was written for it (the
      // transaction rolled back), so the next run covers the same period.
      failed++;
      firstError ??= err instanceof Error ? err.message : String(err);
    }
  }

  Object.assign(stats, {
    accounts_opted_in: prefs.length, due, not_due: notDue, no_email: noEmail, digests_written: written,
    digests_daily: daily, digests_weekly: weekly, nothing_new: nothingNew, setting_changed_during_run: optedOut,
    accounts_over_row_cap: truncated, items: itemsTotal, accounts_failed: failed,
  });
  if (firstError) stats.first_error = firstError.slice(0, 300);
  console.log(`${SOURCE}: ${prefs.length} account(s) with a digest on, ${due} due, ${written} digest(s) ${dryRun ? "built (dry run, nothing written)" : "written"}, ${itemsTotal} item(s), ${nothingNew} with nothing new, ${failed} failed`);
  if (failed > 0 && failed === due) {
    return { source: SOURCE, rowsSeen, rowsChanged: dryRun ? 0 : written, status: "failed", error: `every due account failed: ${firstError}`, stats };
  }
  return { source: SOURCE, rowsSeen, rowsChanged: dryRun ? 0 : written, status: failed > 0 ? "partial" : "success", stats };
}
