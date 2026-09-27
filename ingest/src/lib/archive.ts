// Raw-filing archive helpers: content-addressed storage of fetched filing bytes in a
// private Supabase Storage bucket (`raw-filings`), with one `raw_documents` row per
// (source_url, checksum) pair (checksum = lowercase hex sha256 of the bytes).
//
// WHY: origin pages (SEC EDGAR XML, House Clerk PDFs, Senate eFD HTML, FEC/LDA/
// USAspending records) can vanish, get rate-limited, or change on re-fetch. Archiving
// the original bytes once, keyed by their own hash, means re-processing, OCR reruns,
// and audits never need to hit the origin again — and the archive is trivially
// verifiable (recompute the hash, compare to the row).
//
// BINDING RULES (mirror ingest/py/archive.py — keep both in sync):
//   - Storage is best-effort and NEVER throws for an HTTP failure: a failed upload
//     just leaves storage_bucket NULL and logs a warning, so backfillUnstored() can
//     retry later. A DB error (other than the documented checksum-collision case)
//     still propagates — the row bookkeeping is not optional the way storage is.
//   - `checksum` is UNIQUE on raw_documents in addition to the (source_url) upsert
//     key, so two different source_urls that happen to hold byte-identical content
//     collide there. We do not fail the write for that: we retry the insert with
//     checksum suffixed `<sha256>:<sha256(sourceUrl) first 8 hex chars>` — there is
//     no spare column to record the collision out of band, so the suffix on the
//     stored checksum *is* the record of it, and we log a warning once per
//     occurrence. Both `archiveBytes`'s and `backfillUnstored`'s checksum comparisons
//     know to strip that suffix.
//   - If credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) are missing, the
//     `raw_documents` row is still written (r2_key = the object key it *would* use,
//     storage_bucket left NULL) so a later backfillUnstored() run can upload once the
//     secret exists. Exactly one warning is logged per process for this, not one per
//     document — a job archiving hundreds of filings with no credentials configured
//     must not flood the log.
//   - Polite-client rule (matches lib/http.ts's spirit): at most one upload in flight
//     for this process, and at most one retry, only on a 5xx.
//
// Storage REST API: base `${SUPABASE_URL}/storage/v1`; auth via both
// `Authorization: Bearer <service role key>` and `apikey: <service role key>`.
// Bucket creation (`POST /bucket`) is idempotent (409 / "already exists" -> success).
// Upload (`POST /object/raw-filings/<key>`) takes the raw bytes with `x-upsert: true`,
// which also makes a second upload of the identical key (e.g. the checksum-collision
// case) a safe no-op rather than an error.

import { createHash } from "node:crypto";
import type { getDb } from "./db.js";

export type Sql = ReturnType<typeof getDb>;

export type ArchiveSource =
  | "sec_form4"
  | "house_ptr"
  | "senate_ptr"
  | "fec"
  | "usaspending"
  | "senate_lda"
  | "other";

const BUCKET = "raw-filings";
const ARCHIVE_UA = "spotthemoney.com ingest (Peter Fougerousse <pfouge@gmail.com>)";

let bucketEnsured = false;
let warnedMissingCredentials = false;

/** True when both Supabase Storage env vars are present. */
export function archiveConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Lowercase hex sha256 of the given bytes — the `raw_documents.checksum` format. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "application/xml": "xml",
  "text/xml": "xml",
  "application/pdf": "pdf",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/json": "json",
};

function extensionFor(contentType: string): string {
  const base = (contentType || "").split(";")[0]!.trim().toLowerCase();
  return EXTENSION_BY_CONTENT_TYPE[base] ?? "bin";
}

/** `<source>/<yyyy>/<mm>/<sha256 first 2 chars>/<sha256>.<ext>`, yyyy/mm from `date` (UTC). */
export function objectKeyFor(
  source: ArchiveSource,
  sha256: string,
  contentType: string,
  date: Date,
): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const ext = extensionFor(contentType);
  return `${source}/${yyyy}/${mm}/${sha256.slice(0, 2)}/${sha256}.${ext}`;
}

function storageBaseUrl(): string {
  return `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1`;
}

function storageHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, ...extra };
}

