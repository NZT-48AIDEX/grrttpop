/* ================================================================
   invariants — what must be true of any day, not what was true of one.

   A real market has no expected output. You cannot assert that BTC is
   +8%, because tomorrow it isn't, and a test that pins today's numbers
   has to be rewritten every time it is right. So assert the properties
   instead: things that would be true of any market, and whose failure
   means the modelling is wrong rather than the market moved.

   These are the checks `tools/scenarios.mjs` runs over recorded days.
   They are pure and exported so the unit tests use the same ones — a
   second implementation of "correct" would only drift from this one.

   Each returns null when satisfied, or a sentence naming the offending
   value. Not a boolean: "invariant failed" with no number attached
   sends you reading the wrong file.
   ================================================================ */

import { SHAPES } from "./trend.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
/** trend.js's own threshold for "this is a direction, not noise" */
const NET_MOVE = 2;
const BLOCKS = "▁▂▃▄▅▆▇█";

/**
 * ctx: { reef, trench, reefText, trenchText, live }
 * `live` marks a recording of the real thing, as opposed to a
 * synthetic scenario built to exercise an edge.
 */
export const INVARIANTS = [
  {
    name: "bands account for every creature",
    when: (c) => c.reef?.bands,
    check: (c) => {
      const sum = c.reef.bands.reduce((n, b) => n + b.creatures, 0);
      return sum === c.reef.coins ? null : `bands hold ${sum} of ${c.reef.coins} coins`;
    },
  },
  {
    name: "every coin is rising or falling, and not both",
    when: (c) => c.reef,
    check: (c) => (c.reef.rising + c.reef.falling === c.reef.coins
      ? null
      : `${c.reef.rising} + ${c.reef.falling} ≠ ${c.reef.coins}`),
  },
  {
    name: "breadth sums to the coins it counted",
    when: (c) => c.reef?.week,
    check: (c) => {
      const w = c.reef.week, b = w.breadth;
      const sum = b.up + b.down + b.flat;
      return sum === w.coinsCounted ? null : `breadth sums to ${sum}, counted ${w.coinsCounted}`;
    },
  },
  {
    name: "shape counts sum to the coins counted",
    when: (c) => c.reef?.week?.shapes,
    check: (c) => {
      const w = c.reef.week;
      const sum = Object.values(w.shapes).reduce((a, b) => a + b, 0);
      return sum === w.coinsCounted ? null : `shapes sum to ${sum}, counted ${w.coinsCounted}`;
    },
  },
  {
    name: "every shape is in the vocabulary",
    when: (c) => c.reef?.week?.shapes,
    check: (c) => {
      const unknown = Object.keys(c.reef.week.shapes).filter((k) => !SHAPES.includes(k));
      return unknown.length ? `not in SHAPES: ${unknown.join(", ")}` : null;
    },
  },
  {
    name: "a divergent coin really does disagree with its own week",
    when: (c) => c.reef,
    check: (c) => {
      /* the flag the module exists for: if it can fire while the week
         and the day point the same way, it means nothing */
      for (const coin of [...c.reef.biggestGainers, ...c.reef.biggestLosers]) {
        const t = coin.trend;
        if (!t?.divergent) continue;
        if (sign(t.weekPct) === sign(t.dayPct)) {
          return `${coin.symbol} flagged divergent with week ${t.weekPct}% and day ${t.dayPct}% the same way`;
        }
        if (Math.abs(t.weekPct) <= NET_MOVE) {
          return `${coin.symbol} flagged divergent on a week of only ${t.weekPct}%`;
        }
      }
      return null;
    },
  },
  {
    name: "trend numbers stay inside their own definitions",
    when: (c) => c.reef,
    check: (c) => {
      for (const coin of [...c.reef.biggestGainers, ...c.reef.biggestLosers]) {
        const t = coin.trend;
        if (!t) continue;
        if (!isNum(t.posInRange) || t.posInRange < 0 || t.posInRange > 1) {
          return `${coin.symbol} posInRange ${t.posInRange}`;
        }
        if (!isNum(t.rangePct) || t.rangePct < 0) return `${coin.symbol} rangePct ${t.rangePct}`;
        if (!(t.high >= t.low)) return `${coin.symbol} high ${t.high} below low ${t.low}`;
        if (!(t.points >= 8)) return `${coin.symbol} shaped from only ${t.points} points`;
      }
      return null;
    },
  },
  {
    name: "a sparkline is drawn from blocks, or not drawn",
    when: (c) => c.reef,
    check: (c) => {
      const all = [...c.reef.biggestGainers, ...c.reef.biggestLosers].map((x) => x.trend?.spark);
      if (c.reef.week) all.push(c.reef.week.spark);
      for (const s of all) {
        if (s == null) continue;
        if (s.length === 0) continue;                       // nothing to draw is allowed
        if (s.length > 16) return `sparkline of ${s.length} characters`;
        for (const ch of s) if (!BLOCKS.includes(ch)) return `sparkline contains ${JSON.stringify(ch)}`;
      }
      return null;
    },
  },
  {
    name: "prices and caps are finite and not negative",
    when: (c) => c.reef,
    check: (c) => {
      for (const coin of [...c.reef.biggestGainers, ...c.reef.biggestLosers]) {
        if (coin.price != null && !(isNum(coin.price) && coin.price >= 0)) return `${coin.symbol} price ${coin.price}`;
        if (coin.marketCap != null && !(isNum(coin.marketCap) && coin.marketCap >= 0)) {
          return `${coin.symbol} marketCap ${coin.marketCap}`;
        }
      }
      return null;
    },
  },
  {
    name: "the description says where it came from",
    when: (c) => c.reef || c.trench,
    check: (c) => {
      for (const [what, d] of [["reef", c.reef], ["trench", c.trench]]) {
        if (!d) continue;
        if (!d.data?.source) return `${what} carries no data.source`;
        if (d.data.synthetic && !d.data.note) return `${what} is synthetic and says nothing about it`;
      }
      return null;
    },
  },
  {
    name: "a recording of the real thing is not marked synthetic",
    when: (c) => c.live,
    check: (c) => {
      for (const [what, d] of [["reef", c.reef], ["trench", c.trench]]) {
        if (d?.data?.synthetic) return `${what} replayed from a live recording reports ${d.data.source}`;
      }
      return null;
    },
  },
  {
    name: "the disclaimers survive the modelling",
    when: (c) => c.reef || c.trench,
    check: (c) => {
      if (c.reef && !/not financial advice/i.test(c.reef.note ?? "")) return "the reef dropped its disclaimer";
      if (c.trench && !/read-only/i.test(c.trench.note ?? "")) return "the trench dropped its read-only notice";
      return null;
    },
  },
  {
    name: "a partial wallet read is still labelled partial",
    when: (c) => c.trench?.wallet,
    check: (c) => {
      const w = c.trench.wallet;
      if (!w.partial) return null;
      if (!w.reason) return "a partial read with no reason given";
      return /PARTIAL READ/.test(c.trenchText ?? "") ? null : "the text does not say the read was partial";
    },
  },
  {
    name: "epoch progress is a percentage",
    when: (c) => c.trench?.network?.epochPercent != null,
    check: (c) => {
      const p = c.trench.network.epochPercent;
      return isNum(p) && p >= 0 && p <= 100 ? null : `epochPercent ${p}`;
    },
  },
  {
    name: "nothing leaked into the words",
    when: (c) => c.reefText || c.trenchText,
    check: (c) => {
      /* the cheapest check here and the one that catches the most: a
         renamed field shows up as "undefined" long before it shows up
         as an exception. */
      for (const [what, text] of [["reef", c.reefText], ["trench", c.trenchText]]) {
        if (!text) continue;
        const m = /undefined|NaN|\[object Object\]|\bnull\b/.exec(text);
        if (m) {
          const at = text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, " ");
          return `${what} text contains "${m[0]}" — …${at}…`;
        }
      }
      return null;
    },
  },
];

/** run them all; returns one row per applicable invariant */
export function checkAll(ctx = {}) {
  return INVARIANTS
    .filter((i) => {
      try { return i.when(ctx); } catch { return false; }
    })
    .map((i) => {
      try {
        const detail = i.check(ctx);
        return { name: i.name, ok: detail == null, detail: detail ?? null };
      } catch (e) {
        /* an invariant that throws is itself a finding: the shape it
           assumed is not the shape it got */
        return { name: i.name, ok: false, detail: `the check itself threw: ${e.message}` };
      }
    });
}
