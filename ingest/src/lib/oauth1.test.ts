// Run with: npx tsx src/lib/oauth1.test.ts   (or `node --experimental-strip-types --test`)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  percentEncode,
  signatureBaseString,
  oauth1AuthorizationHeader,
  type OAuth1SignInput,
} from "./oauth1.js";

// ──────────────────────────────────────────────────────────────────────────
// Well-known X/Twitter developer-docs example vector. If this implementation
// ever disagrees with these expected values, the implementation is wrong —
// fix it, do not change the vector.
// https://developer.twitter.com/en/docs/authentication/oauth-1-0a/creating-a-signature
// ──────────────────────────────────────────────────────────────────────────

const VECTOR_INPUT: OAuth1SignInput = {
  method: "POST",
  url: "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
  credentials: {
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  },
  formParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  timestamp: "1318622958",
};

const EXPECTED_SIGNATURE = "hCtSmYh+iHYCEqBWrE7C7hYmtUk=";
const EXPECTED_BASE_STRING_PREFIX =
  "POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26";

test("signatureBaseString matches the known X/Twitter example vector's prefix", () => {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: VECTOR_INPUT.credentials.consumerKey,
    oauth_nonce: VECTOR_INPUT.nonce!,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: VECTOR_INPUT.timestamp!,
    oauth_token: VECTOR_INPUT.credentials.token,
    oauth_version: "1.0",
  };
  const baseString = signatureBaseString(VECTOR_INPUT, oauthParams);
  assert.ok(
    baseString.startsWith(EXPECTED_BASE_STRING_PREFIX),
    `base string did not start with the expected prefix.\n  got:      ${baseString}\n  expected prefix: ${EXPECTED_BASE_STRING_PREFIX}`,
  );
});

test("oauth1AuthorizationHeader produces the known X/Twitter example signature", () => {
  const header = oauth1AuthorizationHeader(VECTOR_INPUT);
  assert.match(header, /^OAuth /);
  const match = header.match(/oauth_signature="([^"]+)"/);
  assert.ok(match, "header must include oauth_signature");
  const signature = decodeURIComponent(match![1]!);
  assert.equal(signature, EXPECTED_SIGNATURE);
});

test("oauth1AuthorizationHeader sorts params by key and percent-encodes values", () => {
  const header = oauth1AuthorizationHeader(VECTOR_INPUT);
  const keys = [...header.matchAll(/([a-z_]+)="/g)].map((m) => m[1]!);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted, "oauth_* keys in the header must be sorted");
  assert.ok(header.startsWith("OAuth oauth_consumer_key="));
});

// ──────────────────────────────────────────────────────────────────────────
// percentEncode edge cases (RFC 3986 unreserved set + UTF-8 byte encoding).
// ──────────────────────────────────────────────────────────────────────────

test("percentEncode: space encodes to %20", () => {
  assert.equal(percentEncode(" "), "%20");
});

test("percentEncode: '*' encodes to %2A", () => {
  assert.equal(percentEncode("*"), "%2A");
});

test("percentEncode: '~' is left untouched", () => {
  assert.equal(percentEncode("~"), "~");
});

test("percentEncode: unreserved characters are left untouched", () => {
  const unreserved = "ABCabc012-._~";
  assert.equal(percentEncode(unreserved), unreserved);
});

test("percentEncode: '!', apostrophe, '(' and ')' are all percent-encoded (encodeURIComponent leaves these alone)", () => {
  assert.equal(percentEncode("!"), "%21");
  assert.equal(percentEncode("'"), "%27");
  assert.equal(percentEncode("("), "%28");
  assert.equal(percentEncode(")"), "%29");
});

test("percentEncode: unicode is encoded as percent-escaped UTF-8 bytes", () => {
  // 'é' is U+00E9 -> UTF-8 bytes 0xC3 0xA9.
  assert.equal(percentEncode("é"), "%C3%A9");
  // A non-BMP emoji (grinning face, U+1F600) -> 4 UTF-8 bytes.
  assert.equal(percentEncode("😀"), "%F0%9F%98%80");
});

test("percentEncode: hex digits are uppercase", () => {
  // '=' -> 0x3D; encodeURIComponent already yields uppercase hex, this pins that behavior.
  assert.equal(percentEncode("="), "%3D");
});

// ──────────────────────────────────────────────────────────────────────────
// JSON-body sanity check: formParams omitted (as for the real X API v2 tweet
// endpoint, whose JSON body is never part of the signature base) still
// produces a well-formed header with only the oauth_* + query params signed.
// ──────────────────────────────────────────────────────────────────────────

test("oauth1AuthorizationHeader works with no formParams (JSON-body POST)", () => {
  const input: OAuth1SignInput = {
    method: "POST",
    url: "https://api.x.com/2/tweets",
    credentials: {
      consumerKey: "ck",
      consumerSecret: "cs",
      token: "tok",
      tokenSecret: "ts",
    },
    nonce: "staticnonce",
    timestamp: "1700000000",
  };
  const header = oauth1AuthorizationHeader(input);
  assert.match(header, /^OAuth oauth_consumer_key="ck"/);
  assert.match(header, /oauth_signature="[^"]+"/);
});
