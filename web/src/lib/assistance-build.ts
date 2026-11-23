// Federal assistance awards: the database read (lib/assistance.ts has the pure rules).
// Called once per build from lib/flagship.ts in its own try/catch.
import type { Company } from "./flagship-core";
import { ASSISTANCE_WINDOW_DAYS, cleanText, emptyAssistance, matchCompanies, type AssistanceData, type AssistanceKind, type AssistanceRow } from "./assistance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
interface Row {
  id: number; source_ref: string; award_id: string | null; kind: string; award_type: string | null; recipient: string; recipient_uei: string | null;
  awarding_agency: string | null; awarding_sub_agency: string | null; amount: number | null; subsidy_cost: number | null;
  start_date: string | null; end_date: string | null; description: string | null; assistance_listing: string | null;
}
const KINDS = new Set(["grant", "direct_payment", "loan", "other"]);

/** One statement; awards that started in the window, never after today. */
export async function loadAssistance(sql: Sql, companies: Iterable<Company>): Promise<AssistanceData> {
  const out = emptyAssistance();
  const rows = (await sql`
    select id, source_ref, award_id, kind, award_type, recipient, recipient_uei, awarding_agency, awarding_sub_agency,
           amount::float8 as amount, subsidy_cost::float8 as subsidy_cost, start_date::text as start_date, end_date::text as end_date,
           description, assistance_listing
      from assistance_awards
     where start_date >= current_date - ${ASSISTANCE_WINDOW_DAYS}::int and start_date <= current_date
     order by amount desc nulls last, id`) as Row[];
  out.rows = rows.filter((r) => KINDS.has(r.kind)).map((r): AssistanceRow => ({
    id: Number(r.id), sourceRef: r.source_ref, awardId: r.award_id, kind: r.kind as AssistanceKind, awardType: cleanText(r.award_type, 200),
    recipient: cleanText(r.recipient, 300) ?? "(not stated)", recipientUei: r.recipient_uei, agency: cleanText(r.awarding_agency, 200), subAgency: cleanText(r.awarding_sub_agency, 200),
    amount: r.amount, subsidyCost: r.subsidy_cost, startDate: r.start_date, endDate: r.end_date, description: cleanText(r.description), listing: cleanText(r.assistance_listing, 200),
  }));
  out.byCompany = matchCompanies(out.rows, [...companies].map((c) => ({ id: c.id, name: c.name, slug: c.slug })));
  return out;
}
