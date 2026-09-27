// I-Bond reset arithmetic (roadmap B.5). Pure functions, unit-tested in ibond.test.ts.
//
// Treasury sets the semiannual inflation rate from CPI-U (NSA):
//   1 November reset  ← CPI September ÷ CPI March − 1
//   1 May reset       ← CPI March ÷ CPI September(prev) − 1
// The fixed rate is announced on reset day and is not derivable in advance.
// Composite = fixed + 2 × semiannual + fixed × semiannual (annualised).

import type { CpiPoint } from "./db";

export interface ResetOutlook {
  nextResetDate: string;            // yyyy-mm-dd
  startMonth: string;               // yyyy-mm (CPI base month)
  endMonth: string;                 // yyyy-mm (CPI final month)
  monthsKnown: number;              // months of the six-month window with CPI published
  monthsTotal: 6;
  startValue: number | null;
  latestValue: number | null;
  latestMonth: string | null;
  /** Semiannual inflation rate implied so far (final only when monthsKnown = 6). */
  impliedSemiannual: number | null; // percent, e.g. 1.23
  isFinal: boolean;
  /** Composite that would result if the fixed rate stays at `fixedRate`. */
  impliedComposite: number | null;  // percent
}

const pad = (n: number) => String(n).padStart(2, "0");

export function nextResetDate(today = new Date()): { date: string; endMonth: string; startMonth: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1; // 1..12
  const d = today.getUTCDate();
  // Reset days are 1 May and 1 November. On reset day itself the new period has begun.
  if (m < 5 || (m === 5 && d < 1)) return { date: `${y}-05-01`, startMonth: `${y - 1}-09`, endMonth: `${y}-03` };
  if (m < 11) return { date: `${y}-11-01`, startMonth: `${y}-03`, endMonth: `${y}-09` };
  return { date: `${y + 1}-05-01`, startMonth: `${y}-09`, endMonth: `${y + 1}-03` };
}

function monthIndex(ym: string): number { const [y, m] = ym.split("-").map(Number); return y! * 12 + (m! - 1); }

export function resetOutlook(cpi: CpiPoint[], fixedRate: number | null, today = new Date()): ResetOutlook {
  const { date, startMonth, endMonth } = nextResetDate(today);
  const byMonth = new Map(cpi.map((p) => [p.month.slice(0, 7), p.value]));
  const startValue = byMonth.get(startMonth) ?? null;
  const s = monthIndex(startMonth), e = monthIndex(endMonth);
  let latestMonth: string | null = null;
  let latestValue: number | null = null;
  let monthsKnown = 0;
  for (let i = s + 1; i <= e; i++) {
    const ym = `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
    const v = byMonth.get(ym);
    if (v != null) { monthsKnown++; latestMonth = ym; latestValue = v; }
  }
  const implied = startValue != null && latestValue != null ? (latestValue / startValue - 1) * 100 : null;
  const isFinal = monthsKnown === 6 && implied != null;
  const composite = implied != null && fixedRate != null
    ? fixedRate + 2 * implied + (fixedRate * implied) / 100
    : null;
  return { nextResetDate: date, startMonth, endMonth, monthsKnown, monthsTotal: 6, startValue, latestValue, latestMonth,
    impliedSemiannual: implied == null ? null : Math.round(implied * 100) / 100, isFinal,
    impliedComposite: composite == null ? null : Math.round(composite * 100) / 100 };
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
