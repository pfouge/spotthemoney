# Design system (2026-11-23)

One token set for every page. Implemented as CSS variables in `web/src/styles/global.css`.
The logo (`Mark.astro`, `Wordmark.astro`) is unchanged. Everything else below replaces the earlier look.

## 1. What each visual attribute means, sitewide

| Attribute | The one thing it means |
|---|---|
| Accent blue (`--accent`) | You can act on this: a link, the active filter, the focused control, the sort arrow |
| Green (`--pos`) | A positive value or a purchase |
| Red (`--neg`) | A negative value or a sale |
| Amber (`--warn`) | A caution about the record: late, under review, held back |
| Ink (`--ink`) | Data and running text |
| Muted ink (`--ink-2`) | A label, a unit, a caption, a date beside a value |
| Weight 600 | A value, a heading, the active item. Never used for emphasis inside a sentence of data |
| Size | Level in the page, never importance: see the type scale |
| Position | Left = text and names, right = numbers; top of a page = the answer, then filters, then detail |

Nothing else carries meaning. No colour is decoration. Chart series that are not a direction use the
neutral series colours (`--series-1` to `--series-4`), never green or red.

## 2. Colour tokens

| Token | Light | Dark | Use | Contrast on ground (light / dark) |
|---|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0F1215` | page ground; there is no separate card colour | |
| `--bg-2` | `#F4F5F7` | `#181C21` | table header, hover row, chip, code, the ad slot | |
| `--ink` | `#14171A` | `#E7EAEE` | data, text | 18.0 / 15.6 |
| `--ink-2` | `#59616B` | `#A3ACB7` | labels, captions | 6.3 / 8.2 (5.8 / 7.5 on `--bg-2`) |
| `--line` | `#E3E6EA` | `#262C33` | hairline row rules and section rules | |
| `--line-2` | `#C7CCD3` | `#3A424C` | input and chip outlines, the rule under a table head | |
| `--accent` | `#1F4FD8` | `#8CB0FF` | links and active controls | 6.6 / 8.7 |
| `--accent-on` | `#FFFFFF` | `#0F1215` | text on an accent fill | 6.6 / 8.7 |
| `--pos` | `#0F7A43` | `#4ADE80` | positive, bought (text and marks) | 5.4 / 10.8 |
| `--neg` | `#B42318` | `#FF7A70` | negative, sold | 6.6 / 7.4 |
| `--warn` | `#8A5A00` | `#E0A93B` | caution flags | 5.9 / 8.9 |

All text pairs pass WCAG AA (4.5:1). Old token names stay as aliases so no component breaks:
`--surface: var(--bg)`, `--surface-alt: var(--bg-2)`, `--ink-soft: var(--ink-2)`, `--signal: var(--accent)`,
`--signal-ink: var(--accent-on)`, `--green`/`--green-ink: var(--pos)`, `--red`/`--red-ink: var(--neg)`,
`--line-strong: var(--line-2)`, `--chip: var(--bg-2)`.

Chart tokens: `--viz-buy`, `--viz-sell`, `--viz-late`, `--viz-muted`, `--viz-none`, `--viz-on` keep their validated
values (they are direction colours). `--viz-one` and `--chart-1` become `--series-1`. Series set, validated as a set
on both grounds before use: `--series-1` blue, `--series-2` ochre, `--series-3` magenta, `--series-4` slate.

## 3. Spacing: one 4px scale

`--s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px.`
Every margin, padding and gap is one of these. Meaning of the steps:
- inside a group of related figures: `--s-1` to `--s-3`
- between groups inside one section: `--s-5`
- between sections: `--s-7`
- page gutter: `--s-4` on a phone, `--s-6` from 768px
Groups are separated by space. A box (border or fill) is used only for: a control, the ad slot, a dialog.

## 4. Type: four sizes, two weights, one family

Family: Inter (variable, self-hosted, SIL OFL) with the system sans as fallback. `font-variant-numeric: tabular-nums`
on the whole page. Weights: 400 and 600 only.

| Token | Size / line | Use |
|---|---|---|
| `--t-xs` | 12 / 16 | labels, captions, table headers, chips, footers |
| `--t-sm` | 14 / 20 | data: tables, facts, controls, navigation. The default on data pages |
| `--t-md` | 16 / 24 | running prose (answer text, guides, articles) and section headings (h2, weight 600) |
| `--t-lg` | 24 / 28 | page title (h1) and a headline figure |

h3 is `--t-sm` at 600. Hierarchy comes from weight, colour and space: a section heading is the same size as prose,
set in 600 with `--s-7` above it. Text drawn inside charts is exempt (it scales with the chart).

## 5. Radius, elevation, motion

`--r-1: 4px` (controls, tags), `--r-2: 8px` (dialogs, menus), `--r-pill` for filter chips only.
No shadows except on a menu or dialog (`--shadow`). No decorative transitions; 120ms on hover colour only.

## 6. Components

### Label / value (`dl.facts`, `.kv`, tiles)
Label: `--t-xs`, `--ink-2`, above the value. Value: `--t-sm`, `--ink`, 600. A headline figure: `--t-lg`, 600.
Pairs sit in a grid with `--s-5` column gap and `--s-3` row gap, no boxes, no rules between them.

### Tiles (`Glance`, figure strips, week tiles, hub tiles)
A tile is a label/value pair with an optional sparkline and one caption line. No border, no fill. Tiles in a row are
separated by a hairline on the left (`border-left: 1px solid var(--line)`, padding-left `--s-4`), first tile none.
On a phone a row of tiles is one swipeable line.

