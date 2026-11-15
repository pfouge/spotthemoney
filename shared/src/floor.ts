// Where the site's corporate-insider (Form 4) record starts (Peter, 2026-10-05).
//
// One date for both sides:
//   - ingest: the history pass walks each ticker back to it, and the daily pass ignores listing
//     entries filed before it (a ticker with few filings used to hand the daily pass a filing
//     from 2002, which was fetched and quarantined again every day);
//   - web: Form 4 filings filed before it are left out of every page, total and download. A few
//     hundred such filings are in the database from before the daily pass had this rule. They
//     are real filings, but a year table showing "2010: 3 rows" reads as a complete year, and it
//     is not one.
//
// Moving the floor back (for example when market-wide history is loaded) is a change to this
// one constant plus a history pass.
export const FORM4_FLOOR = "2025-10-01";

/** True when a Form 4 filing date (YYYY-MM-DD or a longer ISO string) is before the floor. */
export function beforeForm4Floor(filedAt: string | null | undefined, floor: string = FORM4_FLOOR): boolean {
  if (!filedAt) return false;
  return filedAt.slice(0, 10) < floor;
}
