/* ================================================================
   quality — when to stop asking so much of the device.

   Deliberately knows nothing about three.js or the DOM: it watches
   frame times and says "go down a tier", and the page decides what a
   tier means. That keeps the policy testable without a browser, which
   is the same reason market.js and solana.js look the way they do.

   It only ever steps *down*. Stepping back up when frames recover
   sounds nicer and oscillates in practice: raising detail makes frames
   slow again, which lowers it, forever. A visitor on a weak device
   would watch the page pulse between two qualities.
   ================================================================ */

export const SLOW_FRAME = 0.045;   // ~22fps — below this the motion reads as stutter

export function makeQualityGovernor({
  tiers = 3,
  start = tiers - 1,
  window: windowSize = 60,       // frames per verdict
  slowShare = 1 / 3,             // how much of a window must be slow to act
  onChange = () => {},
} = {}) {
  let tier = start;
  let seen = 0;
  let slow = 0;
  let drops = 0;

  return {
    /** feed the raw (unclamped) frame delta in seconds */
    frame(rawDt) {
      if (rawDt > SLOW_FRAME) slow++;
      if (++seen < windowSize) return tier;
      const struggled = slow > windowSize * slowShare;
      seen = 0;
      slow = 0;
      if (struggled && tier > 0) {
        tier--;
        drops++;
        onChange(tier);
      }
      return tier;
    },
    get tier() { return tier; },
    /** how many times we've given up detail — useful in state() */
    get drops() { return drops; },
  };
}
