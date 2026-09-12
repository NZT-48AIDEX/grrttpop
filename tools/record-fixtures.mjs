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

/* the url list is shared with tools/drift.mjs: if each kept its own copy
   they would drift apart and the drift checker would compare the wrong url
   to the wrong file */
import { HTTP_FIXTURES, RPC_CALLS, RPC, SOL_MINT } from "./endpoints.mjs";

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

for (const { file, label, url, timeout, trimmed } of HTTP_FIXTURES) {
  await step(label, async () => {
    const data = await get(url, timeout ?? 25_000);
    if (!trimmed) return save(file, data);
    /* the verified token list is thousands of mints and megabytes. keep the
       shape, trim the volume, and make sure SOL survives the cut. */
    const arr = Array.isArray(data) ? data : data?.tokens ?? [];
    const sol = arr.filter((t) => (t.id ?? t.address) === SOL_MINT);
    save(file, [...sol, ...arr.filter((t) => (t.id ?? t.address) !== SOL_MINT).slice(0, 119)]);
  });
}

await step("solana rpc", async () => {
  const out = {};
  for (const { method, params, expectRefusal } of RPC_CALLS) {
    out[method] = await rpc(method, params);
    // a refusal IS the fixture for the gated method — never "fix" it
    if (expectRefusal) {
      const gated = out[method]?.__error;
      console.log(`  · ${method}: ${gated ? "refused — " + gated.message : "allowed (unusual for a free endpoint)"}`);
    }
  }
  save("solana-rpc.json", out);
});

save("recorded-at.json", { at: new Date().toISOString(), note: "regenerate with: npm run record" });

console.log(failures ? `\n⚠️  done with ${failures} failure(s) — those fixtures are stale or missing`
                     : "\n✅ fixtures recorded");
process.exit(failures ? 1 : 0);
