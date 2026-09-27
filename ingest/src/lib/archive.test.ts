// Run with: npx tsx --test src/lib/archive.test.ts
//
// Tests only the pure parts (object-key derivation, extension mapping, sha256 hex).
// archiveBytes/isArchived/backfillUnstored need a live Postgres + Supabase Storage
// and are exercised by hand against the real project, not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { objectKeyFor, sha256Hex, type ArchiveSource } from "./archive.js";

test("sha256Hex matches node:crypto directly and is lowercase hex", () => {
  const data = new TextEncoder().encode("hello world");
  const expected = createHash("sha256").update(data).digest("hex");
  const actual = sha256Hex(data);
  assert.equal(actual, expected);
  assert.equal(actual.length, 64);
  assert.equal(actual, actual.toLowerCase());
  assert.match(actual, /^[0-9a-f]{64}$/);
});

test("sha256Hex of empty bytes is the well-known empty-string sha256", () => {
  assert.equal(
    sha256Hex(new Uint8Array()),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("objectKeyFor: builds <source>/<yyyy>/<mm>/<prefix>/<sha>.<ext> from a UTC date", () => {
  const sha = "abcd1234" + "0".repeat(56);
  const date = new Date(Date.UTC(2026, 2, 5)); // March 5, 2026 UTC
  const key = objectKeyFor("sec_form4" as ArchiveSource, sha, "application/pdf", date);
  assert.equal(key, `sec_form4/2026/03/ab/${sha}.pdf`);
});

test("objectKeyFor: month/day are zero-padded and use UTC, not local time", () => {
  const sha = "ff".repeat(32);
  // Local-vs-UTC trap: construct a date near a month boundary in UTC.
  const date = new Date(Date.UTC(2026, 0, 9, 23, 59)); // Jan 9, 2026 23:59 UTC
  const key = objectKeyFor("house_ptr" as ArchiveSource, sha, "text/html", date);
  assert.equal(key, `house_ptr/2026/01/ff/${sha}.html`);
});

test("objectKeyFor: extension mapping covers xml/pdf/html/json and falls back to bin", () => {
  const sha = "11".repeat(32);
  const date = new Date(Date.UTC(2026, 5, 1));
  const cases: [string, string][] = [
    ["application/xml", "xml"],
    ["text/xml", "xml"],
    ["text/xml; charset=utf-8", "xml"],
    ["application/pdf", "pdf"],
    ["text/html", "html"],
    ["text/html; charset=utf-8", "html"],
    ["application/xhtml+xml", "html"],
    ["application/json", "json"],
    ["application/json; charset=utf-8", "json"],
    ["application/octet-stream", "bin"],
    ["", "bin"],
    ["image/png", "bin"],
  ];
  for (const [contentType, ext] of cases) {
    const key = objectKeyFor("other" as ArchiveSource, sha, contentType, date);
    assert.equal(key, `other/2026/06/11/${sha}.${ext}`, `content type ${JSON.stringify(contentType)} -> .${ext}`);
  }
});

test("objectKeyFor: content-type matching is case-insensitive", () => {
  const sha = "22".repeat(32);
  const date = new Date(Date.UTC(2026, 5, 1));
  const key = objectKeyFor("fec" as ArchiveSource, sha, "APPLICATION/PDF", date);
  assert.equal(key, `fec/2026/06/22/${sha}.pdf`);
});

test("objectKeyFor: sha256-prefix directory is the first two hex chars", () => {
  const sha = "9e" + "0".repeat(62);
  const date = new Date(Date.UTC(2026, 8, 27));
  const key = objectKeyFor("senate_lda" as ArchiveSource, sha, "application/json", date);
  assert.ok(key.includes(`/9e/${sha}.json`));
});
