// Packed form of the insiders heatmap file.
//
// One object per transaction repeats the ticker, company name, filer, title and a 100-character
// SEC URL on every row; with a full year of Form 4s loaded that came to 41 MiB, and Cloudflare
// refuses any static asset over 25 MiB (every deploy failed on 2026-10-06 until this landed).
// Here each ticker, filer and filing is written once and a row is a short array of indexes and
// numbers. Nothing is dropped: unpack() returns exactly the rows pack() was given, and the
// browser script and scripts/verify-filters.mjs both read the file through it.

export interface PackableRow {
  t: string; n: string | null; p: string; ps: string | null; r: string; ti: string | null;
  c: string | null; s: "buy" | "sell" | "other"; v: number; sh: number | null; pr: number | null;
  pl: boolean; o: string | null; d: string; f: string | null; u: string | null;
}

export const URL_PREFIX = "https://www.sec.gov/Archives/edgar/data/";
const SIDES = ["buy", "sell", "other"] as const;
const DAY = 86400000;
const dayNum = (iso: string) => Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

export interface Packed {
  v: 2;
  /** Day that date offsets count from. */
  base: string;
  tk: [string, string | null][];                          // ticker, name
  pp: [string, string | null, string, string | null][];   // filer, slug, role, title
  fl: [string | null, number | null][];                   // url (without URL_PREFIX), filed-day offset
  ow: (string | null)[];                                  // ownership labels
  rows: (string | number | null)[][];                     // tk, pp, fl, code, side, v (null = sh × pr), sh, pr, plan, ow, day
}

export function pack(rows: PackableRow[]): Packed {
  const base = rows.reduce((m, r) => (r.d < m ? r.d : m), rows[0]?.d ?? "2000-01-01");
  const b = dayNum(base);
  const index = <T>(list: T[], seen: Map<string, number>, key: string, make: () => T) => {
    let i = seen.get(key); if (i == null) { i = list.length; list.push(make()); seen.set(key, i); } return i;
  };
  const out: Packed = { v: 2, base, tk: [], pp: [], fl: [], ow: [], rows: [] };
  const tk = new Map<string, number>(), pp = new Map<string, number>(), fl = new Map<string, number>(), ow = new Map<string, number>();
  for (const r of rows) {
    out.rows.push([
      index(out.tk, tk, JSON.stringify([r.t, r.n]), () => [r.t, r.n]),
      index(out.pp, pp, JSON.stringify([r.p, r.ps, r.r, r.ti]), () => [r.p, r.ps, r.r, r.ti]),
      index(out.fl, fl, JSON.stringify([r.u, r.f]), () => [r.u != null && r.u.startsWith(URL_PREFIX) ? r.u.slice(URL_PREFIX.length) : r.u, r.f != null ? dayNum(r.f) - b : null]),
      r.c, SIDES.indexOf(r.s), r.sh != null && r.pr != null && r.sh * r.pr === r.v ? null : r.v, r.sh, r.pr, r.pl ? 1 : 0,
      index(out.ow, ow, String(r.o), () => r.o),
      dayNum(r.d) - b,
    ]);
  }
  return out;
}

export function unpack(f: Packed): PackableRow[] {
  const b = dayNum(f.base);
  return f.rows.map((x) => {
    const [t, n] = f.tk[x[0] as number]!, [p, ps, r, ti] = f.pp[x[1] as number]!, [u, fd] = f.fl[x[2] as number]!;
    return {
      t, n, p, ps, r, ti, c: x[3] as string | null, s: SIDES[x[4] as number]!, v: x[5] != null ? (x[5] as number) : (x[6] as number) * (x[7] as number),
      sh: x[6] as number | null, pr: x[7] as number | null, pl: x[8] === 1, o: f.ow[x[9] as number] ?? null,
      d: isoOf(b + (x[10] as number)), f: fd != null ? isoOf(b + fd) : null,
      u: u == null ? null : /^https?:/.test(u) ? u : URL_PREFIX + u,
    };
  });
}
