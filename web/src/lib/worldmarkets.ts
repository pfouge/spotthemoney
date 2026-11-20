// World stock markets by size (/markets/largest-stock-exchanges/). Unlike the rest of the site
// this is not read from the database. The World Federation of Exchanges publishes one monthly
// table, about two months behind, so its figures are typed in here, exactly as published, in
// USD millions. The London Stock Exchange is not in that table: its figure comes from the
// exchange's own monthly factsheet, in pounds, converted at one stated rate (see `LSE`).
//
// To update: replace the WFE figures from the next issue's table and change `WFE` (issue, URL,
// asOf, retrieved); replace the two `LSE` inputs from the same month's factsheet and month-end
// rate. An exchange that is missing from a month's table is taken off the lists and named in
// `NOT_IN_TABLE`. Every number the page, the charts, the tables and the CSV show is derived
// from this file. No total, multiple or gap is typed in anywhere.

/** The page these figures feed. /markets/ redirects here until a second markets page exists. */
export const MARKETS_PATH = "/markets/largest-stock-exchanges/";

export const WFE = {
  name: "World Federation of Exchanges",
  publication: "Focus Market Statistics",
  issue: "December 2026",
  table: "Equity - Domestic market capitalisation (USD millions)",
  url: "https://focus.world-exchanges.org/issue/december-2026/market-statistics",
  /** The month the figures are for (the table's newest column). */
  asOf: "2026-10",
  asOfLabel: "October 2026",
  /** The day the figures were read from the source. */
  retrieved: "2026-11-19",
} as const;

/** The United Kingdom's figure. Same month as WFE, different publisher, so it is always labelled. */
export const LSE = {
  name: "London Stock Exchange",
  publication: "Main Market factsheet, October 2026",
  url: "https://docs.londonstockexchange.com/reports/main-market/Main%20Market%20factsheet%20October%202026.xlsx",
  /** "Market Value (£m)", UK companies on the Main Market, as published (741 companies). */
  ukMainMarketGbpMillions: 3_092_744.89,
  ukMainMarketCompanies: 741,
  /** AIM's market value (£m, all 594 companies). Not added: the factsheet does not split it by country. */
  aimGbpMillions: 59_662.71,
  /** US dollars per pound on the last trading day of the month: the Bank of England's daily spot
   *  rate for 30 October 2026, published as $1 = £0.7465. */
  usdPerGbp: 1.3396,
  rateDate: "2026-10-30",
  rateSource: "Bank of England daily spot rate",
  rateUrl: "https://www.poundsterlinglive.com/bank-of-england-spot/historical-spot-exchange-rates/usd/USD-to-GBP-2026",
} as const;

export type SourceKey = "wfe" | "lse";

