#!/usr/bin/env node
/* ================================================================
   corpus — list what has been kept, and let the rest go.

   The archive lives on its own orphan branch, force-pushed as one
   commit, so the repo holds the retained set rather than the sum of
   every snapshot ever taken. That makes pruning a real operation
   rather than a bookkeeping entry: what is not kept is gone.

   usage:
     node tools/corpus.mjs --list [--dir=corpus]
     node tools/corpus.mjs --prune [--dir=corpus] [--dry]
   ================================================================ */

import { readdirSync, readFileSync, writeFileSync, statSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { retain, entryDate, corpusManifest, SIZE_CAP_MB } from "../lib/corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;

const DIR = resolve(ROOT, opt("dir", "corpus"));
const DRY = flag("dry");
const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;

if (!existsSync(DIR)) {
  console.log(`no corpus at ${DIR} — nothing has been archived yet.`);
  process.exit(0);
}

/* reading the meta means gunzipping the bundle; at sixty entries that
   costs about a second, which is cheaper than maintaining a sidecar
   that could disagree with the files it describes. */
function read(dir) {
  const names = readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort();
  return names.map((name) => {
    const path = join(dir, name);
    const bytes = statSync(path).size;
    let meta = {};
    try {
      const b = JSON.parse(gunzipSync(readFileSync(path)));
      meta = { at: b.at, event: b.event, payloads: Object.keys(b.files ?? {}).length, source: b.source };
    } catch (e) {
      meta = { broken: e.message };
    }
    return { name, bytes, ...meta };
  });
}

const incidentDir = join(DIR, "incidents");
const incidents = existsSync(incidentDir)
  ? readdirSync(incidentDir).filter((f) => f.endsWith(".json")).sort()
  : [];

const entries = read(DIR);
const sizes = Object.fromEntries(entries.map((e) => [e.name, e.bytes]));
const plan = retain(entries.map((e) => e.name), { sizes });
const total = entries.reduce((n, e) => n + e.bytes, 0);

if (flag("prune")) {
  for (const name of plan.drop) {
    if (!DRY) rmSync(join(DIR, name));
    console.log(`  ${DRY ? "would drop" : "dropped"}  ${name}  — ${plan.why.get(name)}`);
  }
  const kept = entries.filter((e) => plan.keep.includes(e.name));
  const manifest = {
    ...corpusManifest({
      entries: plan.keep,
      incidents,
      bytes: kept.reduce((n, e) => n + e.bytes, 0),
    }),
    /* per entry, so a reader can pick one without fetching all of them —
       and so the sampling bias is visible: `event` says which of these
       exist because someone pushed rather than because time passed. */
    index: kept.map((e) => ({ name: e.name, at: e.at, event: e.event, bytes: e.bytes })),
  };
  if (!DRY) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, "index.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(`\n${DRY ? "would keep" : "kept"} ${plan.keep.length} of ${entries.length} entries · ` +
              `${mb(plan.bytes)} of a ${SIZE_CAP_MB}MB ceiling${plan.overCap ? " (ceiling engaged)" : ""}`);
  if (incidents.length) console.log(`incidents kept: ${incidents.length} (never pruned — they are the rare part)`);
  process.exit(0);
}

/* default: say what is here */
console.log(`corpus at ${DIR}`);
console.log(`${entries.length} entries · ${mb(total)} · ${incidents.length} incident(s)\n`);
for (const e of entries) {
  const mark = plan.keep.includes(e.name) ? " " : "✂";
  console.log(` ${mark} ${e.name}  ${kb(e.bytes).padStart(7)}  ${String(e.event ?? "?").padEnd(16)} ${plan.why.get(e.name) ?? ""}` +
              (e.broken ? `  ⚠️ unreadable: ${e.broken}` : ""));
}
if (plan.unnamed.length) console.log(`\n${plan.unnamed.length} file(s) not named like an entry, left alone`);
if (plan.drop.length) console.log(`\n${plan.drop.length} would be dropped by --prune`);
if (incidents.length) {
  console.log(`\nincidents:`);
  for (const i of incidents.slice(-5)) {
    const r = JSON.parse(readFileSync(join(incidentDir, i), "utf8"));
    console.log(`   ${r.at}  ${r.stage}  ${String(r.message).slice(0, 70)}`);
  }
}
