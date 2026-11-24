# Page-type audit of the current spotthemoney.com

Read-only audit. Source tree `/home/claude/wt/rd/web/src`, build `/home/claude/wt/rd/web/dist/client` served on port 4800, Playwright with system Chrome, external hosts blocked (TradingView, ads and Google scripts did not load, so those blocks show as empty frames). Screenshots: `/home/claude/work/rd/shots/before/<type>-<example>-<1280|390>.png` (light theme; plus `-dark` for home, stock pltr and member elena). Raw numbers: `/home/claude/work/rd/tools/out/*.json`; scripts in `/home/claude/work/rd/tools/` (not in the repo).

## Notes on method and choices

- The build is the local seed build (about 125 pages, synthetic data), not production. Heights and counts of rows are therefore smaller than production for data-heavy pages; block order, selectors and the number of distinct styles are the same code.
- Viewports 1280x900 and 390x844. Document height in screens = `document.scrollHeight` / viewport height.
- "Distinct" counts are over computed styles of visible elements inside `main` (`font-size`, `font-weight`, `color` of elements with own text, `border-radius`). "Bordered" = visible border on any side or non-none `box-shadow`; "shadowed" = non-none `box-shadow`.
- "First figure" = first element matching a number-bearing figure selector (`.glance-v`, `.datastrip .v`, `.stat`, `.big`, `.tile`), as coded in `measure.mjs`. A page with `-` has none of those before its first table or chart.
- "Numeric table" = a table with a column whose body cells parse as numbers, dates excluded; "all right" = every such column has `text-align:right`. Identifier columns (Year, Code, Doc ID, Item) count as numeric when their cells are digits, so a left-aligned `Year` column is listed as a fault but is arguably correct.
- Sticky header: no `thead` or `th` in the build is `position: sticky; top: ...`. `table.data th:first-child` is `position: sticky; left: 0` at 390 (global.css line 258), a pinned first column, not a header; the measurer's `stickyHead` field counted it at 390, so the column shows `0 (none)` here. The page header (`header.site`) is the only sticky bar: 65px at 1280, 57px at 390. `nav.groupbar` is also sticky (52px, `top: var(--hdr)`), on entity pages only.
- Author example: the spec's example `elena-marsh` is a member, not an author; the only author page is `/writing/authors/spot-the-money/` (tag `author-stm`).
- Embeds: the measurer scopes to `main`, so embeds return document height only.
- Not measured: on-demand pages (`export const prerender = false`: `OdPageView` pages at `/stocks/[...rest]`, `/companies/[...rest]`, `/insiders/[...rest]`, `/od-parity/*`), `/auth/*`, `/api/*`, `/alerts/unsubscribe`, signed-in `/watchlist/` rows, TradingView and ad content, real phones (only 390x844 emulation), Windows font rendering. Scoped `<style>` blocks in 33 page and component files are not in the global.css counts below (they are in the computed-style counts per page).
- P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.

## 1. Summary table

| # | page type | routes | example URLs used (tags in shots/) | pages of this type in the build |
|---|---|---|---|---|
| 1 | Home | `/` | `/` (home-home) | 1 |
| 2 | Stock / company entity page | `/stocks/[ticker]/` (one per company with a ticker; other share classes 301 to it), `/companies/[slug]/` (companies without a ticker page), `/stocks/[...rest]`, `/companies/[...rest]` (on-demand, not measured) | `/stocks/pltr/` (stock-pltr); `/stocks/swap/` (stock-swap); `/stocks/abt/` (stock-abt); `/companies/seed-sponsor-credit-fund/` (company-sponsor) | 10 stocks + 1 companies (seed build) |
| 3 | Member of Congress page | `/congress/[slug]/` | `/congress/elena-marsh/` (member-elena); `/congress/priya-lindqvist/` (member-priya) | 6 (seed) |
| 4 | Insider (Form 4 filer) page | `/insiders/[slug]/`, `/insiders/[...rest]` (on-demand, not measured) | `/insiders/karp-alexander-c/` (insider-karp); `/insiders/seed-fund-director/` (insider-fund) | 10 (seed) |
| 5 | Committee page | `/congress-committees/[slug]/` | `/congress-committees/house-agriculture/` (committee-houseag); `/congress-committees/senate-agriculture-nutrition-and-forestry/` (committee-senag) | 4 (seed) |
| 6 | Industry division page | `/industries/[slug]/` | `/industries/manufacturing/` (industry-manufacturing); `/industries/services/` (industry-services) | 2 (seed) |
| 7 | Lobbying issue page | `/lobbying-issues/[slug]/` | `/lobbying-issues/defense/` (lobbyissue-defense); `/lobbying-issues/trade/` (lobbyissue-trade) | 6 (seed) |
| 8 | Section landing pages | `/congress/`, `/insiders/`, `/stocks/`, `/washington/`, `/rates/`, `/markets/` (redirect), `/companies/`, `/congress-members/` is a screener (below) | `/congress/` (landing-congress); `/insiders/` (landing-insiders); `/stocks/` (landing-stocks); `/washington/` (landing-washington); `/rates/` (landing-rates) | 7 |
| 9 | Rates and markets detail pages | `/rates/i-bonds/`, `/rates/tips/`, `/rates/treasury-yields/`, `/markets/largest-stock-exchanges/` | `/rates/i-bonds/` (ratedetail-i-bonds); `/rates/tips/` (ratedetail-tips); `/rates/treasury-yields/` (ratedetail-treasury-yields); `/markets/largest-stock-exchanges/` (ratedetail-exchanges) | n/a |
| 10 | Dataset hub (client-side filter) | `/company-events/`, `/executive-pay/`, `/institutional-holders/`, `/planned-sales/`, `/large-holders/`, `/congress-votes/`, `/outside-spending/`, `/grants/`, `/lobbyist-contributions/` | `/company-events/` (hub-company-events); `/congress-votes/` (hub-congress-votes); `/executive-pay/` (hub-executive-pay); `/grants/` (hub-grants); `/institutional-holders/` (hub-institutional-holders); `/large-holders/` (hub-large-holders); `/lobbyist-contributions/` (hub-lobbyist-contributions); `/outside-spending/` (hub-outside-spending); `/planned-sales/` (hub-planned-sales) | 9 |
| 11 | Dataset page, server-rendered | `/lobbying/`, `/contracts/`, `/donations/`, `/disclosures/` | `/contracts/` (serverhub-contracts); `/lobbying/` (serverhub-lobbying); `/donations/` (serverhub-donations); `/disclosures/` (serverhub-disclosures) | 4 |
| 12 | Screener / directory | `/congress-trades/`, `/congress-members/`, `/company-financials/` | `/congress-trades/` (screener-congress-trades); `/congress-members/` (screener-congress-members); `/company-financials/` (screener-company-financials) | 3 |
| 13 | List pages (committees, industries, lobbying issues) | `/congress-committees/`, `/industries/`, `/lobbying-issues/` | `/congress-committees/` (list-congress-committees); `/industries/` (list-industries); `/lobbying-issues/` (list-lobbying-issues) | 3 |
| 14 | Guides hub and FAQ | `/guides/`, `/faq/` | `/guides/` (guidehub-guides); `/faq/` (guidehub-faq) | 2 |
| 15 | Guide page | `/guides/[slug]/` | `/guides/tips-real-yields-and-breakeven-inflation/` (guide-tips); `/guides/what-is-form-4/` (guide-what-is-form-4) | 25 (seed) |
| 16 | Writing hub | `/writing/` | `/writing/` (writinghub-writing) | 1 |
| 17 | Article | `/writing/[slug]/` | `/writing/how-late-house-members-report-stock-trades/` (article-late) | 4 (seed) |
| 18 | Author page | `/writing/authors/[slug]/` | `/writing/authors/spot-the-money/` (author-stm) | 1 |
| 19 | Reference and static pages | `/methodology/`, `/about/`, `/contact/`, `/corrections/`, `/privacy/`, `/terms/`, `/developers/`, `/downloads/`, `/feeds/`, `/404` | `/methodology/` (reference-methodology); `/about/` (reference-about); `/contact/` (reference-contact); `/corrections/` (reference-corrections); `/developers/` (reference-developers); `/downloads/` (reference-downloads); `/feeds/` (reference-feeds); `/privacy/` (reference-privacy); `/terms/` (reference-terms); `/404.html` (reference-404) | 10 |
| 20 | Account (watchlist, shared watchlist) | `/watchlist/`, `/watchlist/shared/`; also `/alerts/unsubscribe` (not measured) | `/watchlist/` (account-watchlist); `/watchlist/shared/` (account-shared) | 2 |
| 21 | Embeds | `/embed/congress/[slug]/`, `/embed/stocks/[ticker]/` | `/embed/congress/elena-marsh/` (embed-congress); `/embed/stocks/pltr/` (embed-stock) | 12 (seed) |
| 22 | Search dialog (layout) | in `BaseLayout.astro` (`#searchDlg`), index `/data/search.json` | `/` (search-home) | 1 |

On production the entity types are far larger than the seed counts: about 1,200 stock pages, 12,000+ insider pages and 130+ member pages (Session State 2026-10-10 and 2026-11-23 in CLAUDE.md), so any fix to those templates is applied about 14,000 times.

## 2. Sitewide findings

### 2.1 global.css and writing.css: distinct values with counts

Parsed from `web/src/styles/global.css` (949 lines) and `writing.css` (28 lines), comments removed. Counts are declarations.

**Font sizes: 35 distinct** (px/rem/clamp counted as written; 16 are single-use):

13.5px x28, 12.5px x24, 13px x23, 14px x21, 14.5px x20, 12px x14, 15px x13, 1rem x6, 1.05rem x4, 11.5px x4, 15.5px x3, 20px x3, 0.95rem x3, 1.15rem x3, 11px x3, 0.92em x2, 17px x2, 1.1rem x2, 1.02rem x2, clamp(1.9rem, 4.4vw, 3rem) x1, clamp(1.35rem, 2.6vw, 1.75rem) x1, clamp(1rem, 1.6vw, 1.12rem) x1, 16px x1, clamp(2rem, 5vw, 3.4rem) x1, 22px x1, 0.93rem x1, clamp(2.6rem, 7vw, 3.8rem) x1, 1.4rem x1, 10px x1, 1.5rem x1, 0.5em x1, clamp(1.5rem, 3vw, 2.1rem) x1, 1.12rem x1, 1.8rem x1, 24px x1

**Font weights: 3 used in rules plus a variable-font range** (600 x43; 500 x26; 400 x9; 100 900 x1; `100 900` is the `@font-face` range, not a use). Computed per page: 2 to 4 (the 4th is 700 from default bold elements).

**Text colours (`color:`): 14 distinct**: var(--ink-soft) x94; var(--ink) x83; var(--bg) x16; var(--signal) x14; var(--green-ink) x5; var(--red-ink) x5; inherit x4; var(--signal-ink) x2; var(--line-strong) x2; #6FD6BB x1; #FF9A85 x1; #0B6B55 x1; #B2331E x1; #fff x1

**Backgrounds: 33 distinct**: top by count var(--chip) x36; var(--surface) x25; var(--ink) x17; transparent x16; var(--chip-hover) x8; var(--surface-alt) x8; var(--bg) x5; var(--signal) x3; none x3; var(--viz-buy) x3; rgba(12,13,14,.45) x2; var(--chart-1) x2; var(--chart-2) x2; var(--viz-sell) x2; color-mix(in srgb, var(--signal) 8%, transparent) x2; var(--chip) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4.5l4 4 4-4' fill='none' stroke='%235B5F63' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 13px center...

**Border radii: 14 distinct**: var(--r-pill) x23; var(--r-md) x23; var(--r-sm) x12; 6px x8; 10px x4; 2px x4; 50% x3; 12px x3; 999px x2; 0 x1; 4px x1; 8px x1; 5px x1; 9px x1 (`--r-pill` 999px, `--r-md` 16px, `--r-sm` 8px are tokens; 10 literal values bypass them).

**Box shadows: 6 distinct**: var(--shadow) x6; none x1; var(--glow-signal) x1; 1px 0 0 var(--line) x1; inset 0 0 0 1px var(--ink) x1; 0 0 0 100vmax var(--bg), 0 1px 0 100vmax var(--line) x1

**Line heights: 12 distinct**: 1.5 x6; 1.25 x4; 1.45 x4; 1.3 x3; 1.6 x3; 1.1 x2; 18px x2; 1 x1; 1.55 x1; 1.4 x1; 1.35 x1; 1.15 x1

**Spacing values (margin, padding, gap, row/column gap tokens): 62 distinct** (the value `0` is 299 of the declarations, so 298 other declarations spread over 61 values; rem and px mixed):

0 x299, 8px x50, 10px x44, 12px x40, 6px x38, 1rem x29, 4px x29, 14px x27, 0.5rem x25, 0.4rem x20, 0.9rem x19, 0.6rem x19, 2px x18, 16px x17, 1.25rem x15, 0.2rem x10, 1.1rem x9, 0.3rem x8, 0.8rem x8, 0.7rem x8, 7px x7, 1.2rem x7, 2rem x7, 1.4rem x6, 18px x6, 1px x5, 3px x5, 1.5rem x5, 0.75rem x5, 20px x5, 2.5rem x4, 0.25rem x4, 5px x4, 1.3rem x4, 32px x4, 1.75rem x3, 0.35rem x3, 22px x3, 34px x2, 9px x2, 13px x2, 1.6rem x2, 15px x2, 0.45rem x2, 1.15rem x2, 0.95rem x2, 0.05em x1, 0.35em x1, -8px x1, 2.25rem x1, 11px x1, 3.5rem x1, 36px x1, 1.05rem x1, 0.55rem x1, -1px x1, 0.85rem x1, 28px x1, 24px x1, .35rem x1, .4rem x1, 0.1rem x1

