// Central string-sanitization choke point for every Postgres write.
//
// WHY (gratisglobal lesson, adopted 2026-07-06): a NUL (U+0000) inside a text or
// jsonb parameter kills the insert with Postgres error 22P02 — and one bad row can
// poison a whole batch. IIF's congress-ptr strips NULs at parse time, but we do NOT
// rely on that alone: every source module passes its parsed rows through scrubDeep()
// once, at the single point where records become DB parameters. Do not scrub
// per-call-site; route everything through here.
//
// Implementation note: control characters are matched by code point, not by a regex
// character class, so no raw control bytes ever appear in this source file.

/** True for control characters that are never legal in our data. Keeps \t \n \r. */
function isDisallowedControl(code: number): boolean {
  if (code === 9 || code === 10 || code === 13) return false; // \t \n \r
  return (code >= 0 && code <= 31) || code === 127;
}

export function scrubString(s: string): string {
  // Fast path: most strings are clean.
  let dirty = false;
  for (let i = 0; i < s.length; i++) {
    if (isDisallowedControl(s.charCodeAt(i))) {
      dirty = true;
      break;
    }
  }
  if (!dirty) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (!isDisallowedControl(s.charCodeAt(i))) out += s[i];
  }
  return out;
}

/**
 * Deep-clean a value before it is used as a DB parameter (including anything
 * headed for a jsonb column): strips disallowed control characters from every
 * string, recursing through arrays and plain objects. Non-string primitives,
 * Dates, and unknown object types pass through untouched.
 */
export function scrubDeep<T>(value: T): T {
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[scrubString(k)] = scrubDeep(v);
  }
  return out as T;
}
