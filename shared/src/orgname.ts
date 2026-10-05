// One rule for "is this the same organisation name?", shared by the site (matching
// contract and lobbying rows onto company pages) and the ingest (deciding which
// USAspending recipients belong to a tracked company). Change it in one place only.

/** Upper-case, strip punctuation and corporate suffixes, collapse spaces. */
export function normalizeOrgName(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[.,'"()]/g, " ")
    .replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|LTD|LIMITED|PLC|THE|HOLDINGS?|GROUP)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
