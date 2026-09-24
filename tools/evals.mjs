#!/usr/bin/env node
/* ================================================================
   evals — real questions, asked of the real surfaces.

   ROADMAP stage 4. Each question records what it cost to answer: a
   plain fetch of the published feed, a fetch of the site, a clone with
   node, or a headless browser. The expensive ones are the backlog.

   usage:
     npm run evals                 # the cheap tiers
     npm run evals -- --browser    # including the ones that need chrome
     npm run evals -- --bless      # record the current scores as the baseline
     npm run evals -- --json

   Exits non-zero only on a regression against evals/baseline.json:
   something that used to be answerable and is not, or something that
   got more expensive. A new question is never a failure.
   ================================================================ */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreboard, compare, baselineOf, TIER_WHAT } from "../lib/evals.js";
import { makeRpc, peekWallet, isSolAddress } from "../lib/solana.js";
import { WALLET } from "./endpoints.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const BROWSER = flag("browser");
const BASELINE = join(ROOT, "evals", "baseline.json");

const FEED = "https://raw.githubusercontent.com/NZT-48AIDEX/grrttpop/data/";
const SITE = "https://nzt-48aidex.github.io/grrttpop/";

/* ---------------- how a question is allowed to answer ---------------- */
function ctx() {
  const c = { calls: 0 };
  c.feed = async (name) => {
    c.calls++;
    const r = await fetch(FEED + name, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`${r.status} fetching ${name}`);
    return name.endsWith(".json") ? r.json() : r.text();
  };
  c.site = async (path) => {
    c.calls++;
    const r = await fetch(SITE + path, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`${r.status} fetching ${path}`);
    return path.endsWith(".json") ? r.json() : r.text();
  };
  return c;
}

