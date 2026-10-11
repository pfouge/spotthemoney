// Tiny DOM builder shared by the watchlist scripts. Text always goes in as text nodes, never
// innerHTML: names and labels come from filings and from visitors.
export type Kids = (Node | string | null | undefined | false)[];
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Kids): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v); else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(typeof k === "string" ? document.createTextNode(k) : k);
  return el;
}
export function fmtDate(iso: string | null | undefined, withYear = true): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
}
