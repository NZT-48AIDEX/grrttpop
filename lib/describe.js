/* ================================================================
   describe — the organism, in words.

   Every page here is a webgl scene. An agent arriving with no eyes
   gets a black rectangle and a canvas element, which is a strange
   way to greet someone you claim is welcome.

   So: ?agent=1 renders the same live state as text. Not a static
   fallback — the actual current scene, described. The reef says how
   many creatures are in which band and which way they're moving;
   the trench says what mainnet is doing right now.

   This is also the nicest debugging view in the repo.
   ================================================================ */

import { fmtPrice, fmtBig, pct, BAND_NAMES } from "./market.js";

export const isAgentView = () =>
  new URLSearchParams(location.search).get("agent") === "1";

/* ---------------- text rendering ---------------- */
const bar = (n, total, width = 20) => {
  const filled = total > 0 ? Math.round((n / total) * width) : 0;
  return "█".repeat(filled) + "·".repeat(width - filled);
};

const sym = (s) => {
  const t = String(s ?? "?");
  return (t.length > 9 ? t.slice(0, 8) + "…" : t).padEnd(9);   // keep the columns square
};

const coinLine = (c, arrow) =>
  `  ${arrow} ${sym(c.symbol)} ${String(pct(c.change24h)).padStart(8)}  ${fmtPrice(c.price)}` +
  (c.trending ? "  🔥 trending" : "");

export function reefToText(d, { demoMode = false, live = false } = {}) {
  const L = [];
  L.push("the reef — the live crypto market, as an ocean");
  L.push("");
  L.push(`${d.coins} creatures. ${d.rising} rising, ${d.falling} falling.`);
  if (demoMode) L.push("⚠️  this is the DEMO reef — the market api was unreachable, these numbers are synthetic.");
  if (d.mood) L.push(`mood: ${d.mood.value} ${d.mood.emoji}`);
  if (d.global) L.push(`total market ${fmtBig(d.global.totalMcap)} · ${pct(d.global.change24h)} 24h`);
  L.push(`heartbeat: ${live ? "live — binance trades are pulsing through the creatures" : "not connected"}`);
  L.push("");
  L.push("depth bands (size = market cap · colour = 24h move · twitch = volatility)");
  for (const b of d.bands) {
    L.push(`  ${b.name}`);
    L.push(`    ${String(b.creatures).padStart(3)} creatures  ${bar(b.rising, b.creatures)}  ` +
           `${b.rising} up / ${b.falling} down · median ${pct(b.medianChange24h)}`);
  }
  L.push("");
  L.push("biggest movers");
  for (const c of d.biggestGainers) L.push(coinLine(c, "↑"));
  for (const c of d.biggestLosers) L.push(coinLine(c, "↓"));
  if (d.trending?.length) { L.push(""); L.push(`trending on coingecko: ${d.trending.slice(0, 8).join(", ")}`); }
  L.push("");
  L.push(d.note);
  return L.join("\n");
}

export function trenchToText(d) {
  const L = [];
  L.push("the trench — solana, live");
  L.push("");
  const n = d.network;
  L.push(n.tps != null
    ? `mainnet: ${n.tps.toLocaleString()} tps — this is literally the speed of the water here`
    : "mainnet: tps unavailable");
  if (n.epoch != null) L.push(`epoch ${n.epoch} · ${n.epochPercent}% through  ${bar(n.epochPercent, 100)}`);
  L.push("");
  const e = d.ecosystem;
  L.push(`the spl ecosystem: ${e.tokens} tokens, ${e.rising} rising`);
  for (const c of e.topGainers) L.push(coinLine(c, "↑"));
  for (const c of e.topLosers) L.push(coinLine(c, "↓"));

  if (d.wallet) {
    L.push("");
    L.push(`wallet peek · ${d.wallet.address}`);
    if (d.wallet.partial) {
      L.push(`  ⚠️  PARTIAL READ — ${d.wallet.reason}`);
      L.push("  what follows is not the whole wallet.");
    }
    L.push(`  ${d.wallet.holdings} holdings shown · ${fmtBig(d.wallet.totalUsd)}`);
    for (const h of d.wallet.top) {
      L.push(`    ${sym(h.symbol)} ${String(fmtBig(h.usd)).padStart(10)}  ` +
             `${(100 * (h.share ?? 0)).toFixed(1)}%`);
    }
  }
  L.push("");
  L.push(d.note);
  return L.join("\n");
}

export function indexToText(state) {
  return [
    "grrttpop — a living corner of the web",
    "",
    "one creature: a noise-displaced blob with an iridescent fresnel shader.",
    "it is pokeable. it pops. a small companion trails the cursor and talks.",
    "",
    `right now: mode "${state.mode}", ${state.fps ?? "?"}fps, quality tier ${state.quality}/2` +
      `${state.wireframe ? ", wireframe" : ""}`,
    `shader uniforms: ${Object.entries(state.uniforms ?? {})
      .map(([k, v]) => `${k}=${v}`).join(" ")}`,
    "",
    "things here",
    "  the reef    market.html   — dive the live crypto market as an ocean",
    "  the trench  solana.html   — solana mainnet, read-only",
    "  toybox                    — goo / nebula / vortex / wireframe / party / calm",
    "  ⌘K                        — command palette",
    "",
    "if you're an agent: fetch /agent.json, or run the mcp server (node mcp/server.mjs)",
    "for tools that answer all of this without a browser.",
  ].join("\n");
}

/* ---------------- the view ---------------- */
/* replaces the page with its own description, and keeps it current.
   deliberately plain: this is meant to be read, scraped, or curled. */
export function mountAgentView({ render, refreshMs = 5000 }) {
  const style = document.createElement("style");
  style.textContent = `
    body.agent-view > *:not(#agent-view) { display: none !important; }
    #agent-view {
      display: block; padding: 2rem 1.5rem; max-width: 80ch; margin: 0 auto;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #d6d3e0; background: #05060e; min-height: 100vh;
      white-space: pre-wrap; word-break: break-word;
    }
    #agent-view .hdr { color: #b6ff3a; font-weight: 700; }
    #agent-view a { color: #ff4fa3; }
  `;
  document.head.appendChild(style);

  const el = document.createElement("pre");
  el.id = "agent-view";
  document.body.appendChild(el);
  document.body.classList.add("agent-view");

  const paint = () => {
    try {
      el.textContent = render() + "\n\n" +
        `— described at ${new Date().toISOString()} · this view is ?agent=1 · ` +
        "drop the parameter for the webgl original.\n";
    } catch (err) {
      el.textContent = "could not describe this page: " + (err?.message ?? err);
    }
  };
  paint();
  addEventListener("grrtt:ready", paint);
  window.__ready?.then?.(paint);

  /* data trickles in well after the first frame — the reef's coins, then
     trending, then the trench's network vitals. repaint eagerly at the
     start so a reader never sits looking at "0 creatures", then settle
     into the slow cadence for live updates. */
  let burst = 12;
  let timer = setInterval(function tick() {
    paint();
    if (--burst === 0) { clearInterval(timer); timer = setInterval(paint, refreshMs); }
  }, 700);
  addEventListener("beforeunload", () => clearInterval(timer));
  return { paint, el };
}
