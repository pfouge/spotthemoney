// Standard Industrial Classification (SIC) codes, as the SEC assigns them to filers.
//
// The SEC gives every company that files with it a four-digit SIC code and a short description
// ("3674", "Semiconductors & Related Devices"). The site stores both exactly as the SEC states
// them (table company_sic, migration 0021) and adds one thing of its own: the DIVISION the code
// falls in, read from the code's first two digits (its "major group") with the ranges of the
// SIC manual. That is a lookup, not a judgement, and the page shows the code beside it.
//
// The divisions are broad and old (the manual dates from 1987): software is "Services",
// drug makers and chip makers are both "Manufacturing". Nothing on the site treats a division
// as more than a label.

export interface SicDivision {
  /** Letter of the division in the SIC manual, A to J; "X" for nonclassifiable. */
  code: string;
  name: string;
  /** First and last major group (the code's first two digits), inclusive. */
  from: number;
  to: number;
}

export const SIC_DIVISIONS: SicDivision[] = [
  { code: "A", name: "Agriculture, forestry and fishing", from: 1, to: 9 },
  { code: "B", name: "Mining", from: 10, to: 14 },
  { code: "C", name: "Construction", from: 15, to: 17 },
  { code: "D", name: "Manufacturing", from: 20, to: 39 },
  { code: "E", name: "Transportation, communications and utilities", from: 40, to: 49 },
  { code: "F", name: "Wholesale trade", from: 50, to: 51 },
  { code: "G", name: "Retail trade", from: 52, to: 59 },
  { code: "H", name: "Finance, insurance and real estate", from: 60, to: 67 },
  { code: "I", name: "Services", from: 70, to: 89 },
  { code: "J", name: "Public administration", from: 91, to: 97 },
  { code: "X", name: "Nonclassifiable", from: 99, to: 99 },
];

/**
 * A SIC code as four digits ("100" and 100 become "0100"), or null when the value is empty,
 * not a number of one to four digits, or zero (the SEC leaves the field empty or "0000" for
 * filers it has not classified, such as individuals).
 */
export function cleanSicCode(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const code = s.padStart(4, "0");
  return code === "0000" ? null : code;
}

/** The division a SIC code falls in, or null when the code is missing or in no division. */
export function sicDivision(value: unknown): SicDivision | null {
  const code = cleanSicCode(value);
  if (!code) return null;
  const major = Number(code.slice(0, 2));
  return SIC_DIVISIONS.find((d) => major >= d.from && major <= d.to) ?? null;
}
