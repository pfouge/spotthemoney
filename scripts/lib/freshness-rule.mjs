// How freshness-check.mjs judges one source (rule made explicit 2026-10-12).
//
// One bad day at an upstream API is not an emergency: lda.gov answered HTTP 503 on Oct 9 and 10
// and the whole ingest run went red although the data was one day old. So:
//
//   OK              last run succeeded (or was partial) and the newest record is within its allowance
//   WARN            the LAST run failed, but a successful run happened within the allowance
//                   (runDays × 24 h; 48 h for daily sources) — shown in the summary and as an
//                   Actions warning, does NOT fail the run
//   FAILING         no successful run within the allowance (a failure that persisted), or never ran
//   STALE           runs succeed but the newest record is older than the source's data allowance
//   NOT CONFIGURED  the job reports a skip (missing key or switched off) — listed, never fails
//
// Only FAILING and STALE fail the run.
export function classify({ run, okAgeHours, runDays, hasNewest, dataAgeDays, dataDays, newestStr }) {
  const allowH = runDays * 24;
  if (!run) return { state: "FAILING", why: "never ran" };
  if (run.skipped) return { state: "NOT CONFIGURED", why: run.skipped };
  if (okAgeHours == null || okAgeHours > allowH) {
    const lastErr = run.status === "failed" && run.error ? ` — last error: ${run.error}` : "";
    return { state: "FAILING", why: `no successful run in ${okAgeHours == null ? "ever" : `${Math.round(okAgeHours)} h`} (allowance ${allowH} h)${lastErr}` };
  }
  if (run.status === "failed") {
    return { state: "WARN", why: `last run failed (${run.error ?? "no error text"}); last success ${Math.round(okAgeHours)} h ago — fails if none within ${allowH} h` };
  }
  if (hasNewest && (dataAgeDays == null || dataAgeDays > dataDays)) {
    return { state: "STALE", why: `newest record ${newestStr ?? "—"}, allowance ${dataDays} days` };
  }
  return { state: "OK", why: "" };
}
export const FAILS = new Set(["FAILING", "STALE"]);
