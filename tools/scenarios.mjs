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

import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkAll } from "../lib/invariants.js";
import {
  FIXTURES_RECORDING, committedScenarios, localCorpus, fetchCorpus, replay,
} from "./recordings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const VERBOSE = flag("verbose");

/* ---------------- go ---------------- */
const scenarios = [
  FIXTURES_RECORDING,
  ...committedScenarios(),
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
