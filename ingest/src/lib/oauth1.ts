// OAuth 1.0a HMAC-SHA1 request signing (RFC 5849), for the X API v2
// (`POST https://api.x.com/2/tweets`, whose body is JSON — JSON bodies are never
// part of the OAuth 1.0a signature base, only query-string params and oauth_* params
// are; `formParams` exists solely for the classic application/x-www-form-urlencoded
// case used by the verification test vector below).
//
// WHY hand-rolled: node:crypto gives us HMAC-SHA1 and nothing else needed here — no
// point pulling in an OAuth dependency for ~80 lines of RFC-mechanical string work,
// and project policy (see lib/http.ts, sec_form4.ts) already prefers no extra libs
// for well-specified, machine-checkable formats.
//
// BINDING RULES (RFC 5849 §3.1, §3.4.1, §3.4.2 — verified against the well-known
// X/Twitter developer-docs example vector in oauth1.test.ts; if this implementation
// ever disagrees with that vector, the implementation is wrong, not the vector):
//   - percentEncode: RFC 3986 unreserved set (A-Za-z0-9-._~) is left untouched;
//     everything else is %XX with UPPERCASE hex, including UTF-8 bytes for non-ASCII.
//   - Signature base string = UPPER(method) & percentEncode(normalizedBaseUrl) &
//     percentEncode(paramString), where paramString is every (URL query + form +
//     oauth_*) param, percent-encoded, sorted by encoded key then encoded value,
//     joined as k=v pairs with '&'.
//   - Normalized base URL: lowercase scheme + host, default ports (80/443) dropped,
//     no query string, no fragment.
//   - Signing key = percentEncode(consumerSecret) & percentEncode(tokenSecret).
//   - Signature = base64(HMAC-SHA1(signingKey, baseString)).

import { createHmac, randomBytes } from "node:crypto";

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

export interface OAuth1SignInput {
  method: string;
  /** Absolute URL, may include a query string. */
  url: string;
  credentials: OAuth1Credentials;
  /** Optional form params (application/x-www-form-urlencoded bodies only — never for JSON bodies). */
  formParams?: Record<string, string>;
  /** Injectable for deterministic tests; a random 32-byte hex nonce is generated otherwise. */
  nonce?: string;
  /** Injectable for deterministic tests; the current unix time (seconds) is used otherwise. */
  timestamp?: string;
}

/** RFC 3986 percent-encoding: unreserved chars (A-Za-z0-9-._~) untouched, else %XX uppercase. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Lowercase scheme/host, drop default ports, strip query + fragment (RFC 5849 §3.4.1.2). */
function normalizeBaseUrl(rawUrl: string): string {
  const u = new URL(rawUrl);
  const scheme = u.protocol.toLowerCase(); // e.g. "https:"
  const host = u.hostname.toLowerCase();
  const isDefaultPort =
    u.port === "" ||
    (scheme === "http:" && u.port === "80") ||
    (scheme === "https:" && u.port === "443");
  const authority = isDefaultPort ? host : `${host}:${u.port}`;
  return `${scheme}//${authority}${u.pathname}`;
}

/** Collects URL-query + formParams + oauthParams, percent-encodes, sorts, and joins (RFC 5849 §3.4.1.3/§3.4.1.3.2). */
export function signatureBaseString(
  input: OAuth1SignInput,
  oauthParams: Record<string, string>,
): string {
  const url = new URL(input.url);
  const pairs: [string, string][] = [];
  for (const [k, v] of url.searchParams.entries()) pairs.push([k, v]);
  if (input.formParams) {
    for (const [k, v] of Object.entries(input.formParams)) pairs.push([k, v]);
  }
  for (const [k, v] of Object.entries(oauthParams)) pairs.push([k, v]);

  const encoded = pairs.map(
    ([k, v]) => [percentEncode(k), percentEncode(v)] as [string, string],
  );
  encoded.sort(([ak, av], [bk, bv]) => {
    if (ak !== bk) return ak < bk ? -1 : 1;
    if (av !== bv) return av < bv ? -1 : 1;
    return 0;
  });
  const paramString = encoded.map(([k, v]) => `${k}=${v}`).join("&");

  const baseUrl = normalizeBaseUrl(input.url);
  return `${input.method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
}

/** Builds the full `Authorization: OAuth ...` header value, oauth_signature included. */
export function oauth1AuthorizationHeader(input: OAuth1SignInput): string {
  const nonce = input.nonce ?? randomBytes(32).toString("hex");
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: input.credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: input.credentials.token,
    oauth_version: "1.0",
  };

  const baseString = signatureBaseString(input, oauthParams);
  const signingKey = `${percentEncode(input.credentials.consumerSecret)}&${percentEncode(input.credentials.tokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const withSignature: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  const header = Object.entries(withSignature)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth ${header}`;
}