async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const res = await fetch(`${storageBaseUrl()}/bucket`, {
    method: "POST",
    headers: { ...storageHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (res.ok) {
    bucketEnsured = true;
    return;
  }
  const text = await res.text().catch(() => "");
  if (res.status === 409 || /already exists/i.test(text)) {
    bucketEnsured = true;
    return;
  }
  throw new Error(`ensureBucket failed: HTTP ${res.status} ${text}`);
}

async function uploadObject(objectKey: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const url = `${storageBaseUrl()}/object/${BUCKET}/${objectKey}`;
  const headers = { ...storageHeaders(), "content-type": contentType, "x-upsert": "true" };
  // Buffer.from(...) rather than the raw Uint8Array: fetch's BodyInit typing (DOM lib)
  // wants an ArrayBuffer-backed view, and a Buffer satisfies that unconditionally.
  const body = Buffer.from(bytes);
  let res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok && res.status >= 500) {
    res = await fetch(url, { method: "POST", headers, body }); // one retry, 5xx only
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`upload failed: HTTP ${res.status} ${text}`);
  }
}

// At most one upload in flight for this process (polite-client rule).
let uploadChain: Promise<unknown> = Promise.resolve();
function withUploadLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = uploadChain.then(fn, fn);
  uploadChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

interface PostgresLikeError {
  code?: string;
  constraint_name?: string;
}

function isChecksumUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as PostgresLikeError;
  return e.code === "23505" && typeof e.constraint_name === "string" && e.constraint_name.toLowerCase().includes("checksum");
}

function warnMissingCredentialsOnce(): void {
  if (warnedMissingCredentials) return;
  warnedMissingCredentials = true;
  console.warn(
    "archive: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — raw_documents rows are " +
      "recorded without uploading; run backfillUnstored() once credentials are configured.",
  );
}

export interface ArchiveBytesInput {
  source: ArchiveSource;
  sourceUrl: string;
  bytes: Uint8Array;
  contentType: string;
  filingId?: number | null;
}

export interface ArchiveResult {
  rawDocumentId: number;
  /** The checksum actually stored on the row — see the checksum-collision note above. */
  checksum: string;
  objectKey: string;
  stored: boolean;
  /** True if a raw_documents row for this source_url already existed. */
  deduped: boolean;
}

/** Look up an already-archived row by source_url. Returns null if none exists. */
export async function isArchived(sql: Sql, sourceUrl: string): Promise<{ id: number; stored: boolean } | null> {
  const rows = await sql`
    select id, storage_bucket from raw_documents where source_url = ${sourceUrl} limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id as number, stored: row.storage_bucket !== null };
}

async function upsertRow(
  sql: Sql,
  input: ArchiveBytesInput,
  objectKey: string,
  checksum: string,
): Promise<{ id: number; storageBucket: string | null; inserted: boolean }> {
  const [row] = await sql`
    insert into raw_documents (source, r2_key, content_type, checksum, source_url, filing_id)
    values (${input.source}, ${objectKey}, ${input.contentType}, ${checksum}, ${input.sourceUrl}, ${input.filingId ?? null})
    on conflict (source_url) where source_url is not null do update
      set filing_id = coalesce(excluded.filing_id, raw_documents.filing_id)
    returning id, storage_bucket, (xmax = 0) as inserted
  `;
  return { id: row!.id as number, storageBucket: row!.storage_bucket as string | null, inserted: row!.inserted as boolean };
}

/**
 * Archives one document's bytes: hashes them, upserts the `raw_documents` row, and
 * (if credentials are configured and the row isn't already stored) uploads to Supabase
 * Storage. Never throws for a storage failure — see the binding rules above.
 */
export async function archiveBytes(sql: Sql, input: ArchiveBytesInput): Promise<ArchiveResult> {
  const checksum = sha256Hex(input.bytes);
  const objectKey = objectKeyFor(input.source, checksum, input.contentType, new Date());

  let row: { id: number; storageBucket: string | null; inserted: boolean };
  let effectiveChecksum = checksum;
  try {
    row = await upsertRow(sql, input, objectKey, checksum);
  } catch (err) {
    if (!isChecksumUniqueViolation(err)) throw err;
    // Byte-identical content already archived under a different source_url. Keep this
    // row (same source_url dedupe key still matters) by suffixing the checksum so the
    // UNIQUE constraint doesn't collide; see the binding rules comment above.
    const suffix = sha256Hex(Buffer.from(input.sourceUrl, "utf8")).slice(0, 8);
    effectiveChecksum = `${checksum}:${suffix}`;
    console.warn(
      `archive: raw_documents.checksum collision for ${input.sourceUrl} (sha256 ${checksum} ` +
        `already stored under a different source_url) — storing with suffixed checksum ${effectiveChecksum}`,
    );
    row = await upsertRow(sql, input, objectKey, effectiveChecksum);
  }

  const deduped = !row.inserted;

  if (row.storageBucket !== null) {
    return { rawDocumentId: row.id, checksum: effectiveChecksum, objectKey, stored: true, deduped };
  }

  if (!archiveConfigured()) {
    warnMissingCredentialsOnce();
    return { rawDocumentId: row.id, checksum: effectiveChecksum, objectKey, stored: false, deduped };
  }

  const stored = await withUploadLock(async () => {
    try {
      await ensureBucket();
      await uploadObject(objectKey, input.bytes, input.contentType);
      await sql`
        update raw_documents
        set storage_bucket = ${BUCKET}, stored_at = now(), byte_size = ${input.bytes.byteLength},
            content_type = ${input.contentType}, r2_key = ${objectKey}
        where id = ${row.id}
      `;
      return true;
    } catch (err) {
      console.warn(
        `archive: upload failed for raw_documents.id=${row.id} (${objectKey}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  });

  return { rawDocumentId: row.id, checksum: effectiveChecksum, objectKey, stored, deduped };
}

