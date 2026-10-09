// Automatic internal linking. Three small tools, all pure (tests: scripts/links.test.ts):
//
//   orgPath   a lobbying client, registrant or contract recipient → that company's page, when
//             the name matches a tracked company exactly after normalising (the same rule the
//             company pages use; subsidiaries and near-spellings are deliberately not matched).
//   flagHref  a flag in a trade table ("late", "10b5-1 plan" …) → the guide that explains it.
//   autolink  the first mention of a glossary term in a guide's prose → the guide about it.
//             One link per term per page, never to the page itself, never inside a link,
//             heading, code or table that is already there, and never a term the page already
//             links by hand.
//
// Rule for all three: a link is added only where the target is certain. No fuzzy matching.
import type { Flagship, Company } from "./flagship";
import { companyPath, normalizeOrgName } from "./flagship";

// ── organisations ────────────────────────────────────────────────────────────────────────
let _orgs: { model: Flagship; map: Map<string, Company> } | null = null;
export function orgPath(m: Flagship, name: string | null | undefined): string | null {
  if (!name) return null;
  if (_orgs?.model !== m) {
    const map = new Map<string, Company>();
    const twice = new Set<string>();
    for (const c of m.companies.values()) {
      const k = normalizeOrgName(c.name); if (!k || !c.slug) continue;
      if (map.has(k)) twice.add(k); else map.set(k, c);
    }
    for (const k of twice) map.delete(k); // two companies under one normalised name: not certain, so no link
    _orgs = { model: m, map };
  }
  const c = _orgs.map.get(normalizeOrgName(name));
  return c ? companyPath(c) : null;
}

// ── flags ────────────────────────────────────────────────────────────────────────────────
const G = (slug: string, hash = "") => `/guides/${slug}/${hash ? `#${hash}` : ""}`;
/** The guide that explains a trade-table flag; null when there is none (e.g. "under review"). */
export function flagHref(flag: string, source: string): string | null {
  const form4 = source === "sec_form4";
  switch (flag) {
    case "late": return form4 ? G("what-is-form-4", "when") : G("late-congressional-trade-disclosures", "how-counted");
    case "10b5-1 plan": return G("rule-10b5-1-trading-plans");
    case "derivative": return G("insider-options-and-derivatives");
    case "also in another filing": return G("ten-percent-owners-and-joint-filings", "joint");
    case "spouse": case "joint": case "child": case "dependent": return G("how-to-read-a-congressional-trade-report", "columns");
    default: return null;
  }
}

// ── glossary ─────────────────────────────────────────────────────────────────────────────
export interface Term { re: RegExp; slug: string }
/** Order matters: longer, more specific phrases first. Every slug must be a real guide (tested). */
export const GLOSSARY: Term[] = [
  { re: /\bperiodic transaction reports?\b/i, slug: "how-to-read-a-congressional-trade-report" },
  { re: /\bRule 10b5-1 plans?\b|\b10b5-1 plans?\b/i, slug: "rule-10b5-1-trading-plans" },
  { re: /\btransaction codes?\b/i, slug: "form-4-transaction-codes" },
  { re: /\bcluster buys?\b|\bopen-market purchases?\b/i, slug: "insider-buying-vs-insider-selling" },
  { re: /\boption exercises?\b|\bderivative (?:rows?|securit(?:y|ies))\b/i, slug: "insider-options-and-derivatives" },
  { re: /\b10% owners?\b|\bten[- ]percent owners?\b/i, slug: "ten-percent-owners-and-joint-filings" },
  { re: /\bForm 4s?\b/, slug: "what-is-form-4" },
  { re: /\bSTOCK Act\b/, slug: "congress-stock-trading-rules" },
  { re: /\bdollar ranges?\b|\bamount ranges?\b/i, slug: "congress-trade-amount-ranges" },
  { re: /\blate (?:reports?|filings?|disclosures?)\b|\breported late\b/i, slug: "late-congressional-trade-disclosures" },
  { re: /\btrade maps?\b/i, slug: "how-to-use-the-trade-map" },
  { re: /\blobbying (?:reports?|filings?|disclosures?)\b/i, slug: "lobbying-disclosure-reports" },
  { re: /\bfederal contracts?\b|\bUSAspending\b/i, slug: "federal-contracts-usaspending" },
  { re: /\bcampaign (?:donations?|contributions?)\b/i, slug: "campaign-donations-fec-data" },
  { re: /\bI bonds?\b/, slug: "how-i-bond-rates-work" },
  { re: /\byield curve\b/i, slug: "treasury-yield-curve-explained" },
  { re: /\bTIPS\b|\breal yields?\b/, slug: "tips-real-yields-and-breakeven-inflation" },
];
const SKIP = /^(a|h[1-6]|code|pre|table|button|summary|script|style)$/i;

/**
 * Link the first mention of each glossary term in `html`. `used` carries the terms already
 * linked (or hand-linked) on the page across calls, so each guide is linked at most once per
 * page. Returns the html unchanged when nothing applies.
 */
export function autolink(html: string, opts: { self: string; used: Set<string>; terms?: Term[]; max?: number }): string {
  const terms = (opts.terms ?? GLOSSARY).filter((t) => t.slug !== opts.self);
  // A guide the passage already links by hand is taken, wherever in the passage the link is.
  for (const m of html.matchAll(/href="\/guides\/([a-z0-9-]+)\//g)) opts.used.add(m[1]!);
  let budget = opts.max ?? 4;
  const parts = html.split(/(<[^>]+>)/);
  const open: string[] = [];
  for (let i = 0; i < parts.length && budget > 0; i++) {
    const part = parts[i]!;
    if (part.startsWith("<")) {
      const m = part.match(/^<\s*(\/)?\s*([a-zA-Z0-9]+)/);
      if (!m || /\/>$/.test(part)) continue;
      const tag = m[2]!.toLowerCase();
      if (m[1]) { const at = open.lastIndexOf(tag); if (at >= 0) open.length = at; } else if (!/^(br|hr|img|input|meta|link|wbr)$/.test(tag)) open.push(tag);
      continue;
    }
    if (!part.trim() || open.some((t) => SKIP.test(t))) continue;
    let text = part;
    for (const t of terms) {
      if (budget <= 0) break;
      if (opts.used.has(t.slug)) continue;
      // Work only on text that is not inside a link this pass has just added.
      const segs = text.split(/(<a [^>]*>[^<]*<\/a>)/);
      for (let s = 0; s < segs.length; s++) {
        if (segs[s]!.startsWith("<a ")) continue;
        const hit = t.re.exec(segs[s]!);
        if (!hit) continue;
        segs[s] = `${segs[s]!.slice(0, hit.index)}<a href="/guides/${t.slug}/" data-auto>${hit[0]}</a>${segs[s]!.slice(hit.index + hit[0].length)}`;
        opts.used.add(t.slug); budget--;
        break;
      }
      text = segs.join("");
    }
    parts[i] = text;
  }
  return parts.join("");
}
