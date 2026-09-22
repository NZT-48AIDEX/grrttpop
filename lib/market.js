/* ================================================================
   market — the reef's data and modelling, with no reef attached.

   Everything here runs unchanged in a browser and in node: no DOM,
   no three.js, no localStorage. That is the whole point — an agent
   asking "what does the reef look like right now" should get the
   real answer from the real code, not a second implementation that
   drifts away from this one over time.

   Visualization only: market data in, shapes and numbers out. No
   trading, no custody, no advice.
   ================================================================ */

export const API = "https://api.coingecko.com/api/v3";
export const COINS = 50;
export const BAND_SPLIT = [10, 15];        // shallows 10, mid 15, deep = rest
export const BAND_NAMES = ["the shallows · blue chips", "mid waters · majors", "the deep · small caps"];

import { trendOf, weekShape } from "./trend.js";

/* stable per-id pseudo-randomness: the same coin always sits in the
   same place and wears the same wobble */
export const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1e6, 7);

/* ---------------- fetching ---------------- */
const jget = async (url, fetchImpl = fetch) => {
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error("coingecko " + r.status);
  return r.json();
};

export function fetchMarkets({ perPage = COINS, fetch: f } = {}) {
  return jget(`${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}` +
    `&sparkline=true&price_change_percentage=1h,24h,7d`, f);
}

export async function fetchGlobal({ fetch: f } = {}) {
  const g = (await jget(`${API}/global`, f)).data;
  return { totalMcap: g.total_market_cap.usd, change24h: g.market_cap_change_percentage_24h_usd };
}

export async function fetchFearGreed({ fetch: f } = {}) {
  const d = (await jget("https://api.alternative.me/fng/", f)).data[0];
  return { value: +d.value, label: d.value_classification.toLowerCase() };
}

export async function fetchTrending({ fetch: f } = {}) {
  const j = await jget(`${API}/search/trending`, f);
  return j.coins.map((c) => c.item.id);
}

/* ---------------- the demo reef ---------------- */
/* when the api is unreachable the reef still has to feel alive, but it
   must never be mistaken for real data — callers flag it as demo. */
const DEMO_NAMES = ["bitcorn", "etherdream", "solwave", "dogeling", "pepecoral", "linkfish",
  "adakelp", "dotplankton", "avaquid", "xrpolyp", "tonshell", "shibafry", "uniswirl",
  "atomsquid", "nearreef", "aptoray", "arbeel", "opurchin", "maticrab", "ltcoral",
  "suijelly", "injkraken", "tiacoral", "seiurchin", "ftmfin", "runegill", "ordishell",
  "jupwhale", "wifhat", "bonkfry", "pythfish", "junosnail", "kavakelp", "roseanemone",
  "glmrguppy", "strkray", "mantaray", "zetaeel", "dymdrift", "altbubble"];

export function demoData({ now = Date.now() } = {}) {
  return DEMO_NAMES.map((n, i) => {
    const seed = hash(n);
    const wave = Math.sin(seed + now / 3e4);
    return {
      id: n, name: n, symbol: n.slice(0, 4), image: "",
      current_price: 10000 / (i + 1) * (1 + wave * 0.03),
      market_cap: 9e11 / Math.pow(i + 1, 1.4),
      total_volume: 2e10 / (i + 1),
      market_cap_rank: i + 1,
      price_change_percentage_1h_in_currency: wave * 1.2,
      price_change_percentage_24h_in_currency: wave * 6,
      price_change_percentage_7d_in_currency: Math.cos(seed) * 14,
      sparkline_in_7d: { price: Array.from({ length: 84 }, (_, k) =>
        100 * (1 + 0.1 * Math.sin(seed + k / 9) + 0.03 * Math.sin(k / 2 + seed * 3))) },
    };
  });
}

