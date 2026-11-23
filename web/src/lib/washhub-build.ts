// The /washington/ tiles and the home page's week counts, worked out from the build model with the
// figures, helpers and wording each dataset's own hub page uses. Pure selection is in washhub.ts.
import type { Flagship } from "./flagship";
import { num, plural, money, sum } from "./flagship";
import { orgPath } from "./links";
import { formatDate } from "./format";
import { kindTotals } from "./assistance";
import { ASSISTANCE_WINDOW_DAYS } from "./assistance";
import { siteEventsHub } from "./events8k-build";
import { sitePlanned } from "./plannedsales-build";
import { siteLarge } from "./largeholders-build";
import { siteCompanyByCik } from "./form144-build";
import { unpackHub } from "./events8k";
import { rollLabel } from "./votes";
import { usdFull, SIDE_LABEL } from "./outsidespending";
import { sentenceCase } from "./lobbygifts";
import { inWindow } from "./hubscreen";
import { newestFirst, newestOf, orderTiles, countInWindow, weekTiles, WEEK_DAYS, TILE_ITEMS, type Tile, type WeekTile, type TileItem } from "./washhub";

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const usd = (n: number) => money(n, { compact: false });

export function washTiles(m: Flagship): Tile[] {
  const built = m.builtAt.slice(0, 10);
  const year = new Date(m.builtAt).getUTCFullYear();
  const tiles: (Tile | null)[] = [];

  // Lobbying: the same rows and year as /lobbying/.
  if (m.lobbying.length > 0) {
    const ytd = m.lobbying.filter((l) => l.year === year);
    const total = sum(ytd.map((l) => l.amount));
    const items: TileItem[] = newestFirst(m.lobbying, (l) => l.createdAt).map((l) => ({
      text: `${l.client ?? "(client not stated)"}, via ${l.registrant ?? "(registrant not stated)"}${l.amount != null ? `: ${money(l.amount)}` : ""}`,
      href: orgPath(m, l.client) ?? "/lobbying/", date: day(l.createdAt),
    }));
    tiles.push({
      key: "lobbying", title: "Lobbying", path: "/lobbying/", short: "lobbying",
      blurb: "Quarterly Lobbying Disclosure Act filings: who paid, who was paid, and for what.",
      window: `filed for ${year}`,
      figures: [{ key: "filings", label: `Filings in ${year}`, value: num(ytd.length) }, { key: "income", label: "Income reported", value: money(total) }],
      newest: newestOf(m.lobbying.map((l) => l.createdAt)), newestLabel: "newest filing loaded", items,
      phrase: `${plural(ytd.length, "lobbying filing")} reporting ${money(total)} in ${year} (Senate LDA)`,
    });
  }

  // Lobbyist contributions: the same counted filings as /lobbyist-contributions/.
  const lc = m.lobbyContrib;
  if (lc.available && lc.periods.length > 0) {
    const p = lc.periods[0]!;
    const items: TileItem[] = lc.newest.slice(0, TILE_ITEMS).map((i) => ({
      text: `${sentenceCase(i.type)}${i.payee || i.honoree ? ` to ${i.payee ?? i.honoree}` : ""}${i.amount != null ? `: ${usd(i.amount)}` : ""}, by ${i.registrant ?? i.contributor ?? "(not stated)"}`,
      href: "/lobbyist-contributions/", date: day(i.posted ?? i.date),
    }));
    tiles.push({
      key: "lobbycontrib", title: "Lobbyist contributions", path: "/lobbyist-contributions/", short: "lobbyist contribution reports",
      blurb: "What lobbyists and lobbying firms report giving to campaigns, committees, causes and events on Form LD-203.",
      window: "every report on record",
      figures: [{ key: "reports", label: "LD-203 reports on record", value: num(lc.filingsCounted) }, { key: "latest", label: `${p.label} ${p.year}, amount as reported`, value: usd(p.amount) }],
      newest: day(lc.newestPosted), newestLabel: "newest report posted", items,
      phrase: `${plural(lc.filingsCounted, "lobbyist contribution report")} on Form LD-203 (Senate)`,
    });
  }

  // Federal contracts: the 180 day awards of /contracts/.
  if (m.contracts.length > 0) {
    const total = sum(m.contracts.map((c) => c.amount));
    const items: TileItem[] = newestFirst(m.contracts, (c) => c.actionDate).map((c) => ({
      text: `${c.recipient ?? "(recipient not stated)"} from ${c.agency ?? "(agency not stated)"}${c.amount != null ? `: ${money(c.amount)}` : ""}`,
      href: orgPath(m, c.recipient) ?? "/contracts/", date: day(c.actionDate),
    }));
    tiles.push({
      key: "contracts", title: "Federal contracts", path: "/contracts/", short: "federal contracts",
      blurb: "The largest federal contract awards, from USAspending, with recipient, agency and award value.",
      window: "started in the last 180 days",
      figures: [{ key: "awards", label: "Awards", value: num(m.contracts.length) }, { key: "value", label: "Combined award value", value: money(total) }],
      newest: newestOf(m.contracts.map((c) => c.actionDate)), newestLabel: "newest award start", items,
      phrase: `${plural(m.contracts.length, "large federal contract award")} started in the last 180 days with a combined value of ${money(total)} (USAspending)`,
    });
  }

  // Grants and loans: three kinds, never added together.
  const rows = m.assistance.rows;
  if (rows.length > 0) {
    const t = kindTotals(rows);
    const items: TileItem[] = newestFirst(rows, (r) => r.startDate).map((r) => ({
      text: `${r.recipient}${r.agency ? ` from ${r.agency}` : ""}${r.amount != null ? `: ${money(r.amount)}` : ""}`,
      href: orgPath(m, r.recipient) ?? "/grants/", date: day(r.startDate),
    }));
    tiles.push({
      key: "grants", title: "Grants and loans", path: "/grants/", short: "grants and loans",
      blurb: "Federal grants, loans and direct payments, from USAspending. The kinds are shown apart, never added together.",
      window: `started in the last ${ASSISTANCE_WINDOW_DAYS} days`,
      figures: [
        { key: "awards", label: "Awards", value: num(rows.length) },
        { key: "grants", label: "Grants, award value", value: money(t.grant.value) },
        { key: "loans", label: "Loans and guarantees, face value", value: money(t.loan.value) },
      ],
      newest: newestOf(rows.map((r) => r.startDate)), newestLabel: "newest award start", items,
      phrase: `${plural(rows.length, "federal grant, loan or direct payment")} started in the last ${ASSISTANCE_WINDOW_DAYS} days, shown by kind (USAspending)`,
    });
  }

  // Donations: itemized receipts held, never totals.
  const cm = m.committees.filter((c) => c.count > 0);
  if (cm.length > 0) {
    const receipts = sum(cm.map((c) => c.count));
    const items: TileItem[] = newestFirst(cm, (c) => c.latest).map((c) => ({ text: `${c.name}: ${plural(c.count, "itemized receipt")} held`, href: "/donations/", date: day(c.latest) }));
    tiles.push({
      key: "donations", title: "Donations", path: "/donations/", short: "campaign donations",
      blurb: "Itemized receipts reported to the FEC by the committees tracked here, a recent sample and not a total.",
      window: `dated in the last ${m.donationWindowDays} days`,
      figures: [{ key: "receipts", label: "Itemized receipts held", value: num(receipts) }, { key: "committees", label: "Committees with receipts", value: num(cm.length) }],
      newest: newestOf(cm.map((c) => c.latest)), newestLabel: "newest receipt held", items,
      phrase: `${plural(receipts, "itemized receipt")} held for ${plural(cm.length, "tracked committee")} (FEC)`,
    });
  }

  // Outside spending: the hub's counted expenditures.
  const o = m.outside;
  if (o.shown) {
    const items: TileItem[] = o.newest.slice(0, TILE_ITEMS).map((e) => ({
      text: `${e.committeeName}${e.side ? ` ${SIDE_LABEL[e.side].toLowerCase()}` : ""}${e.candidateName ? ` ${e.candidateName}` : ""}${e.amount != null ? `: ${usdFull(e.amount)}` : ""}`,
      href: "/outside-spending/", date: day(e.spentAt),
    }));
    tiles.push({
      key: "outside", title: "Outside spending", path: "/outside-spending/", short: "outside spending",
      blurb: "Independent expenditures that outside groups report spending to support or oppose federal candidates.",
      window: `${o.cycle ?? "current"} cycle`,
      figures: [{ key: "counted", label: "Expenditures counted", value: num(o.countedRows) }, { key: "spenders", label: "Spending committees", value: num(o.spenderCount) }, { key: "candidates", label: "Candidates named", value: num(o.candidateCount) }],
      newest: newestOf(o.rows.map((r) => r.spentAt)), newestLabel: "newest expenditure", items,
      phrase: `${plural(o.countedRows, "independent expenditure")} counted for the ${o.cycle ?? "current"} cycle (FEC)`,
    });
  }

  // Roll-call votes.
  const v = m.votes;
  if (v.shown) {
    const house = v.rolls.filter((r) => r.chamber === "house").length;
    const items: TileItem[] = newestFirst(v.rolls, (r) => r.date).map((r) => ({
      text: `${rollLabel(r)}${r.bill ? `, ${r.bill}` : ""}${r.result ? `: ${r.result}` : ""}`, href: "/congress-votes/", date: r.date,
    }));
    tiles.push({
      key: "votes", title: "Roll-call votes", path: "/congress-votes/", short: "roll-call votes",
      blurb: "Every recorded House and Senate roll call on file, with the official totals and each member's position.",
      window: "every roll call on file",
      figures: [{ key: "rolls", label: "Roll calls", value: num(v.rolls.length) }, { key: "house", label: "House", value: num(house) }, { key: "senate", label: "Senate", value: num(v.rolls.length - house) }],
      newest: newestOf(v.rolls.map((r) => r.date)), newestLabel: "newest roll call", items,
      phrase: `${plural(v.rolls.length, "roll call")} of the House and the Senate`,
    });
  }
  void built; void formatDate;
  return orderTiles(tiles);
}

