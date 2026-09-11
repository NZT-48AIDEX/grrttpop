#!/usr/bin/env node
/* ================================================================
   smoke — boot the whole organism and check that it is alive.

   Runs every page headless against recorded fixtures on a seeded,
   fixed-step clock, so two runs give the same answer and neither
   touches the network. Asserts against state() rather than pixels:
   a webgl page can render plausible-looking black.

   usage:
     npm run smoke              headless, fixtures, all pages
     npm run smoke -- --live    hit the real apis instead
     npm run smoke -- --head    watch it happen in a real window
     npm run smoke -- --page=reef
     npm run smoke -- --update-baselines
   ================================================================ */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
import { checkBaseline } from "./visual.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, ".smoke");
/* baselines are platform-specific: the site asks for -apple-system and Menlo,
   a linux runner substitutes something else, and swiftshader differs too. one
   directory per platform, rather than a shared one that can never match. */
const PLATFORM = `${process.platform}-${process.arch}`;
const BASELINES = join(ROOT, "baselines", PLATFORM);
const PORT = 4178;
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

const LIVE = flag("live");
const SETTLE = Number(opt("settle")) || 150;   // frames to run before the baseline shot
const only = opt("page");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- what "alive" means, per page ---------------- */
/* each check gets the page's own state() and returns a string to fail
   with, or nothing to pass. */
const universal = [
  ["reached ready", (s) => (s.ready ? null : "never signalled ready")],
  ["painted frames", (s) => (s.frames > 0 ? null : "no frames rendered")],
  ["shaders compiled", (s) => (s.gl?.shaderFails === 0 ? null : `${s.gl.shaderFails} shader(s) failed to compile`)],
  ["gl is drawing", (s) => (s.gl?.calls > 0 ? null : "zero draw calls — nothing reached the screen")],
  ["no page errors", (s) => {
    const bad = s.errors.filter((e) => e.kind === "js" || e.kind === "promise" || e.kind === "shader");
    return bad.length ? bad.map((e) => `${e.kind}: ${e.msg}`).join(" · ") : null;
  }],
];

const PAGES = {
  index: {
    url: "index.html", global: "grrtt",
    agentText: ["a living corner of the web", "the reef", "the trench"],
    checks: [
      ["creature has a mode", (s) => (s.mode ? null : "no mode")],
      ["shader uniforms live", (s) => (typeof s.uniforms?.uTime === "number" ? null : "uTime missing")],
      ["quality tier sane", (s) => ([0, 1, 2].includes(s.quality) ? null : `quality=${s.quality}`)],
    ],
    async exercise(page, { advance }) {
      await page.eval(`grrtt.setMode("party"); grrtt.pop(); return 1`);
      await advance(30);
      const after = await page.eval("return grrtt.state()");
      if (after.mode !== "party") throw new Error(`setMode did not take: mode=${after.mode}`);
      return { modeAfterToybox: after.mode };
    },
  },

  reef: {
    url: "market.html", global: "reef",
    agentText: ["the live crypto market", "depth bands", "biggest movers", "not financial advice"],
    checks: [
      ["market data loaded", (s) => (s.data.coins > 0 ? null : "zero coins")],
      ["creatures exist", (s) => (s.reef.blobs > 0 ? null : "no blobs built")],
      ["creatures visible", (s) => (s.reef.visible > 0 ? null : "every creature is hidden")],
      ["not silently in demo mode", (s, ctx) =>
        (!s.data.demoMode || ctx.live ? null : "fell back to the demo reef with fixtures present")],
    ],
    async exercise(page, { live, advance }) {
      // the depth bands are the whole navigation model
      await page.eval(`reef.dive(2); return 1`);
      await advance(90);
      const dove = await page.eval("return reef.state()");
      if (dove.reef.band !== 2) throw new Error(`dive(2) left us in band ${dove.reef.band}`);

      // and the heartbeat: fake ticks in fixture mode, real socket when live
      let ticks = null;
      if (!live) {
        const sent = await page.eval(`return __harness.emitTicks(12)`);
        await advance(10);
        const s = await page.eval("return reef.state()");
        if (!sent) throw new Error("harness emitted no ticks");
        if (s.ws.sinceLastTickMs == null) throw new Error("ticks never reached the reef");
        ticks = { sent, sinceLastTickMs: s.ws.sinceLastTickMs };
      }
      await page.eval(`reef.dive(0); return 1`);
      await advance(60);
      return { bandAfterDive: dove.reef.band, ticks };
    },
  },

  trench: {
    url: "solana.html", global: "trench",
    agentText: ["solana, live", "the spl ecosystem", "read-only"],
    checks: [
      ["ecosystem loaded", (s) => (s.eco.coins > 0 ? null : "no ecosystem coins")],
      ["creatures exist", (s) => (s.scene.blobs > 0 ? null : "no blobs built")],
      ["chain reachable", (s) => (s.chain.connected ? null : "rpc never connected")],
      ["current driven by tps", (s) => (s.scene.currentSpeed > 0 ? null : "current is dead")],
    ],
    async exercise(page, { advance }) {
      // the gated-rpc path: a partial wallet must never look whole
      const addr = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
      // live, this walks four rpc endpoints with backoff before giving up
      await page.eval(`await trench.peekWallet(${JSON.stringify(addr)}).catch(e => e); return 1`,
        { timeout: 180_000 });
      await advance(60);
      const s = await page.eval("return trench.state()");
      if (s.wallet.address !== addr) throw new Error("wallet peek did not record the address");
      if (s.wallet.holdings < 1) throw new Error("wallet peek returned nothing at all");
      // whenever token accounts are refused, the ui must say so
      if (s.wallet.partial && !s.note) throw new Error("partial wallet read is not disclosed to the user");
      return { holdings: s.wallet.holdings, partial: s.wallet.partial, gated: s.wallet.gated, disclosed: !!s.note };
    },
  },
};

