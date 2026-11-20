// World stock markets by size (/markets/largest-stock-exchanges/). Unlike the rest of the site
// this is not read from the database: the World Federation of Exchanges publishes one monthly
// table, about two months behind, so the figures are typed in here, exactly as published, in
// USD millions. To update: replace the figures from the next issue's table, then change `WFE`
// below (issue, URL, asOf, retrieved). Every number the page, the charts, the tables and the
// CSV show is derived from this file. No total, multiple or gap is typed in anywhere.

/** The page these figures feed. /markets/ redirects here until a second markets page exists. */
export const MARKETS_PATH = "/markets/largest-stock-exchanges/";

export const WFE = {
  name: "World Federation of Exchanges",
  publication: "Focus Market Statistics",
  issue: "November 2026",
  table: "Equity - Domestic market capitalisation (USD millions)",
  url: "https://focus.world-exchanges.org/issue/november-2026/market-statistics",
  /** The month the figures are for (the table's newest column). */
  asOf: "2026-09",
  asOfLabel: "September 2026",
  /** The day the figures were read from the source. */
  retrieved: "2026-11-19",
} as const;

export interface Exchange {
  /** Name as this site shows it. */
  label: string;
  /** A shorter name for phone-width charts. */
  short?: string;
  /** ISO 3166 code of the flag drawn beside it (lib/flags.ts). */
  flag: string;
  /** Domestic market capitalisation, USD millions, exactly as WFE published it. */
  usdMillions: number;
}

const NASDAQ_US: Exchange = { label: "Nasdaq", flag: "us", usdMillions: 45_117_946.26 };
const NYSE: Exchange = { label: "NYSE", flag: "us", usdMillions: 33_593_016.5 };
const EURONEXT: Exchange = { label: "Euronext", flag: "eu", usdMillions: 7_973_738.97 };
const DEUTSCHE_BOERSE: Exchange = { label: "Deutsche Börse", flag: "de", usdMillions: 2_774_757.47 };
// Stockholm-based, so it carries Sweden's flag.
const NASDAQ_NORDIC: Exchange = { label: "Nasdaq Nordic and Baltics", short: "Nasdaq Nordic", flag: "se", usdMillions: 2_334_520.01 };
const BME: Exchange = { label: "BME Spanish Exchanges", short: "BME Spain", flag: "es", usdMillions: 1_375_321.12 };

const SHANGHAI: Exchange = { label: "Shanghai Stock Exchange", short: "Shanghai", flag: "cn", usdMillions: 10_174_142.45 };
const SHENZHEN: Exchange = { label: "Shenzhen Stock Exchange", short: "Shenzhen", flag: "cn", usdMillions: 7_138_814.4 };
const HONG_KONG: Exchange = { label: "Hong Kong Exchanges", flag: "hk", usdMillions: 5_795_895.06 };

/** One bar of the ranking: a single exchange, or (United States) two exchanges stacked. */
export interface MarketBar { label: string; short?: string; flag: string; parts: Exchange[] }
const one = (e: Exchange): MarketBar => ({ label: e.label, short: e.short, flag: e.flag, parts: [e] });

/** Sum in whole cents so that float error never reaches a displayed figure. */
export const sumMillions = (xs: { usdMillions: number }[]): number => xs.reduce((a, x) => a + Math.round(x.usdMillions * 100), 0) / 100;
export const barMillions = (b: MarketBar): number => sumMillions(b.parts);

export const UNITED_STATES: MarketBar = { label: "United States (Nasdaq + NYSE)", short: "United States", flag: "us", parts: [NASDAQ_US, NYSE] };

/** Chart 1: the eighteen bars, largest first (sorted here, not by hand). */
export const LARGEST_MARKETS: MarketBar[] = [
  UNITED_STATES,
  one(SHANGHAI),
  one({ label: "Japan Exchange Group", flag: "jp", usdMillions: 8_872_885.93 }),
  one(EURONEXT),
  one(SHENZHEN),
  one(HONG_KONG),
  one({ label: "TMX Group", flag: "ca", usdMillions: 4_963_725.58 }),
  one({ label: "Taiwan Stock Exchange", short: "Taiwan", flag: "tw", usdMillions: 4_915_156.93 }),
  one({ label: "NSE India", flag: "in", usdMillions: 4_904_475.25 }),
  one({ label: "Korea Exchange", flag: "kr", usdMillions: 4_501_110.15 }),
  one(DEUTSCHE_BOERSE),
  one({ label: "SIX Swiss Exchange", flag: "ch", usdMillions: 2_526_434.32 }),
  one({ label: "Saudi Exchange (Tadawul)", short: "Saudi Exchange", flag: "sa", usdMillions: 2_433_595.44 }),
  one({ label: "ASX", flag: "au", usdMillions: 2_356_677.37 }),
  one(NASDAQ_NORDIC),
  one({ label: "Johannesburg Stock Exchange", short: "Johannesburg", flag: "za", usdMillions: 1_562_222.78 }),
  one(BME),
  one({ label: "B3", flag: "br", usdMillions: 1_079_991.35 }),
].sort((a, b) => barMillions(b) - barMillions(a));

