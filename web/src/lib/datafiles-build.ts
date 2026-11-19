// Builds the catalogue of public data files once per build from what lib/downloads.ts and
// lib/feeds-build.ts already made (so nothing is counted twice), and prints one line to the
// build log for comparison with the files served.
import { getDownloads, byteSize } from "./downloads";
import { getFeeds } from "./feeds-build";
import { FEEDS } from "./feeds";
import { getFlagship } from "./flagship";
import { SITE_URL } from "./seo";
import { buildCatalog, catalogTotals, type Catalog } from "./datafiles";

let cache: Promise<Catalog> | null = null;
export function getCatalog(): Promise<Catalog> {
  return (cache ??= (async () => {
    const [d, feeds, model] = await Promise.all([getDownloads(), getFeeds(), getFlagship()]);
    const one = (m: Map<string, { path: string; rows: number; updated: string | null }>) => [...m].map(([key, f]) => ({ key, path: f.path, rows: f.rows, updated: f.updated }));
    const cat = buildCatalog({
      site: SITE_URL,
      built: model.builtAt,
      files: d.files.map((f) => ({ path: f.path, name: f.name, group: f.group, kind: f.kind, title: f.title, about: f.about, rows: f.rows, bytes: byteSize(f), updated: f.updated, columns: f.columns })),
      member: one(d.member),
      stock: one(d.stock),
      feeds: FEEDS.map((f) => { const items = feeds.get(f.id) ?? []; return { id: f.id, path: f.path, title: f.title, description: f.description, limit: f.limit, items: items.length, newest: items[0]?.date ?? null }; }),
    });
    const t = catalogTotals(cat);
    const rowsOf = (name: string) => cat.csv.files.find((f) => f.name === name)?.rows ?? 0;
    console.log(`[web] data catalogue: ${t.csvFiles} site-wide CSV files, ${t.csvRows} rows, ${t.csvBytes} bytes; ${t.memberFiles} member files, ${t.tickerFiles} ticker files; ${t.feeds} feeds, ${t.feedItems} items; ${t.workingFiles} working files; rows: congress-trades ${rowsOf("congress-trades.csv")}, congress-members ${rowsOf("congress-members.csv")}, committee assignments ${rowsOf("congress-committee-assignments.csv")}, companies ${rowsOf("companies.csv")}, federal-contracts ${rowsOf("federal-contracts.csv")}`);
    return cat;
  })());
}
