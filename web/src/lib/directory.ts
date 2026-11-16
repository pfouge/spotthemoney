// Member directory (/congress-members/): one row per member of Congress on record, with the
// filters a reader can set (name, chamber, party, state, committee, activity).
// Pure: the page builds its rows with `directoryRows`, and the browser script
// (scripts/directory.ts) and the unit tests use the same `matches`, `parseHash` and `toHash`,
// so the page, the script and the tests cannot disagree about what a filter means.
// Everything here is a count, a date or a fact from the roster. Committee seats are context:
// nothing links a trade to a committee.
import type { Flagship, Person, Seat } from "./flagship";

export type PartyKey = "D" | "R" | "I" | "";
export interface DirRow {
  id: number; name: string; sortName: string; path: string | null;
  chamber: "house" | "senate" | "";
  party: PartyKey;
  /** Two-letter state or territory code, "" when the roster has none. */
  state: string;
  /** "TX-21", "AK-AL" (at large), "TX" for a senator. */
  seat: string;
  /** The member's term has ended (left office, or died in office). */
  former: boolean;
  /** Codes of the full committees the member sits on (a subcommittee seat counts for its parent). */
  committees: string[];
  /** Disclosed trades on record, all time, and by disclosure date in the last 365 days. */
  trades: number; trades12m: number;
  /** Newest disclosure date among the member's trades (YYYY-MM-DD), null with no trades. */
  latest: string | null;
}
export interface CommitteeOption { code: string; name: string; chamber: "house" | "senate" | "joint"; members: number }

export const ACTIVITY = ["any", "90", "365", "some", "none"] as const;
export type Activity = (typeof ACTIVITY)[number];
export const ACTIVITY_LABEL: Record<Activity, string> = {
  any: "Any activity",
  "90": "Disclosed a trade in the last 90 days",
  "365": "Disclosed a trade in the last 12 months",
  some: "Has trades on record",
  none: "No trades on record",
};
export interface DirFilter { q: string; chamber: "" | "house" | "senate"; party: PartyKey; state: string; committee: string; activity: Activity }
export const NO_FILTER: DirFilter = { q: "", chamber: "", party: "", state: "", committee: "", activity: "any" };

