#!/usr/bin/env node
/* ================================================================
   scenarios — run today's code over recorded days.

   ROADMAP stage 2. `fixtures/` is one afternoon, replayed forever;
   this replays every day the corpus caught, plus a handful of
   hand-built edges that a real day may never produce — an empty
   market, a coin listed six hours ago, a week where nothing moved.

   A real day has no expected output, so nothing here asserts values.
   It asserts the invariants in lib/invariants.js: properties that
   must hold of any market, whose failure means the modelling is wrong
   rather than that prices changed.

   usage:
     npm run scenarios                   # committed scenarios + fixtures/
     npm run scenarios -- --corpus=DIR   # also every bundle in DIR
     npm run scenarios -- --fetch[=N]    # also the N newest from the corpus branch
     npm run scenarios -- --verbose      # every invariant, not just failures

   Exits non-zero on a failed invariant: unlike the loop, this one is a
   test. Never edit a recording to make it pass — a real day that
   breaks an invariant means the invariant is wrong or the code is.
   ================================================================ */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchMarkets, fetchGlobal, fetchFearGreed, fetchTrending, describeReef } from "../lib/market.js";
import { fetchVitals, fetchEcosystem, makeRpc, peekWallet, describeTrench } from "../lib/solana.js";
import { reefToText, trenchToText } from "../lib/describe.js";
import { checkAll } from "../lib/invariants.js";
import { bundleFetch, fixtureFetch } from "./fixture-fetch.mjs";
import { WALLET } from "./endpoints.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const VERBOSE = flag("verbose");
const REPO = process.env.GITHUB_REPOSITORY || "NZT-48AIDEX/grrttpop";

/* ---------------- where scenarios come from ---------------- */
function committed() {
  const dir = join(ROOT, "fixtures", "scenarios");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return { name: `scenario:${f.replace(/\.json$/, "")}`, label: s.label, files: s.files, live: false };
  });
}

function localCorpus(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort().map((f) => {
    const b = JSON.parse(gunzipSync(readFileSync(join(dir, f))));
    return { name: `corpus:${f.replace(/\.json\.gz$/, "")}`, label: `${b.event} · ${b.at}`, files: b.files, live: true };
  });
}

async function fetchCorpus(n) {
  const base = `https://raw.githubusercontent.com/${REPO}/corpus/`;
  const index = await (await fetch(base + "index.json")).json();
  const newest = (index.index ?? []).slice(-n);
  const out = [];
  for (const e of newest) {
    const buf = Buffer.from(await (await fetch(base + e.name)).arrayBuffer());
    const b = JSON.parse(gunzipSync(buf));
    out.push({ name: `corpus:${e.name.replace(/\.json\.gz$/, "")}`, label: `${b.event} · ${b.at}`, files: b.files, live: true });
  }
  return out;
}

/* ---------------- run one day through the whole data layer ---------------- */
async function replay(s) {
  const f = s.files ? bundleFetch(s.files) : fixtureFetch();
  const ctx = { live: s.live };

  const coins = await fetchMarkets({ fetch: f }).catch(() => []);
  /* the decorations are allowed to fail — that is how the page treats
     them, and a scenario where they do is one worth having */
  const [t, m, g] = await Promise.allSettled([
    fetchTrending({ fetch: f }), fetchFearGreed({ fetch: f }), fetchGlobal({ fetch: f }),
  ]);
  ctx.reef = describeReef(coins, {
    trending: new Set(t.status === "fulfilled" ? t.value : []),
    mood: m.status === "fulfilled" ? m.value.value : null,
    global: g.status === "fulfilled" ? g.value : null,
    data: { source: s.live ? "recorded (live)" : "scenario", at: Date.now() },
  });
  ctx.reefText = reefToText(ctx.reef, { live: null });

  const rpc = makeRpc({ fetch: f, timeout: 2000 });
  const vitals = await fetchVitals(rpc).catch(() => ({}));
  const eco = await fetchEcosystem({ fetch: f }).catch(() => []);
  /* only where the recording actually holds a wallet read — corpus
     entries do not, because the publisher never asks for one */
  let wallet = null;
  if (s.files?.["solana-rpc.json"]?.getTokenAccountsByOwner !== undefined || !s.files) {
    wallet = await peekWallet(WALLET, { rpc, fetch: f }).catch(() => null);
  }
  ctx.trench = describeTrench({
    vitals, eco, wallet,
    data: { source: s.live ? "recorded (live)" : "scenario", at: Date.now() },
  });
  ctx.trenchText = trenchToText(ctx.trench);

  return ctx;
}

/* ---------------- go ---------------- */
const scenarios = [
  { name: "fixtures", label: "the recorded afternoon in fixtures/", files: null, live: true },
  ...committed(),
  ...localCorpus(opt("corpus") && resolve(ROOT, opt("corpus"))),
  ...(flag("fetch") || opt("fetch") ? await fetchCorpus(Number(opt("fetch")) || 3) : []),
];

let failed = 0, checks = 0;
for (const s of scenarios) {
  let rows;
  try {
    rows = checkAll(await replay(s));
  } catch (e) {
    console.log(`❌ ${s.name}\n     replaying it threw: ${e.message}`);
    failed++;
    continue;
  }
  const bad = rows.filter((r) => !r.ok);
  checks += rows.length;
  failed += bad.length;

  console.log(`${bad.length ? "❌" : "✅"} ${s.name.padEnd(28)} ${rows.length - bad.length}/${rows.length}  ${s.label ?? ""}`);
  for (const r of bad) console.log(`     ❌ ${r.name}\n        ${r.detail}`);
  if (VERBOSE) for (const r of rows.filter((x) => x.ok)) console.log(`     ✅ ${r.name}`);
}

console.log(`\n${failed ? "❌" : "✅"} ${checks - failed}/${checks} invariants held over ${scenarios.length} recorded day(s)`);
if (failed) {
  console.log("\nA recording that breaks an invariant means the invariant is wrong or the");
  console.log("code is. Never edit the recording — it is a day that actually happened.");
}
process.exit(failed ? 1 : 0);
