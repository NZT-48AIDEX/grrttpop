#!/usr/bin/env node
/* ================================================================
   snapshot — run the site's data layer in node, write the answers out.

   `lib/market.js` and `lib/solana.js` were extracted so they'd run
   anywhere with no DOM and no three.js. This is that promise being
   collected: the same functions, no browser, output an agent can
   curl.

   usage:
     node tools/snapshot.mjs                 # live apis -> data/
     node tools/snapshot.mjs --out=/tmp/s    # somewhere else
     node tools/snapshot.mjs --fixtures      # offline, from recordings
     node tools/snapshot.mjs --fixtures --allow-synthetic   # and write them

   Exits non-zero rather than publishing something wrong. A failed run
   leaves the last good snapshot standing, which is the correct
   outcome: stale and true beats fresh and invented.
   ================================================================ */

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchMarkets, fetchGlobal, fetchFearGreed, fetchTrending, describeReef, COINS,
} from "../lib/market.js";
import { makeRpc, fetchVitals, fetchEcosystem, describeTrench } from "../lib/solana.js";
import { buildSnapshot, publishability, SNAPSHOT_FILES } from "../lib/snapshot.js";
import { fixtureFetch } from "./fixture-fetch.mjs";
import { captureFetch } from "./capture-fetch.mjs";
import { entryName } from "../lib/corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

const FIXTURES = flag("fixtures");
const ALLOW_SYNTHETIC = flag("allow-synthetic");
const OUT = resolve(ROOT, opt("out") ?? "data");
const EVERY = opt("every") ?? "when the publisher runs — see data.asOf for this file's actual age";
/* where to archive what upstream said, if anywhere. replays are never
   archived: a corpus of our own recordings played back to ourselves
   would be a very confident record of nothing. */
const CORPUS = opt("corpus") ? resolve(ROOT, opt("corpus")) : null;
const EVENT = opt("event") ?? process.env.GITHUB_EVENT_NAME ?? "local";

const f = FIXTURES ? fixtureFetch() : captureFetch(fetch);
/* the stamp every description will carry. replaying recordings is a
   harness, and provenanceOf() turns that into source:"fixtures" and
   synthetic:true — which is what stops this being publishable. */
const harness = FIXTURES ? { on: true, fixtures: true } : null;

/**
 * A run that fails already knows something no sampler can catch: a 429,
 * an rpc refusal, an api that changed shape. Those last minutes, and the
 * publisher looks every few hours — so record it where it happens rather
 * than hoping to sample one later.
 */
function incident(stage, err) {
  if (!CORPUS) return null;
  const at = new Date().toISOString();
  const rec = {
    at, event: EVENT, stage,
    message: err?.message ?? String(err),
    status: err?.status ?? null,
    body: typeof err?.body === "string" ? err.body.slice(0, 2000) : null,
    captured: FIXTURES ? null : Object.keys(f.captured ?? {}),
  };
  const dir = join(CORPUS, "incidents");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  console.error(`   incident recorded: ${file}`);
  return file;
}

const fail = (msg, err = null) => {
  if (err) incident(msg.split(":")[0], err);
  console.error(`✗ ${msg}`);
  process.exit(1);
};

/* ---------------- the reef ---------------- */
async function reef() {
  const at = Date.now();
  const coins = await fetchMarkets({ perPage: COINS, fetch: f });
  if (!Array.isArray(coins) || !coins.length) throw new Error("coingecko returned no coins");

  // decoration: a rate limit on these must not lose the market itself
  const [t, m, g] = await Promise.allSettled([
    fetchTrending({ fetch: f }), fetchFearGreed({ fetch: f }), fetchGlobal({ fetch: f }),
  ]);
  return describeReef(coins, {
    trending: new Set(t.status === "fulfilled" ? t.value : []),
    mood: m.status === "fulfilled" ? m.value.value : null,
    global: g.status === "fulfilled" ? g.value : null,
    data: { source: "coingecko", at, harness },
  });
}

/* ---------------- the trench ---------------- */
/* no wallet here on purpose: a peek is something you ask for about an
   address you chose, not something this publishes about anyone. */
async function trench() {
  const at = Date.now();
  const rpc = makeRpc({ fetch: f });
  const [v, eco] = await Promise.all([
    fetchVitals(rpc).catch(() => null),
    fetchEcosystem({ fetch: f }),
  ]);
  if (!Array.isArray(eco) || !eco.length) throw new Error("coingecko returned no solana ecosystem");
  return describeTrench({
    vitals: v ?? {},
    eco,
    data: { source: `${rpc.state().endpoint || "solana-rpc"} + coingecko`, at, harness },
  });
}

/* ---------------- go ---------------- */
const [r, t] = await Promise.all([
  reef().catch((e) => fail(`the reef: ${e.message}\n  nothing was published; the last snapshot still stands.`, e)),
  trench().catch((e) => fail(`the trench: ${e.message}\n  nothing was published; the last snapshot still stands.`, e)),
]);

const verdict = publishability({ reef: r, trench: t });
if (!verdict.ok && !ALLOW_SYNTHETIC) {
  fail(`refusing to publish: ${verdict.why.join("; ")}.\n` +
       "  a feed of invented numbers is worse than no feed. pass --allow-synthetic to write it anyway (tests only).",
       new Error(`refused: ${verdict.why.join("; ")}`));
}

const files = buildSnapshot({ reef: r, trench: t, every: EVERY });
mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);

const missing = SNAPSHOT_FILES.filter((n) => !(n in files));
if (missing.length) fail(`built a snapshot missing ${missing.join(", ")}`);

/* the archive is the raw upstream payloads, not these derived files:
   replaying describe() output can only ever test code that already
   exists, and the point is to run tomorrow's lib/ over today's market. */
let corpusFile = null;
if (CORPUS && !FIXTURES) {
  const bundle = {
    at: r.data.asOf,
    event: EVENT,
    source: { reef: r.data.source, trench: t.data.source },
    run: process.env.GITHUB_RUN_ID ?? null,
    files: f.captured,
  };
  mkdirSync(CORPUS, { recursive: true });
  corpusFile = join(CORPUS, entryName(r.data.asOf));
  writeFileSync(corpusFile, gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 }));
}

console.log(`✅ snapshot → ${OUT}`);
for (const [name, body] of Object.entries(files)) {
  console.log(`   ${name.padEnd(12)} ${String(Buffer.byteLength(body)).padStart(7)} bytes`);
}
console.log(`   reef:   ${r.coins} coins · ${r.data.source} · ${r.data.asOf}`);
console.log(`   trench: ${t.ecosystem.tokens} tokens · tps ${t.network.tps ?? "—"} · ${t.data.source}`);
if (!verdict.ok) console.log(`   ⚠️  synthetic, written only because --allow-synthetic: ${verdict.why.join("; ")}`);
if (corpusFile) {
  const kb = (statSync(corpusFile).size / 1024).toFixed(0);
  console.log(`   corpus: ${corpusFile.split("/").pop()} (${kb} KB, ${Object.keys(f.captured).length} payloads, event=${EVENT})`);
} else if (CORPUS && FIXTURES) {
  console.log("   corpus: skipped — replays are not archived");
}
