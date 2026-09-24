/* ================================================================
   recordings — where a recorded day comes from, and how to replay it.

   Both the scenario runner and the calibrator want the same thing: a
   recorded day, run through the real data layer, producing the same
   objects the pages and the mcp server produce. This is that, in one
   place, because two copies of "replay a bundle" would drift and then
   two tools would be measuring subtly different sites.

   A recording is `{ name, label, files, live }`, where `files` is
   keyed by the names fixtures/ uses. Corpus bundles already are.
   ================================================================ */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchMarkets, fetchGlobal, fetchFearGreed, fetchTrending, describeReef } from "../lib/market.js";
import { fetchVitals, fetchEcosystem, makeRpc, peekWallet, describeTrench } from "../lib/solana.js";
import { reefToText, trenchToText } from "../lib/describe.js";
import { bundleFetch, fixtureFetch } from "./fixture-fetch.mjs";
import { WALLET } from "./endpoints.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.GITHUB_REPOSITORY || "NZT-48AIDEX/grrttpop";
const CORPUS_URL = `https://raw.githubusercontent.com/${REPO}/corpus/`;

/** the one afternoon in fixtures/ — the site's oldest recorded day */
export const FIXTURES_RECORDING =
  { name: "fixtures", label: "the recorded afternoon in fixtures/", files: null, live: true };

/** hand-built edges a real day may never produce, all labelled synthetic */
export function committedScenarios() {
  const dir = join(ROOT, "fixtures", "scenarios");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return { name: `scenario:${f.replace(/\.json$/, "")}`, label: s.label, files: s.files, live: false };
  });
}

const fromBundle = (name, b) => ({
  name: `corpus:${name.replace(/\.json\.gz$/, "")}`,
  label: `${b.event} · ${b.at}`,
  at: b.at,
  event: b.event,
  files: b.files,
  live: true,
});

export function localCorpus(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort()
    .map((f) => fromBundle(f, JSON.parse(gunzipSync(readFileSync(join(dir, f))))));
}

/** the newest `n` off the corpus branch; `n = Infinity` for all of it */
export async function fetchCorpus(n = 3) {
  const index = await (await fetch(CORPUS_URL + "index.json")).json();
  const rows = (index.index ?? []);
  const newest = Number.isFinite(n) ? rows.slice(-n) : rows;
  const out = [];
  for (const e of newest) {
    const buf = Buffer.from(await (await fetch(CORPUS_URL + e.name)).arrayBuffer());
    out.push(fromBundle(e.name, JSON.parse(gunzipSync(buf))));
  }
  return out;
}

/**
 * Run a recording through the whole data layer. Failures are left to
 * the code's own handling rather than caught here: a recording where
 * the decorations were down is a recording worth having, and the page
 * treats them as optional too.
 */
export async function replay(rec, { wallet = "auto" } = {}) {
  const f = rec.files ? bundleFetch(rec.files) : fixtureFetch();
  const source = rec.live ? "recorded (live)" : "scenario";
  const at = rec.at ? new Date(rec.at).getTime() : Date.now();
  const ctx = { live: rec.live, at: rec.at ?? null, name: rec.name };

  const coins = await fetchMarkets({ fetch: f }).catch(() => []);
  const [t, m, g] = await Promise.allSettled([
    fetchTrending({ fetch: f }), fetchFearGreed({ fetch: f }), fetchGlobal({ fetch: f }),
  ]);
  ctx.reef = describeReef(coins, {
    trending: new Set(t.status === "fulfilled" ? t.value : []),
    mood: m.status === "fulfilled" ? m.value.value : null,
    global: g.status === "fulfilled" ? g.value : null,
    data: { source, at },
  });
  ctx.reefText = reefToText(ctx.reef, { live: null });

  const rpc = makeRpc({ fetch: f, timeout: 2000 });
  const vitals = await fetchVitals(rpc).catch(() => ({}));
  const eco = await fetchEcosystem({ fetch: f }).catch(() => []);

  /* only where the recording actually holds a wallet read — corpus
     entries do not, because the publisher never asks for one */
  let held = null;
  const hasWallet = rec.files ? rec.files["solana-rpc.json"]?.getTokenAccountsByOwner !== undefined : true;
  if (wallet !== "skip" && hasWallet) {
    held = await peekWallet(WALLET, { rpc, fetch: f }).catch(() => null);
  }

  ctx.trench = describeTrench({ vitals, eco, wallet: held, data: { source, at } });
  ctx.trenchText = trenchToText(ctx.trench);
  return ctx;
}