/* ---------------- the questions ---------------- */
const EVALS = [
  {
    id: "week-vs-day",
    question: "which coins are up on the week but selling off today?",
    why: "the question the trend work exists for. a 24h number alone cannot answer it.",
    tier: "feed",
    async run(c) {
      const reef = await c.feed("reef.json");
      const all = [...reef.biggestGainers, ...reef.biggestLosers];
      const turning = all.filter((x) => x.trend?.divergent && x.trend.direction === "up");
      return { answer: turning.map((x) => `${x.symbol} ${x.trend.shape}`), n: reef.week?.breadth?.divergent };
    },
    check: (a) => (Array.isArray(a.answer) ? null : "no list came back"),
  },
  {
    id: "market-in-a-sentence",
    question: "what is the market doing this week, in one sentence?",
    why: "the commonest question anyone asks a market surface.",
    tier: "feed",
    async run(c) {
      const reef = await c.feed("reef.json");
      const w = reef.week;
      return { answer: `${w.shape}, ${w.weekPct}% — ${w.breadth.up} up, ${w.breadth.down} down, ${w.breadth.flat} sideways` };
    },
    check: (a) => (/\d/.test(a.answer) && a.answer.length > 20 ? null : "not a sentence with numbers in it"),
  },
  {
    id: "how-old-and-is-it-real",
    question: "how old is this data, and is any of it invented?",
    why: "an agent quoting a number has to know whether it is real. the demo reef renders identically.",
    tier: "feed",
    async run(c) {
      const reef = await c.feed("reef.json");
      const age = (Date.now() - new Date(reef.data.asOf)) / 3_600_000;
      return { answer: `${age.toFixed(1)}h old, source ${reef.data.source}, synthetic: ${reef.data.synthetic}`,
               synthetic: reef.data.synthetic, source: reef.data.source };
    },
    check: (a) => (typeof a.synthetic === "boolean" && a.source ? null : "provenance missing"),
  },
  {
    id: "solana-vitals",
    question: "what is solana's tps, and how far through the epoch is it?",
    why: "the trench's headline numbers, without rendering the trench.",
    tier: "feed",
    async run(c) {
      const t = await c.feed("trench.json");
      return { answer: `${t.network.tps} tps, epoch ${t.network.epoch} at ${t.network.epochPercent}%`,
               tps: t.network.tps, pct: t.network.epochPercent };
    },
    check: (a) => (a.tps > 0 && a.pct >= 0 && a.pct <= 100 ? null : `tps ${a.tps}, epoch ${a.pct}%`),
  },
  {
    id: "spl-mover-holding",
    question: "which solana token moved most today, and is that move holding?",
    why: "two questions at once — the number, and whether to believe it.",
    tier: "feed",
    async run(c) {
      const t = await c.feed("trench.json");
      const top = t.ecosystem.topGainers[0];
      if (!top) return { answer: "nothing is up today", empty: true };
      return { answer: `${top.symbol} ${top.change24h?.toFixed(2)}% — 7d: ${top.trend?.shape ?? "no history"}`,
               hasShape: !!top.trend };
    },
    check: (a) => (a.empty || a.hasShape ? null : "the mover came back without its week"),
  },
  {
    id: "scene-in-words",
    question: "what is the reef showing right now, in words?",
    why: "used to need a browser: ?agent=1 is rendered by javascript. the published text answers it now.",
    tier: "feed",
    async run(c) {
      const text = await c.feed("reef.txt");
      return { answer: text.split("\n").slice(0, 3).join(" / "), chars: text.length, text };
    },
    check: (a) => (a.chars > 400 && /depth bands/.test(a.text) ? null : `only ${a.chars} chars of description`),
  },
  {
    id: "is-it-tracking-me",
    question: "does this site track me, and what does it promise?",
    why: "an agent should be able to check a claim rather than trust a paragraph.",
    tier: "site",
    async run(c) {
      const card = await c.site("agent.json");
      return { answer: `no_tracking: ${card.site.no_tracking}, mcp read_only: ${card.site.mcp?.read_only}`,
               tracking: card.site.no_tracking, readOnly: card.site.mcp?.read_only };
    },
    check: (a) => (a.tracking === true && a.readOnly === true ? null : "the card does not make both promises"),
  },
  {
    id: "wallet-completeness",
    question: "peek at a public wallet — is what you got the whole thing?",
    why: "the honesty this site is built around. a partial read must never read as complete.",
    tier: "clone",
    async run(c) {
      c.calls++;
      const rpc = makeRpc({ timeout: 8000 });
      const w = await peekWallet(WALLET, { rpc, limit: 5 });
      return { answer: `${w.items.length} holdings, partial: ${w.partial}, gated: ${w.gated} — ${w.reason ?? "complete"}`,
               partial: w.partial, gated: w.gated, reason: w.reason, valid: isSolAddress(WALLET) };
    },
    /* gated can never mean complete: this checker is why the bug above
       was found, and it is the shape of it that matters, not the values */
    check: (a) => {
      if (a.gated && !a.partial) return "gated but reported as a complete read";
      if (a.partial && !a.reason) return "partial with no reason given";
      return null;
    },
  },
  {
    id: "page-actually-renders",
    question: "is the reef rendering, or is it a plausible-looking black rectangle?",
    why: "nothing published can answer this. it is the reason site_state exists.",
    tier: "browser",
    expensive: true,
    async run(c) {
      const { serve } = await import("./serve.mjs");
      const { launch } = await import("./cdp.mjs");
      c.calls++;
      const server = await serve({ root: ROOT, port: 0 });
      const browser = await launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${server.url}/market.html?seed=42&freeze=1&fixtures=1`);
        await page.waitFor("window.__ready !== undefined", { label: "page scripts" });
        await page.eval("await window.__ready; return 1");
        await page.eval("return __harness.step(60)");
        const st = await page.eval("return reef.state()");
        return { answer: `${st.gl.calls} draw calls, ${st.gl.shaderFails} shader failures, ${st.reef.blobs} creatures`,
                 draws: st.gl.calls, fails: st.gl.shaderFails };
      } finally {
        await browser.close();
        await server.stop();
      }
    },
    check: (a) => (a.draws > 0 && a.fails === 0 ? null : `${a.draws} draws, ${a.fails} shader failures`),
  },
];

/* ---------------- run them ---------------- */
const results = [];
for (const e of EVALS) {
  if (e.expensive && !BROWSER) {
    results.push({ id: e.id, question: e.question, tier: e.tier, skipped: true,
                   detail: "needs --browser" });
    continue;
  }
  const c = ctx();
  const t0 = Date.now();
  try {
    const out = await e.run(c);
    const bad = e.check(out);
    results.push({ id: e.id, question: e.question, tier: e.tier, ok: !bad,
                   detail: bad ?? null, answer: out.answer, calls: c.calls, ms: Date.now() - t0 });
  } catch (err) {
    /* a question nothing could answer is the most interesting result
       here, so it is recorded rather than thrown */
    results.push({ id: e.id, question: e.question, tier: "unanswerable", ok: false,
                   detail: err.message, calls: c.calls, ms: Date.now() - t0 });
  }
}

const board = scoreboard(results);
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")).scores : [];
const diff = compare(results, baseline);

if (flag("bless")) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify({
    what: "what each question cost to answer, last time anyone checked",
    why: "a regression here means something an agent could fetch now needs a clone or a browser",
    blessedAt: new Date().toISOString(),
    scores: baselineOf(results),
  }, null, 2) + "\n");
  console.log(`blessed ${baselineOf(results).length} scores into evals/baseline.json`);
}

if (flag("json")) {
  console.log(JSON.stringify({ board, results, diff }, null, 2));
  process.exit(diff.ok ? 0 : 1);
}

for (const r of results) {
  const mark = r.skipped ? "·" : r.ok ? "✅" : "❌";
  console.log(`${mark} ${r.tier.padEnd(12)} ${String(r.calls ?? "").padStart(2)} call(s)  ${r.question}`);
  if (r.answer) console.log(`      → ${String(r.answer).slice(0, 96)}`);
  if (r.detail && !r.skipped) console.log(`      ❌ ${r.detail}`);
  if (r.skipped) console.log(`      · ${r.detail}`);
}

console.log(`\n${board.answered}/${board.ran} answered · ${board.calls} calls · ` +
  Object.entries(board.byTier).map(([t, n]) => `${n} ${t}`).join(" · ") +
  (board.skipped ? ` · ${board.skipped} skipped` : ""));

if (board.backlog.length) {
  console.log(`\nthe backlog — what an agent still cannot get cheaply:`);
  for (const b of board.backlog) console.log(`  ${b.tier.padEnd(13)} ${b.question}\n${" ".repeat(17)}needs ${TIER_WHAT[b.tier]}`);
}

for (const i of diff.improvements) console.log(`\n⬆️  ${i.id}: ${i.why}`);
for (const r of diff.regressions) console.log(`\n❌ regression — ${r.id}: ${r.why}`);
if (diff.added.length) console.log(`\n${diff.added.length} new question(s), not scored before — run with --bless to record them`);

process.exit(diff.ok ? 0 : 1);
