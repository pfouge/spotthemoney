// Form 4 footnotes (components/TxnTable.astro; methodology #footnotes).
//
// A Form 4 can carry footnotes: a weighted-average price and its range, a trading plan and the
// date it was adopted, shares held through a trust, shares withheld for tax. The data jobs keep
// the text of every footnote of a filing, in the filing's order, but not which row each one is
// attached to. So the site shows a filing's footnotes with every row of that filing and says so;
// the filing itself (linked on each row) shows which row each note belongs to.
//
// Pure: text in, text out. No reading of what a note means, no labels, no flags derived from it.

/** At most this many footnotes of one filing are printed; the rest are counted and left to the filing. */
export const MAX_NOTES_PER_FILING = 10;

const ENT: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Undo XML escapes left in stored text (twice: some filings escape an already escaped "&"). */
function decode(s: string): string {
  if (!s.includes("&")) return s;
  const once = (x: string) => x
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, k: string) => ENT[k])
    .replace(/&#(\d+);/g, (m, n: string) => { const c = Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; })
    .replace(/&#x([0-9a-f]+);/gi, (m, n: string) => { const c = parseInt(n, 16); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; })
    .replace(/&amp;/g, "&");
  return once(once(s));
}

/** One footnote as plain text: escapes undone, control characters dropped, white space collapsed. */
export function cleanFootnote(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return decode(raw).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** A filing's stored footnotes as a clean list: empty and repeated notes removed, order kept. */
export function cleanFootnotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = []; const seen = new Set<string>();
  for (const r of raw) {
    const t = cleanFootnote(r);
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
  }
  return out;
}

export interface FilingNotes {
  filingId: number;
  /** Notes printed, in the filing's order (at most MAX_NOTES_PER_FILING). */
  notes: string[];
  /** Notes of this filing not printed. */
  more: number;
  /** All notes of the filing (printed + more). */
  total: number;
}

/**
 * The footnote blocks for one table: one block per filing that has footnotes, in the order the
 * filings first appear in `filingIds` (the table's rows, top to bottom). A filing listed twice
 * gets one block.
 */
export function tableFootnotes(filingIds: Iterable<number>, notesOf: (filingId: number) => string[] | undefined, max = MAX_NOTES_PER_FILING): FilingNotes[] {
  const out: FilingNotes[] = []; const seen = new Set<number>();
  for (const id of filingIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const all = notesOf(id);
    if (!all || all.length === 0) continue;
    const notes = all.slice(0, Math.max(1, max));
    out.push({ filingId: id, notes, more: all.length - notes.length, total: all.length });
  }
  return out;
}

/** "1 note" / "3 notes": the label of the link on a row. */
export function notesLabel(n: number): string {
  return `${n} ${n === 1 ? "note" : "notes"}`;
}

/** The id of a filing's footnote block on a page. */
export function notesAnchor(filingId: number): string {
  return `fn${filingId}`;
}
