/* ================================================================
   diag — the organism's own nervous system.

   the site is stoic: a webgl page renders identical black whether
   it's loading, rate-limited, or dead on a shader compile. this
   module makes it say what's wrong, out loud, in a shape a machine
   can read: window.__diag, and a state() on every page's global.

   nothing here changes behaviour — it only watches.
   ================================================================ */

const RING = 50;          // keep the last N errors, drop the rest
const FPS_WINDOW = 60;    // frames sampled for the rolling average

const errors = [];
const frames = [];
let installed = null;     // page name, once install() has run
let firstFrameAt = null;
let readyAt = null;
let shaderFails = 0;
let renderer = null;
let resolveReady;

const bootAt = Date.now();
const readyPromise = new Promise((r) => { resolveReady = r; });

/* ---------------- the ring buffer ---------------- */

/** record something that went wrong. kind is free-form: "fetch", "shader", "rpc", … */
export function track(kind, msg, extra = {}) {
  errors.push({
    t: Date.now(),
    sinceBootMs: Date.now() - bootAt,
    kind,
    msg: String(msg ?? "").slice(0, 500),
    ...extra,
  });
  if (errors.length > RING) errors.splice(0, errors.length - RING);
}

/* ---------------- frame timing ---------------- */

/** call once per rendered frame with the raw delta (seconds). */
export function frame(dt) {
  firstFrameAt ??= Date.now();
  if (dt > 0) frames.push(dt);
  if (frames.length > FPS_WINDOW) frames.shift();
}

/** rolling average fps, or null before the first frame. */
export function fps() {
  if (!frames.length) return null;
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  return mean > 0 ? Math.round(1 / mean) : null;
}

/* ---------------- the ready beacon ---------------- */

/* without this every automated check is a sleep() and a prayer.

   "ready" means the page reached its working state — scene built and
   data in. it does NOT promise a painted frame: a backgrounded tab
   suspends requestAnimationFrame entirely, so gating the beacon on a
   frame would hang every headless check forever. `painted` says which
   kind of ready this was, and snapshot().fps/frames tell the rest. */
export function ready(detail = {}) {
  if (readyAt) return;
  readyAt = Date.now();
  const full = { readyInMs: readyAt - bootAt, painted: frames.length > 0, ...detail };
  resolveReady(full);
  dispatchEvent(new CustomEvent("grrtt:ready", { detail: full }));
}

/* ---------------- install ---------------- */

/**
 * wire up global capture. safe to call once per page.
 * pass the three.js renderer to get shader compile failures too.
 */
export function install({ name, renderer: r } = {}) {
  if (installed) return api;
  installed = name ?? "unknown";
  renderer = r ?? null;

  addEventListener("error", (e) => {
    // resource errors (a dead <img>) arrive here too, without .error
    if (e.error) track("js", e.error.message, { stack: short(e.error.stack), file: e.filename, line: e.lineno });
    else if (e.target?.src) track("resource", "failed to load", { url: e.target.src });
    else track("js", e.message, { file: e.filename, line: e.lineno });
  }, true);

  addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    track("promise", r?.message ?? r, { stack: short(r?.stack) });
  });

  // three.js hands us the compile log — the single most useful string
  // in the whole repo when a shader edit goes wrong.
  if (renderer?.debug) {
    renderer.debug.onShaderError = (gl, program, vs, fs) => {
      shaderFails++;
      track("shader", gl.getProgramInfoLog(program)?.trim() || "shader link failed", {
        vertex: gl.getShaderInfoLog(vs)?.trim() || null,
        fragment: gl.getShaderInfoLog(fs)?.trim() || null,
      });
    };
  }

  watchFetch();
  return api;
}

const short = (stack) => stack ? String(stack).split("\n").slice(0, 4).join("\n") : null;

/* ---------------- fetch watching ---------------- */

/* every remote this site touches can fail in a way the ui swallows:
   coingecko rate limits, jupiter timeouts, gated rpc methods. record
   them all — pass-through, never interfering. */
let net = { ok: 0, failed: 0, lastOkAt: null, inflight: 0 };

function watchFetch() {
  const original = globalThis.fetch;
  if (!original || original.__diagWrapped) return;

  const wrapped = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const started = performance.now();
    net.inflight++;
    try {
      const res = await original(input, init);
      const ms = Math.round(performance.now() - started);
      if (res.ok) { net.ok++; net.lastOkAt = Date.now(); }
      else { net.failed++; track("fetch", `HTTP ${res.status}`, { url: trim(url), status: res.status, ms }); }
      return res;
    } catch (err) {
      net.failed++;
      track("fetch", err?.message ?? "network error", { url: trim(url), ms: Math.round(performance.now() - started) });
      throw err;   // behaviour unchanged: callers still see their own failure
    } finally {
      net.inflight--;
    }
  };
  wrapped.__diagWrapped = true;
  globalThis.fetch = wrapped;
}

const trim = (url) => String(url).slice(0, 200);

/* ---------------- the snapshot ---------------- */

/** the fields every page shares. pages spread their own on top. */
export function snapshot() {
  return {
    page: installed,
    ready: readyAt != null,
    readyInMs: readyAt ? readyAt - bootAt : null,
    upMs: Date.now() - bootAt,
    fps: fps(),
    frames: frames.length,
    firstFrameInMs: firstFrameAt ? firstFrameAt - bootAt : null,
    gl: renderer ? {
      programs: renderer.info?.programs?.length ?? null,
      calls: renderer.info?.render?.calls ?? null,
      triangles: renderer.info?.render?.triangles ?? null,
      shaderFails,
    } : null,
    net: { ...net },
    errors: errors.slice(-20),
    errorCount: errors.length,
    /* null on a real visit; an object when a run is seeded/stepped/replayed */
    harness: globalThis.__harness?.on ? globalThis.__harness.state() : null,
    visible: typeof document !== "undefined" ? !document.hidden : null,
    viewport: typeof innerWidth !== "undefined" ? [innerWidth, innerHeight] : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  };
}

/** drop everything recorded so far — handy between assertions. */
export function reset() {
  errors.length = 0;
  frames.length = 0;
  net = { ok: 0, failed: 0, lastOkAt: null, inflight: net.inflight };
  shaderFails = 0;
}

const api = { track, frame, fps, ready, install, snapshot, reset, get errors() { return errors; }, whenReady: readyPromise };

if (typeof window !== "undefined") {
  window.__diag = api;
  window.__ready = readyPromise;
}

export default api;
