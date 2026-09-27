// Measurement job: how often do AI answer engines (ChatGPT, Claude, Perplexity, Gemini)
// cite spotthemoney.com when asked the kinds of questions our target readers actually type
// into them? Cadence: monthly (roadmap B.7).
//
// Reads scripts/citation-questions.json (200 fixed questions, curated once and reused every
// run so month-over-month numbers are comparable), asks each question of every engine whose
// API key is present, and upserts one metrics_citations row per (run_date, engine,
// question_id) recording whether spotthemoney.com showed up in the answer text or in any
// cited URL.
//
// Engines are each their own small fetch function returning { text, urls } so a change to
// one provider's response shape never touches the others. All requests go through the
// global `fetch` directly (not lib/http.ts's politeFetch — these are first-party JSON APIs
// with their own auth and rate-limit conventions, not the polite-scraping government sources
// lib/http.ts is policy for), but we still self-throttle: sequential per engine, engines run
// in sequence too, with a fixed 1.2s gap between requests to respect each provider's
// rate limits.
//
// Cost control / smoke testing:
//   CITATION_MAX_QUESTIONS=10   — only ask the first N questions from the file
//   CITATION_ENGINES=openai,gemini — restrict to a comma list of engine keys
//
// No engine key present at all → dry run: validate the question file, print the plan
// (per-engine question count, estimated request count), write nothing, return success with
// stats.dry_run = true. This is also what a fresh clone / CI without secrets sees.
//
// Per-question failures are quarantined (ref = "engine:questionId") and recorded as an
// error row in metrics_citations rather than aborting the run — one flaky provider response
// must not lose the other 199 questions or the other 3 engines.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, closeDb } from "../lib/db.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "citation_count";
const SITE_HOST = "spotthemoney.com";
const REQUEST_GAP_MS = 1200;

interface Question {
  id: string;
  category: string;
  question: string;
  expected_page_type: string;
}

interface EngineAnswer {
  text: string;
  urls: string[];
}

type EngineFn = (question: string) => Promise<EngineAnswer>;

interface EngineDef {
  key: string;
  envKey: string;
  run: EngineFn;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadQuestions(): Question[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "citation-questions.json");
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected a JSON array`);
  for (const q of parsed) {
    if (
      typeof q !== "object" || q === null ||
      typeof (q as Question).id !== "string" ||
      typeof (q as Question).question !== "string"
    ) {
      throw new Error(`${path}: malformed question entry ${JSON.stringify(q)}`);
    }
  }
  return parsed as Question[];
}

/** True when the answer text or any cited URL points at spotthemoney.com. */
function detectCitation(answer: EngineAnswer): boolean {
  if (answer.text.toLowerCase().includes("spotthemoney")) return true;
  for (const u of answer.urls) {
    try {
      const host = new URL(u).host.toLowerCase();
      if (host === SITE_HOST || host.endsWith(`.${SITE_HOST}`)) return true;
    } catch {
      // Not a parseable URL (some engines emit bare domain strings) — fall back to substring.
      if (u.toLowerCase().includes(SITE_HOST)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

async function askOpenAI(question: string): Promise<EngineAnswer> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search_preview" }],
      input: question,
    }),
  });
  if (!res.ok) throw new Error(`openai HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
        annotations?: Array<{ type?: string; url?: string }>;
      }>;
    }>;
  };

  let text = "";
  const urls: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (typeof c.text === "string") text += c.text;
      for (const a of c.annotations ?? []) {
        if (a.type === "url_citation" && a.url) urls.push(a.url);
      }
    }
  }
  return { text, urls };
}

async function askAnthropic(question: string): Promise<EngineAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    content?: Array<{
      type?: string;
      text?: string;
      citations?: Array<{ url?: string }>;
      content?: Array<{ url?: string }>;
    }>;
  };

  let text = "";
  const urls: string[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text") {
      if (typeof block.text === "string") text += block.text;
      for (const c of block.citations ?? []) {
        if (c.url) urls.push(c.url);
      }
    } else if (block.type === "web_search_tool_result") {
      for (const r of block.content ?? []) {
        if (r.url) urls.push(r.url);
      }
    }
  }
  return { text, urls };
}