### Tables
- Numbers right-aligned (`td.num`, `th.num`, and any cell with `data-v` holding a number), text left-aligned.
- Row rule: 1px `--line` under each row. No cell borders, no zebra, no outer border, no rounded corners.
- Head: `--t-xs`, `--ink-2`, weight 600, fill `--bg-2`, sticky at the top of its scroll box.
- Row height: comfortable 40px (default), compact 32px (`html[data-density="compact"]`); a switch in the header.
- Sortable columns keep the existing `data-sortable` behaviour; the arrow is `--accent`.
- A table taller than 12 rows sits in a scroll box (`.tablewrap`, max-height = head + 12 rows) so the page stays
  short and the head stays in view; a "Show all rows" button under it removes the limit. Every row stays in the page.
- Hover: row fill `--bg-2`. First column pinned on phones (as before).
- One row format per entity everywhere: a ticker is `TICKER` in 600 followed by the company name in `--ink-2`;
  a person is the name in 600 followed by seat or role in `--ink-2`; both link to the entity page in `--accent`
  only on hover (names in tables are ink, underlined on hover, so a table is not a wall of blue).

### Flags and tags
Text only, `--t-xs`, no pill fill: buy/sell words in `--pos`/`--neg`; cautions in `--warn`; neutral tags in `--ink-2`.

### Controls
Filter chips: pill, 1px `--line-2`, `--t-xs`; active = `--accent` fill, `--accent-on` text. Selects and inputs:
32px high, `--r-1`, 1px `--line-2`. Primary button: `--accent` fill. Quiet button: text in `--accent`.

### Section
`h2` (`--t-md`, 600), an optional one-line summary in `--ink-2`, then content. `--s-7` above, hairline above the h2
only for top-level sections of a long page. No card.

### Disclosure
Reference blocks (sources and method, guides for this page, questions, footnotes, caveats longer than two lines)
are `<details>` closed by default, with the heading as the summary. Open or closed state is remembered for the
visit (session storage key `stm.ui`). Without JavaScript they open and close natively.

### Sparkline and small multiples
`sparkSvg(values, {w: 96, h: 24})` in `lib/viz.ts`: a 1.5px line in `--ink-2` with the last point marked in `--ink`;
no axis, no fill; `role="img"` with a text label. `sparkBars` for counts per period (bars in `--ink-2`, buys and
sells in `--pos`/`--neg` when the series is a direction). Small multiples: the same spark in a grid, shared scale stated
in the caption.

### Header and footer
Header: 48px, ground `--bg`, hairline under it, sticky. Logo, search field (always visible from 768px), five menus,
density switch, theme switch, watchlist. Footer: link groups in `--t-xs`, no fills.

## 7. Page skeletons

| Type | Order |
|---|---|
| Home | what the site is (one line) · live counts that route to each dataset · newest notable filings · this week · trade map · charts · reference |
| Entity (stock, member, insider, committee) | identity line and facts · at a glance tiles with sparklines · answer text · group bar · groups (Trading, Ownership, Company, Washington) with capped tables · About this record (closed) |
| Hub / screener / directory | title and one-line answer · headline figures · filters · the table · method (closed) |
| Landing (congress, insiders, washington, rates) | title and answer · tiles that route · chart or map · newest rows · questions (closed) |
| Prose (guide, article, methodology, legal) | title · answer · body at `--t-md`, 68ch · sources (closed where long) |

## 8. Summary first: panels, previews and small charts (added 2026-11-23, second pass)

The first pass kept every block open at full length. A page now opens as a summary; depth is one click away.

### Panel (`components/Panel.astro`)
One block of data = one panel:
1. head line: the section's h2 (text unchanged), then quiet actions at the right (CSV, share, "Open in <hub>")
2. summary: one to three headline figures (label/value) and, where the data has a shape, ONE small chart beside them
3. preview: the first 5 rows of the table (the 5 that matter most by the table's own default order)
4. foot: "Show all N rows" (opens the rest in place, in a scroll box of at most 20 rows with a sticky head), and the
   caveat as one line with "more" when long
Every row stays in the page; closed rows are hidden with CSS only. A link to a hidden row opens its table.
A panel with nothing to preview (a note, a chart alone) is just head and summary.

### Panel grid (`.panels`)
12 columns from 1100px: a panel spans 6 (default) or 12 (`data-span="12"`: wide tables, the trade map). One column
below 1100px. Row gap `--s-7`, column gap `--s-6`. Panels in a row align to the top; no boxes around panels, a
hairline above each panel head.

### Preview tables
`.tablewrap[data-preview]` (default 5; `data-preview="8"` for a page's main table). Columns in a 6-span panel are
limited to what fits without sideways scroll at 1100px: the template marks secondary columns `data-col="more"`,
hidden in the preview state and shown once the table is expanded (expanded tables may scroll sideways on phones,
first column pinned).

### Small charts
Every chart has a compact form: at most 180px tall, direct labels instead of a legend, at most three light
gridlines, no frame, no axis line except a baseline, no tick marks, units stated once in the caption. Charts sit in
`.viz-grid`: 4 across from 1280px, 3 from 1024px, 2 from 640px, 1 below; a time series may span 2. The sentence that
reads the chart aloud stays in the page under a closed "Reading" disclosure. Colour: direction charts use
`--viz-buy`/`--viz-sell`; everything else `--series-*` or `--ink-2`.

### Which chart for which question
| Question | Chart |
|---|---|
| Is this bought or sold, and when? | monthly bars up (bought) and down (sold), 12 months |
| Who accounts for it? | ranked horizontal bars, top 5, the rest summed as "others" |
| How has a holding or a figure moved? | line with the last value labelled |
| How is a total split? | one stacked bar with direct labels (never a pie) |
| How does one thing compare across a few periods? | small multiples of the same bar, shared scale |
| How late, how spread? | histogram with the deadline marked |
