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
/* Tokens copied from styles/global.css (redesign, 2026-11-23). This page is a document of its own: no stylesheet is loaded. */
:root { color-scheme: light dark; --bg: #FFFFFF; --bg-2: #F4F5F7; --ink: #14171A; --ink-2: #59616B; --line: #E3E6EA; --line-2: #C7CCD3; --accent: #1F4FD8; --accent-on: #FFFFFF; --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px; --t-sm: 14px; --t-md: 16px; --t-lg: 24px; --r-pill: 999px; --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg: #0F1215; --bg-2: #181C21; --ink: #E7EAEE; --ink-2: #A3ACB7; --line: #262C33; --line-2: #3A424C; --accent: #8CB0FF; --accent-on: #0F1215; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 var(--t-md)/24px var(--font-sans); }
main { max-width: 560px; margin: 0 auto; padding: var(--s-7) var(--s-4) var(--s-7); }
.brand { display: inline-block; margin-bottom: var(--s-6); color: var(--ink); font-weight: 600; text-decoration: none; font-size: var(--t-sm); line-height: 20px; }
h1 { font-size: var(--t-lg); line-height: 28px; font-weight: 600; margin: 0 0 var(--s-3); }
p { margin: 0 0 var(--s-3); }
.soft { color: var(--ink-2); font-size: var(--t-sm); line-height: 20px; }
a { color: var(--accent); text-underline-offset: 2px; }
.brand { color: var(--ink); }
form { margin: var(--s-5) 0; }
button { font: inherit; font-weight: 600; min-height: 48px; padding: 0 var(--s-5); border-radius: var(--r-pill); border: 1px solid var(--accent); background: var(--accent); color: var(--accent-on); cursor: pointer; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
hr { border: 0; border-top: 1px solid var(--line); margin: var(--s-6) 0 var(--s-4); }
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
