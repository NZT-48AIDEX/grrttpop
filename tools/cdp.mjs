/* ================================================================
   cdp — a browser driver in a hundred lines, with no dependencies.

   Node 22 ships fetch and WebSocket, and Chrome speaks a documented
   protocol over both, so the whole of "launch a browser, load a page,
   run some js, take a picture" needs nothing from npm. That matters
   here: this repo vendors its one runtime dependency and has no build
   step, and a test harness that rots because playwright moved on
   would defeat the point.

   Chrome renders WebGL headless through SwiftShader — slower than a
   gpu, but it genuinely rasterises the creature.
   ================================================================ */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

/* ---------------- finding a browser ---------------- */
/* prefer a puppeteer-cached Chrome for Testing (pinned, no profile of
   the user's to touch), then whatever the mac has installed. */
export function findChrome() {
  // an explicit path wins — ci images put chrome wherever they like
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  const cache = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(cache)) {
    const builds = readdirSync(cache).sort().reverse();
    for (const b of builds) {
      for (const sub of ["chrome-mac-arm64", "chrome-mac-x64", "chrome-linux64"]) {
        for (const bin of [
          join(cache, b, sub, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
          join(cache, b, sub, "chrome"),
        ]) if (existsSync(bin)) return bin;
      }
    }
  }
  for (const p of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ]) if (existsSync(p)) return p;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms, label) {
  const t = Date.now();
  for (;;) {
    try { return await fn(); }
    catch (e) { if (Date.now() - t > ms) throw new Error(`${label}: ${e.message}`); await sleep(120); }
  }
}

/* ---------------- the browser ---------------- */
export async function launch({ headless = true, port = 9222 + (process.pid % 900), width = 1280, height = 800 } = {}) {
  const bin = findChrome();
  if (!bin) throw new Error("no chrome found — install Google Chrome, or run: npx puppeteer browsers install chrome");

  const profile = join(tmpdir(), `grrtt-cdp-${process.pid}`);
  const proc = spawn(bin, [
    headless ? "--headless=new" : "",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--hide-scrollbars", "--mute-audio", "--disable-background-timer-throttling",
    // software webgl: no gpu in headless, but the shaders really do compile
    "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
    // ci containers usually can't use chrome's sandbox; the workflow opts in
    // explicitly rather than this weakening every local run by default
    ...(process.env.GRRTT_CHROME_FLAGS ?? "").split(/\s+/).filter(Boolean),
    "about:blank",
  ].filter(Boolean), { stdio: ["ignore", "pipe", "pipe"] });

  const chromeLog = [];
  proc.stderr.on("data", (d) => chromeLog.push(d.toString()));

  const version = await until(
    () => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()),
    20_000, "chrome never opened a debugging port");

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp socket failed")); });

  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method) listeners.forEach((fn) => fn(m));
  };
  const send = (method, params = {}, sessionId, timeout = 60_000) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out after ${timeout}ms`)); }, timeout);
    });

  return {
    version: version.Browser,
    chromeLog,
    async newPage() { return makePage(send, listeners, { width, height }); },
    async close() {
      try { ws.close(); } catch {}
      proc.kill();
      await sleep(150);
      if (!proc.killed) proc.kill("SIGKILL");
    },
  };
}

/* ---------------- a page ---------------- */
async function makePage(send, listeners, { width, height }) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p, timeout) => send(m, p, sessionId, timeout);

  await s("Page.enable");
  await s("Runtime.enable");
  await s("Log.enable");
  await s("Network.enable");
  // size the viewport here — Target.createTarget only accepts dimensions
  // when it is opening a whole new window
  await s("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });

  // the page's own console and crashes, captured for the report
  const console_ = [];
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.consoleAPICalled") {
      console_.push({ type: m.params.type, text: m.params.args.map(argText).join(" ") });
    } else if (m.method === "Runtime.exceptionThrown") {
      console_.push({ type: "exception", text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text });
    } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      console_.push({ type: "error", text: m.params.entry.text });
    }
  });

  return {
    console: console_,
    errors: () => console_.filter((c) => c.type === "error" || c.type === "exception"),

    async goto(url, { waitMs = 0 } = {}) {
      await s("Page.navigate", { url });
      await s("Page.loadEventFired").catch(() => {});
      if (waitMs) await sleep(waitMs);
    },

    /** run an expression in the page; top-level await works, result comes back by value */
    async eval(expression, { timeout } = {}) {
      const r = await s("Runtime.evaluate", {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true, returnByValue: true,
      }, timeout);
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      }
      return r.result?.value;
    },

    /** poll an expression until it is truthy, or give up */
    async waitFor(expression, { timeout = 20_000, label = expression } = {}) {
      const t = Date.now();
      for (;;) {
        const v = await this.eval(`return (${expression})`).catch(() => false);
        if (v) return v;
        if (Date.now() - t > timeout) throw new Error(`timed out waiting for ${label}`);
        await sleep(200);
      }
    },

    /** let the page paint n animation frames — the unit of progress in a fixed-step run */
    async frames(n = 60) {
      return this.eval(`
        let seen = 0;
        await new Promise((done) => {
          const tick = () => { if (++seen >= ${n}) return done(); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        });
        return seen;`);
    },

    /** pretend to be a slower machine (1 = normal, 20 = 20x slower).
        the only way to see adaptive quality actually engage. */
    async throttleCpu(rate = 1) {
      return s("Emulation.setCPUThrottlingRate", { rate });
    },

    /** emulate media features — prefers-reduced-motion, prefers-color-scheme.
        the query-param overrides are a convenience; this exercises the path a
        real visitor's system preference takes. */
    async emulateMedia(features = {}) {
      return s("Emulation.setEmulatedMedia", {
        features: Object.entries(features).map(([name, value]) => ({ name, value })),
      });
    },

    /** pause css animations/transitions — they run on the compositor's own
        clock and will smear a screenshot that is otherwise reproducible */
    async freezeCss() {
      return this.eval(`
        const id = "__harness-freeze";
        if (!document.getElementById(id)) {
          const el = document.createElement("style");
          el.id = id;
          // "paused" freezes an animation wherever it happens to be, which is
          // still a wall-clock-dependent position — "none" returns every
          // element to its base state, which is the same every run
          el.textContent = "*,*::before,*::after{animation:none!important;" +
            "transition:none!important;caret-color:transparent!important}";
          document.head.appendChild(el);
        }
        return true;`);
    },

    /** capture the viewport, or a {x,y,width,height} region of it */
    /** close this tab. a page left open keeps rendering: under software
        webgl a handful of abandoned scenes will starve the one you are
        actually measuring. */
    async close() {
      try { await send("Target.closeTarget", { targetId }); } catch {}
    },

    async screenshot(path, clip) {
      const { data } = await s("Page.captureScreenshot",
        clip ? { format: "png", clip: { ...clip, scale: 1 } } : { format: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, Buffer.from(data, "base64"));
      return path;
    },
  };
}

const argText = (a) => a.value ?? a.description ?? (a.preview ? JSON.stringify(a.preview.properties?.map((p) => p.value)) : a.type);
