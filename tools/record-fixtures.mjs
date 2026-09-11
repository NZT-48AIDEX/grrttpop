#!/usr/bin/env node
/* ================================================================
   record — snapshot the live apis once, so tests never need them.

   CoinGecko's free tier rate-limits hard: an agent running the smoke
   test in a loop would spend its time fighting 429s instead of
   finding bugs. This captures one real response per endpoint into
   fixtures/, which ?fixtures=1 then replays forever, offline.

   Refusals are recorded too. Every free Solana endpoint blocks
   getTokenAccountsByOwner, and that gated path is the most fragile
   code in the repo — a fixture that "succeeds" would test a world
   that does not exist.

   usage: npm run record        (only needed when an api changes shape)
   ================================================================ */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "fixtures");
mkdirSync(OUT, { recursive: true });

const CG = "https://api.coingecko.com/api/v3";
const RPC = "https://solana-rpc.publicnode.com";
const WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";   // binance hot wallet, public, read-only
const SOL_MINT = "So11111111111111111111111111111111111111112";

const save = (name, data) => {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 1));
  const kb = (JSON.stringify(data).length / 1024).toFixed(0);
  console.log(`  ✓ ${name} (${kb}kb)`);
};

const get = async (url, ms = 25_000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const rpc = async (method, params = []) => {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json().catch(() => null);
  if (j?.error) return { __error: j.error };          // keep the refusal verbatim
  if (!r.ok) return { __error: { code: r.status, message: "HTTP " + r.status } };
  return j.result;
};

const step = async (label, fn) => {
  process.stdout.write(`${label}…\n`);
  try { await fn(); }
  catch (e) { console.error(`  ✗ ${label}: ${e.message}`); failures++; }
  await new Promise((r) => setTimeout(r, 1500));       // stay under the free rate limit
};
let failures = 0;

console.log("recording fixtures from the live apis\n");

await step("coingecko markets", async () =>
  save("cg-markets.json", await get(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&sparkline=true&price_change_percentage=1h,24h,7d`)));

await step("coingecko global", async () => save("cg-global.json", await get(`${CG}/global`)));
await step("coingecko trending", async () => save("cg-trending.json", await get(`${CG}/search/trending`)));

await step("coingecko solana ecosystem", async () =>
  save("cg-eco.json", await get(`${CG}/coins/markets?vs_currency=usd&category=solana-ecosystem&order=market_cap_desc&per_page=40&sparkline=true&price_change_percentage=1h,24h,7d`)));

await step("coingecko token price", async () =>
  save("cg-token-price.json", await get(`${CG}/simple/token_price/solana?contract_addresses=${SOL_MINT}&vs_currencies=usd&include_24hr_change=true`)));

await step("fear & greed", async () => save("fng.json", await get("https://api.alternative.me/fng/")));

await step("jupiter verified tokens", async () => {
  const all = await get("https://lite-api.jup.ag/tokens/v2/tag?query=verified", 40_000);
  // the real list is thousands of mints and megabytes; keep the shape,
  // trim the volume, and make sure SOL survives the cut
  const arr = Array.isArray(all) ? all : all?.tokens ?? [];
  const sol = arr.filter((t) => (t.id ?? t.address) === SOL_MINT);
  save("jup-tokens.json", [...sol, ...arr.filter((t) => (t.id ?? t.address) !== SOL_MINT).slice(0, 119)]);
});

await step("jupiter prices", async () =>
  save("jup-price.json", await get(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`)));

await step("solana rpc", async () => {
  const out = {};
  out.getRecentPerformanceSamples = await rpc("getRecentPerformanceSamples", [1]);
  out.getEpochInfo = await rpc("getEpochInfo");
  out.getBalance = await rpc("getBalance", [WALLET]);
  out.getSlot = await rpc("getSlot");
  // expected to come back as a refusal — that IS the fixture
  out.getTokenAccountsByOwner = await rpc("getTokenAccountsByOwner",
    [WALLET, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]);
  const gated = out.getTokenAccountsByOwner?.__error;
  console.log(`  · getTokenAccountsByOwner: ${gated ? "refused — " + gated.message : "allowed (unusual for a free endpoint)"}`);
  save("solana-rpc.json", out);
});

save("recorded-at.json", { at: new Date().toISOString(), note: "regenerate with: npm run record" });

console.log(failures ? `\n⚠️  done with ${failures} failure(s) — those fixtures are stale or missing`
                     : "\n✅ fixtures recorded");
process.exit(failures ? 1 : 0);
