// JSON-LD builders (schema.org) for entity and collection pages — roadmap B.2.
// Person / Organization for profiles, Dataset + DataCatalog for collections, BreadcrumbList
// everywhere. Kept as plain objects so the sitemap and the pages share one source of truth.

export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL ?? "https://spotthemoney.com").replace(/\/$/, "");
export const SITE_NAME = "Spot the Money";
export const PUBLISHER = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  logo: { "@type": "ImageObject", url: `${SITE_URL}/mark.svg` },
};

export const LICENSE_NOTE =
  "Public U.S. government records (SEC EDGAR, House Clerk, FEC, USAspending, Senate LDA, U.S. Treasury, BLS), rendered as filed. Attribution to spotthemoney.com requested when reused.";

export interface Crumb { name: string; path: string }

export function breadcrumbList(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE_URL}${c.path}`,
    })),
  };
}

export function personLd(opts: { name: string; path: string; jobTitle?: string | null; worksFor?: { name: string; path?: string | null } | null; description: string; sameAs?: string[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${SITE_URL}${opts.path}#person`,
    name: opts.name,
    url: `${SITE_URL}${opts.path}`,
    description: opts.description,
    ...(opts.jobTitle ? { jobTitle: opts.jobTitle } : {}),
    ...(opts.worksFor ? { worksFor: { "@type": "Organization", name: opts.worksFor.name, ...(opts.worksFor.path ? { url: `${SITE_URL}${opts.worksFor.path}` } : {}) } } : {}),
    ...(opts.sameAs?.length ? { sameAs: opts.sameAs } : {}),
    subjectOf: { "@type": "WebPage", url: `${SITE_URL}${opts.path}`, publisher: PUBLISHER },
  };
}

export function organizationLd(opts: { name: string; path: string; tickerSymbol?: string | null; description: string; sameAs?: string[]; identifier?: { name: string; value: string } | null }) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}${opts.path}#organization`,
    name: opts.name,
    url: `${SITE_URL}${opts.path}`,
    description: opts.description,
    ...(opts.tickerSymbol ? { tickerSymbol: opts.tickerSymbol } : {}),
    ...(opts.identifier ? { identifier: { "@type": "PropertyValue", name: opts.identifier.name, value: opts.identifier.value } } : {}),
    ...(opts.sameAs?.length ? { sameAs: opts.sameAs } : {}),
    subjectOf: { "@type": "WebPage", url: `${SITE_URL}${opts.path}`, publisher: PUBLISHER },
  };
}

export function datasetLd(opts: { name: string; path: string; description: string; dateModified: string; keywords?: string[]; sources?: { name: string; url: string }[]; temporalCoverage?: string; parentCatalogPath?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": `${SITE_URL}${opts.path}#dataset`,
    name: opts.name,
    url: `${SITE_URL}${opts.path}`,
    description: opts.description,
    dateModified: opts.dateModified,
    license: "https://creativecommons.org/licenses/by/4.0/",
    isAccessibleForFree: true,
    creator: PUBLISHER,
    publisher: PUBLISHER,
    ...(opts.keywords?.length ? { keywords: opts.keywords } : {}),
    ...(opts.temporalCoverage ? { temporalCoverage: opts.temporalCoverage } : {}),
    ...(opts.sources?.length ? { isBasedOn: opts.sources.map((s) => ({ "@type": "Dataset", name: s.name, url: s.url })) } : {}),
    includedInDataCatalog: { "@type": "DataCatalog", "@id": `${SITE_URL}${opts.parentCatalogPath ?? "/"}#catalog`, name: `${SITE_NAME} data catalog`, url: `${SITE_URL}${opts.parentCatalogPath ?? "/"}` },
  };
}

export function dataCatalogLd(opts: { path: string; name: string; description: string; datasets: { name: string; path: string }[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "DataCatalog",
    "@id": `${SITE_URL}${opts.path}#catalog`,
    name: opts.name,
    url: `${SITE_URL}${opts.path}`,
    description: opts.description,
    publisher: PUBLISHER,
    dataset: opts.datasets.map((d) => ({ "@type": "Dataset", name: d.name, url: `${SITE_URL}${d.path}` })),
  };
}

export const SOURCES = {
  edgar: { name: "SEC EDGAR Form 4 filings", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4" },
  house: { name: "U.S. House Clerk financial disclosures", url: "https://disclosures-clerk.house.gov/FinancialDisclosure" },
  senate: { name: "U.S. Senate electronic financial disclosures", url: "https://efdsearch.senate.gov/search/" },
  fec: { name: "FEC campaign finance data (OpenFEC)", url: "https://www.fec.gov/data/" },
  usaspending: { name: "USAspending.gov award data", url: "https://www.usaspending.gov/" },
  lda: { name: "Senate Lobbying Disclosure Act filings", url: "https://lda.senate.gov/" },
  treasury: { name: "U.S. Treasury daily yield curve rates", url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates" },
  fiscaldata: { name: "Treasury Fiscal Data — I Bonds interest rates", url: "https://fiscaldata.treasury.gov/datasets/i-bonds-interest-rates/" },
  bls: { name: "BLS Consumer Price Index (CPI-U)", url: "https://www.bls.gov/cpi/" },
};

export function edgarFilingUrl(sourceUrl: string | null): string | null {
  // ownership-XML URL → the filing's index page for humans.
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/^(https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d+)\//);
  return m ? `${m[1]}/` : sourceUrl;
}