/** In the WFE table but left off the ranking: it lists largely the same companies as NSE India. */
export const BSE_INDIA: Exchange = { label: "BSE India", flag: "in", usdMillions: 4_911_150.59 };

/** Chart 2: the EU-based exchanges in the WFE table, summed into the European Union bar. */
export const EU_EXCHANGES: Exchange[] = [
  EURONEXT, DEUTSCHE_BOERSE, NASDAQ_NORDIC, BME,
  { label: "Warsaw Stock Exchange", flag: "pl", usdMillions: 381_706.67 },
  { label: "Vienna Stock Exchange", flag: "at", usdMillions: 252_899.82 },
  { label: "Athens Stock Exchange", flag: "gr", usdMillions: 171_255.59 },
  { label: "Luxembourg Stock Exchange", flag: "lu", usdMillions: 85_316.58 },
  { label: "Bucharest Stock Exchange", flag: "ro", usdMillions: 84_859.27 },
  { label: "Budapest Stock Exchange", flag: "hu", usdMillions: 74_108.69 },
  { label: "Prague Stock Exchange", flag: "cz", usdMillions: 53_060.94 },
  { label: "Zagreb Stock Exchange", flag: "hr", usdMillions: 40_256.27 },
  { label: "Cyprus Stock Exchange", flag: "cy", usdMillions: 35_311.8 },
  { label: "Ljubljana Stock Exchange", flag: "si", usdMillions: 25_311.64 },
  { label: "Bulgarian Stock Exchange", flag: "bg", usdMillions: 12_944.43 },
  { label: "Malta Stock Exchange", flag: "mt", usdMillions: 5_874.59 },
  { label: "Bratislava Stock Exchange", flag: "sk", usdMillions: 3_308.91 },
].sort((a, b) => b.usdMillions - a.usdMillions);

/** Chart 2: China is the mainland's exchanges in the WFE table, Shanghai and Shenzhen. The Beijing Stock
 *  Exchange is not in the table. Hong Kong is a separate market with its own bar in the ranking and is
 *  not added in (`HONG_KONG_EXCHANGE` is exported so the page can say what adding it would give). */
export const CHINA_EXCHANGES: Exchange[] = [SHANGHAI, SHENZHEN];
export const HONG_KONG_EXCHANGE = HONG_KONG;

export const US_MILLIONS = barMillions(UNITED_STATES);
export const EU_MILLIONS = sumMillions(EU_EXCHANGES);
export const US_EU_MULTIPLE = US_MILLIONS / EU_MILLIONS;
export const US_EU_GAP_MILLIONS = Math.round((US_MILLIONS - EU_MILLIONS) * 100) / 100;
export const CHINA_MILLIONS = sumMillions(CHINA_EXCHANGES);
export const US_CHINA_MULTIPLE = US_MILLIONS / CHINA_MILLIONS;

/** USD millions as "$78.71T". Chart 1 uses two decimals, chart 2 one. */
export const trillions = (usdMillions: number, decimals = 2): string => `$${(usdMillions / 1e6).toFixed(decimals)}T`;
/** USD millions as published: "78,710,962.76". */
export const millions = (usdMillions: number): string => usdMillions.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The rows of world-stock-markets.csv: the same rows the page's three tables show. */
export interface MarketCsvRow { section: string; rank: number; market: string; components: string; flag: string; usdMillions: number }
export function marketCsvRows(): MarketCsvRow[] {
  return [
    ...LARGEST_MARKETS.map((b, i) => ({
      section: "largest_stock_markets", rank: i + 1, market: b.label, flag: b.flag, usdMillions: barMillions(b),
      components: b.parts.length > 1 ? b.parts.map((p) => `${p.label} ${p.usdMillions.toFixed(2)}`).join(" + ") : "",
    })),
    ...[
      { market: "United States", flag: "us", usdMillions: US_MILLIONS, components: UNITED_STATES.parts.map((p) => p.label).join(" + ") },
      { market: "European Union", flag: "eu", usdMillions: EU_MILLIONS, components: `${EU_EXCHANGES.length} EU-based exchanges` },
      { market: "China", flag: "cn", usdMillions: CHINA_MILLIONS, components: CHINA_EXCHANGES.map((p) => p.label).join(" + ") },
    ].sort((a, b) => b.usdMillions - a.usdMillions).map((r, i) => ({ section: "united_states_eu_china", rank: i + 1, ...r })),
    ...EU_EXCHANGES.map((e, i) => ({ section: "eu_exchanges_summed", rank: i + 1, market: e.label, flag: e.flag, usdMillions: e.usdMillions, components: "" })),
  ];
}
