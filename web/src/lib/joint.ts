// One trade, several Form 4s.
//
// When funds, trusts or holding companies own a stake together, each of them reports the same
// transaction: Carlyle's sale of 26,105,840 Medline shares at $41 on 2026-03-10 arrived under
// seven reporting owners, and summing the rows turned a $1.07B sale into $7.6B. Rows from
// different filers with the same stock, date, code, share count and price are one transaction.
// The first filing received keeps it; the rest are marked joint and left out of every total
// that spans filers (they still show, with their value, on each filer's own page).
//
// The match also needs the same "shares owned after the transaction": joint filers report one
// holding, while separate accounts that each sold an equal slice (three family trusts selling
// 1,925 shares apiece at one average price) report their own. With that, a repeat by the same
// filer in a second filing is caught too — SGF FANG Holdings' 9,079,675 Diamondback shares on
// 2026-09-16 sit in two consecutive accessions. Rows in one filing are never merged.
//
// Small identical trades by unrelated insiders do happen (two new directors each buying 1,000
// shares in an offering), so only rows worth JOINT_MIN_VALUE or more are matched.

export const JOINT_MIN_VALUE = 250_000;

export interface JointRow {
  id: number; filingId: number; personId: number | null; securityId: number | null;
  date: string | null; code: string | null; isDerivative: boolean | null;
  shares: number | null; price: number | null; value: number | null;
  /** Shares owned after the transaction, as filed; null when the filing gives none. */
  ownedAfter: number | null;
}

/** Map of duplicate row id → the id of the row that keeps the transaction. */
export function jointDuplicates(rows: JointRow[]): Map<number, number> {
  const groups = new Map<string, JointRow[]>();
  for (const r of rows) {
    if (r.personId == null || r.securityId == null || !r.date || !r.code) continue;
    if (!(r.shares != null && r.shares > 0) || !(r.price != null && r.price > 0) || !((r.value ?? 0) >= JOINT_MIN_VALUE)) continue;
    const key = [r.securityId, r.date, r.code, r.isDerivative === true ? 1 : 0, r.shares, r.price, r.ownedAfter ?? "none"].join("|");
    const g = groups.get(key); if (g) g.push(r); else groups.set(key, [r]);
  }
  const out = new Map<number, number>();
  for (const g of groups.values()) {
    if (new Set(g.map((r) => r.filingId)).size < 2) continue;
    const first = g.reduce((a, b) => (b.filingId < a.filingId || (b.filingId === a.filingId && b.id < a.id) ? b : a));
    for (const r of g) {
      if (r.filingId === first.filingId) continue;
      // Another filer: the same trade. The same filer again: only with a holding on file to match on.
      if (r.personId !== first.personId || r.ownedAfter != null) out.set(r.id, first.id);
    }
  }
  return out;
}
