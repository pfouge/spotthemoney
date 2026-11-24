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