**Custom properties:** 85 lines, 3 sets (light `:root`, dark, a couple of aliases). Palette: `--bg #F2F1EC`, `--surface #FFFFFF`, `--ink #0C0D0E`, `--ink-soft #5B5F63`, `--signal #0C5C76`, `--green #15824B`, `--red #C0392B`, `--green-ink #11733F`, `--red-ink #B03226`, chart tokens `--chart-1..4`, `--viz-*`. Literal hex colours outside tokens: `#6FD6BB`, `#FF9A85`, `#0B6B55`, `#B2331E`, `#fff`.

### 2.2 Colours with more than one meaning

| colour | meanings found (selector, global.css) |
|---|---|
| green: `--green-ink` #11733F / `--green` #15824B | buy side (`table.data.txns td.side.buy`, `.nf-act.buy`), positive change (`.datastrip .v.up, .pos`), the "Congress" kind label (`.kind.congress`), result text (`.result`), data series 1 (`--chart-1` = #15824B, `.s-primary`, `.v-c1`: first series on any chart, not buy). Four greens in use: #11733F, #15824B, #12876A (`--viz-buy`), #0B6B55 literal; plus teal #0C5C76 (`--signal`). |
| red: `--red-ink` / `--red` / `--viz-sell` #D4472F | sell side, negative change, error/late states (`--viz-late` is a separate brown #8A5A00 for "late"), `#B2331E` literal. Four reds: #B03226, #C0392B, #D4472F, #B2331E literal. |
| teal `--signal` #0C5C76 (14 `color:` uses, 3 backgrounds) | link hover (`a:hover`), focus ring (`:focus-visible`), live dot (`.datastrip .live`), the `LIVE` tag background (`.tag.live`), the "insider" kind label (`.kind.insider`), active controls, "show more" buttons (`.answer-more`, `.hm-reset`, `.hm-more`), `:target` row tint, `a.faq-more` link. Link, action, status and category share one colour. |
| `--ink` background (17 `background:` uses) | active chip/segment, primary button, tile text on dark. Active state and primary action share it. |
| `--chart-2` blue #0E75B0 = `--viz-one` | second series on charts, "one group" in scatter, comparison line (`.s-compare`). |
| `--ink-soft` #5B5F63 (94 `color:` uses, the most used colour) | secondary text, labels, units, table meta, disabled and note text. One grey for six roles. |

Weight: `600` (43 declarations) is used for headings, table headers, side labels (`td.side.buy`), active chips and numbers. Size: 13.5px (28 declarations), 12.5px (24), 13px (23) and 14px (21) sit within 1.5px of each other and are used for the same roles (meta, labels, cells).

### 2.3 Tables without right-aligned numbers and without a sticky header

Across the 63 page tags measured at 1280 (home, entity, hub, reference, etc.): **151 tables**, **118** with a numeric column, **108** of those fully right-aligned, **10** with at least one left-aligned numeric column. **0 tables have a sticky header** (`thead`/`th` sticky with `top`); all 151 scroll their header away. At 390, 103 tables pin their first column (`table.data th:first-child, td:first-child`, `left: 0`) and the rest are not pinned.

| table (caption / first column) | left-aligned numeric column | pages |
|---|---|---|
| How quickly were House trades reported | `Trades`, `Share` | article-late |
| Industry codes in this division | `Code` (sortable) | industry-manufacturing, industry-services |
| What kind of transactions | `Year` | insider-karp, insider-fund |
| Year by year, and whose trades | `Year` | member-elena |
| Filings | `Doc ID` | member-elena |
| Awards by industry code | `Code` (sortable) | serverhub-contracts |
| Company events: Form 8-K reports | `Item` | stock-pltr |
| Contributions this company's lobbying filers made | `Year` | stock-pltr |

Tables with no numeric column at all (identified as text-only): `hub-company-events`, `screener-congress-trades` (amount is a range string), `serverhub-disclosures`, and 21 tables on `/downloads/` (file lists).

### 2.4 Layout facts that apply to every page type

- `header.site` is `position: sticky; top: 0`, 65px at 1280 and 57px at 390 (`--hdr`). It holds the mark, search pill, 5 `details.navm` menus and the theme switch.
- Content order on every indexable page: `aside.ad-slot.ad-top` (115px at 1280, y=120) then `nav.crumbs` (y=255) then `h1` (y=293). The `h1` is at y=293 at 1280 and y=261 or 289 at 390 on 53 of 65 tags; on 7 tags with `ads={false}` (privacy, terms, contact, watchlists, 404) it is at y=161 (1280). The ad slot adds 132px (115px plus margin) before any content.
- `aside.ad-slot.ad-mid` and `ad-low` are 305px; `ad-multiplex` is 25px collapsed (unfilled). Unfilled units carry a visible "Advertisement" label.
- `p.disclaimer` closes every page (40px).
- Horizontal overflow at 390: only `/faq/` (19px, `a.faq-more`). All other 64 page tags measure 0.
- Dark theme (checked on home, pltr, elena): same counts as light; no additional elements.

## 3. Page types

### 3.1 Home

**Routes:** `/`

**Templates and shared components:** `pages/index.astro`; `Heatmap`, `NotableFeed`, `VizHome`, `MiniHeatmap`, `Tape`, `Answer`, `AdSlot` (no `Crumbs`)

**Who lands here:** Search and direct visitors wanting "what are insiders and Congress buying now". Come from search, social shares, RSS. Scan the notable-trades feed, then open the trade map and pick a ticker.

