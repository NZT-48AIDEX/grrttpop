#!/usr/bin/env node
/* ================================================================
   drift — has an api changed shape under us?

   The whole suite replays recorded responses, which is what makes it
   fast and offline. It also means a provider can rename a field and
   nothing goes red: CI replays the old shape back to itself and stays
   green while the live site quietly breaks.

   `smoke --live` catches the loud half — a response that breaks the
   page. This catches the quiet half, and says *which field*: it
   re-fetches each fixture's live counterpart, compares the key paths
   rather than the values, and reports what moved.

   The judgement it makes: a field the code actually reads going
   missing is worth failing over. A field nobody touches is worth a
   line of output and nothing more.

   usage: npm run drift
   ================================================================ */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shapeOf, compareShapes, referencedBy } from "../lib/shape.mjs";
import { HTTP_FIXTURES, RPC_CALLS, RPC } from "./endpoints.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures");
const json = (name) => JSON.parse(readFileSync(join(FIX, name), "utf8"));

/* every file that reads an api response — used to decide whether a
   change is a problem or a curiosity */
const sources = Object.fromEntries(
  ["lib", "."].flatMap((dir) => {
    const d = join(ROOT, dir);
    return readdirSync(d)
      .filter((f) => f.endsWith(".js") && !f.startsWith("."))
      .map((f) => [dir === "." ? f : `${dir}/${f}`, readFileSync(join(d, f), "utf8")]);
  }));

const findings = [];
const note = (fixture, level, message, detail) => findings.push({ fixture, level, message, detail });

/* A drift checker that can only be exercised against a live, rate-limited
   api is a drift checker nobody exercises. DRIFT_LIVE_DIR points at a
   directory of json standing in for "what the api returns now", so the whole
   pipeline — compare, classify, decide whether to fail — runs offline and
   deterministically. Used by the tests; unset in normal operation. */
const LIVE_DIR = process.env.DRIFT_LIVE_DIR;
const stubbed = (file) => LIVE_DIR && existsSync(join(LIVE_DIR, file));
const stub = (file) => JSON.parse(readFileSync(join(LIVE_DIR, file), "utf8"));

const fetchJson = async (url, timeout = 20_000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (r.status === 429) { const e = new Error("rate limited (429)"); e.rateLimited = true; throw e; }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
};

/** one fixture, compared live */
function report(fixture, recorded, live, { trimmed = false, prefix = "" } = {}) {
  const diff = compareShapes(shapeOf(recorded), shapeOf(live));

  if (diff.same && !diff.added.length) {
    note(fixture, "ok", `${prefix}shape matches`);
    return;
  }

  // a trimmed recording has fewer rows than live, never fewer *fields*
  const used = referencedBy(diff.removed, sources);
  const usedChanged = referencedBy(diff.changed.map((c) => c.path), sources);

  for (const path of diff.removed) {
    const where = used.get(path);
    note(fixture, where ? "fail" : "warn",
      `${prefix}gone: ${path}` + (where ? `  — read by ${where.join(", ")}` : "  (nothing reads it)"));
  }
  for (const c of diff.changed) {
    const where = usedChanged.get(c.path);
    note(fixture, where ? "fail" : "warn",
      `${prefix}${c.path}: ${c.from} → ${c.to}` + (where ? `  — read by ${where.join(", ")}` : "  (nothing reads it)"));
  }
  if (diff.added.length) {
    note(fixture, "info", `${prefix}${diff.added.length} new field(s)`, diff.added.slice(0, 6).join(", "));
  }
  if (diff.same) note(fixture, "ok", `${prefix}no fields lost` + (trimmed ? " (recording is row-trimmed)" : ""));
}

console.log("comparing recorded fixtures against the live apis\n");

let inconclusive = 0;

