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

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchMarkets, fetchGlobal, fetchFearGreed, fetchTrending, describeReef, COINS,
} from "../lib/market.js";
import { makeRpc, fetchVitals, fetchEcosystem, describeTrench } from "../lib/solana.js";
import { buildSnapshot, publishability, SNAPSHOT_FILES } from "../lib/snapshot.js";
import { fixtureFetch } from "./fixture-fetch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

const FIXTURES = flag("fixtures");
const ALLOW_SYNTHETIC = flag("allow-synthetic");
const OUT = resolve(ROOT, opt("out") ?? "data");
const EVERY = opt("every") ?? "30 minutes";

const f = FIXTURES ? fixtureFetch() : fetch;
/* the stamp every description will carry. replaying recordings is a
   harness, and provenanceOf() turns that into source:"fixtures" and
   synthetic:true — which is what stops this being publishable. */
const harness = FIXTURES ? { on: true, fixtures: true } : null;

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

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
  reef().catch((e) => fail(`the reef: ${e.message}\n  nothing was published; the last snapshot still stands.`)),
  trench().catch((e) => fail(`the trench: ${e.message}\n  nothing was published; the last snapshot still stands.`)),
]);

const verdict = publishability({ reef: r, trench: t });
if (!verdict.ok && !ALLOW_SYNTHETIC) {
  fail(`refusing to publish: ${verdict.why.join("; ")}.\n` +
       "  a feed of invented numbers is worse than no feed. pass --allow-synthetic to write it anyway (tests only).");
}

const files = buildSnapshot({ reef: r, trench: t, every: EVERY });
mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);

const missing = SNAPSHOT_FILES.filter((n) => !(n in files));
if (missing.length) fail(`built a snapshot missing ${missing.join(", ")}`);

console.log(`✅ snapshot → ${OUT}`);
for (const [name, body] of Object.entries(files)) {
  console.log(`   ${name.padEnd(12)} ${String(Buffer.byteLength(body)).padStart(7)} bytes`);
}
console.log(`   reef:   ${r.coins} coins · ${r.data.source} · ${r.data.asOf}`);
console.log(`   trench: ${t.ecosystem.tokens} tokens · tps ${t.network.tps ?? "—"} · ${t.data.source}`);
if (!verdict.ok) console.log(`   ⚠️  synthetic, written only because --allow-synthetic: ${verdict.why.join("; ")}`);
