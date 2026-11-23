// Large holders hub (pages/large-holders.astro, lib/largeholders.ts): wires the shared engine
// (scripts/hubscreen.ts) to the Schedule 13D and 13G rules. Text goes in as text nodes; nothing is stored.
import { h } from "./dom";
import { startHub } from "./hubscreen";
import {
  largeScreen, lhSummaryLine, parseLhHash, toLhHash, isLhViewHash, isDefaultLhFilter, firstLhDir, lhViewCsv, lhViewCsvName, unpackLarge, shortDate, percentText, FILING_THRESHOLD,
  DEFAULT_LH_VIEW, NO_LH_FILTER, type LargeData, type LhFilter, type LhRow, type LhView, type LhSortKey,
} from "../lib/largeholders";
import { nf } from "../lib/hubscreen";

export const largeRow = (r: LhRow): HTMLTableRowElement => {
  const others = r.persons > 1 ? r.persons - 1 : 0;
  const label = `Schedule ${r.schedule}${r.amend ? "/A (amendment)" : ""}`;
  return h("tr", { "data-statement": r.accession },
    h("td", {}, r.c.path ? h("a", { href: r.c.path }, r.c.name) : r.c.name, r.c.ticker ? h("span", { class: "soft small mono" }, ` ${r.c.ticker}`) : null),
    h("td", { class: "wrap" }, r.path ? h("a", { href: r.path }, r.holder) : r.holder,
      others > 0 ? h("span", { class: "lh-sub" }, `with ${nf(others)} other reporting ${others === 1 ? "person" : "persons"}`) : null),
    h("td", {}, `Schedule ${r.schedule}`),
    h("td", { class: "num" }, r.percent != null ? percentText(r.percent) : "", r.percent != null && r.percent < FILING_THRESHOLD ? h("span", { class: "lh-sub" }, `below ${FILING_THRESHOLD}%`) : null),
    h("td", { class: "num" }, r.shares != null ? nf(r.shares) : ""),
    h("td", { class: "mono" }, shortDate(r.event)),
    h("td", { class: "mono" }, shortDate(r.filed)),
    h("td", { class: "mono" }, r.url ? h("a", { href: r.url, rel: "noopener nofollow", target: "_blank" }, `${label} ↗`) : label),
  );
};

startHub<LhRow, LhFilter, LhView, LargeData>({
  unpack: unpackLarge,
  defaults: DEFAULT_LH_VIEW,
  parse: parseLhHash, toHash: toLhHash, isHash: isLhViewHash, isDefault: isDefaultLhFilter,
  screen: largeScreen, line: (r) => lhSummaryLine(r as never),
  rowEl: largeRow,
  readFilter: (get) => ({ q: get("q"), division: get("division"), schedule: get("schedule") as LhFilter["schedule"], pct: get("pct") as LhFilter["pct"], w: Number(get("w") || NO_LH_FILTER.w) }),
  controls: (f) => ({ q: f.q, division: f.division, schedule: f.schedule, pct: f.pct, w: String(f.w) }),
  csv: lhViewCsv, csvName: lhViewCsvName,
  firstDir: (k) => firstLhDir(k as LhSortKey),
});
