# Decisions made during the redesign (2026-11-23)

Peter's answers before the work started: deploy as each page type passes its checks; keep the logo only (fonts and
accent are a free choice); light and dark both stay, light by default; the first-time visitor wins the first screen
of the homepage; nothing is out of scope.

Each entry: the decision, why, and how to reverse it.

1. **Typeface: Inter for everything, Outfit removed.** One family meets "two weights, four sizes" and has true
   tabular figures; a second display face only made hierarchy by size. Self-hosted (`web/public/fonts/`), so no
   request leaves the site. Reverse: restore `outfit-latin-wght.woff2`, `--font-display` and the preload line.
2. **Accent: blue `#1F4FD8` (dark `#8CB0FF`).** The old look used teal for links and green for both the brand and
   "bought". Green and red now mean only positive and negative, so the accent had to be neither. Reverse: change
   `--accent` in one place.
3. **White ground, no cards.** Groups are separated by space and hairlines. The paper-coloured ground and white
   cards put a box around every block. Reverse: set `--bg` and restore `.card` fill and radius.
4. **Body size 14px on data pages, 16px for prose.** Dense tables read better at 14 with 40px rows; long text keeps 16.
5. **Long tables scroll inside a 12-row box with a sticky head and a "Show all rows" button.** The NVDA page was
   32,757px tall (52 screens at 1272x634), one table alone 11,400px. Rows stay in the page (find-in-page, links to a
   row and the checks that count rows all still work). Hiding rows was rejected for that reason.
6. **"About this record" and other reference blocks are closed by default.** Headings unchanged, content in the page.
7. **Remembered state uses one session-storage key, `stm.ui`** (open sections, row density, expanded tables). It lasts
   for the visit only. Local storage was not used because the privacy page lists every local-storage key; the privacy
   page gains one sentence about the session key.
8. **Names in tables are ink, not accent.** A table of 200 linked names in blue reads as noise; the link shows on hover
   and focus, and by position (first column).
9. **The scheduled parity task could not be paused** (permission refused on 2026-11-22) and another session is merging
   company pages. Their changes land on main during this work; each redesign pull request is rebased on main and
   re-checked before merging.
10. **Homepage: direction A ("front page of record") chosen over direction B ("search first").** Both were built and
    measured (`design/home/scoring.md`; first screens in `design/home/a-*.png` and `b-*.png`). For a first-time visitor
    the first screen has three jobs. Both directions say what the site is and show the search field. A shows 11 live
    figures with 12-week sparklines on a desktop first screen (B: 8) and 6 on a phone (B: none of the dataset figures,
    which start below the fold), and every figure in A is a one-click route to its page type. B's right-hand list of
    newest filings shows liveness but not breadth, and on a quiet day it is nearly empty. Taken from B into A: the
    "Recently active" line of example tickers and members under the search field. Reverse: build with
    `PUBLIC_HOME_DIR=b` (both directions stay in `web/src/components/HomeTop.astro`).
11. **The top advertisement moves below each page's title block.** It sat above the breadcrumb and title (115px on
    most pages), so no first screen began with what the page is. Its reserved height is unchanged.
12. **Direction B removed; the homepage is rebuilt as panels (task H2, second pass).** Direction A won in entry 10, so
    `PUBLIC_HOME_DIR=b` and the B markup are gone from `HomeTop.astro` (the source before removal is saved as
    `design/home/direction-b/HomeTop.original.astro`; the scoring note in entry 10 still describes both). The page is
    now one band (what the site is, search, "Recently active" at the left; the dataset tiles, four across, at the right),
    the answer as two muted lines with "What is covered" folded beside it, then panels: notable trades (8 one-line rows,
    6 on a phone, chevron opens details in place, "Show more", "About this list" folded) beside a rail with "This week in
    filings" and the leaderboards (top 5, "Show all"); the trade map with one control line and the other filters under
    "More filters (n)"; one row of compact charts; the rates strip. Height at 1280: 11,114 to about 4,400 px; at 390:
    19,080 to about 6,400 px. The top ad follows the answer because `adplace` keeps the answer with the title block.
13. **Entity pages show one group at a time (task F).** The group bar is a tab set with an "All" tab at the end; Trading
    opens first and the visitor's choice is remembered per page type for the visit in `stm.ui` (`tabs`). Every group stays
    in the page; without JavaScript all groups show stacked as before. Why: /stocks/vmfk/ was 9,458px with every group
    stacked. Reverse: remove `initTabs()` from `scripts/reveal.ts` (the bar falls back to jump links).
14. **One reveal for every hidden target (task F).** `scripts/reveal.ts` opens the hidden tab, the closed `<details>` and the
    previewed table row around a hash target, on load, on hashchange and on a click of a link to the current hash.
    `ui.ts` and `tablecap.ts` no longer have their own versions. Reverse: restore `openToHash` (ui.ts) and `revealTarget`
    (tablecap.ts) from commit b97ec4e.
15. **Mid and low ads sit after the tab panels, separated by visible content (task F).** With one group shown, ads between
    groups would have touched. Order now: groups, mid ad, "Guides for this page" (members: their questions), low ad,
    disclaimer, multiplex. Which pages carry ads is unchanged. Reverse: move the two `AdSlot`s back between the groups.
16. **Filings and the comparison table move to "About this record" on member and insider pages; Form 144 notices an insider
    filed move to "Ownership" (task F).** They are reference and ownership material, and the Trading tab had to fit the
    height targets. Headings, ids and rows are unchanged. Reverse: move the sections back into the Trading group.
17. **Headline figures per panel (`PanelFigs.astro`) on committee, industry and lobbying-issue pages (task F).** One to three
    figures the panel's own sentence or the page's facts already state, printed large at the top of the panel. Reverse:
    delete the `<PanelFigs>` lines.
18. **Preview counts on these pages are 5 (kit default) and at most 8 (task F).** `data-preview` is the kit's presentation
    attribute, not one a verifier reads; the industries table went from 10 to 8 to meet "no table over 8 before Show all".
    Note: the kit has no rule for `data-preview="5"`; leave the attribute off for 5.
19. **Footer link groups fold on phones with a chevron button (task F).** A `<summary>` holding the group's heading link
    failed axe (nested-interactive), so the heading stays a link and a separate button folds the list. Reverse: delete the
    footer block in `ui.ts` and section 5 of `rd-final.css`.
20. **The top ad of guides and articles is placed inside the `<article>`, after the title block (task F, lib/adplace.ts).**
    The whole guide is one `<article>`, so the ad had landed after it, next to the multiplex. Reverse: drop the
    `el.tag === "article"` branch in `splitForAd`.
21. **New CSS for this pass is in `styles/rd-final.css` (task F).** Dead first-pass rules removed: `rd-entity.css` section 1
    (every `main > .container.flow-entity ... { order }` rule) and `rd-people.css` section 1 and its trailing answer-meta
    rules; no page carries `.title-row` at the top level any more, so BaseLayout's `flowEntity` class is now never set.
