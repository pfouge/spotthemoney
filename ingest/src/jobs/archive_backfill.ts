// Job: upload raw_documents rows that were hashed before the Storage credentials existed
// (storage_bucket is null). Run on demand: `npm run ingest -- archive_backfill`. Safe to
// re-run; each pass takes ARCHIVE_BACKFILL_LIMIT rows (default 200) oldest first. The
// documents are re-fetched from their source_url with the polite client and the sha256 is
// checked against the stored checksum before upload.

import { backfillUnstored, archiveConfigured } from "../lib/archive.js";
import { fetchText } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "archive_backfill";

export async function runArchiveBackfill(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  if (!archiveConfigured()) {
    ctx.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing can be uploaded; no-op");
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }
  const limit = Number(process.env.ARCHIVE_BACKFILL_LIMIT ?? 200);
  const result = await backfillUnstored(sql, {
    limit,
    fetchBytes: async (url) => {
      // fetchText goes through the polite client (UA, host gap, backoff). Documents here are
      // text formats (XML/HTML/JSON) or PDFs; PDFs are binary, so use the raw Response path.
      const isPdf = /\.pdf(\?|$)/i.test(url);
      if (!isPdf) {
        const text = await fetchText(url);
        return { bytes: new TextEncoder().encode(text), contentType: url.endsWith(".xml") ? "application/xml" : "text/plain" };
      }
      const res = await fetch(url, { headers: { "user-agent": process.env.INGEST_USER_AGENT ?? "spotthemoney.com ingest (Peter Fougerousse <pfouge@gmail.com>)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: "application/pdf" };
    },
  });
  ctx.rowsSeen = result.attempted;
  ctx.rowsChanged = result.stored;
  for (const f of result.failed) ctx.quarantine(String(f.id), f.error);
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged,
    status: result.failed.length > 0 && result.stored === 0 ? "partial" : "success", stats: ctx.stats() };
}