export function partyKey(party: string | null | undefined): PartyKey {
  if (!party) return "";
  const p = party.toLowerCase();
  return p === "d" || p.startsWith("dem") ? "D" : p === "r" || p.startsWith("rep") ? "R" : "I";
}
export const PARTY_LABEL: Record<PartyKey, string> = { D: "Democrat", R: "Republican", I: "Independent", "": "" };

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** "Earl L. \"Buddy\" Carter" → "carter earl l. buddy": surname first, for the default order only. */
export function sortName(name: string): string {
  const words = name.replace(/["“”(),]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIX.test(words[words.length - 1])) words.pop();
  const last = words.pop() ?? "";
  return [last, ...words].join(" ").toLowerCase();
}

export function seatCode(chamber: string | null, state: string | null, district: string | null): string {
  if (!state) return "";
  if (chamber !== "house" || district == null || district === "") return state;
  return `${state}-${district === "0" ? "AL" : district}`;
}

/** The full committee a seat belongs to. */
export function topCommittee(s: Seat): string { return s.parent ?? s.code; }

/** Whole days from `iso` to `today` (both YYYY-MM-DD, UTC). */
export function daysBetween(iso: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86400_000);
}

export function directoryRows(m: Flagship, today: string, path: (p: Person) => string | null): DirRow[] {
  const rows: DirRow[] = [];
  for (const p of m.people.values()) {
    if (!p.isCongress) continue;
    const role = p.roles.find((r) => r.kind === "congress");
    if (!role) continue;
    let latest: string | null = null, trades12m = 0;
    for (const t of p.txns) {
      const d = t.disclosedAt?.slice(0, 10);
      if (!d) continue;
      if (!latest || d > latest) latest = d;
      const age = daysBetween(d, today);
      if (age >= 0 && age <= 365) trades12m++;
    }
    rows.push({
      id: p.id, name: p.name, sortName: sortName(p.name), path: path(p),
      chamber: role.chamber ?? "", party: partyKey(role.party), state: (role.state ?? "").toUpperCase(),
      seat: seatCode(role.chamber, role.state ? role.state.toUpperCase() : null, role.district),
      former: !!role.validTo && role.validTo.slice(0, 10) < today,
      committees: [...new Set((m.seats.get(p.id) ?? []).map(topCommittee))].sort(),
      trades: p.txns.length, trades12m, latest,
    });
  }
  return rows.sort((a, b) => a.sortName.localeCompare(b.sortName) || a.id - b.id);
}

/** Full committees that at least one listed member sits on, House first, then Senate, then joint; by name. */
export function committeeOptions(m: Flagship, rows: DirRow[]): CommitteeOption[] {
  const names = new Map<string, { name: string; chamber: CommitteeOption["chamber"] }>();
  for (const seats of m.seats.values()) for (const s of seats) if (!s.parent && !names.has(s.code)) names.set(s.code, { name: s.name, chamber: s.chamber });
  const counts = new Map<string, number>();
  for (const r of rows) for (const c of r.committees) counts.set(c, (counts.get(c) ?? 0) + 1);
  const order = { house: 0, senate: 1, joint: 2 } as const;
  return [...counts.entries()]
    .filter(([code]) => names.has(code))
    .map(([code, members]) => ({ code, members, ...names.get(code)! }))
    .sort((a, b) => order[a.chamber] - order[b.chamber] || a.name.localeCompare(b.name));
}

/** What the filter needs to know about a row; the browser reads these from the row's data attributes. */
export interface DirKey { name: string; chamber: string; party: string; state: string; committees: string[]; trades: number; latest: string | null }

export function matches(r: DirKey, f: DirFilter, today: string): boolean {
  if (f.chamber && r.chamber !== f.chamber) return false;
  if (f.party && r.party !== f.party) return false;
  if (f.state && r.state !== f.state) return false;
  if (f.committee && !r.committees.includes(f.committee)) return false;
  if (f.activity === "some" && r.trades === 0) return false;
  if (f.activity === "none" && r.trades > 0) return false;
  if (f.activity === "90" || f.activity === "365") {
    if (!r.latest) return false;
    const age = daysBetween(r.latest, today);
    if (age < 0 || age > Number(f.activity)) return false;
  }
  const q = f.q.trim().toLowerCase();
  if (q) {
    const name = r.name.toLowerCase();
    for (const word of q.split(/\s+/)) if (!name.includes(word)) return false;
  }
  return true;
}

export function isDefault(f: DirFilter): boolean {
  return !f.q.trim() && !f.chamber && !f.party && !f.state && !f.committee && f.activity === "any";
}

/** "#chamber=senate&party=D" → a filter. Unknown keys and values are ignored, so a jump link stays a jump link. */
export function parseHash(hash: string): DirFilter {
  const f: DirFilter = { ...NO_FILTER };
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const ch = p.get("chamber"); if (ch === "house" || ch === "senate") f.chamber = ch;
  const pa = (p.get("party") ?? "").toUpperCase(); if (pa === "D" || pa === "R" || pa === "I") f.party = pa;
  const st = (p.get("state") ?? "").toUpperCase(); if (/^[A-Z]{2}$/.test(st)) f.state = st;
  const co = (p.get("committee") ?? "").toUpperCase(); if (/^[A-Z0-9]{2,8}$/.test(co)) f.committee = co;
  const ac = p.get("activity") ?? ""; if ((ACTIVITY as readonly string[]).includes(ac)) f.activity = ac as Activity;
  f.q = (p.get("q") ?? "").slice(0, 60);
  return f;
}

/** The hash for a filter; "" when nothing is set. */
export function toHash(f: DirFilter): string {
  const p = new URLSearchParams();
  if (f.chamber) p.set("chamber", f.chamber);
  if (f.party) p.set("party", f.party);
  if (f.state) p.set("state", f.state);
  if (f.committee) p.set("committee", f.committee);
  if (f.activity !== "any") p.set("activity", f.activity);
  if (f.q.trim()) p.set("q", f.q.trim());
  const s = p.toString();
  return s ? `#${s}` : "";
}