**Blocks top to bottom** (example `home-home-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| Notable trades by insiders and Congress | `section.hero.hero-map` | 255 | 119 | P |
| - | `p.note.nf-coverage` | 381 | 64 | P |
| - | `section.answer[data-answer]` | 465 | 156 | P |
| Notable trades | `section#notable.feed[data-notable][data-src]` | 661 | 400 | P |
| This week in filings | `section[data-week][data-built]` | 1092 | 222 | P |
| - | `h2#heatmap.nf-maph` | 1347 | 31 | P |
| - | `p.soft.small` | 1386 | 60 | S |
| How to read the map | `aside.nf-howto` | 1454 | 179 | P |
| - | `div.hm-switch` | 1647 | 42 | P |
| Most traded | `div.hm-pane[data-pane]` | 1693 | 872 | P |
| &nbsp;&nbsp;Most traded | `section#hm-all.heatmap[data-heatmap][data-kind]` | 1693 | 872 | P |
| The week in disclosures | `section` | 2605 | 1707 | S |
| - | `div.datastrip.strip-compact` | 4332 | 110 | P |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 4470 | 305 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 4815 | 25 | R |

**Measured faults:**

- Overview first: the first figure (first `span` datum) sits at y=1224 at 1280 and y=1658 at 390 (home-home-1280.png, home-home-390.png); above it are the ad slot (115px), `h1`, `p.nf-coverage`, `section.answer` and the notable feed. The map the page is named for (`h2#heatmap`) is below the feed.
- No ink that carries no information: `aside.ad-slot.ad-top` is 115px tall at y=120 and pushes `h1` to y=272 (h1Y 272 at 1280, 240 at 390).
- One meaning per colour/size: 19 distinct font sizes, 4 weights, 8 text colours and 6 radii on one page (home-home-1280.png); other page types use 3 to 21 (most 10 to 17).
- Same skeleton: home has its own block order (hero, answer, feed, week strip, map, charts, strip); it has no `dl.facts`/`section.glance` and no `nav.groupbar`, unlike entity pages.
- Hierarchy by size: `h1` and `.hm-*` headings use clamp() sizes up to 3.8rem; hierarchy otherwise relies on size (37 distinct computed sizes across the measured pages, 35 declared in CSS, 6 of them clamp() values).

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home-home-1280 | 6.2 | 272 | 1224 | - | 19 | 4 | 8 | 6 | 36 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| home-home-390 | 9.9 | 240 | 1658 | - | 18 | 4 | 8 | 6 | 35 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| home-home-1280-dark | 6.2 | 272 | 1224 | - | 19 | 4 | 8 | 6 | 36 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |


**Redesign: how each principle was applied (Home, task H2)**

- Overview first: the band says what the site is, offers search and shows twelve routes with one live figure each before any table; the answer follows in two muted lines.
- Grouping: notable trades and the week's filings sit side by side as panels; the map has one control line (pane, window, view) and everything else under "More filters (n)" with Reset beside it.
- One meaning per attribute: accent is links and the current choice, green and red are bought and sold only, ink is data, muted is labels; rule tags are text.
- Data-ink: no card frames on the rail or the rows; the week's counts carry one thin bar each; the charts are one compact row.
- Hierarchy by contrast: only 12, 14, 16 and 24 px and weights 400 and 600; the h1 is 24 px; every panel title is 16 px.
- Consistency: panel head, caveat line, preview rows and "Show more / Show all" behave the same in notable trades, tiles and leaderboards.
- Progressive disclosure: notable rows 8 (6 on a phone), tiles 6 on a phone, leaderboards top 5, coverage and "About this list" folded, details in place under a chevron; nothing is removed, every hidden item is one click away.
- Numbers (1280 / 390): page height 11,114 to about 4,400 px and 19,080 to about 6,400 px (60 and 66 percent shorter); first screen at 1280 holds the title, search, 11 dataset tiles with sparklines and the answer; at 390 the title, search, 6 tiles and the answer.

### 3.2 Stock / company entity page

**Routes:** `/stocks/[ticker]/` (one per company with a ticker; other share classes 301 to it), `/companies/[slug]/` (companies without a ticker page), `/stocks/[...rest]`, `/companies/[...rest]` (on-demand, not measured)

**Templates and shared components:** `pages/stocks/[ticker].astro`, `pages/companies/[slug].astro`; `Crumbs`, `Follow`, `Answer`, `Glance`, `GroupBar`, `PageGroup`, `TradingView`, `Viz*`, `TxnTable`, `PlannedSales`, `LargeHolders`, `InstHolders`, `Financials`, `ExecutivePay`, `CompanyEvents`, `WashingtonRecords`, `LobbyContribFiler`, `Assistance`, `LearnMore`, `SourcePanel`, `AdSlot`

**Who lands here:** Investors and researchers who search a ticker or follow a link from the map, tape or a news item. Want: who inside the company and in Congress traded it, what else is on file (holders, planned sales, financials, lobbying).

**Blocks top to bottom** (example `stock-pltr-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| PLTR PALANTIR TECHNOLOGIES INC. | `div.title-row` | 293 | 62 | P |
| - | `dl.facts[data-entity-facts]` | 370 | 93 | P |
| - | `section.answer[data-answer][data-updated]` | 483 | 233 | P |
| - | `section.glance[data-glance]` | 733 | 235 | P |
| - | `section.datastrip` | 974 | 88 | P |
| - | `nav.groupbar[data-groupbar]` | 1072 | 52 | P |
| Share price | `div#trading.pgroup[data-pgroup]` | 1134 | 6857 | S |
| &nbsp;&nbsp;- | `p.pgroup-label` | 1134 | 20 | R |
| &nbsp;&nbsp;Share price | `section.tv[data-tv][data-symbol]` | 1194 | 888 | S |
| &nbsp;&nbsp;PLTR in charts | `section` | 2122 | 1139 | S |
| &nbsp;&nbsp;Insider buying and selling in PLTR: 3 and 12 mon | `section[data-entity-periods]` | 3301 | 703 | P |
| &nbsp;&nbsp;Insiders trading PLTR | `section[data-entity-insiders]` | 4044 | 348 | P |
| &nbsp;&nbsp;Members of Congress trading PLTR | `section[data-entity-members]` | 4432 | 256 | P |
| &nbsp;&nbsp;- | `p.dl-row[data-download]` | 4696 | 36 | S |
| &nbsp;&nbsp;- | `h2#insider-transactions` | 4772 | 31 | S |
| &nbsp;&nbsp;- | `div.tablewrap` | 4815 | 377 | P |
| &nbsp;&nbsp;- | `details.fnotes[data-fnotes]` | 5198 | 47 | R |
| &nbsp;&nbsp;- | `h2#congress-trades` | 5285 | 31 | S |
| &nbsp;&nbsp;- | `p.section-note[data-screener-link][data-n]` | 5323 | 42 | P |
| &nbsp;&nbsp;- | `div.tablewrap` | 5377 | 473 | P |
| &nbsp;&nbsp;Planned sales: Form 144 notices | `section[data-planned-sales][data-cik]` | 5890 | 2101 | P |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 8018 | 305 | R |
| Large holders: Schedules 13D and 13G | `div#ownership.pgroup[data-pgroup]` | 8351 | 3266 | S |
| &nbsp;&nbsp;- | `p.pgroup-label` | 8351 | 32 | R |
| &nbsp;&nbsp;Large holders: Schedules 13D and 13G | `section[data-large-holders][data-cik]` | 8424 | 1599 | P |
| &nbsp;&nbsp;Institutional holders: Form 13F | `section[data-inst-holders][data-cik]` | 10063 | 1554 | P |
| Financials, as filed | `div#company.pgroup[data-pgroup]` | 11640 | 3182 | S |
| &nbsp;&nbsp;- | `p.pgroup-label` | 11640 | 32 | R |
| &nbsp;&nbsp;Financials, as filed | `section[data-financials][data-cik]` | 11712 | 1862 | P |
| &nbsp;&nbsp;Executive pay, as filed | `section#executive-pay-section[data-executive-pay][data-cik]` | 13614 | 624 | P |
| &nbsp;&nbsp;Company events: Form 8-K reports | `section#company-events-section[data-company-events][data-cik]` | 14278 | 544 | P |
| Federal contracts (USAspending, awards started i | `div#washington.pgroup[data-pgroup]` | 14845 | 941 | S |
| &nbsp;&nbsp;- | `p.pgroup-label` | 14845 | 32 | R |
| &nbsp;&nbsp;- | `h2#contracts` | 14917 | 31 | S |
| &nbsp;&nbsp;- | `div.tablewrap` | 14960 | 107 | P |
| &nbsp;&nbsp;- | `h2#lobbying` | 15107 | 31 | S |
| &nbsp;&nbsp;- | `div.tablewrap` | 15149 | 89 | P |
| &nbsp;&nbsp;Contributions this company's lobbying filings re | `section[data-lobby-filer][data-items]` | 15278 | 508 | S |
| - | `aside.ad-slot.ad-low[data-ad-pos]` | 15813 | 305 | R |
| Related stocks | `div#record.pgroup[data-pgroup]` | 16146 | 1218 | R |
| &nbsp;&nbsp;- | `p.pgroup-label` | 16146 | 32 | R |
| &nbsp;&nbsp;Related stocks | `section[data-related]` | 16219 | 209 | R |
| &nbsp;&nbsp;Guides for this page | `section.learn-more[data-learn-more]` | 16467 | 376 | R |
| &nbsp;&nbsp;- | `h2#sources` | 16884 | 31 | R |
| &nbsp;&nbsp;- | `div.source-panel[data-sources]` | 16926 | 283 | R |
| &nbsp;&nbsp;- | `p` | 17225 | 140 | S |
| - | `p.disclaimer` | 17379 | 40 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 17459 | 25 | R |

**Measured faults:**

- Overview first: PLTR is 20.2 screens at 1280 and 27.8 at 390. The first table is at y=3436 (3.8 screens); the first figure is `span.glance-v` at y=748 (stock-pltr-1280.png).
- Related figures repeated: the same company figures appear in `dl.facts` (y=370, h=93), `section.glance` (y=733, h=235) and `section.datastrip` (y=974, h=88): three strips before the group bar at y=1072.
- Stacked sticky chrome: `header.site` 65px plus `nav.groupbar` 52px is 117px (stock-pltr-1280.png); at 390 the header is 57px.
- Long reference content not collapsed: `section[data-planned-sales]` 2101px, `section[data-large-holders]` 1599px, `section[data-inst-holders]` 1554px, `section[data-financials]` 1862px, `section.tv` 888px are open. Only 4 `details` on the page, all closed (`details.fnotes` among them).
- Boxes instead of whitespace: 49 bordered and 1 shadowed elements on PLTR; 20 distinct font sizes, 3 weights, 6 colours, 4 radii.
- Same type, different skeleton: abt (sparse, h1 y=161, no ad-top) has no `groupbar`; pltr has the groupbar and five `div.pgroup`. Same entity type renders 3.3 to 20.2 screens with a different block order (stock-abt-1280.png vs stock-pltr-1280.png).
- Tables: 19 on PLTR, 14 of 16 with numeric columns fully right-aligned; left-aligned numerics in `Company events: Form 8-K reports [Item]` and `Contributions this company's lobbying fi [Year]` (identifier columns). No table has a sticky header; 13 have a left-pinned first column at 390.
- Ad: `aside.ad-slot.ad-mid` is 305px tall at y=8018 between `#trading` and `#ownership`; `ad-low` is 305px at y=15813.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stock-pltr-1280 | 20.2 | 293 | 748 | 3436 | 20 | 3 | 6 | 4 | 49 | 1 | 0 | 0 | 19 | 14/16 | 0 (none) |
| stock-pltr-390 | 27.8 | 261 | 838 | 4880 | 21 | 3 | 6 | 4 | 49 | 1 | 0 | 0 | 19 | 14/16 | 0 (none) |
| stock-swap-1280 | 7.1 | 293 | 723 | 2509 | 17 | 3 | 6 | 5 | 16 | 1 | 0 | 0 | 4 | 4/4 | 0 (none) |
| stock-swap-390 | 9.1 | 261 | 838 | 2738 | 18 | 3 | 6 | 5 | 16 | 1 | 0 | 0 | 4 | 4/4 | 0 (none) |
| stock-abt-1280 | 3.3 | 161 | 485 | - | 11 | 3 | 5 | 3 | 9 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| stock-abt-390 | 4.2 | 118 | 520 | - | 11 | 3 | 6 | 3 | 9 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| company-sponsor-1280 | 5.5 | 293 | 640 | 1210 | 15 | 3 | 4 | 4 | 16 | 1 | 0 | 0 | 5 | 5/5 | 0 (none) |
| company-sponsor-390 | 7.8 | 289 | 851 | 1636 | 15 | 3 | 5 | 4 | 16 | 1 | 0 | 0 | 5 | 5/5 | 0 (none) |
| stock-pltr-1280-dark | 20.2 | 293 | 748 | 3436 | 20 | 3 | 6 | 4 | 49 | 1 | 0 | 0 | 19 | 14/16 | 0 (none) |

**Redesign: how each principle was applied (Stock and company, task E)**

- Overview first: crumbs, the identity line (h1 with Follow, Cite and Share), facts, the top ad, glance tiles and a plain answer paragraph come before any table; the group bar follows.
- Grouping: facts, tiles and the figure row read as one group; sections sit in Trading, Ownership, Company, Washington; reference blocks (sources, guides, related, questions) are closed `details` under "About this record".
- One meaning per attribute: accent is links and the current group, green and red are bought and sold only, ink is data, muted is labels; flags are text tags.
- Data-ink: no card frames or tile boxes; charts are small multiples without frames; each tile carries a 12-month sparkline from the dataset's own dates.
- Hierarchy by contrast: only 12, 14, 16 and 24 px and weights 400 and 600; the h1 is 24 px, section h2 is the one step below the page title.
- Consistency: one section header (h2, summary, caveat, CSV link on the heading line, table in its scroll box) on every page type.
- Progressive disclosure: caveats longer than two lines fold behind "Show more"; long tables keep the 12-row box with "Show all rows"; reference blocks start closed and remember their state.
- Numbers (screens = page height / 900 at 1280, / 844 at 390; first figure and first table y at 1280 / 390): stock PLTR: 20.2 to 14.6 screens at 1280, 27.8 to 19.8 at 390; first figure y 733 to 467 / 823 to 611; first table y 3436 to 3126 / 4880 to 4435. Company sponsor page: 5.5 to 4.5 and 7.8 to 6.1 screens.

### 3.3 Member of Congress page

**Routes:** `/congress/[slug]/`

**Templates and shared components:** `pages/congress/[slug].astro`; `Crumbs`, `Follow`, `Answer`, `Glance`, `GroupBar`, `PageGroup`, `VizPerson`, `TxnTable`, `MemberVotes`, `OutsideSpending`, `LobbyContrib`, `CampaignCommittee`, `ScreenerLink`, `SourcePanel`

**Who lands here:** Voters, journalists and investors who search a member name or reach the page from the map or a trade row. Want: what this member traded, how fast it was disclosed, committees, votes and donations.

**Blocks top to bottom** (example `member-elena-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| Elena Marsh | `div.title-row` | 293 | 61 | P |
| - | `p.lede` | 354 | 27 | S |
| - | `dl.facts[data-profile-facts]` | 395 | 44 | P |
| - | `section.answer[data-answer][data-updated]` | 459 | 149 | P |
| - | `section.glance[data-glance]` | 626 | 215 | P |
| - | `section.datastrip` | 847 | 88 | P |
| - | `nav.groupbar[data-groupbar]` | 945 | 52 | P |
| Most-traded stocks | `div#trading.pgroup[data-pgroup]` | 1006 | 3546 | S |
| &nbsp;&nbsp;- | `p.pgroup-label` | 1006 | 20 | R |
| &nbsp;&nbsp;Most-traded stocks | `section` | 1067 | 421 | S |
| &nbsp;&nbsp;Trading in charts | `section` | 1527 | 845 | S |
| &nbsp;&nbsp;Year by year, and whose trades | `section` | 2412 | 352 | S |
| &nbsp;&nbsp;How this record compares | `section[data-profile-compare]` | 2804 | 307 | S |
| &nbsp;&nbsp;- | `h2#trades` | 3151 | 31 | S |
| &nbsp;&nbsp;- | `p.dl-row[data-download]` | 3189 | 36 | S |
| &nbsp;&nbsp;- | `p.section-note[data-screener-link][data-n]` | 3231 | 42 | P |
| &nbsp;&nbsp;- | `div.tablewrap` | 3285 | 905 | P |
| &nbsp;&nbsp;- | `h2#filings` | 4229 | 31 | S |
| &nbsp;&nbsp;- | `div.tablewrap` | 4272 | 281 | P |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 4581 | 305 | R |
| Recorded votes | `div#washington.pgroup[data-pgroup]` | 4914 | 4792 | S |
| &nbsp;&nbsp;- | `p.pgroup-label` | 4914 | 32 | R |
| &nbsp;&nbsp;Recorded votes | `section[data-votes][data-yea]` | 4986 | 1456 | S |
| &nbsp;&nbsp;Committee assignments | `section[data-profile-committees]` | 6482 | 211 | S |
| &nbsp;&nbsp;Outside spending: independent expenditures | `section[data-outside-spending][data-counted]` | 6732 | 1646 | S |
| &nbsp;&nbsp;Campaign committee | `section[data-campaign][data-committees]` | 8419 | 572 | S |
| &nbsp;&nbsp;Lobbyist contributions | `section[data-lobby-contrib][data-items]` | 9031 | 675 | S |
| - | `aside.ad-slot.ad-low[data-ad-pos]` | 9734 | 305 | R |
| Related members | `div#record.pgroup[data-pgroup]` | 10067 | 1424 | R |
| &nbsp;&nbsp;- | `p.pgroup-label` | 10067 | 32 | R |
| &nbsp;&nbsp;Related members | `section[data-profile-related]` | 10139 | 187 | R |
| &nbsp;&nbsp;Questions about Elena Marsh's trades | `section[data-profile-qa]` | 10366 | 668 | S |
| &nbsp;&nbsp;- | `h2#sources` | 11074 | 31 | R |
| &nbsp;&nbsp;- | `div.source-panel[data-sources]` | 11117 | 139 | R |
| &nbsp;&nbsp;- | `p` | 11272 | 163 | S |
| &nbsp;&nbsp;- | `p.section-note` | 11449 | 42 | S |
| - | `p.disclaimer` | 11500 | 40 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 11580 | 25 | R |

**Measured faults:**

- Overview first: 13.7 screens at 1280 and 19.8 at 390 (member-elena-1280.png). First table at y=1159, ahead of the charts and the year-by-year block; 14 tables.
- Same skeleton: member-priya (no trades) renders 4.4 screens with the h1 at y=161 (no ad-top, no groupbar) while member-elena has h1 at y=293 (ad slot first). Same entity type, two block orders.
- Boxes: 31 bordered and 1 shadowed elements; 19 font sizes, 4 weights (member-elena-1280.png).
- Numerics: 12 of 14 tables have numeric columns, 10 fully right-aligned; `Year by year, and whose trades [Year]` and `Filings [Doc ID]` left-aligned (identifier columns). No sticky thead; 9 tables pin the first column at 390.
- Collapsed content: 1 `details` closed of 14 `h2`; filings list and committee seats are open.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| member-elena-1280 | 13.7 | 293 | 641 | 1159 | 19 | 4 | 6 | 4 | 31 | 1 | 0 | 0 | 14 | 10/12 | 0 (none) |
| member-elena-390 | 19.8 | 261 | 814 | 1652 | 19 | 4 | 6 | 4 | 31 | 1 | 0 | 0 | 14 | 10/12 | 0 (none) |
| member-priya-1280 | 4.4 | 161 | 504 | 1174 | 13 | 3 | 3 | 4 | 11 | 0 | 0 | 0 | 2 | 1/1 | 0 (none) |
| member-priya-390 | 6.2 | 118 | 594 | 1306 | 12 | 3 | 4 | 4 | 11 | 0 | 0 | 0 | 2 | 1/1 | 0 (none) |
| member-elena-1280-dark | 13.7 | 293 | 641 | 1159 | 19 | 4 | 6 | 4 | 31 | 1 | 0 | 0 | 14 | 10/12 | 0 (none) |

**Redesign: how each principle was applied (Member, task E)**

- Overview first: crumbs, the identity line (h1 with Follow, Cite and Share), facts, the top ad, glance tiles and a plain answer paragraph come before any table; the group bar follows.
- Grouping: facts, tiles and the figure row read as one group; sections sit in Trading, Ownership, Company, Washington; reference blocks (sources, guides, related, questions) are closed `details` under "About this record".
- One meaning per attribute: accent is links and the current group, green and red are bought and sold only, ink is data, muted is labels; flags are text tags.
- Data-ink: no card frames or tile boxes; charts are small multiples without frames; each tile carries a 12-month sparkline from the dataset's own dates.
- Hierarchy by contrast: only 12, 14, 16 and 24 px and weights 400 and 600; the h1 is 24 px, section h2 is the one step below the page title.
- Consistency: one section header (h2, summary, caveat, CSV link on the heading line, table in its scroll box) on every page type.
- Progressive disclosure: caveats longer than two lines fold behind "Show more"; long tables keep the 12-row box with "Show all rows"; reference blocks start closed and remember their state.
- Numbers (screens = page height / 900 at 1280, / 844 at 390; first figure and first table y at 1280 / 390): member Elena Marsh: 13.7 to 9.7 screens at 1280, 19.8 to 13.6 at 390; first figure y 626 to 396 / 799 to 533; first table y 1159 to 928 / 1652 to 1333.

### 3.4 Insider (Form 4 filer) page

**Routes:** `/insiders/[slug]/`, `/insiders/[...rest]` (on-demand, not measured)

**Templates and shared components:** `pages/insiders/[slug].astro`; `Crumbs`, `Follow`, `Answer`, `Glance`, `PageGroup`, `VizPerson`, `TxnTable`, `FiledNotices`, `ReportedHoldings`, `LearnMore`, `SourcePanel`

**Who lands here:** Investors who search an executive or fund name, or follow a trade row. Want: what this person bought and sold, their roles, holdings after, planned sales.

**Blocks top to bottom** (example `insider-karp-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| Karp Alexander C. | `div.title-row` | 293 | 61 | P |
| - | `p.lede` | 354 | 27 | S |
| - | `dl.facts[data-entity-facts]` | 395 | 44 | P |
| - | `section.answer[data-answer][data-updated]` | 459 | 175 | P |
| - | `p.section-note[data-insider-events][data-n]` | 650 | 21 | S |
| - | `section.glance[data-glance]` | 688 | 194 | P |
| - | `section.datastrip` | 888 | 88 | P |
| - | `nav.groupbar[data-groupbar]` | 986 | 52 | P |
| Trading in charts | `div#trading.pgroup[data-pgroup]` | 1048 | 2843 | S |
| &nbsp;&nbsp;- | `p.pgroup-label` | 1048 | 20 | R |
| &nbsp;&nbsp;Trading in charts | `section` | 1108 | 815 | S |
| &nbsp;&nbsp;What kind of transactions | `section` | 1963 | 239 | S |
| &nbsp;&nbsp;- | `h2#transactions` | 2242 | 31 | S |
| &nbsp;&nbsp;- | `p.dl-row[data-download]` | 2281 | 36 | S |
| &nbsp;&nbsp;- | `div.tablewrap` | 2329 | 185 | P |
| &nbsp;&nbsp;- | `details.fnotes[data-fnotes]` | 2520 | 47 | R |
| &nbsp;&nbsp;- | `h2#filings` | 2606 | 31 | S |
| &nbsp;&nbsp;- | `div.tablewrap` | 2649 | 185 | P |
| &nbsp;&nbsp;Planned sales: Form 144 notices this filer submi | `section[data-filed-notices][data-cik]` | 2874 | 1017 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 3919 | 305 | R |
| - | `aside.ad-slot.ad-low[data-ad-pos]` | 4252 | 305 | R |
| Other insiders at PALANTIR TECHNOLOGIES INC. | `div#record.pgroup[data-pgroup]` | 4585 | 848 | S |
| &nbsp;&nbsp;- | `p.pgroup-label` | 4585 | 32 | R |
| &nbsp;&nbsp;Other insiders at PALANTIR TECHNOLOGIES INC. | `section[data-related]` | 4657 | 105 | R |
| &nbsp;&nbsp;Guides for this page | `section.learn-more[data-learn-more]` | 4802 | 277 | R |
| &nbsp;&nbsp;- | `h2#sources` | 5119 | 31 | R |
| &nbsp;&nbsp;- | `div.source-panel[data-sources]` | 5161 | 139 | R |
| &nbsp;&nbsp;- | `p` | 5316 | 116 | S |
| - | `p.disclaimer` | 5447 | 40 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 5527 | 25 | R |

**Measured faults:**

- Overview first: 7.0 screens (karp), first table at y=2065 at 1280, y=2778 at 390 (insider-karp-390.png). First figure at y=703.
- Boxes: 25 bordered and 1 shadowed elements on karp; 16 font sizes, 3 weights, 5 colours, 4 radii.
- Numerics: 6 tables, 5 right-aligned; `What kind of transactions [Year]` left-aligned (insider-karp-1280.png). No sticky thead.
- Same skeleton: the page shares entity header blocks with stocks and members and has `nav.groupbar` (52px sticky, as on stocks); the fund example (4.6 screens, h1 y=293) differs from karp (7.0) in the blocks present.
- Ad `aside.ad-slot.ad-top` 115px above `h1` (h1 y=293).

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| insider-karp-1280 | 7 | 293 | 703 | 2065 | 16 | 3 | 5 | 4 | 25 | 1 | 0 | 0 | 6 | 5/6 | 0 (none) |
| insider-karp-390 | 9.8 | 261 | 846 | 2778 | 16 | 3 | 6 | 4 | 25 | 1 | 0 | 0 | 6 | 5/6 | 0 (none) |
| insider-fund-1280 | 4.6 | 293 | 641 | 1514 | 16 | 3 | 5 | 3 | 14 | 1 | 0 | 0 | 5 | 4/5 | 0 (none) |
| insider-fund-390 | 6.4 | 261 | 812 | 1841 | 16 | 3 | 6 | 3 | 14 | 1 | 0 | 0 | 5 | 4/5 | 0 (none) |

**Redesign: how each principle was applied (Insider, task E)**

- Overview first: crumbs, the identity line (h1 with Follow, Cite and Share), facts, the top ad, glance tiles and a plain answer paragraph come before any table; the group bar follows.
- Grouping: facts, tiles and the figure row read as one group; sections sit in Trading, Ownership, Company, Washington; reference blocks (sources, guides, related, questions) are closed `details` under "About this record".
- One meaning per attribute: accent is links and the current group, green and red are bought and sold only, ink is data, muted is labels; flags are text tags.
- Data-ink: no card frames or tile boxes; charts are small multiples without frames; each tile carries a 12-month sparkline from the dataset's own dates.
- Hierarchy by contrast: only 12, 14, 16 and 24 px and weights 400 and 600; the h1 is 24 px, section h2 is the one step below the page title.
- Consistency: one section header (h2, summary, caveat, CSV link on the heading line, table in its scroll box) on every page type.
- Progressive disclosure: caveats longer than two lines fold behind "Show more"; long tables keep the 12-row box with "Show all rows"; reference blocks start closed and remember their state.
- Numbers (screens = page height / 900 at 1280, / 844 at 390; first figure and first table y at 1280 / 390): insider Karp: 7.0 to 5.5 screens at 1280, 9.8 to 7.9 at 390; first figure y 688 to 396 / 831 to 605; first table y 2065 to 1744 / 2778 to 2537.

### 3.5 Committee page

**Routes:** `/congress-committees/[slug]/`

**Templates and shared components:** `pages/congress-committees/[slug].astro`; `Crumbs`, `Answer`, `TxnTable`

**Who lands here:** Researchers who follow a committee name from a member page. Want: members, and the stocks and trades of those members.

**Blocks top to bottom** (example `committee-houseag-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 27 | S |
| - | `dl.facts[data-committee-facts]` | 395 | 44 | P |
| - | `section.answer[data-answer][data-updated]` | 459 | 156 | P |
| - | `nav.jump` | 631 | 29 | S |
| Members | `section[data-committee-members]` | 700 | 262 | S |
| Most-traded stocks, last 12 months | `section[data-committee-stocks]` | 1002 | 469 | S |
| Trades disclosed by members | `section[data-committee-trades]` | 1511 | 2393 | S |
| Lobbyist contributions naming members | `section[data-committee-lobbycontrib][data-n]` | 3944 | 322 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 4294 | 305 | R |
| - | `h2#about` | 4639 | 31 | S |
| - | `p` | 4678 | 70 | S |
| - | `p` | 4762 | 93 | S |
| - | `p` | 4869 | 93 | S |
| Other House committees | `section` | 5002 | 68 | S |
| - | `p.disclaimer` | 5079 | 20 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 5139 | 25 | R |

**Measured faults:**

- Overview first: first table at y=793 at 1280, ahead of any figure (no `firstFigure` found; committee-houseag-1280.png). 6.5 screens for House Agriculture.
- Collapsed content: `Trades disclosed by members` (200 rows) is open; 1 closed `details`.
- Numerics: 3 of 4 numeric tables fully right-aligned.
- Boxes: 3 bordered elements, 12 font sizes, 5 text colours (committee-houseag-1280.png).

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| committee-houseag-1280 | 6.5 | 293 | - | 793 | 12 | 3 | 5 | 3 | 3 | 0 | 0 | 0 | 4 | 3/3 | 0 (none) |
| committee-houseag-390 | 8.5 | 289 | - | 1120 | 12 | 3 | 6 | 3 | 3 | 0 | 0 | 0 | 4 | 3/3 | 0 (none) |
| committee-senag-1280 | 3.1 | 293 | - | 767 | 11 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 2 | 2/2 | 0 (none) |
| committee-senag-390 | 4.7 | 310 | - | 1090 | 11 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 2 | 2/2 | 0 (none) |

**Redesign: how each principle was applied (Committee, task E)**

- Overview first: crumbs, the identity line (h1 with Follow, Cite and Share), facts, the top ad, glance tiles and a plain answer paragraph come before any table; the group bar follows.
- Grouping: facts, tiles and the figure row read as one group; sections sit in Trading, Ownership, Company, Washington; reference blocks (sources, guides, related, questions) are closed `details` under "About this record".
- One meaning per attribute: accent is links and the current group, green and red are bought and sold only, ink is data, muted is labels; flags are text tags.
- Data-ink: no card frames or tile boxes; charts are small multiples without frames; each tile carries a 12-month sparkline from the dataset's own dates.
- Hierarchy by contrast: only 12, 14, 16 and 24 px and weights 400 and 600; the h1 is 24 px, section h2 is the one step below the page title.
- Consistency: one section header (h2, summary, caveat, CSV link on the heading line, table in its scroll box) on every page type.
- Progressive disclosure: caveats longer than two lines fold behind "Show more"; long tables keep the 12-row box with "Show all rows"; reference blocks start closed and remember their state.
- Numbers (screens = page height / 900 at 1280, / 844 at 390; first figure and first table y at 1280 / 390): committee House Agriculture: 6.5 to 4.1 screens at 1280, 8.5 to 5.5 at 390; no figure strip; first table y 793 to 728 / 1120 to 1017.

### 3.6 Industry division page

**Routes:** `/industries/[slug]/`

**Templates and shared components:** `pages/industries/[slug].astro`

**Who lands here:** Researchers who follow the industry link on a company page. Want: companies of that SIC division with insider and Congress activity.

**Blocks top to bottom** (example `industry-manufacturing-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 27 | S |
| - | `dl.facts[data-industry-facts][data-built]` | 395 | 44 | P |
| - | `section.answer[data-answer][data-updated]` | 459 | 156 | P |
| - | `nav.jump` | 631 | 29 | S |
| Industry codes in this division | `section[data-industry-codes]` | 700 | 229 | S |
| Companies | `section[data-industry-companies]` | 969 | 350 | S |
| About this page | `div.prose` | 1347 | 776 | S |
| Other divisions | `section` | 2162 | 68 | S |
| - | `p.disclaimer` | 2239 | 20 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 2299 | 25 | R |

**Measured faults:**

- Overview first: no figure; first table at y=793 (industry-manufacturing-1280.png).
- Numerics: 2 tables, 1 fully right-aligned; `Industry codes in this division [Code↕]` has left-aligned numeric code column on both examples.
- Same skeleton as the lobbying-issue page except the block names; both are plain facts + tables with no groupbar.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| industry-manufacturing-1280 | 3.4 | 293 | - | 793 | 11 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 2 | 1/2 | 0 (none) |
| industry-manufacturing-390 | 5 | 289 | - | 1080 | 11 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 2 | 1/2 | 0 (none) |
| industry-services-1280 | 3.2 | 293 | - | 793 | 11 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 2 | 1/2 | 0 (none) |
| industry-services-390 | 4.8 | 289 | - | 1080 | 11 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 2 | 1/2 | 0 (none) |

**Redesign: how each principle was applied (Industry division, task E)**

- Overview first: crumbs, the identity line (h1 with Follow, Cite and Share), facts, the top ad, glance tiles and a plain answer paragraph come before any table; the group bar follows.
- Grouping: facts, tiles and the figure row read as one group; sections sit in Trading, Ownership, Company, Washington; reference blocks (sources, guides, related, questions) are closed `details` under "About this record".
- One meaning per attribute: accent is links and the current group, green and red are bought and sold only, ink is data, muted is labels; flags are text tags.
- Data-ink: no card frames or tile boxes; charts are small multiples without frames; each tile carries a 12-month sparkline from the dataset's own dates.
- Hierarchy by contrast: only 12, 14, 16 and 24 px and weights 400 and 600; the h1 is 24 px, section h2 is the one step below the page title.
- Consistency: one section header (h2, summary, caveat, CSV link on the heading line, table in its scroll box) on every page type.
- Progressive disclosure: caveats longer than two lines fold behind "Show more"; long tables keep the 12-row box with "Show all rows"; reference blocks start closed and remember their state.
- Numbers (screens = page height / 900 at 1280, / 844 at 390; first figure and first table y at 1280 / 390): industry Manufacturing: 3.4 to 2.8 screens at 1280, 5.0 to 3.9 at 390; no figure strip; first table y 793 to 772 / 1080 to 1041.

### 3.7 Lobbying issue page

**Routes:** `/lobbying-issues/[slug]/`

**Templates and shared components:** `pages/lobbying-issues/[slug].astro`

**Who lands here:** Researchers who follow an issue tag from a lobbying row. Want: the biggest clients and registrants for one issue.

**Blocks top to bottom** (example `lobbyissue-defense-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 27 | S |
| - | `dl.facts[data-issue-facts]` | 395 | 44 | P |
| - | `section.answer[data-answer][data-updated]` | 459 | 149 | P |
| - | `nav.jump` | 624 | 29 | S |
| Clients, 2026 | `section[data-issue-table]` | 693 | 229 | S |
| Registrants, 2026 | `section[data-issue-table]` | 962 | 229 | S |
| Newest filings that list Defense | `section[data-issue-filings]` | 1231 | 229 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 1489 | 305 | R |
| - | `h2#about` | 1834 | 31 | S |
| - | `p` | 1872 | 70 | S |
| - | `p` | 1957 | 116 | S |
| - | `p` | 2087 | 93 | S |
| Other issue areas | `section` | 2220 | 103 | S |
| - | `p.disclaimer` | 2331 | 20 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 2391 | 25 | R |

**Measured faults:**

- Overview first: no figure; first table at y=786 at 1280, y=933 at 390 (lobbyissue-defense-390.png).
- All 3 tables are fully right-aligned numeric; none has a sticky thead.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lobbyissue-defense-1280 | 3.5 | 293 | - | 786 | 11 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 3 | 3/3 | 0 (none) |
| lobbyissue-defense-390 | 4.9 | 261 | - | 933 | 11 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 3 | 3/3 | 0 (none) |
| lobbyissue-trade-1280 | 3.5 | 293 | - | 786 | 11 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 3 | 3/3 | 0 (none) |
| lobbyissue-trade-390 | 5.1 | 289 | - | 1016 | 11 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 3 | 3/3 | 0 (none) |

**Redesign: how each principle was applied (Lobbying issue, task E)**

- Overview first: crumbs, the identity line (h1 with Follow, Cite and Share), facts, the top ad, glance tiles and a plain answer paragraph come before any table; the group bar follows.
- Grouping: facts, tiles and the figure row read as one group; sections sit in Trading, Ownership, Company, Washington; reference blocks (sources, guides, related, questions) are closed `details` under "About this record".
- One meaning per attribute: accent is links and the current group, green and red are bought and sold only, ink is data, muted is labels; flags are text tags.
- Data-ink: no card frames or tile boxes; charts are small multiples without frames; each tile carries a 12-month sparkline from the dataset's own dates.
- Hierarchy by contrast: only 12, 14, 16 and 24 px and weights 400 and 600; the h1 is 24 px, section h2 is the one step below the page title.
- Consistency: one section header (h2, summary, caveat, CSV link on the heading line, table in its scroll box) on every page type.
- Progressive disclosure: caveats longer than two lines fold behind "Show more"; long tables keep the 12-row box with "Show all rows"; reference blocks start closed and remember their state.
- Numbers (screens = page height / 900 at 1280, / 844 at 390; first figure and first table y at 1280 / 390): issue Defense: 3.5 to 2.9 screens at 1280, 4.9 to 3.9 at 390; no figure strip; first table y 786 to 720 / 933 to 941.

### 3.8 Section landing pages

**Routes:** `/congress/`, `/insiders/`, `/stocks/`, `/washington/`, `/rates/`, `/markets/` (redirect), `/companies/`, `/congress-members/` is a screener (below)

**Templates and shared components:** `pages/congress/index.astro`, `pages/insiders/index.astro`, `pages/stocks/index.astro`, `pages/washington/index.astro`, `pages/rates/index.astro`, `pages/markets/index.astro`; `Heatmap`, `Viz*`, `TxnTable`, `SectionFaq`, `.card` links

**Who lands here:** Visitors browsing a topic from the nav. Want: the topic map plus the newest filings, and the way into datasets.

**Blocks top to bottom** (example `landing-congress-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 54 | S |
| - | `section.answer[data-answer][data-updated]` | 428 | 149 | P |
| - | `h2#heatmap.hm-h2` | 593 | 31 | P |
| Most traded | `section#hm-congress.heatmap[data-heatmap][data-kind]` | 632 | 926 | P |
| - | `nav.feeds` | 1582 | 34 | S |
| Congress trading in charts | `section` | 1656 | 1375 | S |
| - | `h2#newest` | 3072 | 31 | S |
| - | `p.dl-row[data-download]` | 3110 | 36 | S |
| - | `p.section-note[data-feed-link]` | 3152 | 21 | S |
| - | `div.tablewrap` | 3185 | 3257 | P |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 6469 | 305 | R |
| - | `h2#most-active` | 6814 | 31 | S |
| - | `div.tablewrap` | 6857 | 233 | P |
| - | `h2#late-filers` | 7130 | 31 | S |
| - | `div.tablewrap` | 7173 | 233 | P |
| - | `h2#most-traded` | 7445 | 31 | S |
| - | `div.tablewrap` | 7488 | 377 | P |
| - | `h2#members` | 7904 | 31 | S |
| - | `p` | 7943 | 93 | S |
| More views | `section.mini-charts` | 8076 | 655 | S |
| - | `h2` | 8772 | 31 | S |
| - | `p` | 8810 | 70 | S |
| - | `p.disclaimer` | 8895 | 20 | R |
| Common questions | `section.section-faq` | 8955 | 691 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 9686 | 25 | R |

**Measured faults:**

- Overview first: `/congress/` is 11.6 screens at 1280 and 15.7 at 390; first table at y=3185 (landing-congress-1280.png). `/insiders/` 9.6 screens, first table y=2646.
- Boxes/cards: `/washington/` has 7 `.card` and 36 bordered elements; `/rates/` has 4 `.card` (landing-washington-1280.png). Other types use 0.
- Colour sprawl: `/congress/` has 9 distinct text colours, 6 radii, 17 sizes; `/insiders/` 8 colours, 7 radii, 18 sizes.
- Same type, different skeleton: `/stocks/` has a table at y=648 with no map; `/rates/` has no table and no figure (landing-rates-1280.png).
- Collapsed content: `/insiders/` has 1 closed `details`; the FAQ block (`SectionFaq`) is open on all of them.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| landing-congress-1280 | 11.6 | 293 | 774 | 3185 | 17 | 3 | 9 | 6 | 34 | 0 | 0 | 0 | 4 | 3/3 | 0 (none) |
| landing-congress-390 | 15.7 | 261 | 769 | 4193 | 17 | 3 | 9 | 6 | 34 | 0 | 0 | 0 | 4 | 3/3 | 0 (none) |
| landing-insiders-1280 | 9.6 | 293 | 774 | 2646 | 18 | 3 | 8 | 7 | 33 | 0 | 0 | 0 | 7 | 7/7 | 0 (none) |
| landing-insiders-390 | 13.3 | 261 | 769 | 3552 | 18 | 3 | 8 | 7 | 33 | 0 | 0 | 0 | 7 | 7/7 | 0 (none) |
| landing-stocks-1280 | 4.2 | 293 | - | 648 | 10 | 3 | 4 | 2 | 8 | 0 | 0 | 0 | 2 | 2/2 | 0 (none) |
| landing-stocks-390 | 6 | 261 | - | 725 | 11 | 3 | 4 | 2 | 8 | 0 | 0 | 0 | 2 | 2/2 | 0 (none) |
| landing-washington-1280 | 4.3 | 293 | - | - | 15 | 3 | 4 | 2 | 36 | 0 | 7 | 0 | 0 | 0/0 | 0 (none) |
| landing-washington-390 | 7.8 | 261 | - | - | 14 | 3 | 4 | 2 | 36 | 0 | 7 | 0 | 0 | 0/0 | 0 (none) |


**Redesign: how each principle was applied (3.8 section landings)**

- Overview first: each landing opens with a figure row; the Common questions block is closed.
- Grouping: filters, count line, table and download controls sit in that order with one gap between groups; reference text is a closed block at the foot.
- One meaning per attribute: accent is only the active filter and links; green and red stay on bought and sold; ticker is 600 and the company name is muted wherever an entity row appears.
- Data-ink: borders removed between figure tiles and rows, no extra boxes; the two download buttons share one quiet outline style.
- Hierarchy by contrast: only 12, 14, 16 and 24px and weights 400 and 600; figures are 24px, labels 12px muted.
- Consistency: one HubFigures component, one `.ent` row format, one `details.ref` pattern on every page of this type.
- Progressive disclosure: method, coverage and "how to read" blocks are `<details data-remember>` closed by default, headings unchanged.
- Numbers: /congress/ 11.6 to 7.5 screens at 1280, 14.8 to 10.2 at 390; first figure y 774 to 544; first table y 3185 to 3129. /stocks/ 4.2 to 2.9 and 5.6 to 3.5; /washington/ 4.3 to 3.3 and 7.3 to 5.4. Route tiles with a live figure each were not built (skipped).

### 3.9 Rates and markets detail pages

**Routes:** `/rates/i-bonds/`, `/rates/tips/`, `/rates/treasury-yields/`, `/markets/largest-stock-exchanges/`

**Templates and shared components:** `pages/rates/*.astro`, `pages/markets/largest-stock-exchanges.astro`; `Viz`, `Answer`

**Who lands here:** Savers and fixed-income readers who search I-Bond rate, TIPS yields, yield curve. Want: the current number first, then history.

**Blocks top to bottom** (example `ratedetail-i-bonds-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `section.answer[data-answer][data-updated]` | 366 | 149 | P |
| - | `section.panel` | 531 | 168 | S |
| I-Bond rate history | `div.viz-grid` | 719 | 476 | P |
| - | `h2#next-reset` | 1235 | 31 | S |
| - | `section#reset.panel.reset` | 1274 | 266 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 1567 | 305 | R |
| - | `p.dl-row[data-download]` | 1900 | 36 | S |
| - | `h2` | 1976 | 31 | S |
| - | `p.lede` | 2015 | 27 | S |
| - | `section#calc.panel[data-rate]` | 2042 | 386 | S |
| - | `h2` | 2468 | 31 | S |
| - | `p` | 2507 | 70 | S |
| - | `p.panel` | 2591 | 89 | S |
| - | `p` | 2694 | 93 | S |
| - | `aside.ad-slot.ad-low[data-ad-pos]` | 2815 | 305 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 3160 | 25 | R |

**Measured faults:**

- Overview first holds here: first figure at y=552 to 631 (ratedetail-i-bonds-1280.png). Exchanges page: first table at y=2621 after two charts, 8.9 screens (ratedetail-exchanges-1280.png).
- Colour: treasury-yields and exchanges use 4 weights and up to 5 radii; chart series colours `--chart-1..4` against `--viz-*` (two greens: #15824B and #12876A).
- Numerics: all numeric tables fully right-aligned (4/4 on exchanges).

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ratedetail-i-bonds-1280 | 4.3 | 293 | 552 | - | 15 | 3 | 4 | 5 | 12 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| ratedetail-i-bonds-390 | 5.7 | 261 | 580 | - | 15 | 3 | 5 | 5 | 12 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| ratedetail-tips-1280 | 3.5 | 293 | 623 | 822 | 15 | 3 | 3 | 2 | 5 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| ratedetail-tips-390 | 4.5 | 261 | 693 | 927 | 14 | 3 | 4 | 2 | 5 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| ratedetail-treasury-yields-1280 | 5.3 | 293 | 631 | 1792 | 15 | 4 | 4 | 3 | 7 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| ratedetail-treasury-yields-390 | 6.1 | 261 | 677 | 1699 | 15 | 4 | 5 | 3 | 7 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| ratedetail-exchanges-1280 | 8.9 | 293 | - | 2621 | 14 | 4 | 3 | 3 | 10 | 0 | 0 | 0 | 4 | 4/4 | 0 (none) |
| ratedetail-exchanges-390 | 12.3 | 261 | - | 3439 | 14 | 4 | 4 | 3 | 10 | 0 | 0 | 0 | 4 | 4/4 | 0 (none) |


**Redesign: how each principle was applied (3.9 rates and markets pages)**

- Overview first: headline figures not added on rates pages (skipped); reference blocks on tips, treasury-yields and markets are closed.
- Grouping: filters, count line, table and download controls sit in that order with one gap between groups; reference text is a closed block at the foot.
- One meaning per attribute: accent is only the active filter and links; green and red stay on bought and sold; ticker is 600 and the company name is muted wherever an entity row appears.
- Data-ink: borders removed between figure tiles and rows, no extra boxes; the two download buttons share one quiet outline style.
- Hierarchy by contrast: only 12, 14, 16 and 24px and weights 400 and 600; figures are 24px, labels 12px muted.
- Consistency: one HubFigures component, one `.ent` row format, one `details.ref` pattern on every page of this type.
- Progressive disclosure: method, coverage and "how to read" blocks are `<details data-remember>` closed by default, headings unchanged.
- Numbers: treasury-yields page 5.3 to 4.7 screens at 1280, 5.7 to 4.9 at 390; first figure y 631 to 544; first table y 1792 to 1675. Markets 8.9 to 5.9 screens at 1280, 11.5 to 7.1 at 390.

### 3.10 Dataset hub (client-side filter)

**Routes:** `/company-events/`, `/executive-pay/`, `/institutional-holders/`, `/planned-sales/`, `/large-holders/`, `/congress-votes/`, `/outside-spending/`, `/grants/`, `/lobbyist-contributions/`

**Templates and shared components:** `pages/<name>.astro`, `pages/grants/index.astro`, `pages/lobbyist-contributions/index.astro`; `HubStyles`, `Answer`, `DownloadCsv`; data in `pages/data/*.json.ts`

**Who lands here:** Researchers looking up one dataset (all 8-K events, all planned sales). Want: filter by company or date and download.

**Blocks top to bottom** (example `hub-company-events-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 81 | S |
| - | `section.answer[data-answer][data-updated]` | 455 | 156 | P |
| - | `div.evhub[data-evhub][data-src]` | 627 | 471 | P |
| - | `h2#about` | 1137 | 31 | S |
| - | `p` | 1176 | 163 | S |
| - | `p` | 1353 | 93 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 1474 | 305 | R |
| - | `p.disclaimer` | 1807 | 40 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 1887 | 25 | R |

**Measured faults:**

- Overview first: controls and table come before any figure. First figure found on only 3 of 9 (grants y=657, lobbyist-contributions y=631, outside-spending y=665); the other 6 have the table first at y=744 to 937 (hub-planned-sales-1280.png).
- Same skeleton, different content: 9 hubs, 5 with one table, 4 with 2 to 5 (grants 5, lobbyist-contributions 5, outside-spending 3, institutional-holders 2 and 13.8 screens at 1280) (hub-institutional-holders-1280.png).
- Numerics: `hub-company-events` table has no numeric column; the rest are fully right-aligned. None has a sticky thead.
- Ad `ad-mid` 305px between table and the "About" text on each (hub-company-events-1280.png: y=1474).

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hub-company-events-1280 | 2.9 | 293 | - | 803 | 12 | 3 | 3 | 2 | 5 | 0 | 0 | 0 | 1 | 0/0 | 0 (none) |
| hub-company-events-390 | 4.4 | 261 | - | 975 | 11 | 3 | 4 | 2 | 5 | 0 | 0 | 0 | 1 | 0/0 | 0 (none) |
| hub-congress-votes-1280 | 3.1 | 293 | - | 744 | 12 | 3 | 3 | 2 | 5 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| hub-congress-votes-390 | 4.5 | 261 | - | 951 | 11 | 3 | 4 | 2 | 5 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| hub-executive-pay-1280 | 3.2 | 293 | - | 937 | 14 | 3 | 3 | 2 | 5 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| hub-executive-pay-390 | 4.8 | 261 | - | 1168 | 13 | 3 | 4 | 2 | 5 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| hub-grants-1280 | 8.2 | 293 | 657 | 998 | 13 | 3 | 3 | 2 | 4 | 0 | 0 | 0 | 5 | 5/5 | 0 (none) |
| hub-grants-390 | 11.9 | 261 | 710 | 1216 | 12 | 3 | 4 | 2 | 4 | 0 | 0 | 0 | 5 | 5/5 | 0 (none) |


**Redesign: how each principle was applied (3.10 dataset hubs)**

- Overview first: 3 to 5 headline figures sit above the filters on company-events, executive-pay, planned-sales, large-holders, institutional-holders and congress-votes.
- Grouping: filters, count line, table and download controls sit in that order with one gap between groups; reference text is a closed block at the foot.
- One meaning per attribute: accent is only the active filter and links; green and red stay on bought and sold; ticker is 600 and the company name is muted wherever an entity row appears.
- Data-ink: borders removed between figure tiles and rows, no extra boxes; the two download buttons share one quiet outline style.
- Hierarchy by contrast: only 12, 14, 16 and 24px and weights 400 and 600; figures are 24px, labels 12px muted.
- Consistency: one HubFigures component, one `.ent` row format, one `details.ref` pattern on every page of this type.
- Progressive disclosure: method, coverage and "how to read" blocks are `<details data-remember>` closed by default, headings unchanged.
- Numbers: company-events 2.9 to 2.5 screens at 1280, 4.1 to 3.4 at 390; first figure y none to 576 (665 at 390); first table y 803 to 708 (975 to 797).

### 3.11 Dataset page, server-rendered

**Routes:** `/lobbying/`, `/contracts/`, `/donations/`, `/disclosures/`

**Templates and shared components:** `pages/lobbying/index.astro`, `pages/contracts/index.astro`, `pages/donations/index.astro`, `pages/disclosures/index.astro`; `Viz*`, `IssueList`

**Who lands here:** Researchers who want the biggest lobbying, contract or donation records. Want: totals first, then the list.

**Blocks top to bottom** (example `serverhub-contracts-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 54 | S |
| - | `section.answer[data-answer][data-updated]` | 428 | 175 | P |
| Contract flow: agency to recipient | `div.viz-grid` | 623 | 572 | P |
| - | `h2` | 1234 | 31 | S |
| - | `div.tablewrap` | 1277 | 233 | P |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 1538 | 305 | R |
| - | `h2` | 1883 | 31 | S |
| - | `p.dl-row[data-download]` | 1922 | 36 | S |
| - | `div.tablewrap` | 1970 | 557 | P |
| - | `p.section-note[data-detail-note]` | 2532 | 126 | S |
| Awarding sub-agencies (awards started in the las | `section[data-sub-agencies][data-with]` | 2698 | 307 | P |
| Awards by industry code (awards started in the l | `section[data-naics-codes][data-with]` | 3045 | 521 | P |
| What this page shows | `div.prose` | 3606 | 341 | S |
| - | `h2` | 3987 | 31 | S |
| - | `p` | 4026 | 163 | S |
| - | `p.disclaimer` | 4203 | 20 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 4263 | 25 | R |

**Measured faults:**

- Overview first partly holds (charts before tables) but no figure: first table at y=1247 to 1406 (serverhub-lobbying-1280.png); disclosures puts its table at y=547 (7.9 screens).
- Numerics: contracts 3 of 4 fully right-aligned (`Awards by industry code [Code↕]`).
- Reference not collapsed: `section[data-naics-codes]` 521px and `section[data-sub-agencies]` 307px open on contracts.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| serverhub-contracts-1280 | 5.6 | 293 | - | 1277 | 13 | 3 | 3 | 2 | 5 | 0 | 0 | 0 | 4 | 3/4 | 0 (none) |
| serverhub-contracts-390 | 7.5 | 261 | - | 1322 | 13 | 3 | 4 | 2 | 5 | 0 | 0 | 0 | 4 | 3/4 | 0 (none) |
| serverhub-lobbying-1280 | 4.4 | 293 | - | 1406 | 12 | 3 | 3 | 2 | 5 | 0 | 0 | 0 | 3 | 3/3 | 0 (none) |
| serverhub-lobbying-390 | 6.1 | 261 | - | 1426 | 12 | 3 | 4 | 2 | 5 | 0 | 0 | 0 | 3 | 3/3 | 0 (none) |
| serverhub-donations-1280 | 4.5 | 293 | - | 1247 | 12 | 3 | 3 | 2 | 4 | 0 | 0 | 0 | 3 | 3/3 | 0 (none) |
| serverhub-donations-390 | 6.3 | 261 | - | 1174 | 12 | 3 | 4 | 2 | 4 | 0 | 0 | 0 | 3 | 3/3 | 0 (none) |
| serverhub-disclosures-1280 | 7.9 | 293 | - | 547 | 11 | 3 | 5 | 3 | 3 | 0 | 0 | 0 | 1 | 0/0 | 0 (none) |
| serverhub-disclosures-390 | 9.5 | 261 | - | 615 | 11 | 3 | 5 | 3 | 3 | 0 | 0 | 0 | 1 | 0/0 | 0 (none) |


**Redesign: how each principle was applied (3.11 server-rendered dataset pages)**

- Overview first: lobbying, contracts, donations and disclosures open with a figure row.
- Grouping: filters, count line, table and download controls sit in that order with one gap between groups; reference text is a closed block at the foot.
- One meaning per attribute: accent is only the active filter and links; green and red stay on bought and sold; ticker is 600 and the company name is muted wherever an entity row appears.
- Data-ink: borders removed between figure tiles and rows, no extra boxes; the two download buttons share one quiet outline style.
- Hierarchy by contrast: only 12, 14, 16 and 24px and weights 400 and 600; figures are 24px, labels 12px muted.
- Consistency: one HubFigures component, one `.ent` row format, one `details.ref` pattern on every page of this type.
- Progressive disclosure: method, coverage and "how to read" blocks are `<details data-remember>` closed by default, headings unchanged.
- Numbers: lobbying 4.4 to 3.7 screens at 1280, 5.8 to 4.7 at 390; first figure y none to 520; first table y 1406 to 1345. Contracts 5.6 to 4.8 and 7.0 to 5.8; figure y 592.

### 3.12 Screener / directory

**Routes:** `/congress-trades/`, `/congress-members/`, `/company-financials/`

**Templates and shared components:** `pages/congress-trades.astro`, `pages/congress-members.astro`, `pages/company-financials.astro`

**Who lands here:** Analysts who filter rows (by party, side, revenue). Want: set filters, sort, download.

**Blocks top to bottom** (example `screener-congress-trades-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 81 | S |
| - | `section.answer[data-answer][data-updated]` | 455 | 156 | P |
| - | `div.screener[data-screener][data-src]` | 627 | 2794 | P |
| - | `h2#about` | 3461 | 31 | S |
| - | `p` | 3500 | 116 | S |
| - | `p` | 3630 | 279 | S |
| - | `p#saved` | 3924 | 163 | S |
| - | `p#ticker-history` | 4101 | 209 | S |
| - | `p` | 4325 | 163 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 4515 | 305 | R |
| - | `p.disclaimer` | 4848 | 20 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 4908 | 25 | R |

**Measured faults:**

- Overview first: no figure; table at y=711 to 930 (screener-congress-members-1280.png).
- Colour: congress-trades uses 5 text colours, 3 radii (side, late flags) against 3 on the others (screener-congress-trades-1280.png).
- Numerics: congress-trades table has no right-aligned numeric column (0/0 numeric detected: amounts are text ranges).

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| screener-congress-trades-1280 | 6.3 | 293 | - | 930 | 13 | 3 | 5 | 3 | 6 | 0 | 0 | 0 | 1 | 0/0 | 0 (none) |
| screener-congress-trades-390 | 8.6 | 261 | - | 1101 | 12 | 3 | 6 | 3 | 6 | 0 | 0 | 0 | 1 | 0/0 | 0 (none) |
| screener-congress-members-1280 | 3 | 293 | - | 711 | 12 | 3 | 3 | 2 | 4 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| screener-congress-members-390 | 4.4 | 261 | - | 865 | 11 | 3 | 4 | 2 | 4 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| screener-company-financials-1280 | 4.3 | 293 | - | 891 | 12 | 3 | 3 | 2 | 5 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| screener-company-financials-390 | 6.8 | 261 | - | 1069 | 11 | 3 | 4 | 2 | 5 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |


**Redesign: how each principle was applied (3.12 screeners and directories)**

- Overview first: congress-trades, company-financials and congress-members open with a figure row before any control.
- Grouping: filters, count line, table and download controls sit in that order with one gap between groups; reference text is a closed block at the foot.
- One meaning per attribute: accent is only the active filter and links; green and red stay on bought and sold; ticker is 600 and the company name is muted wherever an entity row appears.
- Data-ink: borders removed between figure tiles and rows, no extra boxes; the two download buttons share one quiet outline style.
- Hierarchy by contrast: only 12, 14, 16 and 24px and weights 400 and 600; figures are 24px, labels 12px muted.
- Consistency: one HubFigures component, one `.ent` row format, one `details.ref` pattern on every page of this type.
- Progressive disclosure: method, coverage and "how to read" blocks are `<details data-remember>` closed by default, headings unchanged.
- Numbers: congress-trades 6.3 to 4.6 screens at 1280, 8.1 to 5.4 at 390; first figure y none to 576; first table y 930 to 844. company-financials 4.3 to 2.6 and 6.4 to 3.4.

### 3.13 List pages (committees, industries, lobbying issues)

**Routes:** `/congress-committees/`, `/industries/`, `/lobbying-issues/`

**Templates and shared components:** `pages/congress-committees/index.astro`, `pages/industries/index.astro`, `pages/lobbying-issues/index.astro`

**Who lands here:** Visitors who want to pick a committee, industry or issue.

**Blocks top to bottom** (example `list-congress-committees-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 54 | S |
| - | `section.answer[data-answer][data-updated]` | 428 | 156 | P |
| All committees | `section[data-committees]` | 624 | 325 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 977 | 305 | R |
| - | `h2#about` | 1322 | 31 | S |
| - | `p` | 1361 | 93 | S |
| - | `p` | 1468 | 93 | S |
| - | `p` | 1576 | 116 | S |
| - | `p.disclaimer` | 1706 | 20 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 1766 | 25 | R |

**Measured faults:**

- One sortable table each, fully right-aligned numeric, no figure first (first table y=662 to 746).
- 2 to 3 screens at 1280: the shortest data pages.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| list-congress-committees-1280 | 2.8 | 293 | - | 716 | 11 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| list-congress-committees-390 | 4 | 261 | - | 785 | 11 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| list-industries-1280 | 2.8 | 293 | - | 746 | 11 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| list-industries-390 | 4.2 | 261 | - | 879 | 11 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| list-lobbying-issues-1280 | 2.9 | 293 | - | 662 | 11 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| list-lobbying-issues-390 | 4.1 | 261 | - | 724 | 11 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |


**Redesign: how each principle was applied (3.13 list pages)**

- Overview first: committees, industries and lobbying-issues index pages open with a figure row.
- Grouping: filters, count line, table and download controls sit in that order with one gap between groups; reference text is a closed block at the foot.
- One meaning per attribute: accent is only the active filter and links; green and red stay on bought and sold; ticker is 600 and the company name is muted wherever an entity row appears.
- Data-ink: borders removed between figure tiles and rows, no extra boxes; the two download buttons share one quiet outline style.
- Hierarchy by contrast: only 12, 14, 16 and 24px and weights 400 and 600; figures are 24px, labels 12px muted.
- Consistency: one HubFigures component, one `.ent` row format, one `details.ref` pattern on every page of this type.
- Progressive disclosure: method, coverage and "how to read" blocks are `<details data-remember>` closed by default, headings unchanged.
- Numbers: industries 2.8 to 2.3 screens at 1280, 3.9 to 2.9 at 390; first figure y none to 552; first table y 746 to 748.

### 3.14 Guides hub and FAQ

**Routes:** `/guides/`, `/faq/`

**Templates and shared components:** `pages/guides/index.astro`, `pages/faq.astro`; `SectionFaq`

**Who lands here:** Beginners who search "what is a PTR". Want: a short answer and the guide to read.

**Blocks top to bottom** (example `guidehub-guides-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 27 | S |
| - | `section.answer[data-answer][data-updated]` | 401 | 175 | P |
| - | `nav.feeds` | 592 | 34 | S |
| Congress trades | `section.guide-group` | 666 | 468 | S |
| Insider trades | `section.guide-group` | 1174 | 668 | S |
| Washington money | `section.guide-group` | 1881 | 287 | S |
| Rates | `section.guide-group` | 2208 | 244 | S |
| Using this site | `section.guide-group` | 2492 | 264 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 2784 | 305 | R |
| - | `p.disclaimer` | 3117 | 40 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 3197 | 25 | R |

**Measured faults:**

- Long reference not collapsed: `/faq/` is 18.1 screens at 1280 and 30.2 at 390, one `div.prose` of 14,492px, 70 questions all open (guidehub-faq-1280.png).
- Overflow: `/faq/` overflows 19px at 390 from `a.faq-more` (white-space: nowrap) (guidehub-faq-390.png). The only horizontal overflow found sitewide.
- 125 bordered elements on `/faq/`.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| guidehub-guides-1280 | 4.4 | 293 | - | - | 10 | 3 | 3 | 2 | 28 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| guidehub-guides-390 | 8.5 | 261 | - | - | 9 | 3 | 4 | 2 | 28 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| guidehub-faq-1280 | 18.1 | 293 | - | - | 9 | 3 | 4 | 2 | 125 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| guidehub-faq-390 | 30.2 | 261 | - | - | 9 | 3 | 4 | 2 | 125 | 0 | 0 | 19 ({'s': 'a.faq-more', 'right': 409, 'w': 393}) | 0 | 0/0 | 0 (none) |



**Redesign: how each principle was applied** (Guides hub and FAQ, 2026-11-23)
- overview first: Answer block and group chips first; each FAQ group is a heading with its questions under it.
- grouping: Questions sit under the existing group headings; the group chips jump to them.
- one meaning per attribute: Plus/minus marks only the disclosure; links are accent, nothing else uses accent.
- data-ink: Hairlines between questions, no boxes; every row is a question.
- hierarchy by contrast: Questions are 14px semibold summaries, answers regular 16px.
- consistency: Same `details` pattern as the methodology and the guides' own Q&A; `a.faq-more` now wraps.
- progressive disclosure: 70 answers closed behind their questions; `data-remember` and the address hash open one.
- before/after: /faq/ 18.1 screens at 1280 and 30.2 at 390 before; 8.1 and 10.7 after (14,492px prose block to 7,306px page); no table on the page.

### 3.15 Guide page

**Routes:** `/guides/[slug]/`

**Templates and shared components:** `pages/guides/[slug].astro`; `lib/guides/*`

**Who lands here:** Beginners reading one explainer. Want: the answer, then detail on demand.

**Blocks top to bottom** (example `guide-tips-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| TIPS, real yields and breakeven inflation | `article.guide` | 293 | 3023 | S |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 3357 | 25 | R |

**Measured faults:**

- Long reference not collapsed: what-is-form-4 is 10.9 screens at 1280 and 18.7 at 390, a single `article.guide` of 8,713px with 13 `h2` all open (guide-what-is-form-4-1280.png).
- Ad `article` slot inside a reading column.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| guide-tips-1280 | 4.6 | 293 | - | - | 10 | 3 | 3 | 2 | 8 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| guide-tips-390 | 6.7 | 289 | - | - | 11 | 3 | 4 | 2 | 8 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| guide-what-is-form-4-1280 | 10.9 | 293 | - | - | 10 | 3 | 3 | 2 | 12 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| guide-what-is-form-4-390 | 18.7 | 261 | - | - | 11 | 3 | 4 | 2 | 12 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |



**Redesign: how each principle was applied** (Guide page, 2026-11-23)
- overview first: Title, answer, In brief, then a contents list (sticky at 1280, closed disclosure at 390).
- grouping: Sections, questions, sources, related guides are separate h2 groups listed in the contents.
- one meaning per attribute: Accent is link only; the contents list uses ink.
- data-ink: No extra frames; the list has one hairline.
- hierarchy by contrast: One 68ch column, h2 semibold, body regular.
- consistency: Same `Toc` and `prose-grid` as methodology, legal and corrections pages.
- progressive disclosure: Guide questions are closed `details`; contents closed on a phone.
- before/after: what-is-form-4: 10.9 screens at 1280 and 18.7 at 390 before; 6.9 and 10.5 after; no table before the first section.

### 3.16 Writing hub

**Routes:** `/writing/`

**Templates and shared components:** `pages/writing/index.astro`

**Who lands here:** Readers of articles. Want the newest titles.

**Blocks top to bottom** (example `writinghub-writing-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 54 | S |
| - | `section.answer[data-answer][data-updated]` | 428 | 149 | P |
| - | `ul.guide-cards.writing-cards` | 596 | 229 | S |
| - | `aside.ad-slot.ad-mid[data-ad-pos]` | 853 | 305 | R |
| - | `p.disclaimer` | 1186 | 40 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 1266 | 25 | R |

**Measured faults:**

- 2.2 screens at 1280; 6 bordered elements; no figure or table.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| writinghub-writing-1280 | 2.2 | 293 | - | - | 8 | 3 | 3 | 2 | 6 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| writinghub-writing-390 | 3.5 | 261 | - | - | 7 | 3 | 4 | 2 | 6 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |



**Redesign: how each principle was applied** (Writing hub, 2026-11-23)
- overview first: Empty state or list of article cards, newest first.
- grouping: One card per article with title, deck, author and read time.
- one meaning per attribute: Tag chips only for Draft.
- data-ink: Cards are hairline rows in the same grid as guide cards.
- hierarchy by contrast: Title semibold, deck regular, meta in ink-2.
- consistency: `guide-cards` grid shared with the guides hub, `minmax(280px,1fr)`.
- progressive disclosure: Nothing hidden.
- before/after: No change in height beyond the shared grid (empty hub in this build).

### 3.17 Article

**Routes:** `/writing/[slug]/`

**Templates and shared components:** `pages/writing/[slug].astro`; `writing.css`

**Who lands here:** Readers arriving from search or social.

**Blocks top to bottom** (example `article-late-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| How Late Do House Members Report Stock Trades? | `article.article` | 293 | 3444 | S |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 3778 | 25 | R |

**Measured faults:**

- 5.0 screens at 1280, 7.8 at 390; `How quickly were House trades reported i [Trades|Share]` table has left-aligned numeric columns (article-late-1280.png).

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| article-late-1280 | 5 | 293 | - | 1145 | 12 | 4 | 3 | 2 | 10 | 0 | 0 | 0 | 1 | 0/1 | 0 (none) |
| article-late-390 | 7.8 | 289 | - | 1576 | 11 | 4 | 4 | 2 | 10 | 0 | 0 | 0 | 1 | 0/1 | 0 (none) |



**Redesign: how each principle was applied** (Article, 2026-11-23)
- overview first: Title, deck, byline, summary, then the body at 68ch.
- grouping: Body, questions, tags, author box, more writing are separate blocks.
- one meaning per attribute: Numeric table columns right-aligned with tabular figures; links accent.
- data-ink: The author box has one top hairline only.
- hierarchy by contrast: h2 semibold with 32px above; byline in ink-2.
- consistency: Questions use the shared `details.faq-item`.
- progressive disclosure: Article questions closed.
- before/after: Late-trades article: 4.5 screens at 1280 and 7.2 at 390 after (5.0 and 7.8 before); first table y 819 at 1280.

### 3.18 Author page

**Routes:** `/writing/authors/[slug]/`

**Templates and shared components:** `pages/writing/authors/[slug].astro`

**Who lands here:** Readers who click a byline.

**Blocks top to bottom** (example `author-stm-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 81 | S |
| - | `p.author-links` | 444 | 22 | S |
| - | `section.answer[data-answer][data-updated]` | 487 | 124 | P |
| - | `h2` | 650 | 31 | S |
| - | `ul.guide-cards.writing-cards` | 700 | 209 | S |
| - | `p.disclaimer` | 926 | 40 | R |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 1006 | 25 | R |

**Measured faults:**

- 2.0 screens at 1280; 6 bordered elements; one `h2`.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| author-stm-1280 | 2 | 293 | - | - | 10 | 3 | 3 | 2 | 6 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| author-stm-390 | 3.2 | 261 | - | - | 9 | 3 | 4 | 2 | 6 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |



**Redesign: how each principle was applied** (Author page, 2026-11-23)
- overview first: Name, bio and links in the title block, then the list of articles.
- grouping: Articles are the one list.
- one meaning per attribute: Accent only on links.
- data-ink: No boxes.
- hierarchy by contrast: Name is the h1.
- consistency: Cards as on the writing hub.
- progressive disclosure: None needed.
- before/after: Unchanged height; only the shared card grid applies.

### 3.19 Reference and static pages

**Routes:** `/methodology/`, `/about/`, `/contact/`, `/corrections/`, `/privacy/`, `/terms/`, `/developers/`, `/downloads/`, `/feeds/`, `/404`

**Templates and shared components:** `pages/methodology.astro`, `about`, `contact`, `corrections`, `privacy`, `terms`, `developers`, `downloads/index`, `feeds/index`, `404`

**Who lands here:** Researchers checking method, licensing or file formats; legal visitors.

**Blocks top to bottom** (example `reference-methodology-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `aside.ad-slot.ad-top[data-ad-pos]` | 120 | 115 | R |
| - | `nav.crumbs` | 255 | 21 | R |
| - | `h1` | 293 | 53 | P |
| - | `p.lede` | 354 | 54 | S |
| - | `section.answer[data-answer][data-updated]` | 428 | 175 | P |
| - | `h2#sources` | 643 | 31 | R |
| - | `p` | 681 | 47 | S |
| - | `ul` | 743 | 465 | S |
| - | `h2#publishing-bar` | 1248 | 31 | S |
| - | `p` | 1287 | 116 | S |
| - | `h2#lag` | 1443 | 31 | S |
| - | `p` | 1482 | 116 | S |
| - | `h2#values` | 1638 | 31 | S |
| - | `p` | 1677 | 372 | S |
| - | `h2#notable` | 2089 | 31 | P |
| - | `p` | 2128 | 140 | S |
| - | `ul` | 2282 | 256 | S |
| - | `p` | 2553 | 163 | S |
| - | `h2#flags` | 2756 | 31 | S |
| - | `ul` | 2801 | 116 | S |
| - | `h2#matching` | 2958 | 31 | S |
| - | `p` | 2997 | 209 | S |
| - | `p` | 3220 | 116 | S |
| - | `p#one-page` | 3351 | 349 | S |
| - | `p#ticker-owners` | 3714 | 302 | S |
| - | `p#related-pages` | 4031 | 186 | R |
| - | `p#industry` | 4231 | 186 | S |
| - | `p#industries` | 4431 | 256 | S |
| - | `p#holdings` | 4702 | 233 | S |
| - | `p#insider-summary` | 4949 | 256 | S |
| - | `p#form-144` | 5219 | 698 | S |
| - | `p#schedule-13` | 5931 | 791 | S |
| - | `p#form-144` | 6735 | 558 | S |
| - | `p#schedule-13` | 7308 | 674 | S |
| - | `p#assistance` | 7996 | 302 | S |
| - | `p#lobbyist-contributions` | 8313 | 488 | S |
| - | `p#financials` | 8816 | 1302 | S |
| - | `p#institutional-holders` | 10132 | 581 | S |
| - | `p#financials-screener` | 10728 | 791 | P |
| - | `p#company-events` | 11533 | 419 | S |
| - | `p#executive-pay` | 11966 | 395 | S |
| - | `p#footnotes` | 12375 | 256 | S |
| - | `p#downloads` | 12645 | 186 | S |
| - | `p#week-in-filings` | 12846 | 233 | S |
| - | `p#feeds` | 13093 | 209 | S |
| - | `p#votes` | 13317 | 395 | S |
| - | `p#campaign-committee` | 13726 | 349 | S |
| - | `p#outside-spending` | 14090 | 419 | S |
| - | `p#member-pages` | 14523 | 186 | S |
| - | `p#member-directory` | 14723 | 140 | S |
| - | `p#congress-screener` | 14877 | 535 | P |
| - | `p#ticker-history` | 15426 | 372 | S |
| - | `p#committees` | 15813 | 279 | S |
| - | `p#lobbying-issues` | 16106 | 209 | S |
| - | `h2#social` | 16355 | 31 | S |
| - | `p` | 16394 | 70 | S |
| - | `h2#never` | 16504 | 31 | S |
| - | `p` | 16543 | 93 | S |
| - | `h2#corrections` | 16676 | 31 | S |
| - | `p` | 16714 | 23 | S |
| - | `h2#coverage` | 16778 | 31 | S |
| - | `p` | 16816 | 47 | S |
| - | `ul` | 16878 | 395 | S |
| - | `div.table-wrap` | 17288 | 259 | S |
| - | `h2#status` | 17587 | 31 | S |
| - | `p.mono.small` | 17626 | 40 | S |
| - | `aside.ad-slot.ad-multiplex[data-ad-pos]` | 17706 | 25 | R |

**Measured faults:**

- Long reference not collapsed: methodology is 20.5 screens at 1280 and 41.1 at 390; its first table is at y=17288 (reference-methodology-1280.png). 12 `h2`, 0 `details`.
- `/downloads/` has 21 tables and 20 `details`, 4154 y to the first table; 53 bordered elements (reference-downloads-1280.png). `/developers/` is 9.8 screens at 1280 and 18.5 at 390 with 51 bordered elements.
- Same skeleton: contact, privacy and terms start at y=161 (no ad-top, `ads={false}`), the others at y=293.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference-methodology-1280 | 20.5 | 293 | - | 17288 | 11 | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| reference-methodology-390 | 41.1 | 261 | - | 33028 | 11 | 3 | 4 | 3 | 3 | 0 | 0 | 0 | 1 | 1/1 | 0 (none) |
| reference-about-1280 | 3.1 | 293 | - | - | 8 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| reference-about-390 | 4.7 | 261 | - | - | 8 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| reference-contact-1280 | 2.3 | 161 | - | - | 7 | 3 | 3 | 2 | 3 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| reference-contact-390 | 3.6 | 118 | - | - | 7 | 3 | 4 | 2 | 3 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| reference-corrections-1280 | 2.4 | 293 | - | - | 9 | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| reference-corrections-390 | 3.5 | 261 | - | - | 8 | 3 | 4 | 3 | 3 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |



**Redesign: how each principle was applied** (Reference and static pages, 2026-11-23)
- overview first: Answer block, then a contents list; methodology opens with the first two sections only.
- grouping: Methodology sections are one disclosure each; legal pages are plain h2 sections; downloads and developers keep their jump pills.
- one meaning per attribute: Plus/minus is the only marker; accent is link only.
- data-ink: Legal pages are body text only, no boxes.
- hierarchy by contrast: h2 semibold, 68ch text, sticky contents at 1024px and up.
- consistency: One `ProseBody`/`Toc` pair builds the contents from the page's own h2s on methodology, privacy, terms, about, contact and corrections; headings with no id (corrections) get one from their text.
- progressive disclosure: 10 of 12 methodology sections closed, remembered per visit; a link to any id inside a closed section (there are about 35 paragraph anchors in 'matching') opens it (`openToHash` in ui.ts).
- before/after: methodology 20.5 screens at 1280 and 41.1 at 390 before; 3.6 and 5.4 after. privacy 7.5 and 12.1, terms 5.3 and 7.9, developers 6.7 and 11.9 (9.8 and 18.5 before). The methodology table is inside the 'coverage' disclosure.

### 3.20 Account (watchlist, shared watchlist)

**Routes:** `/watchlist/`, `/watchlist/shared/`; also `/alerts/unsubscribe` (not measured)

**Templates and shared components:** `pages/watchlist/index.astro`, `pages/watchlist/shared/index.astro`; `scripts/watchlist.ts`

**Who lands here:** Signed-in visitors with followed pages.

**Blocks top to bottom** (example `account-watchlist-1280`; y and h in px at 1280; P/S/R is my judgment from the rendered block and the likely visitor intent, not a measurement.):

| name | selector | y@1280 | h | P/S/R |
|---|---|---|---|---|
| - | `nav.crumbs` | 122 | 21 | R |
| - | `h1` | 161 | 53 | P |
| - | `div[data-watchlist][data-alerts]` | 222 | 205 | S |

**Measured faults:**

- Measured signed out, so only the empty shell (1.3 screens); the rows rendered by `watchcards.ts` are not measured.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| account-watchlist-1280 | 1.3 | 161 | - | - | 4 | 3 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| account-watchlist-390 | 2 | 118 | - | - | 4 | 3 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| account-shared-1280 | 1.1 | 161 | - | - | 3 | 2 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| account-shared-390 | 1.7 | 118 | - | - | 3 | 2 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |



**Redesign: how each principle was applied** (Account (watchlist, shared watchlist), 2026-11-23)
- overview first: Sign-in prompt or the lists, nothing else on the page.
- grouping: One body, filled by script.
- one meaning per attribute: Accent for the sign-in button only.
- data-ink: No new frames.
- hierarchy by contrast: h1 then lede.
- consistency: Page width limited to 68ch on a phone and tablet, full width from 1024px.
- progressive disclosure: Rows are filled by the script; unchanged.
- before/after: Unchanged (script-filled; not signed in here).

### 3.21 Embeds

**Routes:** `/embed/congress/[slug]/`, `/embed/stocks/[ticker]/`

**Templates and shared components:** `pages/embed/*`; `EmbedLayout`

**Who lands here:** Third-party sites embedding one chart.

**Blocks:** `EmbedLayout` wraps one `Viz` chart with a link to the full page; no header, nav, ads or analytics (see CLAUDE.md, Charts 2026-10-04).

**Measured faults:**

- Measured document height only (1 screen); computed-style counts returned 0 because the measurer scopes to `main`, which embeds do not have.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| embed-congress-1280 | 1 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| embed-congress-390 | 1 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| embed-stock-1280 | 1 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| embed-stock-390 | 1 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |



**Redesign: how each principle was applied** (Embeds, 2026-11-23)
- overview first: The chart alone with a source line.
- grouping: One chart and one footer.
- one meaning per attribute: Tokens only.
- data-ink: No chrome added.
- hierarchy by contrast: Footer in ink-2 12px.
- consistency: Uses the same tokens as the site via global.css.
- progressive disclosure: None.
- before/after: Unchanged.

### 3.22 Search dialog (layout)

**Routes:** in `BaseLayout.astro` (`#searchDlg`), index `/data/search.json`

**Templates and shared components:** `layouts/BaseLayout.astro`; `scripts/ui.ts`

**Who lands here:** Anyone, with `/` or Ctrl+K.

**Blocks:** `#searchDlg` dialog: input, result list grouped by kind (Congress first), keyboard hint; opened from `.search-pill`, `/` or Ctrl+K (shots/before/search-*).

**Measured faults:**

- Screenshots in shots/before/search-*; not scored separately.

**Measured numbers:**

| page (width) | screens | h1 y | first figure y | first table y | font sizes | weights | text colours | radii | bordered | shadowed | .card | overflow px | tables | numeric tables all right/with numeric | sticky thead |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| search-home-1280 | 6.2 | 272 | 1224 | - | 19 | 4 | 8 | 6 | 36 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |
| search-home-390 | 9.9 | 240 | 1658 | - | 18 | 4 | 8 | 6 | 35 | 0 | 0 | 0 | 0 | 0/0 | 0 (none) |



**Redesign: how each principle was applied** (Search dialog and share dialog, 2026-11-23)
- overview first: Input first, results under it.
- grouping: Share channels, extras and cite are three groups.
- one meaning per attribute: Accent only on the primary button.
- data-ink: One border, one shadow.
- hierarchy by contrast: Radius 8px, 4px controls.
- consistency: Touch targets grow to 44px at 640px and below; the dialogs use the shared tokens.
- progressive disclosure: Cite stays folded into the share dialog as before.
- before/after: Unchanged height.

## 4. Blocks per page type that must survive the redesign (regression list)

Each line is a selector that exists in the current build on that page type. Taken from the rendered DOM and the Session State sections of CLAUDE.md. A selector in brackets is an attribute selector.

- **All indexable pages:** `header.site`, `details.navm` (5), `#menuBtn`, `#siteMenu`, `.search-pill`, `#searchDlg`, `#shareDlg`, `#themeBtn`, `nav.crumbs` (BreadcrumbList), `main#main`, skip link, `aside.ad-slot[data-ad-pos=top|mid|low|multiplex]` where ads are on, `p.disclaimer`, `footer.site` links (About, Methodology, Corrections, Terms, Privacy, Contact, Guides, FAQ, Writing, Downloads, Developers, RSS feeds, World markets, llms.txt), JSON-LD, `link[rel=alternate]` feeds, `meta[name=color-scheme]`
- **Home:** `h1`, `p.nf-coverage`, `section.answer[data-answer]`, `NotableFeed` (`.nf-*`), `[data-week]` strip, `h2#heatmap`, `.hm-switch`, three `Heatmap` roots with `[data-ctl]` filters (who, chamber, party, role, cap, window, view, side), `.hm-chart-switch`, scatter and tile drawing, `.hm-side-rows`, `.hm-reset`, "Share this view" (`[data-share=map]`), `VizHome` charts, `.datastrip.strip-compact`, URL hash keys `chart,w,view,scope,side,cap`
- **Stock / company:** `.title-row` with `Follow`, `dl.facts[data-entity-facts]` (Company, security type, size band, industry link, counts, latest trade), `section.answer[data-answer]` with Cite and Share, `section.glance[data-glance]`, `section.datastrip`, `nav.groupbar[data-groupbar]`, `div.pgroup#trading|#ownership|#company|#washington|#record`, `section.tv[data-tv]`, `section[data-entity-periods]` (3 and 12 month table), `section[data-entity-insiders]`, `section[data-entity-members]`, `h2#insider-transactions` + `TxnTable`, `details.fnotes[data-fnotes]`, `h2#congress-trades`, `p[data-screener-link]`, `section[data-planned-sales]`, `section[data-large-holders]`, `section[data-inst-holders]`, `section[data-financials]`, `section#executive-pay-section`, `section#company-events-section`, `h2#contracts`, `h2#lobbying`, `section[data-lobby-filer]`, `section[data-related]`, `section.learn-more[data-learn-more]`, `h2#sources`, `div.source-panel[data-sources]`, `[data-share-classes]`, `p.dl-row[data-download]`, `td.side` buy/sell flags, row ids `tr#t<id>`, `a.flag.notes`
- **Member:** `dl.facts` (chamber, seat, party, term, committees, latest trade), `section.answer`, jump links, figure strip, most-traded stocks, `VizPerson` charts, year-by-year table, owner table, "How this record compares", committee assignments, `TxnTable` disclosed trades, `p[data-screener-link]`, filings table, related members, `MemberVotes`, `OutsideSpending`, `LobbyContrib`, `CampaignCommittee`, per-member questions with FAQPage JSON-LD, `div.source-panel`, `DownloadCsv`
- **Insider:** `dl.facts`, `section.answer`, `VizPerson`, "What kind of transactions" (codes), rows by year, `TxnTable` with Held after and Change columns, `FiledNotices` `[data-filed-notices]`, `ReportedHoldings` `[data-reported-holdings]`, other insiders at the company, `SourcePanel`, `LearnMore`
- **Committee, industry, lobbying issue:** `dl.facts`, `section.answer`, members table / company table / client and registrant tables, `TxnTable` (committee), `id="sic-<code>"` anchors (industry), `IssueList` links (issue), sortable `table.data[data-sortable]`, `DownloadCsv`
- **Section landings:** `Heatmap` (congress, insiders), `VizCongress`, `VizInsiders`, `TxnTable` newest disclosures, feed links, `SectionFaq`, chips to datasets (Member directory, Trade screener, Committees), `.card` link grid (`/washington/`, `/rates/`)
- **Rates and markets detail:** `section.answer`, `datastrip`, `Viz` charts (curve with playback, rate history, rank bars), tables (`table.data`), `DownloadCsv`
- **Dataset hubs:** `p.hub-note`, `div.hub-controls[data-hub-ctl]`, `p.hub-count`, `p.dl-row` + `p.hub-dl`, `div.tablewrap table.data.hub-table`, `div.hub-pager`, `section.answer`, `.evhub[data-evhub]`, data file loaded from `/data/<name>.json`, URL hash filter keys
- **Server-rendered datasets:** `section.answer`, `Viz` (contract flow, issue treemap, state map), tables with `p.dl-row[data-download]`, `section[data-sub-agencies]`, `section[data-naics-codes]`, `.tablewrap`
- **Screeners:** `[data-scr]` controls (filters, search, pins, download, saved screens, pager), `th[data-sort]`, count line, Reset, first 50 rows server-printed, hash keys (congress-trades: chamber, party, state, committee, side, min, max, owner, asset, window, tw, late, hist, member, ticker, sort, dir, page, size), `localStorage` key `stm.screens.congress`
- **Guides, FAQ:** `section.answer`, "In brief", question headings, `/guides/<slug>/#<anchor>` anchors, Article + FAQPage JSON-LD, `article.guide`, "See it on this site", related guides, sources, `/data/guides.json`
- **Writing:** `/writing/` hub, article body `.prose.article-body`, byline, author box, `rss.xml`, Article JSON-LD
- **Reference:** `#coverage` list (`li[data-stored]`), `#form-144`, `#schedule-13`, `#financials`, other methodology anchors referenced by guides and tables (`#ticker-owners`, `#holdings`, `#footnotes` ...), `/downloads/` file lists `ul.files` and column dictionary, `/developers/` catalogue, `/feeds/` list
- **Account:** `#acctBtn` badge, `/watchlist/` sections (lists, new since last visit, email digest `data-alerts`), `/watchlist/shared/#<slug>`, `[data-share]` dialog
- **Embeds:** `EmbedLayout` single chart, canonical link to the full page, noindex

The verifiers in `scripts/verify-*.mjs` (guides, links, filters, share, a11y, screener, directory and others) read many of these selectors; a selector removed from the page breaks that verifier by design.

## Redesign, second pass: stock and company pages (E2)

How each principle was applied: summary first (identity row with Follow, Cite, Share; compact facts; answer clamped to two lines; eight glance tiles; one row of compact charts), detail on demand (panels with previews of 5 rows, 8 for the two transaction tables; trailing columns marked `data-col="more"` on the insiders and members tables; "More figures" and the codes table closed), one place per figure (Cite and Share beside the h1 only; panel notes clamp to two lines, full text stays in the DOM), grouping (Trading, Ownership, Company, Washington, About, each a 12-column `.panels` grid; a group with no panels is absent). Numbers (desktop 1280 / phone 390, big data): /stocks/vmfk/ 14807 to 9314 / 18823 to 12613; /stocks/spy/ 4345 to 3761 / 5033 to 4157; /stocks/nvda/ 13297 to 9082 / 17107 to 12109. Short of the 60% target; see report-E2.
