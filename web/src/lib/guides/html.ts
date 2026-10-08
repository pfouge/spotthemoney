// Small helpers for writing guide bodies as HTML strings.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A link to another site (primary sources). Internal links are written as plain <a href="/…">. */
export const ext = (url: string, text: string): string => `<a href="${esc(url)}" rel="noopener">${text}</a>`;

/** A data table in the site's table style. Cells are HTML. */
export function table(head: string[], rows: string[][]): string {
  return `<div class="tablewrap"><table class="data guide-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** "2026-10-08" → "October 8, 2026" (UTC, so the date never slips a day). */
export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Strip tags: used for word counts and the plain-text copy of a guide. */
export const plain = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
