// /data/votes/<chamber>-<yyyy>-<mm>.json: members' positions on the roll calls of one chamber
// and one calendar month, packed (lib/votes.ts MonthFile). Built by streaming the month's
// positions from the database; one file per chamber and month with a recorded position.
import type { APIRoute } from "astro";
import { getFlagship, flagshipSql } from "../../../lib/flagship";
import { buildMonthFile, slugMap } from "../../../lib/votes-build";
import { MONTH_FILE_RE, monthFileName } from "../../../lib/votes";

export async function getStaticPaths() {
  const m = await getFlagship();
  return m.votes.months.map((x) => ({ params: { file: monthFileName(x.chamber, x.month) } }));
}
export const GET: APIRoute = async ({ params }) => {
  const g = MONTH_FILE_RE.exec(String(params.file));
  if (!g) return new Response("Not found", { status: 404 });
  const m = await getFlagship();
  const file = await buildMonthFile(flagshipSql(), g[1] as "house" | "senate", `${g[2]}-${g[3]}`, slugMap(m), m.votes.builtAt || m.builtAt.slice(0, 10));
  return new Response(JSON.stringify(file), { headers: { "content-type": "application/json; charset=utf-8" } });
};
