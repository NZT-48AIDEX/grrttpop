/* the stamp that says whether the numbers are real. the failure this
   guards against is silent by construction: synthetic data that looks
   exactly like live data, which is only a bug the moment someone acts
   on it. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { provenanceOf, provenanceLine } from "../lib/provenance.js";
import { describeReef, demoData } from "../lib/market.js";
import { describeTrench } from "../lib/solana.js";
import { reefToText, trenchToText } from "../lib/describe.js";

test("saying nothing is answered with 'unknown', never with silence", () => {
  const p = provenanceOf();
  assert.equal(p.source, "unknown");
  assert.equal(p.synthetic, false, "unknown is not a claim that it's fake either");
  assert.match(p.note, /did not say where/);
  assert.equal(p.asOf, null);
  assert.equal(p.ageMs, null);
});

test("the demo reef is marked synthetic, loudly", () => {
  const p = provenanceOf({ source: "demo", at: 1_700_000_000_000 });
  assert.equal(p.synthetic, true);
  assert.match(p.note, /^SYNTHETIC/);
  assert.match(p.note, /do not quote them as market data/);
});

test("a fixture of coingecko is not coingecko", () => {
  const p = provenanceOf({ source: "coingecko", harness: { on: true, fixtures: true, seed: 42 } });
  assert.equal(p.source, "fixtures", "replay wins over the name of whoever was recorded");
  assert.equal(p.synthetic, true);
  assert.match(p.note, /^REPLAY/);
  assert.deepEqual(p.harness, { on: true, fixtures: true, seed: 42 });
});

test("demo under fixtures stays demo — the worse of the two labels", () => {
  const p = provenanceOf({ source: "demo", harness: { on: true, fixtures: true } });
  assert.equal(p.source, "demo");
  assert.equal(p.synthetic, true);
});

test("a real read is real, and carries its age", () => {
  const at = 1_700_000_000_000;
  const p = provenanceOf({ source: "coingecko", at, now: at + 45_000 });
  assert.equal(p.synthetic, false);
  assert.equal(p.note, null, "nothing to warn about");
  assert.equal(p.ageMs, 45_000);
  assert.equal(p.asOf, new Date(at).toISOString());
  assert.equal(p.harness, null, "harness is absent when it isn't on");
});

test("an idle harness is not reported as one", () => {
  assert.equal(provenanceOf({ source: "coingecko", harness: { on: false, fixtures: false } }).harness, null);
});

test("the demo reef cannot reach a caller unlabelled", () => {
  const d = describeReef(demoData({ now: 1_700_000_000_000 }), {
    data: { source: "demo", at: 1_700_000_000_000 },
  });
  assert.equal(d.data.synthetic, true);
  assert.equal(d.coins, 40, "and it really is a full reef of invented coins");

  // the same fact has to survive the translation into words
  const text = reefToText(d);
  assert.match(text, /SYNTHETIC/);
  assert.match(text, /source: demo/);
});

test("describeReef and describeTrench both stamp, even when asked nothing", () => {
  assert.equal(describeReef([], {}).data.source, "unknown");
  assert.equal(describeTrench({}).data.source, "unknown");
  assert.match(trenchToText(describeTrench({})), /source: unknown/);
});

test("the trench carries its stamp into words", () => {
  const d = describeTrench({
    vitals: { tps: 3000, epoch: 1, epochPct: 50 },
    data: { source: "solana-rpc.publicnode.com + coingecko", at: 1_700_000_000_000 },
  });
  assert.equal(d.data.synthetic, false);
  assert.match(trenchToText(d), /source: solana-rpc\.publicnode\.com \+ coingecko/);
});

test("provenanceLine stays readable with nothing to say", () => {
  assert.equal(provenanceLine(null), "source: unstated");
  assert.equal(provenanceLine(provenanceOf()), "source: unknown");
  assert.match(provenanceLine(provenanceOf({ source: "coingecko", at: Date.now() - 5000 })), /5s ago/);
  assert.match(provenanceLine(provenanceOf({ source: "coingecko", at: Date.now() - 600_000 })), /10m ago/);
});
