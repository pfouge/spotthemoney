// Is this response a Cloudflare challenge page rather than the site?
//
// Since 2026-10-11 Bot Fight Mode is on for spotthemoney.com (Free plan). It answers requests from
// cloud networks — GitHub's runners are on Azure — with HTTP 403 and an interstitial
// ("Just a moment...") instead of the page. Cloudflare's docs: Bot Fight Mode cannot be skipped
// with WAF custom rules or Page Rules, so the checks cannot simply be let through. A challenged
// request says nothing about whether the deploy worked, so the checks report it as
// INCONCLUSIVE, never as a pass or a failure. Real failures (5xx, 404, wrong content) still fail.
//
// Signals, strongest first: the `cf-mitigated: challenge` response header Cloudflare sets on
// challenge responses; otherwise a 403/429/503 whose body is Cloudflare's challenge page.
export function isCloudflareChallenge(status, headers, body = "") {
  const get = (k) => (typeof headers?.get === "function" ? headers.get(k) : headers?.[k.toLowerCase()]) ?? "";
  if (/challenge/i.test(String(get("cf-mitigated")))) return true;
  if (![403, 429, 503].includes(Number(status))) return false;
  return /<title>\s*Just a moment\.\.\.\s*<\/title>|\/cdn-cgi\/challenge-platform\/|cf-chl-|cf_chl_opt/i.test(String(body).slice(0, 20000));
}

/** Print a GitHub Actions warning annotation (or a plain warning line elsewhere). */
export function warn(message) {
  console.log(process.env.GITHUB_ACTIONS ? `::warning title=Inconclusive (Cloudflare challenge)::${message}` : `⚠ ${message}`);
}