/* ---------------- modelling ---------------- */
/* which depth band a coin lands in, by its position in the current sort */
export const bandOf = (index) => index < BAND_SPLIT[0] ? 0 : index < BAND_SPLIT[0] + BAND_SPLIT[1] ? 1 : 2;

export function sortCoins(coins, { sort = "mcap", watchlist = new Set(), bags = [] } = {}) {
  let list = [...coins];
  if (sort === "gainers") list.sort((a, b) => (b.price_change_percentage_24h_in_currency ?? -99) - (a.price_change_percentage_24h_in_currency ?? -99));
  if (sort === "losers") list.sort((a, b) => (a.price_change_percentage_24h_in_currency ?? 99) - (b.price_change_percentage_24h_in_currency ?? 99));
  if (sort === "watched") list = list.filter((c) => watchlist.has(c.id));
  if (sort === "bags") list = list.filter((c) => bags.some((b) => b.id === c.id));
  return list;
}

/** creature size: log market cap normally, holding value under the bags sort */
export function sizeFor(c, lo, hi, { sort = "mcap", bags = [] } = {}) {
  if (sort === "bags") {
    const bag = bags.find((b) => b.id === c.id);
    const val = Math.sqrt((bag?.amt ?? 0) * (c.current_price ?? 0));
    return 0.6 + 2.0 * (hi > lo ? (val - lo) / (hi - lo) : 0.5);
  }
  return 0.55 + 2.05 * (hi > lo ? (Math.log(c.market_cap || 1) - lo) / (hi - lo) : 0.5);
}

/** non-overlapping spiral packing — deterministic given the same ids and sizes */
export function packPositions(items) {
  const placed = [];
  for (const it of items) {
    if (!placed.length) { placed.push({ x: 0, y: 0, r: it.size }); continue; }
    const a0 = (hash(it.id) % 628) / 100;
    let done = false;
    for (let rad = placed[0].r + it.size; !done && rad < 120; rad += 0.2) {
      for (let k = 0; k < 40; k++) {
        const a = a0 + (k / 40) * Math.PI * 2;
        const x = Math.cos(a) * rad, y = Math.sin(a) * rad * 0.72;
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + it.size + 0.18)) {
          placed.push({ x, y, r: it.size });
          done = true;
          break;
        }
      }
    }
    if (!done) placed.push({ x: 0, y: 0, r: it.size });
  }
  return placed;
}

export const bagValue = (bags, coins) =>
  bags.reduce((s, b) => s + (coins.find((c) => c.id === b.id)?.current_price ?? 0) * b.amt, 0);