/** Counts for the seven days up to the build day; a dataset that is not shown is absent (null). */
export function weekCounts(m: Flagship): WeekTile[] {
  const built = m.builtAt.slice(0, 10);
  const ev = unpackHub(siteEventsHub(m).data);
  const pl = sitePlanned(m).all, lh = siteLarge(m).all;
  const lc = m.lobbyContrib;
  const siteCos = new Set([...siteCompanyByCik(m).entries()].filter(([, c]) => c.slug).map(([cik]) => cik));
  return weekTiles({
    events: ev.length > 0 ? countInWindow(ev.map((r) => r.e.filed), built) : null,
    votes: m.votes.shown ? countInWindow(m.votes.rolls.map((r) => r.date), built) : null,
    outside: m.outside.shown ? countInWindow(m.outside.rows.filter((r) => r.counted).map((r) => r.spentAt), built) : null,
    // Every statement filed, not only each holder's newest one: the count is of filings, as the tile says and as the download lists them.
    holders: lh.length > 0 ? countInWindow([...m.schedule13.byCik.entries()].flatMap(([cik, xs]) => (siteCos.has(cik) ? xs.map((x) => x.filedAt) : [])), built) : null,
    planned: pl.length > 0 ? countInWindow(pl.map((r) => r.filed), built) : null,
    lobbycontrib: lc.available && lc.periods.length > 0 ? lc.postedRecent.filter((r) => inWindow(r.date, built, WEEK_DAYS)).reduce((a, r) => a + r.filings, 0) : null,
    grants: m.assistance.rows.length > 0 ? countInWindow(m.assistance.rows.map((r) => r.startDate), built) : null,
  });
}
