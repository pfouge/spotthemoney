// Offline tests for the contributions source helpers. Run:
//   npx tsx --test ingest/src/sources/senate_lda_contributions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { contribUrl } from "./senate_lda_contributions.js";

test("request URL: newest first, floor, optional upper bound, paging", () => {
  process.env.LDA_API_BASE = "http://127.0.0.1:1";
  const u = new URL(contribUrl({ after: "2025-01-01", page: 2, pageSize: 25 }));
  assert.equal(u.pathname, "/contributions/");
  assert.equal(u.searchParams.get("ordering"), "-dt_posted");
  assert.equal(u.searchParams.get("filing_dt_posted_after"), "2025-01-01");
  assert.equal(u.searchParams.get("filing_dt_posted_before"), null);
  assert.equal(u.searchParams.get("page"), "2");
  assert.equal(u.searchParams.get("page_size"), "25");
  const v = new URL(contribUrl({ after: "2025-01-01", before: "2026-01-01T00:00:00", page: 1, pageSize: 10 }));
  assert.equal(v.searchParams.get("filing_dt_posted_before"), "2026-01-01T00:00:00");
});
