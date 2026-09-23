/* ================================================================
   calibrate — is a judgement actually saying anything?

   `lib/trend.js` draws its lines at 2% range, 2% net, 0.5% day.
   Those numbers were tuned against sine waves and one frozen
   afternoon, and no test will ever complain about them, because every
   test agrees with them by construction.

   The question a test cannot ask: across real markets, does
   "chopping sideways" describe 3% of coins or 60%? A label that fires
   on everything carries no information, and one that never fires is
   dead weight in a vocabulary someone has to read. Neither is a bug —
   nothing throws — which is exactly why it needs measuring.

   Pure: samples in, distribution and complaints out. A sample is the
   `week` block of a `describeReef()`/ecosystem output, which already
   counts every coin rather than the handful in the movers list.
   ================================================================ */

import { SHAPES } from "./trend.js";

/** a label on more than this share of coins is not distinguishing anything */
export const TOO_COARSE = 0.6;
/** below this it is a vocabulary word nobody will ever meet */
export const TOO_RARE = 0.01;
/**
 * "never fires" is only evidence with enough independent samples.
 * On a green day `falling, at its weekly low` does not fire because
 * nothing is falling — flagging that would cry wolf every rising
 * market until nobody reads the flags, which is how drift checkers
 * die. Below this many samples it is reported as information, not
 * as a complaint.
 */
export const DEAD_LABEL_SAMPLES = 20;

const pctOf = (n, total) => (total > 0 ? n / total : 0);

/**
 * @param samples  array of `week` blocks: { shapes, breadth, coinsCounted }
 */
export function calibrate(samples = [], { deadLabelSamples = DEAD_LABEL_SAMPLES } = {}) {
  const usable = samples.filter((s) => s && s.shapes && s.coinsCounted > 0);
  if (!usable.length) {
    return { samples: 0, coins: 0, labels: [], breadth: null, flags: [],
             note: "no samples — nothing to say about the thresholds" };
  }

  const counts = new Map(SHAPES.map((l) => [l, 0]));
  let coins = 0;
  const breadth = { up: 0, down: 0, flat: 0, divergent: 0 };

  for (const s of usable) {
    coins += s.coinsCounted;
    for (const [label, n] of Object.entries(s.shapes)) {
      // a label the vocabulary does not know is a change nobody told calibration about
      counts.set(label, (counts.get(label) ?? 0) + n);
    }
    for (const k of Object.keys(breadth)) breadth[k] += s.breadth?.[k] ?? 0;
  }

  const labels = [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: pctOf(count, coins) }))
    .sort((a, b) => b.count - a.count);

  const flags = [];
  for (const l of labels) {
    if (l.share > TOO_COARSE) {
      flags.push({ kind: "too-coarse", label: l.label, share: l.share,
        why: `on ${(l.share * 100).toFixed(0)}% of coins — it is not distinguishing them from each other` });
    } else if (l.count === 0 && usable.length >= deadLabelSamples) {
      flags.push({ kind: "never-fires", label: l.label, share: 0,
        why: `never fired across ${usable.length} samples — either the threshold is unreachable or the case does not occur` });
    } else if (l.count && l.share < TOO_RARE) {
      flags.push({ kind: "very-rare", label: l.label, share: l.share,
        why: `${(l.share * 100).toFixed(2)}% of coins — real, but almost nobody will meet it` });
    }
    if (!SHAPES.includes(l.label)) {
      flags.push({ kind: "unknown-label", label: l.label, share: l.share,
        why: "not in trend.js's SHAPES — the vocabulary changed and calibration was not told" });
    }
  }

  const divShare = pctOf(breadth.divergent, coins);
  if (coins > 0 && breadth.divergent === 0 && usable.length >= deadLabelSamples) {
    flags.push({ kind: "divergent-never", label: "divergent", share: 0,
      why: "no coin disagreed with its own week — the flag the module exists for never fired" });
  } else if (divShare > 0.5) {
    flags.push({ kind: "divergent-common", label: "divergent", share: divShare,
      why: `${(divShare * 100).toFixed(0)}% divergent — if most coins are flagged, the flag is noise` });
  }

  return {
    samples: usable.length,
    coins,
    labels,
    breadth: { ...breadth, divergentShare: divShare },
    flags,
    /* one sample is a moment, not a distribution. the caller needs to
       know which it is looking at before it tunes anything. */
    /* samples taken at the same instant are one observation of one
       market wearing two hats, not two independent draws. until the
       corpus exists, every run of this is that. */
    silentLabels: labels.filter((l) => !l.count).map((l) => l.label),
    enoughForDeadLabels: usable.length >= deadLabelSamples,
    note: usable.length < deadLabelSamples
      ? `${usable.length} sample(s) — a moment, not a distribution. labels that did not fire ` +
        `here are not dead, just unmet: nothing falls on a rising day. ` +
        `needs ${deadLabelSamples}+ spread over real days before retuning anything.`
      : `${usable.length} samples`,
  };
}
