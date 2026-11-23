// Planned sales hub (pages/planned-sales.astro, lib/plannedsales.ts): wires the shared engine
// (scripts/hubscreen.ts) to the Form 144 rules. Text goes in as text nodes; nothing is stored.
import { h } from "./dom";
import { startHub } from "./hubscreen";
import {
  plannedScreen, psSummaryLine, parsePsHash, toPsHash, isPsViewHash, isDefaultPsFilter, firstPsDir, psViewCsv, psViewCsvName, unpackPlanned, shortDate,
  DEFAULT_PS_VIEW, NO_PS_FILTER, type PlannedData, type PsFilter, type PsRow, type PsView, type PsSortKey,
} from "../lib/plannedsales";
import { nf } from "../lib/hubscreen";

export const plannedRow = (r: PsRow, heldHref: string): HTMLTableRowElement => {
  return h("tr", { "data-accession": r.accession },
    h("td", { class: "mono" }, shortDate(r.filed), r.amend ? h("span", { class: "ps-sub" }, "Amendment") : null),
    h("td", {}, r.c.path ? h("a", { href: r.c.path }, r.c.name) : r.c.name, r.c.ticker ? h("span", { class: "soft small mono" }, ` ${r.c.ticker}`) : null),
    h("td", { class: "wrap" }, r.s.path ? h("a", { href: r.s.path }, r.s.name) : r.s.name),
    h("td", { class: "wrap" }, r.relationship ?? ""),
    h("td", { class: "num" }, r.shares != null ? nf(r.shares) : ""),
    r.held
      ? h("td", { class: "num", "data-held": "" }, h("a", { class: "soft", href: heldHref }, "not shown"))
      : h("td", { class: "num" }, r.value != null ? `$${nf(r.value)}` : ""),
    h("td", { class: "mono" }, shortDate(r.sale)),
    h("td", { class: "mono" }, shortDate(r.plan)),
    h("td", { class: "mono" }, r.url ? h("a", { href: r.url, rel: "noopener nofollow", target: "_blank" }, "Form 144 ↗") : ""),
  );
};

startHub<PsRow, PsFilter, PsView, PlannedData>({
  unpack: unpackPlanned,
  defaults: DEFAULT_PS_VIEW,
  parse: parsePsHash, toHash: toPsHash, isHash: isPsViewHash, isDefault: isDefaultPsFilter,
  screen: plannedScreen, line: (r) => psSummaryLine(r as never),
  rowEl: (r) => plannedRow(r, document.querySelector<HTMLElement>("[data-hub-root]")?.dataset.heldHref ?? "/methodology/#form-144"),
  readFilter: (get) => ({
    q: get("q"), division: get("division"), form: get("form") as PsFilter["form"], plan: get("plan") as PsFilter["plan"],
    min: Number(get("min") || 0), w: Number(get("w") || NO_PS_FILTER.w),
  }),
  controls: (f) => ({ q: f.q, division: f.division, form: f.form, plan: f.plan, min: String(f.min), w: String(f.w) }),
  csv: psViewCsv, csvName: psViewCsvName,
  firstDir: (k) => firstPsDir(k as PsSortKey),
});
