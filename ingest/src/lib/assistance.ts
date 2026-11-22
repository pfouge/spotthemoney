// Pure helpers for the USAspending financial-assistance job (sources/usaspending_assistance.ts).
// No I/O here, so every rule is unit-tested (assistance.test.ts).
//
// The award search rejects a request that mixes award-type groups, so each group is asked
// separately, and the field names differ: loans have "Loan Value", "Subsidy Cost" and
// "Issued Date" where grants and direct payments have "Award Amount", "Start Date", "End Date".

import { cleanText, dateOnly, parseAmount } from "../sources/usaspending.js";

export type AssistanceKind = "grant" | "direct_payment" | "loan" | "other";

export interface KindSpec {
  kind: AssistanceKind;
  /** Award type codes of the group (the API wants one group per request). */
  codes: string[];
  /** Extra codes tried first; dropped as a set if the API rejects them. */
  extraCodes: string[];
  /** Fields the job cannot do without; a rejection of one of these is a real failure. */
  required: string[];
  /** Fields that may be dropped one at a time when the API rejects them. */
  optional: string[];
  amountField: string;
  startField: string;
  endField: string | null;
}

const COMMON_OPTIONAL = ["Awarding Sub Agency", "Description", "Recipient UEI", "Assistance Listings", "Award Type"];

export const KIND_SPECS: Record<AssistanceKind, KindSpec> = {
  grant: {
    kind: "grant",
    codes: ["02", "03", "04", "05"],
    extraCodes: ["F001", "F002"],
    required: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Start Date"],
    optional: ["End Date", ...COMMON_OPTIONAL],
    amountField: "Award Amount",
    startField: "Start Date",
    endField: "End Date",
  },
  direct_payment: {
    kind: "direct_payment",
    codes: ["06", "10"],
    extraCodes: ["F006", "F007"],
    required: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Start Date"],
    optional: ["End Date", ...COMMON_OPTIONAL],
    amountField: "Award Amount",
    startField: "Start Date",
    endField: "End Date",
  },
  loan: {
    kind: "loan",
    codes: ["07", "08"],
    extraCodes: ["F003", "F004"],
    required: ["Award ID", "Recipient Name", "Loan Value", "Awarding Agency", "Issued Date"],
    optional: ["Subsidy Cost", ...COMMON_OPTIONAL.filter((f) => f !== "Award Type")],
    amountField: "Loan Value",
    startField: "Issued Date",
    endField: null,
  },
  other: {
    kind: "other",
    codes: ["09", "11", "-1"],
    extraCodes: [],
    required: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Start Date"],
    optional: ["End Date", ...COMMON_OPTIONAL],
    amountField: "Award Amount",
    startField: "Start Date",
    endField: "End Date",
  },
};

/** The kinds searched slice by slice (largest awards). "other" is reached only through company searches. */
export const SLICED_KINDS: AssistanceKind[] = ["grant", "direct_payment", "loan"];
export const ALL_KINDS: AssistanceKind[] = ["grant", "direct_payment", "loan", "other"];

export const DESCRIPTION_MAX = 1000;
export const LISTING_MAX = 200;

const MASKED = [/^MULTIPLE RECIPIENTS$/i, /^REDACTED DUE TO PII$/i, /^MISCELLANEOUS FOREIGN AWARDEES$/i, /^MULTIPLE FOREIGN RECIPIENTS$/i];

/** Recipients USAspending masks by law; stored as returned, only counted. */
export function isMaskedRecipient(name: string | null | undefined): boolean {
  if (!name) return false;
  const t = name.trim();
  return MASKED.some((re) => re.test(t));
}

/** "Assistance Listings" has come back as text, a list of {cfda_number, cfda_program_title} or a list of text. */
export function listingText(v: unknown): string | null {
  const one = (x: unknown): string | null => {
    if (typeof x === "string") return cleanText(x, LISTING_MAX);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const num = o["cfda_number"] ?? o["assistance_listing_number"] ?? o["number"];
      const title = o["cfda_program_title"] ?? o["cfda_title"] ?? o["title"];
      const t = [num, title].filter((p) => typeof p === "string" || typeof p === "number").map(String).join(" ");
      return cleanText(t, LISTING_MAX);
    }
    return null;
  };
  if (Array.isArray(v)) return cleanText(v.map(one).filter(Boolean).join("; "), LISTING_MAX);
  return one(v);
}

export interface AssistanceRecord {
  sourceRef: string;
  awardId: string | null;
  kind: AssistanceKind;
  awardType: string | null;
  recipient: string;
  recipientUei: string | null;
  awardingAgency: string | null;
  awardingSubAgency: string | null;
  amount: number | null;
  subsidyCost: number | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  assistanceListing: string | null;
  masked: boolean;
}

/** Shape guard for the first answer: results is a list of objects carrying generated_internal_id. */
export function looksLikeSearchAnswer(resp: unknown): boolean {
  if (!resp || typeof resp !== "object") return false;
  const results = (resp as { results?: unknown }).results;
  if (!Array.isArray(results)) return false;
  if (results.length === 0) return true; // an empty slice is a valid answer
  return results.every((r) => r && typeof r === "object" && typeof (r as Record<string, unknown>)["generated_internal_id"] === "string");
}

/** One API row to a record; null (with a reason) when it cannot be stored. */
export function parseAssistanceRow(
  row: Record<string, unknown>,
  kind: AssistanceKind,
): { ok: true; rec: AssistanceRecord } | { ok: false; reason: string } {
  const spec = KIND_SPECS[kind];
  const sourceRef = row["generated_internal_id"];
  if (typeof sourceRef !== "string" || !sourceRef) return { ok: false, reason: "missing generated_internal_id" };
  const recipientRaw = row["Recipient Name"];
  const recipient = typeof recipientRaw === "string" ? recipientRaw.replace(/\s+/g, " ").trim() : "";
  if (!recipient) return { ok: false, reason: "missing recipient name" };
  const awardId = row["Award ID"];
  const typeRaw = row["Award Type"];
  return {
    ok: true,
    rec: {
      sourceRef,
      awardId: typeof awardId === "string" || typeof awardId === "number" ? String(awardId) : null,
      kind,
      awardType: cleanText(typeRaw, 100),
      recipient,
      recipientUei: cleanText(row["Recipient UEI"], 20),
      awardingAgency: cleanText(row["Awarding Agency"], 200),
      awardingSubAgency: cleanText(row["Awarding Sub Agency"], 200),
      amount: parseAmount(row[spec.amountField]),
      subsidyCost: kind === "loan" ? parseAmount(row["Subsidy Cost"]) : null,
      startDate: dateOnly(row[spec.startField]) ?? (kind === "loan" ? dateOnly(row["Start Date"]) : null),
      endDate: spec.endField ? dateOnly(row[spec.endField]) : null,
      description: cleanText(row["Description"], DESCRIPTION_MAX),
      assistanceListing: listingText(row["Assistance Listings"]),
      masked: isMaskedRecipient(recipient),
    },
  };
}