function stripChecksumSuffix(checksum: string): string {
  const idx = checksum.indexOf(":");
  return idx === -1 ? checksum : checksum.slice(0, idx);
}

async function defaultFetchBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url, { headers: { "user-agent": ARCHIVE_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
}

/**
 * Uploads any rows recorded (via archiveBytes) with storage_bucket still NULL —
 * e.g. because credentials weren't configured at ingest time. Verifies the
 * re-fetched bytes still hash to the stored checksum before uploading.
 */
export async function backfillUnstored(
  sql: Sql,
  opts?: { limit?: number; fetchBytes?: (url: string) => Promise<{ bytes: Uint8Array; contentType: string }> },
): Promise<{ attempted: number; stored: number; failed: { id: number; error: string }[] }> {
  const limit = opts?.limit ?? 200;
  const fetchBytes = opts?.fetchBytes ?? defaultFetchBytes;

  const rows = await sql`
    select id, source_url, checksum, r2_key
    from raw_documents
    where storage_bucket is null
    order by id
    limit ${limit}
  `;

  let stored = 0;
  const failed: { id: number; error: string }[] = [];

  for (const row of rows) {
    const id = row.id as number;
    const sourceUrl = row.source_url as string | null;
    const checksum = row.checksum as string | null;
    const objectKey = row.r2_key as string;

    if (!sourceUrl) {
      failed.push({ id, error: "no source_url to re-fetch" });
      continue;
    }
    if (!archiveConfigured()) {
      warnMissingCredentialsOnce();
      failed.push({ id, error: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" });
      continue;
    }

    try {
      const { bytes, contentType } = await fetchBytes(sourceUrl);
      const actual = sha256Hex(bytes);
      const expected = checksum ? stripChecksumSuffix(checksum) : null;
      if (expected && actual !== expected) {
        failed.push({ id, error: `sha256 mismatch: expected ${expected}, got ${actual}` });
        continue;
      }

      const ok = await withUploadLock(async () => {
        try {
          await ensureBucket();
          await uploadObject(objectKey, bytes, contentType);
          await sql`
            update raw_documents
            set storage_bucket = ${BUCKET}, stored_at = now(), byte_size = ${bytes.byteLength}, content_type = ${contentType}
            where id = ${id}
          `;
          return true;
        } catch (err) {
          console.warn(
            `archive: backfill upload failed for raw_documents.id=${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return false;
        }
      });

      if (ok) stored++;
      else failed.push({ id, error: "upload failed (see warning log)" });
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { attempted: rows.length, stored, failed };
}