for (const { file, label, url, timeout, trimmed } of HTTP_FIXTURES) {
  if (!existsSync(join(FIX, file))) { note(file, "warn", "no recording to compare against"); continue; }
  try {
    const live = stubbed(file) ? stub(file) : await fetchJson(url, timeout);
    report(file, json(file), live, { trimmed });
  } catch (err) {
    // being rationed is not the same as being wrong
    note(file, err.rateLimited ? "skip" : "warn",
      err.rateLimited ? "rate limited — inconclusive, try later" : `could not fetch: ${err.message}`);
    inconclusive++;
  }
  process.stdout.write(`  ${label}\n`);
  if (!LIVE_DIR) await new Promise((r) => setTimeout(r, 1200));   // stay under the free tier
}

/* rpc is one url with the method in the body, so it is compared per method */
if (existsSync(join(FIX, "solana-rpc.json"))) {
  const recorded = json("solana-rpc.json");
  for (const { method, params, expectRefusal } of RPC_CALLS) {
    const was = recorded[method];
    try {
      if (stubbed("solana-rpc.json")) {
        const liveAll = stub("solana-rpc.json");
        const now = liveAll[method];
        const refused = !!now?.__error;
        if (expectRefusal) {
          note("solana-rpc.json", refused ? "ok" : "warn",
            refused ? `${method}: still refused (as recorded)`
              : `${method}: no longer refused — the recorded refusal may be stale`);
        } else if (refused) {
          note("solana-rpc.json", "warn", `${method}: now refused — ${now.__error.message}`);
        } else {
          report("solana-rpc.json", was, now, { prefix: `${method}: ` });
        }
        continue;
      }
      const r = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = await r.json().catch(() => null);
      const nowRefused = !!j?.error;

      if (expectRefusal) {
        /* the recorded refusal is load-bearing: it is what keeps the
           gated-wallet path exercisable offline. if the endpoint STOPS
           refusing, the fixture is now testing a world that no longer
           exists — which is drift, just in the pleasant direction. */
        note("solana-rpc.json", nowRefused ? "ok" : "warn",
          nowRefused ? `${method}: still refused (as recorded)`
            : `${method}: no longer refused — the recorded refusal may be stale`);
        continue;
      }
      if (nowRefused) { note("solana-rpc.json", "warn", `${method}: now refused — ${j.error.message}`); continue; }
      report("solana-rpc.json", was, j.result, { prefix: `${method}: ` });
    } catch (err) {
      note("solana-rpc.json", "warn", `${method}: could not reach — ${err.message}`);
      inconclusive++;
    }
    if (!LIVE_DIR) await new Promise((r) => setTimeout(r, 400));
  }
  process.stdout.write("  solana rpc\n");
}

/* ---------------- report ---------------- */
const ICON = { ok: "✅", info: "  ·", warn: "⚠️ ", fail: "❌", skip: "⏭ " };
const byFixture = new Map();
for (const f of findings) {
  if (!byFixture.has(f.fixture)) byFixture.set(f.fixture, []);
  byFixture.get(f.fixture).push(f);
}

console.log();
for (const [fixture, list] of byFixture) {
  const worst = list.some((f) => f.level === "fail") ? "fail"
    : list.some((f) => f.level === "warn") ? "warn"
    // inconclusive is not the same as fine, and must not wear a green tick
    : list.some((f) => f.level === "skip") ? "skip" : "ok";
  console.log(`${ICON[worst]} ${fixture}`);
  for (const f of list) {
    if (f.level === "ok" && worst === "ok") continue;   // don't repeat the headline
    console.log(`     ${ICON[f.level]} ${f.message}${f.detail ? `\n         ${f.detail}` : ""}`);
  }
}

const failed = findings.filter((f) => f.level === "fail");
const warned = findings.filter((f) => f.level === "warn");

console.log();
if (failed.length) {
  console.log(`❌ ${failed.length} field(s) the code reads have changed shape.`);
  console.log("   Before re-recording: read CLAUDE.md — `npm run record` moves the pixels");
  console.log("   and triggers a two-platform baseline re-bless. It is never one commit.");
} else if (warned.length) {
  console.log(`⚠️  ${warned.length} change(s), none in fields the code reads. Worth a look, not a fire.`);
} else {
  console.log("✅ every recorded shape still matches the live api.");
}
if (inconclusive) console.log(`   (${inconclusive} endpoint(s) inconclusive — rate limits or unreachable)`);

process.exit(failed.length ? 1 : 0);