export interface Exchange {
  /** Name as this site shows it. */
  label: string;
  /** A shorter name for phone-width charts. */
  short?: string;
  /** ISO 3166 code of the flag drawn beside it (lib/flags.ts). Only chart rows need a vendored flag. */
  flag: string;
  /** Domestic market capitalisation, USD millions. WFE figures are exactly as published. */
  usdMillions: number;
  /** Where the figure comes from. Default "wfe". */
  source?: SourceKey;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const NASDAQ_US: Exchange = { label: "Nasdaq", flag: "us", usdMillions: 42_710_693.5 };
const NYSE: Exchange = { label: "NYSE", flag: "us", usdMillions: 33_220_308.62 };
const SHANGHAI: Exchange = { label: "Shanghai Stock Exchange", short: "Shanghai", flag: "cn", usdMillions: 10_549_992.81 };
const SHENZHEN: Exchange = { label: "Shenzhen Stock Exchange", short: "Shenzhen", flag: "cn", usdMillions: 5_463_759.54 };
const HONG_KONG: Exchange = { label: "Hong Kong Exchanges", flag: "hk", usdMillions: 5_406_012.71 };
const EURONEXT: Exchange = { label: "Euronext", flag: "eu", usdMillions: 7_905_067.68 };
const DEUTSCHE_BOERSE: Exchange = { label: "Deutsche Börse", flag: "de", usdMillions: 2_786_010.71 };
// Stockholm-based, so it carries Sweden's flag.
const NASDAQ_NORDIC: Exchange = { label: "Nasdaq Nordic and Baltics", short: "Nasdaq Nordic", flag: "se", usdMillions: 2_370_981.69 };
const BME: Exchange = { label: "BME Spanish Exchanges", short: "BME Spain", flag: "es", usdMillions: 1_306_351.51 };
const TMX: Exchange = { label: "TMX Group", flag: "ca", usdMillions: 5_086_611.24 };
const NSE_INDIA: Exchange = { label: "NSE India", flag: "in", usdMillions: 4_860_305.79 };
const ASX: Exchange = { label: "ASX", flag: "au", usdMillions: 2_270_762.05 };
const JSE: Exchange = { label: "Johannesburg Stock Exchange", short: "Johannesburg", flag: "za", usdMillions: 1_387_415.67 };
const CYPRUS: Exchange = { label: "Cyprus Stock Exchange", flag: "cy", usdMillions: 32_547.51 };
const MALTA: Exchange = { label: "Malta Stock Exchange", flag: "mt", usdMillions: 5_629.08 };

/** UK companies on the London Stock Exchange's Main Market, pounds converted to dollars. */
export const LONDON: Exchange = {
  label: "London Stock Exchange (LSE data)", short: "London (LSE data)", flag: "gb", source: "lse",
  usdMillions: round2(LSE.ukMainMarketGbpMillions * LSE.usdPerGbp),
};

/** One bar of the ranking: a single exchange, or (United States) two exchanges stacked. */
export interface MarketBar { label: string; short?: string; flag: string; parts: Exchange[] }
const one = (e: Exchange): MarketBar => ({ label: e.label, short: e.short, flag: e.flag, parts: [e] });

/** Sum in whole cents so that float error never reaches a displayed figure. */
export const sumMillions = (xs: { usdMillions: number }[]): number => xs.reduce((a, x) => a + Math.round(x.usdMillions * 100), 0) / 100;
export const barMillions = (b: MarketBar): number => sumMillions(b.parts);
export const barSource = (b: MarketBar): SourceKey => b.parts[0].source ?? "wfe";

export const UNITED_STATES: MarketBar = { label: "United States (Nasdaq + NYSE)", short: "United States", flag: "us", parts: [NASDAQ_US, NYSE] };

/** Chart 1: every market above US$1 trillion, largest first (sorted here, not by hand). */
export const LARGEST_MARKETS: MarketBar[] = [
  UNITED_STATES,
  one(SHANGHAI),
  one({ label: "Japan Exchange Group", flag: "jp", usdMillions: 8_544_563.53 }),
  one(EURONEXT),
  one(SHENZHEN),
  one(HONG_KONG),
  one(TMX),
  one(NSE_INDIA),
  one({ label: "Taiwan Stock Exchange", short: "Taiwan", flag: "tw", usdMillions: 4_535_519.69 }),
  one(LONDON),
  one({ label: "Korea Exchange", flag: "kr", usdMillions: 3_848_568.99 }),
  one(DEUTSCHE_BOERSE),
  one({ label: "SIX Swiss Exchange", flag: "ch", usdMillions: 2_755_610.12 }),
  one({ label: "Saudi Exchange (Tadawul)", short: "Saudi Exchange", flag: "sa", usdMillions: 2_431_563.99 }),
  one(NASDAQ_NORDIC),
  one(ASX),
  one(JSE),
  one(BME),
].sort((a, b) => barMillions(b) - barMillions(a));

/** In the WFE table but left off the ranking: it lists largely the same companies as NSE India. */
export const BSE_INDIA: Exchange = { label: "BSE India", flag: "in", usdMillions: 4_987_675.83 };

/** Exchanges this page would show that have no row in this month's WFE table. Absent, not zero.
 *  `last` is the newest figure WFE did publish for them, for the page's note. */
export const NOT_IN_TABLE: { label: string; last: { asOfLabel: string; usdMillions: number } }[] = [
  { label: "B3, Brazil's exchange,", last: { asOfLabel: "September 2026", usdMillions: 1_079_991.35 } },
];

/** Chart 2, European Union: the EU-based exchanges in the WFE table. */
export const EU_EXCHANGES: Exchange[] = [
  EURONEXT, DEUTSCHE_BOERSE, NASDAQ_NORDIC, BME, CYPRUS, MALTA,
  { label: "Warsaw Stock Exchange", flag: "pl", usdMillions: 371_802.61 },
  { label: "Vienna Stock Exchange", flag: "at", usdMillions: 237_166.5 },
  { label: "Athens Stock Exchange", flag: "gr", usdMillions: 161_394.35 },
  { label: "Bucharest Stock Exchange", flag: "ro", usdMillions: 98_105.62 },
  { label: "Luxembourg Stock Exchange", flag: "lu", usdMillions: 78_706.5 },
  { label: "Budapest Stock Exchange", flag: "hu", usdMillions: 72_655.12 },
  { label: "Prague Stock Exchange", flag: "cz", usdMillions: 52_719.21 },
  { label: "Zagreb Stock Exchange", flag: "hr", usdMillions: 40_221.6 },
  { label: "Ljubljana Stock Exchange", flag: "si", usdMillions: 24_186.57 },
  { label: "Bulgarian Stock Exchange", flag: "bg", usdMillions: 15_355.87 },
  { label: "Bratislava Stock Exchange", flag: "sk", usdMillions: 3_116.75 },
].sort((a, b) => b.usdMillions - a.usdMillions);

/** Chart 2, China: the mainland's two exchanges, the same figures as their bars in the ranking.
 *  Hong Kong is a separate market with its own bar and is not added in (`HONG_KONG_EXCHANGE` is
 *  exported so the page can say what adding it would give). The table's small over-the-counter
 *  market for mainland companies (NEEQ) is not added either. */
export const CHINA_EXCHANGES: Exchange[] = [SHANGHAI, SHENZHEN];
export const HONG_KONG_EXCHANGE = HONG_KONG;
export const CHINA_OTC: Exchange = { label: "National Equities Exchange and Quotations", flag: "cn", usdMillions: 64_088.47 };

/** Chart 2, Commonwealth: exchanges based in a member country of the Commonwealth of Nations
 *  that have a row in this month's WFE table, plus London from the LSE factsheet. India is
 *  counted once (NSE). Cyprus and Malta are also in the EU list. Not members, so not here:
 *  Bermuda (a British Overseas Territory) and the regional BRVM exchange. */
export const COMMONWEALTH_EXCHANGES: Exchange[] = [
  TMX, NSE_INDIA, LONDON, ASX, JSE, CYPRUS, MALTA,
  { label: "Singapore Exchange", flag: "sg", usdMillions: 879_515.27 },
  { label: "Bursa Malaysia", flag: "my", usdMillions: 490_777.26 },
  { label: "Nigerian Exchange", flag: "ng", usdMillions: 149_831.23 },
  { label: "NZX (New Zealand)", flag: "nz", usdMillions: 100_361.43 },
  { label: "Pakistan Stock Exchange", flag: "pk", usdMillions: 66_496.3 },
  { label: "Dhaka Stock Exchange", flag: "bd", usdMillions: 27_053.71 },
  { label: "Ghana Stock Exchange", flag: "gh", usdMillions: 23_011.51 },
  { label: "Colombo Stock Exchange", flag: "lk", usdMillions: 22_558.24 },
  { label: "Canadian Securities Exchange", flag: "ca", usdMillions: 14_768.14 },
  { label: "Jamaica Stock Exchange", flag: "jm", usdMillions: 13_935.54 },
  { label: "Lusaka Securities Exchange", flag: "zm", usdMillions: 13_202.42 },
  { label: "Stock Exchange of Mauritius", flag: "mu", usdMillions: 7_478.37 },
  { label: "Rwanda Stock Exchange", flag: "rw", usdMillions: 4_639.37 },
  { label: "Namibia Securities Exchange", flag: "na", usdMillions: 3_698.49 },
].sort((a, b) => b.usdMillions - a.usdMillions);
/** Commonwealth exchanges that were in WFE's table a month earlier and have no row this month. */
export const COMMONWEALTH_NOT_IN_TABLE = ["the Nairobi Securities Exchange (Kenya)", "the Dar es Salaam Stock Exchange (Tanzania)"];

export const US_MILLIONS = barMillions(UNITED_STATES);
export const EU_MILLIONS = sumMillions(EU_EXCHANGES);
export const CHINA_MILLIONS = sumMillions(CHINA_EXCHANGES);
export const COMMONWEALTH_MILLIONS = sumMillions(COMMONWEALTH_EXCHANGES);
export const US_EU_MULTIPLE = US_MILLIONS / EU_MILLIONS;
export const US_CHINA_MULTIPLE = US_MILLIONS / CHINA_MILLIONS;
export const US_COMMONWEALTH_MULTIPLE = US_MILLIONS / COMMONWEALTH_MILLIONS;
export const US_EU_GAP_MILLIONS = round2(US_MILLIONS - EU_MILLIONS);

/** Chart 2's bars. Colour class follows the market, never its rank. */
export interface Bloc { key: string; label: string; flag?: string; cls: string; usdMillions: number; summed: string; mixedSource?: boolean }
export const BLOCS: Bloc[] = [
  { key: "us", label: "United States", flag: "us", cls: "v-c2", usdMillions: US_MILLIONS, summed: UNITED_STATES.parts.map((p) => p.label).join(" + ") },
  { key: "commonwealth", label: "Commonwealth", cls: "v-c4", usdMillions: COMMONWEALTH_MILLIONS, summed: `${COMMONWEALTH_EXCHANGES.length} exchanges in Commonwealth countries, London included`, mixedSource: true },
  { key: "china", label: "China", flag: "cn", cls: "v-c3", usdMillions: CHINA_MILLIONS, summed: CHINA_EXCHANGES.map((p) => p.label).join(" + ") },
  { key: "eu", label: "European Union", flag: "eu", cls: "v-c1", usdMillions: EU_MILLIONS, summed: `${EU_EXCHANGES.length} EU-based exchanges` },
].sort((a, b) => b.usdMillions - a.usdMillions);

/** USD millions as "$78.71T". Chart 1 uses two decimals, chart 2 one. */
export const trillions = (usdMillions: number, decimals = 2): string => `$${(usdMillions / 1e6).toFixed(decimals)}T`;
/** USD millions as published: "78,710,962.76". */
export const millions = (usdMillions: number): string => usdMillions.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCE_TEXT: Record<SourceKey, { source: string; url: string }> = {
  wfe: { source: `${WFE.name}, ${WFE.publication}, ${WFE.issue}, ${WFE.table}`, url: WFE.url },
  lse: { source: `${LSE.name}, ${LSE.publication}, UK companies, GBP ${LSE.ukMainMarketGbpMillions.toFixed(2)} million at USD ${LSE.usdPerGbp} per GBP (${LSE.rateSource}, ${LSE.rateDate})`, url: LSE.url },
};
export const sourceText = (k: SourceKey) => SOURCE_TEXT[k];

/** The rows of world-stock-markets.csv: the same rows the page's tables show. */
export interface MarketCsvRow { section: string; rank: number; market: string; components: string; flag: string; usdMillions: number; source: string; sourceUrl: string }
export function marketCsvRows(): MarketCsvRow[] {
  const src = (k: SourceKey) => ({ source: SOURCE_TEXT[k].source, sourceUrl: SOURCE_TEXT[k].url });
  const mixed = { source: `${SOURCE_TEXT.wfe.source}; London: ${SOURCE_TEXT.lse.source}`, sourceUrl: WFE.url };
  return [
    ...LARGEST_MARKETS.map((b, i) => ({
      section: "largest_stock_markets", rank: i + 1, market: b.label, flag: b.flag, usdMillions: barMillions(b), ...src(barSource(b)),
      components: b.parts.length > 1 ? b.parts.map((p) => `${p.label} ${p.usdMillions.toFixed(2)}`).join(" + ") : "",
    })),
    ...BLOCS.map((b, i) => ({ section: "blocs_compared", rank: i + 1, market: b.label, flag: b.flag ?? "", usdMillions: b.usdMillions, components: b.summed, ...(b.mixedSource ? mixed : src("wfe")) })),
    ...EU_EXCHANGES.map((e, i) => ({ section: "eu_exchanges_summed", rank: i + 1, market: e.label, flag: e.flag, usdMillions: e.usdMillions, components: "", ...src(e.source ?? "wfe") })),
    ...COMMONWEALTH_EXCHANGES.map((e, i) => ({ section: "commonwealth_exchanges_summed", rank: i + 1, market: e.label, flag: e.flag, usdMillions: e.usdMillions, components: "", ...src(e.source ?? "wfe") })),
  ];
}
