/* calibration is the part that tells you a judgement is useless while
   every other test agrees it is correct. Its own failure mode is crying
   wolf, so most of these are about when it should stay quiet. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, TOO_COARSE, DEAD_LABEL_SAMPLES } from "../lib/calibrate.js";
import { SHAPES, shapeOf } from "../lib/trend.js";

const week = (f) => Array.from({ length: 168 }, (_, i) => f(i / 167));
const sample = (shapes, over = {}) => ({
  shapes,
  coinsCounted: Object.values(shapes).reduce((a, b) => a + b, 0),
  breadth: { up: 0, down: 0, flat: 0, divergent: 0, ...over },
});

test("every label shapeOf can produce is in SHAPES", () => {
  /* the vocabulary and the code that speaks it drift apart silently:
     calibration would just report an unknown label forever. */
  const series = [
    week((t) => 100 * (1 + 0.2 * t)),                     // climbing
    week((t) => 100 * (1 - 0.2 * t)),                     // falling
    week(() => 100),                                      // flat
    week((t) => 100 * (1 + 0.05 * Math.sin(t * Math.PI * 10))),
    week((t) => 100 * (1 + (t < 0.4 ? 0.62 * t : 0.25 - 0.28 * (t - 0.4)))),
    week((t) => 100 * (t < 0.85 ? 1 - 0.3 * t : 0.745 + 0.25 * (t - 0.85))),
    week((t) => 100 * (1 + 0.3 * t - (t > 0.9 ? 0.05 : 0))),
  ];
  for (const s of series) {
    const shape = shapeOf(s)?.shape;
    assert.ok(SHAPES.includes(shape), `"${shape}" is not in SHAPES`);
  }
});

test("nothing to say about no samples", () => {
  const c = calibrate([]);
  assert.equal(c.samples, 0);
  assert.deepEqual(c.flags, []);
  assert.match(c.note, /nothing to say/);
});

test("a label on most of the market is flagged as saying nothing", () => {
  const c = calibrate([sample({ "chopping sideways": 45, climbing: 5 })]);
  const flag = c.flags.find((f) => f.kind === "too-coarse");
  assert.ok(flag, "45 of 50 should be flagged");
  assert.equal(flag.label, "chopping sideways");
  assert.ok(flag.share > TOO_COARSE);
});

test("a label that did not fire today is not called dead", () => {
  /* the wolf-crying case: on a green day nothing falls, and flagging
     that every time is how a checker gets ignored. */
  const c = calibrate([sample({ climbing: 50 })]);
  assert.equal(c.flags.filter((f) => f.kind === "never-fires").length, 0);
  assert.ok(c.silentLabels.includes("falling"), "still reported, just not as a complaint");
  assert.equal(c.enoughForDeadLabels, false);
  assert.match(c.note, /not dead, just unmet/);
});

test("with a corpus behind it, a silent label is a real finding", () => {
  const many = Array.from({ length: DEAD_LABEL_SAMPLES }, () => sample({ climbing: 50 }));
  const c = calibrate(many);
  assert.equal(c.enoughForDeadLabels, true);
  const dead = c.flags.filter((f) => f.kind === "never-fires").map((f) => f.label);
  assert.ok(dead.includes("falling"), "twenty samples with nothing falling is worth saying");
  assert.ok(dead.length >= 8, "most of the vocabulary went unused");
});

test("a label the vocabulary has never heard of is reported", () => {
  const c = calibrate([sample({ "moonwards, probably": 50 })]);
  assert.ok(c.flags.some((f) => f.kind === "unknown-label"));
});

test("divergent is only called dead with enough samples, and noisy whenever", () => {
  const quiet = calibrate([sample({ climbing: 50 }, { divergent: 0 })]);
  assert.equal(quiet.flags.filter((f) => f.kind === "divergent-never").length, 0);

  const many = Array.from({ length: DEAD_LABEL_SAMPLES }, () => sample({ climbing: 50 }, { divergent: 0 }));
  assert.ok(calibrate(many).flags.some((f) => f.kind === "divergent-never"));

  const noisy = calibrate([sample({ climbing: 50 }, { divergent: 40 })]);
  assert.ok(noisy.flags.some((f) => f.kind === "divergent-common"),
    "if most coins are flagged, the flag is noise");
});

test("counts add up across samples", () => {
  const c = calibrate([sample({ climbing: 10 }), sample({ climbing: 5, falling: 5 })]);
  assert.equal(c.samples, 2);
  assert.equal(c.coins, 20);
  assert.equal(c.labels.find((l) => l.label === "climbing").count, 15);
  assert.equal(c.labels.find((l) => l.label === "climbing").share, 0.75);
});

test("junk samples are skipped, not counted as zero", () => {
  const c = calibrate([null, {}, { shapes: {}, coinsCounted: 0 }, sample({ climbing: 4 })]);
  assert.equal(c.samples, 1);
  assert.equal(c.coins, 4);
});
