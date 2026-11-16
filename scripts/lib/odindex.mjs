// On-demand (market-scope) pages have no file in the build: the Worker renders them on request. A
// verifier served from static files (the build itself behind a plain file server) cannot fetch them,
// so it accepts a link whose target is listed in /data/od-index.json (the od entities the built pages
// link to) without fetching it. Against a live base URL it fetches a sample instead (stage 3b).
export const ST_ARG = (argv = process.argv) => argv.includes("--static");

/** Loads the index. `isStatic` is true with --static or when the server answers like python's http.server. */
export async function loadOdIndex(base, argv = process.argv) {
  let idx = { insiders: [], companies: [], stocks: [] };
  try { const r = await fetch(`${base}/data/od-index.json`); if (r.ok) idx = await r.json(); } catch { /* none: nothing is od */ }
  let isStatic = ST_ARG(argv);
  if (!isStatic) { try { const r = await fetch(base + "/robots.txt", { method: "HEAD" }); isStatic = /SimpleHTTP|http\.server/i.test(r.headers.get("server") ?? ""); } catch { /* keep false */ } }
  const sets = { insiders: new Set(idx.insiders), companies: new Set(idx.companies), stocks: new Set(idx.stocks) };
  /** "insiders" | "stocks" | "companies" when the path is a listed on-demand page, else null. */
  const kindOf = (path) => {
    const m = /^\/(insiders|stocks|companies)\/([^/]+)\/$/.exec(path);
    return m && sets[m[1]].has(m[2]) ? m[1] : null;
  };
  let sampled = 0;
  /** true: accept without fetching. Live servers: the first `n` listed links are fetched, the rest accepted. */
  const accept = (path, n = 20) => { if (!kindOf(path)) return false; if (isStatic) return true; return sampled++ >= n; };
  return { isStatic, kindOf, accept, size: idx.insiders.length + idx.companies.length + idx.stocks.length };
}