async function askPerplexity(question: string): Promise<EngineAnswer> {
  const apiKey = process.env.PERPLEXITY_API_KEY!;
  const model = process.env.PERPLEXITY_MODEL ?? "sonar";
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!res.ok) throw new Error(`perplexity HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
    search_results?: Array<{ url?: string }>;
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  const urls: string[] = [...(data.citations ?? [])];
  for (const r of data.search_results ?? []) {
    if (r.url) urls.push(r.url);
  }
  return { text, urls };
}

async function askGemini(question: string): Promise<EngineAnswer> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: question }] }],
      tools: [{ google_search: {} }],
    }),
  });
  if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> };
    }>;
  };

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const urls: string[] = [];
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    if (chunk.web?.uri) urls.push(chunk.web.uri);
  }
  return { text, urls };
}

const ENGINES: EngineDef[] = [
  { key: "openai", envKey: "OPENAI_API_KEY", run: askOpenAI },
  { key: "anthropic", envKey: "ANTHROPIC_API_KEY", run: askAnthropic },
  { key: "perplexity", envKey: "PERPLEXITY_API_KEY", run: askPerplexity },
  { key: "gemini", envKey: "GEMINI_API_KEY", run: askGemini },
];

// ---------------------------------------------------------------------------

export async function ingestCitationCount(): Promise<IngestRunResult> {
  const ctx = createRunContext(SOURCE);
  const runDate = new Date().toISOString().slice(0, 10); // today, UTC

  let questions: Question[];
  try {
    questions = loadQuestions();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "failed", error: message };
  }

  const maxQuestions = Number(process.env.CITATION_MAX_QUESTIONS ?? questions.length);
  if (Number.isFinite(maxQuestions) && maxQuestions > 0 && maxQuestions < questions.length) {
    questions = questions.slice(0, maxQuestions);
  }

  const restrictTo = process.env.CITATION_ENGINES
    ? new Set(process.env.CITATION_ENGINES.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const candidateEngines = restrictTo ? ENGINES.filter((e) => restrictTo.has(e.key)) : ENGINES;
  const activeEngines = candidateEngines.filter((e) => Boolean(process.env[e.envKey]));

  ctx.extra["run_date"] = runDate;
  ctx.extra["question_count"] = questions.length;
  ctx.extra["engines_considered"] = candidateEngines.map((e) => e.key);
  ctx.extra["engines_active"] = activeEngines.map((e) => e.key);

  if (activeEngines.length === 0) {
    // Dry run: no key present for any candidate engine.
    const plan = candidateEngines.map((e) => ({
      engine: e.key,
      env_key: e.envKey,
      key_present: false,
      questions: questions.length,
    }));
    console.log(`[${SOURCE}] dry run — no engine keys present. Plan:`);
    for (const p of plan) console.log(`  ${p.engine}: 0/${p.questions} (missing ${p.env_key})`);
    console.log(
      `  total questions in file: ${questions.length}; would send ${questions.length} requests per active engine`,
    );
    return {
      source: SOURCE,
      rowsSeen: 0,
      rowsChanged: 0,
      status: "success",
      stats: {
        ...ctx.stats(),
        dry_run: true,
        plan,
        estimated_requests_if_all_active: questions.length * candidateEngines.length,
      },
    };
  }

  const sql = getDb();
  let changed = 0;

  for (const engine of activeEngines) {
    let engineErrors = 0;
    for (const q of questions) {
      ctx.rowsSeen++;
      let cited: boolean | null = null;
      let citedUrls: string[] = [];
      let excerpt: string | null = null;
      let errorMsg: string | null = null;

      try {
        const answer = await engine.run(q.question);
        cited = detectCitation(answer);
        citedUrls = answer.urls;
        excerpt = answer.text.slice(0, 500);
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        engineErrors++;
        ctx.quarantine(`${engine.key}:${q.id}`, errorMsg);
      }

      const row = scrubDeep({
        run_date: runDate,
        engine: engine.key,
        question_id: q.id,
        question: q.question,
        cited,
        cited_urls: citedUrls,
        answer_excerpt: excerpt,
        error: errorMsg,
      });

      const result = await sql`
        insert into metrics_citations (
          run_date, engine, question_id, question, cited, cited_urls, answer_excerpt, error
        )
        values (
          ${row.run_date}, ${row.engine}, ${row.question_id}, ${row.question},
          ${row.cited}, ${sql.json(row.cited_urls)}, ${row.answer_excerpt}, ${row.error}
        )
        on conflict (run_date, engine, question_id) do update
          set question = excluded.question,
              cited = excluded.cited,
              cited_urls = excluded.cited_urls,
              answer_excerpt = excluded.answer_excerpt,
              error = excluded.error
      `;
      changed += result.count ?? 0;

      await sleep(REQUEST_GAP_MS);
    }
    ctx.extra[`${engine.key}_errors`] = engineErrors;
  }

  ctx.rowsChanged = changed;

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: "success",
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- citation_count` or `tsx src/jobs/citation_count.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestCitationCount()
    .then((r) => {
      console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`);
      if (r.error) console.warn("  note:", r.error);
    })
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