/* ---------------- formatting ---------------- */
export function fmtPrice(v) {
  if (v == null) return "—";
  if (v >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return "$" + v.toFixed(2);
  return "$" + v.toFixed(v < 0.01 ? 6 : 4);
}

export function fmtBig(v) {
  if (v == null) return "—";
  for (const [s, m] of [["T", 1e12], ["B", 1e9], ["M", 1e6]])
    if (v >= m) return "$" + (v / m).toFixed(2) + s;
  return "$" + Math.round(v).toLocaleString();
}

export const pct = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

/* ---------------- why the heartbeat is quiet ---------------- */
/**
 * A dead WebSocket always closes 1006 — the spec gives the page no reason,
 * so "blocked in your country" and "your wifi died" look identical. Binance
 * answers 451 over plain https when it won't serve your region, which is the
 * one way to tell the difference from inside the browser.
 *
 * The trench already distinguishes a gated RPC method from a dead network and
 * says which. The reef should be able to do the same rather than showing a
 * dim dot and leaving you to guess.
 */
export async function diagnoseTicks({ fetch: f = fetch, timeoutMs = 6000 } = {}) {
  const PING = "https://api.binance.com/api/v3/ping";
  const signal = () => AbortSignal.timeout(timeoutMs);

  // node (and any caller with cors allowed) can read the status directly
  try {
    const r = await f(PING, { signal: signal() });
    if (r.status === 451) return { reason: "geo-blocked", detail: GEO };
    if (r.ok) return { reason: "socket-blocked", detail: SOCKET };
    return { reason: "http-" + r.status, detail: `binance answered ${r.status}. live ticks are unavailable; prices still refresh.` };
  } catch { /* in a browser this throws for a 451 too — see below */ }

  /* A cross-origin error response carries no CORS headers, so the browser
     rejects it before any status is readable: a 451 and a dead network look
     identical. A no-cors probe still resolves (opaquely) when the server
     answered *something*, and only throws when nothing was reachable — which
     is enough to tell "refused us" from "couldn't get there". */
  try {
    await f(PING, { mode: "no-cors", signal: signal() });
    return { reason: "refused", detail: REFUSED };
  } catch {
    return { reason: "unreachable", detail: UNREACHABLE };
  }
}

export const moodEmoji = (v) => v < 25 ? "😱" : v < 45 ? "😟" : v < 55 ? "😐" : v < 75 ? "😋" : "🤪";

const GEO = "binance doesn't serve this region (451), so live trade ticks can't reach you here. everything else on this page is unaffected.";
const SOCKET = "binance is reachable but the trade socket won't open — a proxy, extension or firewall may be blocking websockets.";
const REFUSED = "binance answered but wouldn't serve this page — most likely a regional block. prices still refresh; only the live trade pulses are missing.";
const UNREACHABLE = "can't reach binance at all — offline, or a blocker is in the way. prices still refresh.";

/* ---------------- the reef, described ---------------- */
/* what the ocean would look like, for something that cannot see it.
   this is what an agent gets back when it asks about the reef. */
export function describeReef(coins, { trending = new Set(), mood = null, global: g = null, sort = "mcap" } = {}) {
  const list = sortCoins(coins, { sort });
  const bands = [0, 1, 2].map((b) => {
    const inBand = list.filter((_, i) => bandOf(i) === b);
    const up = inBand.filter((c) => (c.price_change_percentage_24h_in_currency ?? 0) >= 0).length;
    return {
      band: b,
      name: BAND_NAMES[b],
      creatures: inBand.length,
      rising: up,
      falling: inBand.length - up,
      medianChange24h: median(inBand.map((c) => c.price_change_percentage_24h_in_currency ?? 0)),
    };
  });

  const byChange = [...coins].sort((a, b) =>
    (b.price_change_percentage_24h_in_currency ?? 0) - (a.price_change_percentage_24h_in_currency ?? 0));
  const brief = (c) => ({
    id: c.id, symbol: c.symbol?.toUpperCase(), name: c.name,
    price: c.current_price, change24h: c.price_change_percentage_24h_in_currency,
    /* the other two windows were always in the response and always thrown
       away. one number can't tell you whether a move is starting or ending. */
    change1h: c.price_change_percentage_1h_in_currency ?? null,
    change7d: c.price_change_percentage_7d_in_currency ?? null,
    marketCap: c.market_cap, rank: c.market_cap_rank,
    trending: trending.has?.(c.id) ?? false,
    trend: trendOf(c),
  });

  return {
    coins: coins.length,
    bands,
    rising: coins.filter((c) => (c.price_change_percentage_24h_in_currency ?? 0) >= 0).length,
    falling: coins.filter((c) => (c.price_change_percentage_24h_in_currency ?? 0) < 0).length,
    biggestGainers: byChange.slice(0, 5).map(brief),
    biggestLosers: byChange.slice(-5).reverse().map(brief),
    trending: [...(trending ?? [])],
    mood: mood == null ? null : { value: mood, emoji: moodEmoji(mood) },
    /* the whole reef as one creature: an equal-weighted index of every
       coin's week, plus how many are doing each thing. null when the
       market data arrived without its hourly series. */
    week: weekShape(coins),
    global: g,
    note: "market data only — no trading, no custody, not financial advice",
  };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2);
};
