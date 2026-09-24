#!/usr/bin/env node
/* ================================================================
   calibrate — are the judgements saying anything, across real days?

   ROADMAP stage 3. `lib/trend.js` draws its lines at 2% range, 2% net,
   0.5% day, tuned against sine waves and one frozen afternoon. Nothing
   in the suite can complain about those numbers, because every test
   agrees with them by construction.

   So replay the corpus and count. A label on 60% of coins is not
   distinguishing them from each other; a label that never fires across
   enough different markets is a word nobody will ever meet. Neither is
   a bug — nothing throws — which is exactly why it needs measuring.

   usage:
     npm run calibrate                  # the whole corpus branch
     npm run calibrate -- --fetch=10    # just the newest 10
     npm run calibrate -- --corpus=DIR  # a local corpus directory
     npm run calibrate -- --live        # the published feed only (one moment)
     npm run calibrate -- --json

   Reports; never blocks. A threshold being wrong is a thing to go and
   think about, not a build to fail.
   ================================================================ */

import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { calibrate, DEAD_LABEL_SAMPLES } from "../lib/calibrate.js";
import { localCorpus, fetchCorpus, replay } from "./recordings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FEED = "https://raw.githubusercontent.com/NZT-48AIDEX/grrttpop/data/";

/* ---------------- gather the weeks ---------------- */
async function fromCorpus() {
  const recs = opt("corpus")
    ? localCorpus(resolve(ROOT, opt("corpus")))
    : await fetchCorpus(opt("fetch") ? Number(opt("fetch")) : Infinity);

  const samples = [];
  for (const rec of recs) {
    /* skip the wallet: it costs a live rpc call per entry and tells
       calibration nothing about shape */
    const ctx = await replay(rec, { wallet: "skip" });
    /* both rows carry the same `at`, because they are one observation
       of one market — the moment count is what the threshold reads */
    if (ctx.reef?.week) samples.push({ ...ctx.reef.week, at: rec.at, what: "reef" });
    if (ctx.trench?.ecosystem?.week) samples.push({ ...ctx.trench.ecosystem.week, at: rec.at, what: "spl" });
  }
  return { samples, recordings: recs.length };
}

async function fromFeed() {
  const get = async (n) => (await fetch(FEED + n)).json();
  const [reef, trench] = await Promise.all([get("reef.json"), get("trench.json")]);
  const at = reef.data?.asOf;
  return {
    samples: [
      ...(reef.week ? [{ ...reef.week, at, what: "reef" }] : []),
      ...(trench.ecosystem?.week ? [{ ...trench.ecosystem.week, at, what: "spl" }] : []),
    ],
    recordings: 1,
  };
}

const { samples, recordings } = flag("live") ? await fromFeed() : await fromCorpus();
const c = calibrate(samples);

if (flag("json")) {
  console.log(JSON.stringify({ recordings, ...c }, null, 2));
  process.exit(0);
}

console.log(`calibration over ${recordings} recording(s) — ${c.samples} samples, ` +
  `${c.moments} distinct moment(s), ${c.coins} coin-observations` +
  (c.span ? `, spanning ${c.span.hours}h` : ""));
console.log(`\n${c.note}\n`);

const width = Math.max(...c.labels.map((l) => l.label.length));
for (const l of c.labels) {
  const bar = "█".repeat(Math.round(l.share * 40)) || "";
  console.log(`  ${l.label.padEnd(width)}  ${String(l.count).padStart(5)}  ` +
    `${(l.share * 100).toFixed(1).padStart(5)}%  ${bar}`);
}

console.log(`\n  divergent: ${(c.breadth.divergentShare * 100).toFixed(1)}% of coin-observations` +
  `  (up ${c.breadth.up} · down ${c.breadth.down} · flat ${c.breadth.flat})`);

if (c.flags.length) {
  console.log(`\nflags:`);
  for (const f of c.flags) console.log(`  ${f.kind}  \`${f.label}\`\n    ${f.why}`);
} else {
  console.log(`\nno flags: every label in use, none of them swallowing the market.`);
}

if (!c.enoughForDeadLabels) {
  console.log(`\nSilent labels are not being flagged yet — that needs ${DEAD_LABEL_SAMPLES} moments, ` +
    `and this is ${c.moments}.`);
  if (c.silentLabels.length) console.log(`Unmet so far: ${c.silentLabels.join(", ")}`);
}
