/* ================================================================
   trend — the shape of a move, not just where it ended.

   Coingecko hands back 168 hourly prices per coin in
   `sparkline_in_7d`, and this site was reading exactly one of them.
   "+8.2%" is true and nearly useless on its own: a coin that has
   climbed all week and a coin that doubled on tuesday and has been
   bleeding out since both report +8.2%, and an agent told only the
   number will confidently say the wrong thing about the second one.

   So: the same series, reduced two ways. A sparkline for anything
   that reads text, and a short label for the cases where the last
   number disagrees with the week behind it.

   Pure and browser-safe like the rest of lib/: numbers in, numbers
   and strings out. No DOM, no fetching, no three.js.
   ================================================================ */

const BLOCKS = "▁▂▃▄▅▆▇█";

/** the week is flat below this much total range, in percent */
const FLAT_RANGE = 2;
/** and a net move under this is chop, not a direction */
const NET_MOVE = 2;
/** the last day has to move at least this much to count as disagreeing */
const DAY_MOVE = 0.5;

const clean = (xs) => (Array.isArray(xs) ? xs.filter((v) => Number.isFinite(v)) : []);
const pct = (from, to) => (from > 0 ? ((to - from) / from) * 100 : 0);
const r2 = (v) => Math.round(v * 100) / 100;

/** the hourly series a coin arrived with, or null if it didn't bring one */
export function priceSeries(coin) {
  const xs = clean(coin?.sparkline_in_7d?.price);
  return xs.length >= 8 ? xs : null;
}

/* bucket means rather than every nth point: sampling would drop a
   spike that fell between two samples, and a spike is the whole
   reason to look at the shape. */
function downsample(xs, width) {
  if (xs.length <= width) return xs;
  const out = [];
  for (let i = 0; i < width; i++) {
    const a = Math.floor((i * xs.length) / width);
    const b = Math.max(a + 1, Math.floor(((i + 1) * xs.length) / width));
    let sum = 0;
    for (let k = a; k < b; k++) sum += xs[k];
    out.push(sum / (b - a));
  }
  return out;
}

/** a series as one line of unicode blocks, scaled to its own min/max */
export function sparkline(xs, width = 12) {
  const s = downsample(clean(xs), width);
  if (s.length < 2) return "";
  const lo = Math.min(...s), hi = Math.max(...s);
  // a genuinely flat week is a flat line, not a crash or a full bar
  if (!(hi > lo)) return BLOCKS[3].repeat(s.length);
  return s.map((v) => BLOCKS[Math.min(7, Math.floor(((v - lo) / (hi - lo)) * 8))]).join("");
}

/**
 * Classify a series. Everything here is derived from four numbers —
 * net move, last-day move, total range, and where the last price sits
 * inside that range — and they all come back with the label, because a
 * caller that disagrees with the thresholds should be able to see past
 * them rather than reimplement this.
 */
export function shapeOf(xs) {
  const s = clean(xs);
  if (s.length < 8) return null;

  const first = s[0], last = s[s.length - 1];
  const lo = Math.min(...s), hi = Math.max(...s);
  const net = pct(first, last);
  // the last seventh of a 7-day series is the last day
  const dayFrom = s[Math.max(0, s.length - Math.max(2, Math.round(s.length / 7)))];
  const day = pct(dayFrom, last);
  const range = lo > 0 ? ((hi - lo) / lo) * 100 : 0;
  const posInRange = hi > lo ? (last - lo) / (hi - lo) : 0.5;

  /* the case worth naming: the week and the last day point opposite
     ways, so the headline percentage is describing something that has
     already stopped happening. */
  const divergent = (net > NET_MOVE && day < -DAY_MOVE) || (net < -NET_MOVE && day > DAY_MOVE);

  let shape, direction;
  if (range < FLAT_RANGE) {
    shape = "flat all week"; direction = "flat";
  } else if (net > NET_MOVE) {
    direction = "up";
    shape = day >= -DAY_MOVE
      ? (posInRange > 0.9 ? "climbing, at its weekly high" : "climbing")
      : (posInRange < 0.5 ? "spiked and gave most of it back" : "up on the week, sliding back");
  } else if (net < -NET_MOVE) {
    direction = "down";
    shape = day <= DAY_MOVE
      ? (posInRange < 0.1 ? "falling, at its weekly low" : "falling")
      : (posInRange > 0.5 ? "dumped and bought back" : "down on the week, bouncing");
  } else {
    shape = "chopping sideways"; direction = "flat";
  }

  return {
    shape, direction, divergent,
    weekPct: r2(net),
    dayPct: r2(day),
    rangePct: r2(range),
    posInRange: r2(posInRange),
    high: hi, low: lo,
    points: s.length,
  };
}

/**
 * The same judgement as one line of prose, for anywhere a sparkline is
 * already drawn but nothing says what it means — a card, a tooltip, the
 * accessible name for a canvas that a screen reader otherwise reads as
 * nothing at all.
 */
export function trendSentence(t) {
  if (!t) return "";
  const p = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  return t.divergent
    ? `7d: ${t.shape} — ${p(t.weekPct)} on the week, ${p(t.dayPct)} today`
    : `7d: ${t.shape} — ${p(t.weekPct)}`;
}

/** a coin's week: the sparkline and the shape, or null if it brought no series */
export function trendOf(coin, { width = 12 } = {}) {
  const xs = priceSeries(coin);
  if (!xs) return null;
  const shape = shapeOf(xs);
  return shape && { spark: sparkline(xs, width), ...shape };
}

/**
 * Every coin's week as one equal-weighted series — each normalised to
 * its own starting price first, so a $60k coin and a $0.00002 coin get
 * one vote each. Aligned on the tail, so the window shrinks to the
 * shortest week anyone brought — a coin listed on thursday would
 * otherwise have to be either dropped or invented. `points` says how
 * many hours actually went in.
 */
export function indexSeries(coins = []) {
  const all = coins.map(priceSeries).filter(Boolean);
  if (!all.length) return null;
  const len = Math.min(...all.map((s) => s.length));
  if (len < 8) return null;

  const out = new Array(len).fill(0);
  let counted = 0;
  for (const s of all) {
    const tail = s.slice(s.length - len);
    const base = tail[0];
    if (!(base > 0)) continue;
    for (let i = 0; i < len; i++) out[i] += tail[i] / base;
    counted++;
  }
  return counted ? { series: out.map((v) => v / counted), counted } : null;
}

/**
 * The market as one creature: the index's shape, plus how many coins
 * are doing each thing. Breadth is the part a single index number
 * hides — "+1%" reads very differently when it is forty coins up and
 * ten down versus one coin up and forty-nine flat.
 */
export function weekShape(coins = [], { width = 16 } = {}) {
  const idx = indexSeries(coins);
  if (!idx) return null;
  const shape = shapeOf(idx.series);
  if (!shape) return null;

  const breadth = { up: 0, down: 0, flat: 0, divergent: 0 };
  const shapes = {};
  for (const c of coins) {
    const t = trendOf(c, { width: 8 });
    if (!t) continue;
    breadth[t.direction]++;
    if (t.divergent) breadth.divergent++;
    shapes[t.shape] = (shapes[t.shape] ?? 0) + 1;
  }

  return { spark: sparkline(idx.series, width), ...shape, coinsCounted: idx.counted, breadth, shapes };
}
