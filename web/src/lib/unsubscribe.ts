// The unsubscribe page for email digests (parity queue item 7, stage 3) — the pure part: which
// answer a request gets and the HTML of each. The route (src/pages/alerts/unsubscribe.ts) adds
// the one database call. Tested in scripts/unsubscribe.test.ts.
//
// The address is fixed by the digest builder (ingest/src/lib/digest.ts unsubscribeUrl):
//   /alerts/unsubscribe/?token=<64 hex characters>
//
// Rules:
//   GET   shows a page with one button and changes nothing. Mail scanners and link previews
//         open every link in an email; a GET that unsubscribed would turn digests off for people
//         who never asked.
//   POST  unsubscribes. It needs no sign-in and no Origin header, because mail programs send
//         the one-click POST of RFC 8058 themselves ("List-Unsubscribe=One-Click"). The token
//         is the whole authority: 64 hex characters that cannot be guessed.
//   The answer to a well-formed token is the same whether or not it is known, so the page
//   cannot be used to test tokens.
//   A token that is not 64 hex characters gets "this link is incomplete" (the shape is public).
//
// The page is a small document of its own: no site layout (an on-demand page may not use
// BaseLayout), no script, no analytics, no outside file. The token is in the address, so the
// page sends no referrer anywhere.

import { isUnsubToken } from "./account";

export type UnsubView = "confirm" | "done" | "bad" | "error";

/** What a request should get before the database is asked. */
export function unsubPlan(method: string, token: string | null | undefined): { view: UnsubView; status: number; call: boolean } {
  if (!isUnsubToken(token)) return { view: "bad", status: 400, call: false };
  if (method === "POST") return { view: "done", status: 200, call: true };
  return { view: "confirm", status: 200, call: false };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TITLES: Record<UnsubView, string> = {
  confirm: "Unsubscribe from email digests",
  done: "You are unsubscribed",
  bad: "This unsubscribe link is incomplete",
  error: "That did not work",
};

function body(view: UnsubView, action: string): string {
  const button = (label: string): string =>
    `<form method="post" action="${esc(action)}"><button type="submit">${label}</button></form>`;
  if (view === "confirm") {
    return `<p>Press the button to stop the email digests from Spot the Money that this link belongs to.</p>
${button("Unsubscribe")}
<p class="soft">Your account and your watchlists stay as they are. You can turn digests back on at any time on your <a href="/watchlist/" rel="noreferrer">watchlist page</a>.</p>`;
  }
  if (view === "done") {
    return `<p>No more email digests will be sent for this link. Nothing else changed: the account and its watchlists are still there.</p>
<p class="soft">To turn digests back on, or to delete the account and everything in it, open your <a href="/watchlist/" rel="noreferrer">watchlist page</a>.</p>`;
  }
  if (view === "bad") {
    return `<p>The link you opened is missing part of its address, so we cannot tell which digest it belongs to. Open the unsubscribe link in the email again, or copy the whole address.</p>
<p class="soft">You can also sign in and turn digests off on your <a href="/watchlist/" rel="noreferrer">watchlist page</a>, or write to us from the <a href="/contact/" rel="noreferrer">contact page</a>.</p>`;
  }
  return `<p>We could not reach the database just now, so nothing was changed. Please try again in a minute.</p>
${button("Try again")}
<p class="soft">If it keeps failing, sign in and turn digests off on your <a href="/watchlist/" rel="noreferrer">watchlist page</a>, or write to us from the <a href="/contact/" rel="noreferrer">contact page</a>.</p>`;
}

/** The whole HTML document for one view. `token` is only ever a checked 64-hex string or "". */
export function unsubPage(view: UnsubView, token: string | null | undefined): string {
  const t = isUnsubToken(token) ? token : "";
  const action = `/alerts/unsubscribe/?token=${t}`;
  const title = TITLES[view];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} | Spot the Money</title>
<style>
:root { color-scheme: light dark; --bg: #ffffff; --ink: #14181c; --soft: #55606b; --line: #d5dbe1; --btn: #14181c; --btn-ink: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1215; --ink: #eef1f4; --soft: #a3adb7; --line: #2c343c; --btn: #eef1f4; --btn-ink: #0f1215; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif; }
main { max-width: 560px; margin: 0 auto; padding: 40px 20px 56px; }
.brand { display: inline-block; margin-bottom: 28px; color: var(--ink); font-weight: 700; letter-spacing: .08em; text-decoration: none; font-size: 14px; }
h1 { font-size: 26px; line-height: 1.2; margin: 0 0 14px; }
p { margin: 0 0 14px; }
.soft { color: var(--soft); font-size: 15px; }
a { color: inherit; }
form { margin: 22px 0; }
button { font: inherit; font-weight: 600; min-height: 48px; padding: 0 26px; border-radius: 999px; border: 1px solid var(--btn); background: var(--btn); color: var(--btn-ink); cursor: pointer; }
button:focus-visible, a:focus-visible { outline: 3px solid Highlight; outline-offset: 3px; }
hr { border: 0; border-top: 1px solid var(--line); margin: 28px 0 16px; }
</style>
</head>
<body>
<main>
<a class="brand" href="/" rel="noreferrer">SPOT THE MONEY</a>
<h1>${esc(title)}</h1>
${body(view, action)}
<hr>
<p class="soft"><a href="/privacy/#accounts" rel="noreferrer">Privacy policy</a></p>
</main>
</body>
</html>
`;
}

/** Headers of every answer: never cached, never indexed, never framed by the route itself. */
export const UNSUB_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
