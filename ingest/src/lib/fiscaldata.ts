// Thin client for the U.S. Treasury Fiscal Data API.
// Base + docs: https://fiscaldata.treasury.gov/api-documentation/
// RESTful, JSON, GET only, NO API KEY REQUIRED.

const BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/";

export interface FiscalDataResponse<Row = Record<string, unknown>> {
  data: Row[];
  meta: {
    count: number;
    labels?: Record<string, string>;
    dataTypes?: Record<string, string>;
    "total-count"?: number;
    "total-pages"?: number;
  };
  links?: Record<string, string | null>;
}

export interface FiscalDataQuery {
  /** comma-separated field list (optional; omit for all) */
  fields?: string;
  /** Fiscal Data filter expression, e.g. "record_date:gte:2020-01-01" */
  filter?: string;
  /** sort expression, e.g. "-record_date" for descending */
  sort?: string;
  pageSize?: number;
  pageNumber?: number;
}

/**
 * Fetch one page from a Fiscal Data endpoint.
 * @param endpoint path after the base, e.g. "v2/accounting/od/i_bonds_rates"
 */
export async function fiscalData<Row = Record<string, unknown>>(
  endpoint: string,
  query: FiscalDataQuery = {},
): Promise<FiscalDataResponse<Row>> {
  const url = new URL(endpoint.replace(/^\//, ""), BASE);
  if (query.fields) url.searchParams.set("fields", query.fields);
  if (query.filter) url.searchParams.set("filter", query.filter);
  if (query.sort) url.searchParams.set("sort", query.sort);
  url.searchParams.set("page[size]", String(query.pageSize ?? 100));
  url.searchParams.set("page[number]", String(query.pageNumber ?? 1));

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `Fiscal Data ${res.status} for ${url.pathname}. ` +
        `If 404, confirm the endpoint path in the dataset's "API Quick Guide" ` +
        `at https://fiscaldata.treasury.gov/datasets/i-bonds-interest-rates/`,
    );
  }
  return (await res.json()) as FiscalDataResponse<Row>;
}