/* ---------------- a static server, no deps ---------------- */
function serve() {
  const p = spawn("npx", ["--yes", "http-server", "-p", String(PORT), "-c-1", "--silent", ROOT], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  return {
    proc: p,
    async ready() {
      for (let i = 0; i < 120; i++) {
        try { const r = await fetch(`http://127.0.0.1:${PORT}/agent.json`); if (r.ok) return; } catch {}
        await sleep(250);
      }
      throw new Error("static server never came up");
    },
    stop() { p.kill(); },
  };
}

/* ---------------- run ---------------- */
mkdirSync(SHOTS, { recursive: true });
const server = serve();
const results = [];
let browser;

try {
  await server.ready();
  browser = await launch({ headless: !flag("head") });
  // a scratch page that only ever decodes and compares images
  const differ = await browser.newPage();
  console.log(`smoke · ${browser.version} · ${LIVE ? "LIVE apis" : "recorded fixtures"}\n`);

  for (const [name, spec] of Object.entries(PAGES)) {
    if (only && only !== name) continue;
    const t0 = Date.now();
    const page = await browser.newPage();
    const row = { page: name, checks: [], failures: [] };

    try {
      // seeded + pumped so two runs land on the same pixels
      const q = LIVE ? "" : "?seed=42&freeze=1&fixtures=1";
      await page.goto(`http://localhost:${PORT}/${spec.url}${q}`);
      await page.waitFor("window.__ready !== undefined", { label: "the page's own scripts" });

      // --live depends on apis that ration us. coingecko answers 429 with no
      // cors headers, which chrome then reports as a cors block, so the
      // console looks like a bug in the page rather than a rate limit.
      // waiting on a beacon that can never fire just times out opaquely.
      await page.waitFor(`__diag.snapshot().ready`, {
        timeout: LIVE ? 90_000 : 30_000,
        label: LIVE ? "live data (the apis may be rate-limiting this ip — try without --live)" : "the page to reach ready",
      });

      const advance = LIVE
        ? (n) => page.frames(n)
        : (n) => page.eval(`return __harness.step(${n})`);

      await page.eval("await window.__ready; return 1");

      if (!LIVE) {
        // wait for the network to go quiet BEFORE stepping. data landing
        // mid-run would rebuild the scene at a different frame each time,
        // and no amount of frame-counting fixes that.
        await page.waitFor("__diag.snapshot().net.inflight === 0", { label: "in-flight requests to settle" });
        let last = -1;
        for (let i = 0; i < 40; i++) {
          const n = await page.eval("return __diag.snapshot().net.ok");
          if (n === last) break;       // two quiet polls running means nothing more is coming
          last = n;
          await sleep(120);
        }
        // then step to an ABSOLUTE frame count. stepping "SETTLE more" would
        // inherit whatever warm-up frames happened to have run already —
        // that drift is exactly what made three runs give three pictures.
        await page.eval(`return __harness.step(Math.max(0, ${SETTLE} - __harness.state().steppedFrames))`);
      } else {
        await advance(SETTLE);
      }

      const state = await page.eval(`return ${spec.global}.state()`);
      row.state = state;

      // the baseline shot is the settled scene, before any interaction
      if (!LIVE) await page.freezeCss();
      row.shot = await page.screenshot(join(SHOTS, `${name}.png`));

      // compare against the committed reference. skipped when live, where
      // the picture is whatever the market happens to be doing today.
      if (!LIVE) {
        const { readFileSync } = await import("node:fs");
        const vis = await checkBaseline(differ, BASELINES, name, readFileSync(row.shot),
          { update: flag("update-baselines") });
        row.visual = vis;
        row.checks.push({ label: "matches baseline", ok: vis.status !== "fail" });
        if (vis.status === "fail") row.failures.push(`baseline — ${vis.message}`);
      }

      for (const [label, check] of [...universal, ...spec.checks]) {
        const problem = check(state, { live: LIVE });
        row.checks.push({ label, ok: !problem });
        if (problem) row.failures.push(`${label} — ${problem}`);
      }

      // ?agent=1 is the only thing a visitor with no eyes gets — check it
      // renders, and that it renders the real state rather than an empty shell
      try {
        const agent = await browser.newPage();
        await agent.goto(`http://localhost:${PORT}/${spec.url}?agent=1${LIVE ? "" : "&seed=42&fixtures=1"}`);
        await agent.waitFor("window.__ready !== undefined", { label: "page scripts" });
        await agent.eval("await window.__ready; return 1");
        const text = await agent.waitFor(
          `(() => { const t = document.getElementById("agent-view")?.textContent ?? ""; return ${JSON.stringify(spec.agentText)}.every(s => t.includes(s)) && t; })()`,
          { timeout: 30_000, label: `the ${name} to describe itself` });
        row.agentView = { chars: text.length, lines: text.split("\n").length };
        row.checks.push({ label: "describes itself (?agent=1)", ok: true });
      } catch (e) {
        row.checks.push({ label: "describes itself (?agent=1)", ok: false });
        row.failures.push(`agent view — ${e.message}`);
      }

      if (spec.exercise) {
        try { row.exercised = await spec.exercise(page, { live: LIVE, advance }); row.checks.push({ label: "interactions", ok: true }); }
        catch (e) { row.checks.push({ label: "interactions", ok: false }); row.failures.push(`interactions — ${e.message}`); }
      }

      // a console error the page never routed through diag still counts
      const consoleErrors = page.errors().filter((e) => !/favicon|ERR_/.test(e.text));
      if (consoleErrors.length) row.failures.push(`console — ${consoleErrors.map((e) => e.text.slice(0, 120)).join(" · ")}`);

    } catch (e) {
      row.failures.push(`fatal — ${e.message}`);
      try { row.shot = await page.screenshot(join(SHOTS, `${name}.png`)); } catch {}
    }

    row.ms = Date.now() - t0;
    results.push(row);

    const ok = !row.failures.length;
    console.log(`${ok ? "✅" : "❌"} ${name.padEnd(7)} ${String(row.ms + "ms").padStart(7)}  ${row.checks.filter((c) => c.ok).length}/${row.checks.length} checks`);
    if (row.state) {
      const s = row.state;
      console.log(`   ${s.fps ?? "?"}fps · ${s.gl?.calls ?? 0} draws · ${s.gl?.programs ?? 0} shaders · ${s.errorCount} recorded errors`);
    }
    for (const f of row.failures) console.log(`   ↳ ${f}`);
    if (row.agentView) console.log(`   ↳ ?agent=1: ${row.agentView.lines} lines, ${row.agentView.chars} chars of description`);
    if (row.visual) {
      console.log(row.visual.status === "created"
        ? `   ↳ baseline: CREATED for ${PLATFORM} — nothing was compared. commit it to turn visual regression on here.`
        : `   ↳ baseline: ${row.visual.status} — ${row.visual.message ?? row.visual.path}`);
    }
    if (row.exercised) console.log(`   ↳ ${JSON.stringify(row.exercised)}`);
    console.log();
  }
} finally {
  await browser?.close();
  server.stop();
}

const report = {
  at: new Date().toISOString(),
  mode: LIVE ? "live" : "fixtures",
  pass: results.every((r) => !r.failures.length),
  pages: results,
};
writeFileSync(join(SHOTS, "report.json"), JSON.stringify(report, null, 2));

const failed = results.filter((r) => r.failures.length);
console.log(failed.length
  ? `❌ ${failed.length}/${results.length} page(s) failed — details in .smoke/report.json, screenshots in .smoke/`
  : `✅ all ${results.length} page(s) alive — screenshots + state in .smoke/`);
process.exit(failed.length ? 1 : 0);
