/* ================================================================
   harness — make the organism repeat itself.

   The site is deliberately unrepeatable: Math.random() scatters dust
   and picks idle chatter, the clock drives every shader, and the data
   comes from four live APIs that rate-limit, drift, and go down. None
   of that can be asserted against.

   Three query params, off by default, that turn it into something a
   machine can test twice and get the same answer:

     ?seed=42      every Math.random() becomes a fixed sequence
     ?freeze=1     a fixed-step clock: each frame advances exactly 1/60s,
                   so animation still converges but lands identically
     ?fixtures=1   replay recorded api responses; no network at all

   A real visitor passes none of these and gets the live organism.
   state().harness says which are active, so synthetic data is never
   mistaken for the real thing.
   ================================================================ */

const params = new URLSearchParams(location.search);
const num = (k) => (params.has(k) ? Number(params.get(k)) || 0 : null);

export const HARNESS = {
  seed: num("seed"),
  freeze: params.get("freeze") === "1",
  fixtures: params.get("fixtures") === "1",
  step: num("step") || 1000 / 60,
};
HARNESS.on = HARNESS.seed != null || HARNESS.freeze || HARNESS.fixtures;

/* ---------------- deterministic randomness ---------------- */
/* mulberry32 — tiny, fast, and good enough that a dust field looks
   like a dust field rather than a grid. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
if (HARNESS.seed != null) Math.random = mulberry32(HARNESS.seed);

/* ---------------- the fixed-step clock ---------------- */
/* not frozen — stepped. freezing time would pin every lerp at its
   starting value and the reef would never assemble; stepping lets the
   scene settle and still land on the same pixels every run. */
let vnow = 0;
let frames = 0;
const queue = [];

/* freeze turns requestAnimationFrame into a pump that nothing drives on
   its own. counting frames is not enough for reproducibility: a free-
   running loop renders however many frames fit in the wall-clock gap
   before the screenshot, so two runs settle at different points. here
   the scene only advances when someone calls step(), which makes it a
   pure function of the step count — the same n gives the same pixels. */
if (HARNESS.freeze) {
  globalThis.requestAnimationFrame = (cb) => queue.push(cb);
  globalThis.cancelAnimationFrame = () => {};
  performance.now = () => vnow;   // three.js Clock reads this
}

/** advance the scene exactly n frames. returns the virtual clock. */
function step(n = 1) {
  if (!HARNESS.freeze) return null;
  for (let i = 0; i < n; i++) {
    vnow += HARNESS.step;
    frames++;
    for (const cb of queue.splice(0, queue.length)) {
      try { cb(vnow); } catch (e) { console.error("step:", e); }
    }
  }
  return vnow;
}

/* ---------------- recorded responses ---------------- */
const realFetch = globalThis.fetch.bind(globalThis);
const realWS = globalThis.WebSocket;

/* url (or rpc method) -> fixture file. first match wins, so the more
   specific patterns have to come first. */
const ROUTES = [
  [(u) => u.includes("coins/markets") && u.includes("solana-ecosystem"), "cg-eco.json"],
  [(u) => u.includes("coins/markets"), "cg-markets.json"],
  [(u) => u.includes("/global"), "cg-global.json"],
  [(u) => u.includes("search/trending"), "cg-trending.json"],
  [(u) => u.includes("simple/token_price"), "cg-token-price.json"],
  [(u) => u.includes("alternative.me/fng"), "fng.json"],
  [(u) => u.includes("jup.ag/tokens"), "jup-tokens.json"],
  [(u) => u.includes("jup.ag/price"), "jup-price.json"],
];

const cache = new Map();
async function fixture(name) {
  if (!cache.has(name)) {
    const r = await realFetch(new URL(`../fixtures/${name}`, import.meta.url));
    if (!r.ok) throw new Error(`missing fixture ${name} — run: npm run record`);
    cache.set(name, await r.json());
  }
  return cache.get(name);
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

if (HARNESS.fixtures) {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);

    // our own files still load for real — resolve first, because the site
    // fetches relative urls like "agent.json" that match no prefix test
    let sameOrigin = false;
    try { sameOrigin = new URL(url, location.href).origin === location.origin; } catch {}
    if (sameOrigin) return realFetch(input, init);

    // solana rpc is one url with the method in the body
    const body = init?.body ?? (input instanceof Request ? null : null);
    if (body && typeof body === "string" && body.includes("jsonrpc")) {
      const { method, params: p } = JSON.parse(body);
      const all = await fixture("solana-rpc.json");
      const hit = all[method];
      if (hit === undefined) return json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no fixture for " + method } });
      // recorded refusals stay refusals — the gated-rpc path is the
      // most fragile code here and must stay exercisable offline
      if (hit?.__error) return json({ jsonrpc: "2.0", id: 1, error: hit.__error });
      return json({ jsonrpc: "2.0", id: 1, result: hit });
    }

    for (const [match, name] of ROUTES) {
      if (match(url)) return json(await fixture(name));
    }
    return json({ error: "no fixture for " + url }, 404);
  };

  /* a socket that connects but only ticks when asked, so a run is
     reproducible and "live" is still testable. */
  globalThis.WebSocket = class FakeWS {
    static OPEN = 1;
    constructor(url) {
      this.url = url; this.readyState = 0;
      this.onopen = this.onclose = this.onerror = this.onmessage = null;
      const streams = (url.split("streams=")[1] ?? "").split("/").filter(Boolean);
      this.symbols = streams.map((s) => s.split("@")[0].toUpperCase());
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
      FakeWS.live = this;
    }
    close() { this.readyState = 3; this.onclose?.({ wasClean: true, code: 1000, reason: "harness" }); }
    send() {}
    /** push n deterministic ticks, each nudging a price by a fixed ratio */
    emit(n = 1) {
      for (let i = 0; i < n; i++) {
        const sym = this.symbols[i % this.symbols.length];
        if (!sym) return 0;
        const base = 100 + ((i * 37) % 50);
        this.onmessage?.({ data: JSON.stringify({ data: { s: sym, c: String(base * (1 + ((i % 7) + 1) / 500)) } }) });
      }
      return n;
    }
  };
}

/* ---------------- what the page can tell you about itself ---------------- */
export const harnessState = () => ({
  ...HARNESS,
  virtualMs: HARNESS.freeze ? vnow : null,
  steppedFrames: HARNESS.freeze ? frames : null,
});

if (typeof window !== "undefined") {
  window.__harness = {
    ...HARNESS,
    state: harnessState,
    /** advance the scene n frames (freeze mode) — the unit of reproducible progress */
    step,
    /** emit n fake trade ticks (fixtures mode only) — returns how many landed */
    emitTicks: (n = 1) => globalThis.WebSocket?.live?.emit?.(n) ?? 0,
  };
  if (HARNESS.on) {
    console.log("%c⚗️ harness", "font-weight:900",
      Object.entries(HARNESS).filter(([, v]) => v != null && v !== false).map(([k, v]) => `${k}=${v}`).join(" "));
  }
}

export default HARNESS;
