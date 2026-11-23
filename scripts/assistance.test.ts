// Federal assistance (web/src/lib/assistance.ts). Run: npx tsx --test scripts/assistance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMasked, shortDescription, splitListing, programLabel, kindTotals, maskedCount, largest, agencyRows, programRows, kindSentence, maskedSentence, matchCompanies, emptyAssistance, assistanceLog, DESCRIPTION_SHOWN, type AssistanceRow } from "../web/src/lib/assistance";

const row = (o: Partial<AssistanceRow>): AssistanceRow => ({ id: 1, sourceRef: "X", awardId: "A", kind: "grant", awardType: null, recipient: "ACME CORP", recipientUei: null, agency: "Department of Energy", subAgency: null, amount: 100, subsidyCost: null, startDate: "2026-10-01", endDate: null, description: null, listing: null, ...o });

test("masked recipients", () => {
  assert.ok(isMasked("MULTIPLE RECIPIENTS"));
  assert.ok(isMasked("REDACTED DUE TO PII"));
  assert.ok(isMasked(null));
  assert.ok(!isMasked("NVIDIA CORP"));
});

test("shortDescription cuts at a word and cleans", () => {
  assert.equal(shortDescription("  a \n b "), "a b");
  assert.equal(shortDescription(""), null);
  const long = "WORD ".repeat(100);
  const s = shortDescription(long)!;
  assert.ok(s.endsWith("…") && s.length <= DESCRIPTION_SHOWN + 1);
  assert.equal(shortDescription('Quotes "x" <b> & more'), 'Quotes "x" <b> & more');
});

test("listing split", () => {
  assert.deepEqual(splitListing("93.778 Medical Assistance Program"), { number: "93.778", title: "Medical Assistance Program" });
  assert.deepEqual(splitListing("Just a title"), { number: null, title: "Just a title" });
  assert.deepEqual(splitListing(null), { number: null, title: null });
  assert.equal(programLabel("10.112 Price Loss Coverage"), "10.112 Price Loss Coverage");
});

test("kinds are never added together", () => {
  const rows = [row({ id: 1, kind: "grant", amount: 10 }), row({ id: 2, kind: "loan", amount: 1000, subsidyCost: -5 }), row({ id: 3, kind: "direct_payment", amount: 7 })];
  const t = kindTotals(rows);
  assert.equal(t.grant.value, 10); assert.equal(t.loan.value, 1000); assert.equal(t.direct_payment.value, 7);
  const s = kindSentence(rows, (n) => `$${n}`);
  assert.match(s, /1 grant with an award value of \$10/);
  assert.match(s, /1 loan.* with a face value of \$1000/);
  assert.ok(!/\$1017/.test(s));
});

test("largest and group order", () => {
  const rows = [row({ id: 1, amount: 5 }), row({ id: 2, amount: 50 }), row({ id: 3, amount: null }), row({ id: 4, kind: "loan", amount: 999 })];
  assert.deepEqual(largest(rows, "grant", 2).map((r) => r.id), [2, 1]);
  assert.equal(agencyRows(rows).length, 1);
  assert.equal(programRows(rows).length, 0);
});

test("masked count and sentence", () => {
  assert.equal(maskedCount([row({ recipient: "REDACTED DUE TO PII" }), row({})]), 1);
  assert.equal(maskedSentence(0), "");
  assert.match(maskedSentence(2), /2 awards name no single recipient/);
});

test("company match: exact normalised name only; shared names and masked recipients match nothing", () => {
  const cos = [{ id: 1, name: "NVIDIA Corp", slug: "nvidia-corp" }, { id: 2, name: "Twin Co", slug: "twin-a" }, { id: 3, name: "TWIN CO.", slug: "twin-b" }, { id: 4, name: "Nameless", slug: null }];
  const rows = [row({ id: 1, recipient: "NVIDIA CORP" }), row({ id: 2, recipient: "NVIDIA CORPORATION OF AMERICA" }), row({ id: 3, recipient: "TWIN CO" }), row({ id: 4, recipient: "MULTIPLE RECIPIENTS" }), row({ id: 5, recipient: "NAMELESS" })];
  const m = matchCompanies(rows, cos);
  assert.deepEqual([...m.keys()], [1]);
  assert.deepEqual(m.get(1)!.map((r) => r.id), [1]);
});

test("empty data logs without throwing", () => {
  assert.match(assistanceLog(emptyAssistance()), /0 awards/);
});
