import { prefersReducedMotion } from "./lib/harness.js";   // must be first: patches rng/clock/fetch before anything reads them
import * as THREE from "three";
import diag from "./lib/diag.js";
import { makeQualityGovernor } from "./lib/quality.js";
import {
  makeRpc, fetchVitals as readVitals, fetchEcosystem, loadTokenList as loadJupList,
  peekWallet as readWallet, isSolAddress, hostOf,
  RPCS, SOL_MINT, TOKEN_PROGRAMS, ECO_COUNT, CG,
} from "./lib/solana.js";
import { describeTrench } from "./lib/solana.js";
import { isAgentView, mountAgentView, trenchToText } from "./lib/describe.js";

/* ================================================================
   the trench — solana, live.
   Two waters: the SPL ecosystem swimming at the surface, and any
   wallet's holdings as a school of fish in the deep. Network
   vitals stream from mainnet RPC; the current speed IS the TPS.
   Strictly read-only: no keys, no signatures, no transactions.
   ================================================================ */

const BAND_Z = [0, -70];
const FOG_DENSITY = 0.014;

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
diag.install({ name: "trench", renderer });
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070512, FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
camera.position.set(0, 0, 26);
const lookTarget = new THREE.Vector3(0, 0, 0);

/* ---------------- creature shader (solana palette) ---------------- */
const NOISE_GLSL = /* glsl */ `
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0*C.xxx;
    vec3 x2 = x0 - i2 + 2.0*C.xxx;
    vec3 x3 = x0 - 1. + 3.0*C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

const VERT = /* glsl */ `
  uniform float uTime, uAmp, uSpeed, uSeed, uPulse;
  varying vec3 vNormal, vView;
  varying float vDisp;
  ${NOISE_GLSL}
  void main() {
    vec3 p = position;
    float n = snoise(p * 1.8 + uSeed + uTime * uSpeed);
    float disp = n * uAmp + uPulse * (0.3 + 0.3 * n);
    p += normal * disp;
    vDisp = disp;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime, uChange, uDim, uGlow;
  varying vec3 vNormal, vView;
  varying float vDisp;
  void main() {
    vec3 up      = vec3(0.08, 0.95, 0.58);   // solana green
    vec3 down    = vec3(1.00, 0.22, 0.50);
    vec3 neutral = vec3(0.60, 0.27, 1.00);   // solana purple
    vec3 base = uChange >= 0.0
      ? mix(neutral, up, smoothstep(0.0, 1.0, uChange))
      : mix(neutral, down, smoothstep(0.0, 1.0, -uChange));
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vView);
    float fresnel = pow(1.0 - abs(dot(N, V)), 2.2);
    vec3 col = mix(base * 0.18, base, fresnel * 1.5 + 0.22 + vDisp * 0.35);
    col += vec3(1.0) * uGlow * fresnel * 0.8;
    col *= uDim;
    float dist = length(vView);
    float f = 1.0 - exp(-pow(dist * ${FOG_DENSITY}, 2.0));
    col = mix(col, vec3(0.028, 0.020, 0.070), clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* every creature shares one geometry, so stepping detail down is a single
   swap rather than N rebuilds. this page is heavier than the index — dozens
   of shader meshes, not one — and had no fallback at all for a device that
   can't keep up. */
const DETAIL = [2, 3, 5];
const RATIO = [1, Math.min(devicePixelRatio, 1.25), Math.min(devicePixelRatio, 1.75)];
let sharedGeo = new THREE.IcosahedronGeometry(1, DETAIL[2]);
let qualityTier = 2;

const quality = makeQualityGovernor({
  tiers: 3,
  onChange: (tier) => {
    qualityTier = tier;
    renderer.setPixelRatio(RATIO[tier]);
    const next = new THREE.IcosahedronGeometry(1, DETAIL[tier]);
    const old = sharedGeo;
    sharedGeo = next;
    for (const b of blobs.values()) b.mesh.geometry = next;
    old.dispose();
    diag.track("quality", `stepped down to tier ${tier} — frames were slow`, { detail: DETAIL[tier] });
  },
});
function makeCreature(seed) {
  return new THREE.Mesh(sharedGeo, new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uAmp: { value: 0.12 }, uSpeed: { value: 0.5 },
      uSeed: { value: seed }, uPulse: { value: 0 }, uChange: { value: 0 },
      uDim: { value: 1 }, uGlow: { value: 0 },
    },
    vertexShader: VERT, fragmentShader: FRAG,
  }));
}

/* ---------------- the current (dust speed = live TPS) ---------------- */
const DUST = 1200;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 100;
  dustPos[i * 3 + 1] = (Math.random() - 0.5) * 60;
  dustPos[i * 3 + 2] = 20 - Math.random() * 120;
}
dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.09, color: 0x7a5cc0, transparent: true, opacity: 0.6,
}));
scene.add(dust);
let currentSpeed = 0.3;   // scaled from live TPS

/* ---------------- state ---------------- */
const blobs = new Map();   // id -> { mesh, item, target, size, band, spring, springVel }
let ecoCoins = [];
let walletItems = [];      // [{ id, symbol, name, amount, usd, price, mint, image, share }]
let walletAddr = "";
let view = "eco";
let lastEcoAt = null;       // when the ecosystem list last came back real
let rpcOk = false;          // mainnet reachable on the last call
let lastRpcAt = null;
let vitals = { tps: null, epoch: null, epochPct: null };
let walletMeta = { addr: "", partial: false, gated: false, at: null };
let tokenListSize = null;   // how many verified mints jupiter gave us
/* the current here is driven by live tps, which is the point of the page —
   under reduced motion it keeps its colour and its reading, and stops moving */
const reducedMotion = prefersReducedMotion();
let selectedId = null;
let hoveredId = null;
let focus = null;
let bandFit = [16, 16];
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1e6, 7);
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (id) => document.getElementById(id);

/* ---------------- formatting ---------------- */
function fmtPrice(v) {
  if (v == null) return "—";
  if (v >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return "$" + v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}
function fmtBig(v) {
  if (v == null) return "—";
  for (const [s, m] of [["T", 1e12], ["B", 1e9], ["M", 1e6]])
    if (v >= m) return "$" + (v / m).toFixed(2) + s;
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
const fmtAmt = (v) => v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
  : v.toLocaleString("en-US", { maximumSignificantDigits: 5 });
const pct = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

/* ---------------- solana rpc with failover ----------------
   Free public endpoints serve cheap calls (getBalance, epoch, perf
   samples) but universally BLOCK getTokenAccountsByOwner — it's an
   indexed method every provider gates behind an api key. So the pool
   is: your own endpoint first (if you've set one), then the publics. */
let customRpc = localStorage.getItem("trench-rpc") || "";

/* failover, the blocked-vs-down distinction and the endpoint pool all live
   in lib/solana.js so node can use the same code. the page supplies the
   side effects: light the dot, record each refusal. */
let rpc = buildRpc();
function buildRpc() {
  return makeRpc({
    custom: customRpc,
    onEvent: (e) => {
      if (e.kind === "ok") setRpcDot(true);
      else diag.track("rpc", e.message, { method: e.method, host: e.host, blocked: e.blocked });
    },
  });
}
const endpoints = () => rpc.endpoints();


function setRpcDot(on) {
  rpcOk = on;
  if (on) lastRpcAt = Date.now();
  const el = $("rpc-dot");
  el.textContent = (on ? "●" : "○") + " mainnet";
  el.classList.toggle("on", on);
}

/* ---------------- network vitals ---------------- */
async function fetchVitals() {
  const v = await readVitals(rpc);          // shared: the reads and the maths
  for (const e of v.errors) diag.track("vitals", e.message, { call: e.call });
  vitals = { tps: v.tps, epoch: v.epoch, epochPct: v.epochPct };
  $("tps").textContent = v.tps == null ? "⚡ … tps" : `⚡ ${v.tps.toLocaleString()} tps`;
  if (v.tps != null) currentSpeed = 0.2 + Math.min(v.tps / 4000, 1.5);   // the current IS the tps
  if (v.epoch != null) $("epoch").textContent = `epoch ${v.epoch} · ${v.epochPct}%`;
}

/* ---------------- ecosystem data ---------------- */
const fetchEco = () => fetchEcosystem({ count: ECO_COUNT });

let retryTimer = null;
async function refreshEco(first = false) {
  try {
    ecoCoins = await fetchEco();
    lastEcoAt = Date.now();
    localStorage.setItem("trench-cache", JSON.stringify({ t: Date.now(), coins: ecoCoins }));
    note("");
  } catch (err) {
    diag.track("eco", err?.message ?? err);
    try {
      const c = JSON.parse(localStorage.getItem("trench-cache") || "null");
      if (c?.coins?.length && !ecoCoins.length) {
        ecoCoins = c.coins;
        lastEcoAt = c.t;
        note("🌊 market api busy — cached ecosystem · retrying…");
      } else if (!ecoCoins.length) {
        note("🌊 can't reach market data — retrying…");
      }
    } catch (err) { diag.track("cache", err?.message ?? err); }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(refreshEco, 20_000);
  }
  rebuild();
  if (ecoCoins.length) diag.ready({ page: "trench" });   // alive even if the tab is hidden and never paints
  if (first) fetchVitals();
}

/* ---------------- wallet peek (read-only) ---------------- */
/* the reads, the pricing fallbacks and the gated-endpoint handling all live
   in lib/solana.js. the page keeps the school, the camera and the note. */
async function peekWallet(addr) {
  note("🔭 reading wallet from mainnet…");
  const res = await readWallet(addr, {
    rpc,
    onEvent: (e) => diag.track(e.kind, e.message ?? "", { source: e.source }),
  });
  const { items, total, partial: accountsFailed, gated } = res;
  tokenListSize = res.tokenListSize;

  walletItems = items;
  walletAddr = addr;
  walletMeta = { addr, partial: accountsFailed, gated, at: Date.now() };
  if (accountsFailed) diag.track("wallet", gated ? "token accounts gated" : "token accounts unreachable", { addr });
  localStorage.setItem("trench-last-wallet", addr);
  // never pretend a partial read is the whole wallet
  note(!accountsFailed ? ""
    : gated ? "⚓ SOL balance only — free public RPCs block token-account reads. add your own endpoint below (free key from helius/quicknode) to see the whole school."
    : "🌊 rpc unreachable for token accounts — showing SOL only · try again shortly");
  rebuild();               // spawn the school before the camera dives to it
  renderWalletPanel(total);
  setView("wallet");
  $("rpc-row").hidden = !accountsFailed;   // surface the fix exactly when it's needed
}

function renderWalletPanel(total) {
  $("wallet-panel").hidden = false;
  $("wallet-sub").textContent = walletAddr.slice(0, 4) + "…" + walletAddr.slice(-4) +
    " · " + walletItems.length + " holdings shown";
  const ul = $("wallet-list");
  ul.innerHTML = "";
  for (const it of walletItems) {
    const li = document.createElement("li");
    const img = it.image ? `<img src="${it.image}" alt="" loading="lazy" onerror="this.remove()">` : "";
    li.innerHTML = `${img}<span>${fmtAmt(it.amount)} ${it.symbol}</span>` +
      `<span class="bag-val">${it.usd ? fmtBig(it.usd) : "—"}</span>`;
    ul.appendChild(li);
  }
  $("wallet-total").textContent = fmtBig(total);
}
$("wallet-close").addEventListener("click", () => ($("wallet-panel").hidden = true));

/* bring-your-own endpoint — stays in localStorage, never sent anywhere else */
$("rpc-input").value = customRpc;
$("rpc-save").addEventListener("click", () => {
  const v = $("rpc-input").value.trim();
  if (v && !/^https:\/\//i.test(v)) { note("🌊 rpc endpoint must start with https://"); return; }
  customRpc = v;
  rpc = buildRpc();          // a new endpoint means a fresh pool, yours first
  v ? localStorage.setItem("trench-rpc", v) : localStorage.removeItem("trench-rpc");
  note(v ? "⚓ endpoint saved — peeking again…" : "endpoint cleared");
  if (walletAddr) peekWallet(walletAddr).catch(() => note("🌊 that endpoint didn't work — check the url"));
});

$("wallet-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const addr = $("wallet-input").value.trim();
  if (!isSolAddress(addr)) { note("🌊 that doesn't look like a solana address"); return; }
  try { await peekWallet(addr); }
  catch { note("🌊 couldn't read that wallet (rpc busy?) — try again in a moment"); }
});
$("wallet-input").value = localStorage.getItem("trench-last-wallet") || "";

/* ---------------- layout ---------------- */
function packPositions(items) {
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

function fitDist(boundR) {
  const vFov = (camera.fov * Math.PI) / 180 / 2;
  const hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  return THREE.MathUtils.clamp((boundR * 1.15) / Math.tan(Math.min(vFov, hFov)), 9, 42);
}

function rebuild() {
  /* band 0: ecosystem */
  const caps = ecoCoins.map((c) => c.market_cap || 1);
  const lo = Math.log(Math.min(...caps, 1)), hi = Math.log(Math.max(...caps, 2));
  const ecoItems = ecoCoins.map((c) => ({
    id: c.id,
    size: 0.55 + 2.05 * (hi > lo ? (Math.log(c.market_cap || 1) - lo) / (hi - lo) : 0.5),
    coin: c,
  }));
  /* band 1: wallet school */
  const maxShare = Math.max(...walletItems.map((i) => Math.sqrt(i.share)), 0.01);
  const walletBand = walletItems.map((i) => ({
    id: i.id,
    size: 0.5 + 1.9 * (Math.sqrt(i.share) / maxShare),
    item: i,
  }));

  const keep = new Set([...ecoItems, ...walletBand].map((i) => i.id));
  for (const [id, b] of blobs) {
    b.mesh.visible = keep.has(id);
    if (!keep.has(id) && selectedId === id) closeCard();
  }

  [[ecoItems, 0], [walletBand, 1]].forEach(([items, band]) => {
    if (!items.length) { bandFit[band] = 12; return; }
    const pos = packPositions(items);
    let boundR = 1;
    items.forEach((it, i) => {
      let b = blobs.get(it.id);
      if (!b) {
        const mesh = makeCreature(hash(it.id) % 100);
        mesh.position.set(pos[i].x, pos[i].y, BAND_Z[band] - 25);
        scene.add(mesh);
        b = { mesh, target: new THREE.Vector3(), size: it.size, spring: 0, springVel: 0 };
        blobs.set(it.id, b);
      }
      b.coin = it.coin ?? null;
      b.item = it.item ?? null;
      b.size = it.size;
      b.band = band;
      b.mesh.visible = true;
      b.target.set(pos[i].x, pos[i].y, BAND_Z[band] + Math.sin(hash(it.id)) * 2.0);
      const u = b.mesh.material.uniforms;
      if (it.coin) {
        const chg = it.coin.price_change_percentage_24h_in_currency ?? 0;
        u.uChange.value = THREE.MathUtils.clamp(chg / 5, -1, 1);
        u.uAmp.value = THREE.MathUtils.clamp(0.06 + Math.abs(chg) * 0.02, 0.06, 0.4);
        u.uSpeed.value = THREE.MathUtils.clamp(0.3 + Math.abs(it.coin.price_change_percentage_1h_in_currency ?? 0) * 0.5, 0.3, 2.5);
      } else {
        u.uChange.value = THREE.MathUtils.clamp((it.item.chg ?? 0) / 5, -1, 1);
        u.uAmp.value = THREE.MathUtils.clamp(0.08 + Math.abs(it.item.chg ?? 0) * 0.02, 0.08, 0.4);
        u.uSpeed.value = 0.4;
      }
      boundR = Math.max(boundR, Math.hypot(pos[i].x, pos[i].y) + it.size);
    });
    bandFit[band] = fitDist(boundR);
  });
}

/* ---------------- view switching ---------------- */
let targetCamZ = BAND_Z[0] + 26;
function setView(v) {
  view = v;
  document.querySelectorAll(".sorts button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === v));
  const band = v === "wallet" ? 1 : 0;
  targetCamZ = BAND_Z[band] + bandFit[band];
  focus = null;
  if (v === "wallet" && !walletItems.length) note("🔭 paste an address below to see its school");
}
document.querySelectorAll(".sorts button").forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.view)));

addEventListener("wheel", (e) => {
  if (e.target.closest(".coin-card, .bags-panel")) return;
  targetCamZ = THREE.MathUtils.clamp(targetCamZ - e.deltaY * 0.06, BAND_Z[1] + 8, BAND_Z[0] + 44);
  focus = null;
}, { passive: true });

/* ---------------- pointer: hover, tap vs drag ---------------- */
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2(0, 0);
const tooltip = $("tooltip");
let pointerActive = false;
let drag = null;

function setNDC(e) {
  mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
}
addEventListener("pointermove", (e) => {
  pointerActive = true;
  setNDC(e);
  tooltip.style.left = e.clientX + "px";
  tooltip.style.top = e.clientY + "px";
  if (drag) {
    if (Math.abs(e.clientY - drag.y0) > 8) drag.moved = true;
    if (drag.moved && e.pointerType !== "mouse") {
      targetCamZ = THREE.MathUtils.clamp(drag.camZ0 + (e.clientY - drag.y0) * 0.16, BAND_Z[1] + 8, BAND_Z[0] + 44);
      focus = null;
    }
  }
});
canvas.addEventListener("pointerdown", (e) => {
  pointerActive = true;
  setNDC(e);
  drag = { y0: e.clientY, camZ0: targetCamZ, moved: false };
});
canvas.addEventListener("pointerup", (e) => {
  const wasDrag = drag?.moved;
  drag = null;
  if (wasDrag) return;
  setNDC(e);
  const id = pickBlob();
  if (!id) { closeCard(); return; }
  const b = blobs.get(id);
  b.springVel = 8;
  blip();
  selectedId = id;
  focus = { id };
  fillCard(b);
});

function pickBlob() {
  if (!pointerActive) return null;
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects([...blobs.values()].filter((b) => b.mesh.visible).map((b) => b.mesh));
  if (!hits.length) return null;
  for (const [id, b] of blobs) if (b.mesh === hits[0].object) return id;
  return null;
}

/* ---------------- card (eco coins + wallet tokens) ---------------- */
const card = $("coin-card");

function fillCard(b) {
  card.hidden = false;
  const eco = !!b.coin;
  $("card-changes").style.display = eco ? "" : "none";
  $("spark").style.display = eco ? "" : "none";
  $("eco-stats").hidden = !eco;
  $("wallet-stats").hidden = eco;

  if (eco) {
    const c = b.coin;
    $("card-img").src = c.image || "";
    $("card-name").textContent = c.name;
    $("card-symbol").textContent = c.symbol;
    $("card-price").textContent = fmtPrice(c.current_price);
    for (const [id, v] of [["chg-1h", c.price_change_percentage_1h_in_currency],
                           ["chg-24h", c.price_change_percentage_24h_in_currency],
                           ["chg-7d", c.price_change_percentage_7d_in_currency]]) {
      const el = $(id);
      el.textContent = id.replace("chg-", "") + " " + pct(v);
      el.className = v >= 0 ? "up" : "down";
    }
    $("card-rank").textContent = "#" + (c.market_cap_rank ?? "—");
    $("card-mcap").textContent = fmtBig(c.market_cap);
    $("card-vol").textContent = fmtBig(c.total_volume);
    drawSpark(c);
  } else {
    const it = b.item;
    $("card-img").src = it.image || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    $("card-name").textContent = it.name;
    $("card-symbol").textContent = it.symbol;
    $("card-price").textContent = it.usd ? fmtBig(it.usd) : fmtAmt(it.amount) + " " + it.symbol;
    $("w-amount").textContent = fmtAmt(it.amount) + " " + it.symbol;
    $("w-share").textContent = (it.share * 100).toFixed(1) + "%";
    $("w-mint").textContent = it.mint.slice(0, 6) + "…" + it.mint.slice(-4);
    $("w-mint").dataset.mint = it.mint;
  }
}
$("w-mint").addEventListener("click", (e) => {
  navigator.clipboard?.writeText(e.target.dataset.mint || "");
  note("mint copied");
  setTimeout(() => note(""), 1200);
});

function drawSpark(c) {
  const cv = $("spark"), ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  const data = c.sparkline_in_7d?.price;
  if (!data?.length) return;
  const min = Math.min(...data), max = Math.max(...data);
  const up = data[data.length - 1] >= data[0];
  const X = (i) => (i / (data.length - 1)) * (cv.width - 8) + 4;
  const Y = (v) => cv.height - 6 - ((v - min) / (max - min || 1)) * (cv.height - 12);
  ctx.beginPath();
  data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = up ? "#14f195" : "#ff5e8a";
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function closeCard() { card.hidden = true; selectedId = null; focus = null; }
$("card-close").addEventListener("click", closeCard);
addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeCard(); $("wallet-panel").hidden = true; }
});

/* ---------------- pop ---------------- */
let audioCtx;
function blip() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(500, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.12);
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.16);
  } catch { /* fine */ }
}

function note(msg) {
  const el = $("reef-note");
  el.textContent = msg;
  el.hidden = !msg;
}

/* ---------------- boot + loops ---------------- */
refreshEco(true);
setInterval(refreshEco, 120_000);
setInterval(fetchVitals, 12_000);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (ecoCoins.length || walletItems.length) rebuild();
}
addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  diag.frame(rawDt);
  quality.frame(rawDt);
  const kCam = 1 - Math.exp(-3.2 * rawDt);
  const kLook = 1 - Math.exp(-5 * rawDt);

  const hovId = pickBlob();
  if (hovId !== hoveredId) {
    hoveredId = hovId;
    canvas.style.cursor = hovId ? "pointer" : "default";
    if (hovId) {
      const b = blobs.get(hovId);
      tooltip.innerHTML = b.coin
        ? (() => { const chg = b.coin.price_change_percentage_24h_in_currency ?? 0;
            return `<b>${b.coin.name}</b> ${fmtPrice(b.coin.current_price)} <span class="${chg >= 0 ? "up" : "down"}">${pct(chg)}</span>`; })()
        : `<b>${b.item.symbol}</b> ${fmtAmt(b.item.amount)} · ${b.item.usd ? fmtBig(b.item.usd) : "unpriced"}`;
    }
    tooltip.hidden = !hovId;
  }

  for (const [id, b] of blobs) {
    if (!b.mesh.visible) continue;
    const u = b.mesh.material.uniforms;
    u.uTime.value = t;
    const bobY = reducedMotion ? 0 : Math.sin(t * 0.6 + u.uSeed.value) * 0.12;
    b.mesh.position.x = lerp(b.mesh.position.x, b.target.x, 0.04);
    b.mesh.position.y = lerp(b.mesh.position.y, b.target.y + bobY, 0.04);
    b.mesh.position.z = lerp(b.mesh.position.z, b.target.z, 0.04);
    b.springVel -= b.spring * 60 * dt;
    b.springVel *= Math.exp(-7 * dt);
    b.spring += b.springVel * dt;
    u.uPulse.value = b.spring;
    const hovBoost = id === hoveredId ? 1.12 : 1;
    b.mesh.scale.setScalar(lerp(b.mesh.scale.x, b.size * hovBoost, 0.12));
    u.uGlow.value = lerp(u.uGlow.value, id === selectedId ? 0.9 : id === hoveredId ? 0.45 : 0, 0.1);
    b.mesh.rotation.y = t * 0.1 + u.uSeed.value;
  }

  if (focus) {
    const b = blobs.get(focus.id);
    if (b?.mesh.visible) {
      const p = b.mesh.position;
      const dist = (b.size * 3.2 + 2.6) / Math.min(1, Math.max(0.5, camera.aspect));
      camera.position.x = lerp(camera.position.x, p.x, kCam);
      camera.position.y = lerp(camera.position.y, p.y + b.size * 0.4, kCam);
      camera.position.z = lerp(camera.position.z, p.z + dist, kCam);
      lookTarget.lerp(p, kLook);
      targetCamZ = p.z + dist;
    } else focus = null;
  } else {
    camera.position.x = lerp(camera.position.x, mouseNDC.x * 1.4, kCam * 0.6);
    camera.position.y = lerp(camera.position.y, mouseNDC.y * 0.9, kCam * 0.6);
    camera.position.z = lerp(camera.position.z, targetCamZ, kCam);
    lookTarget.lerp(new THREE.Vector3(camera.position.x * 0.5, camera.position.y * 0.5, camera.position.z - 12), kLook);
  }
  camera.lookAt(lookTarget);
  // the current IS the tps — under reduced motion the number still drives it,
  // it just crawls instead of streaming past
  dust.rotation.z += currentSpeed * (reducedMotion ? 0.0004 : 0.004) * (dt / 0.016);

  renderer.render(scene, camera);
  if (ecoCoins.length) diag.ready({ page: "trench" });   // alive = painted, with data
});

/* hackable, like everything here */
window.trench = {
  blobs, get eco() { return ecoCoins; }, get wallet() { return walletItems; },
  peekWallet, setView, rpc, fillCard,
  /* the trench in words, for anything without eyes */
  describe: () => describeTrench({
    vitals,
    eco: ecoCoins,
    wallet: walletItems.length
      ? { address: walletAddr, items: walletItems, total: walletItems.reduce((s, i) => s + i.usd, 0),
          partial: walletMeta.partial, gated: walletMeta.gated,
          reason: walletMeta.partial ? (walletMeta.gated
            ? "free public RPCs block token-account reads — add your own endpoint to see the whole wallet"
            : "rpc unreachable for token accounts — SOL balance only") : null }
      : null,
  }),
  /* one structured snapshot, for anything without eyes */
  state: () => ({
    ...diag.snapshot(),
    chain: {
      connected: rpcOk,
      sinceLastOkMs: lastRpcAt ? Date.now() - lastRpcAt : null,
      endpoint: rpc.state().endpoint,
      customRpc: rpc.state().custom,
      poolSize: rpc.state().poolSize,
      ...vitals,
    },
    eco: { coins: ecoCoins.length, ageMs: lastEcoAt ? Date.now() - lastEcoAt : null },
    wallet: {
      address: walletMeta.addr || null,
      holdings: walletItems.length,
      valueUsd: +walletItems.reduce((s, i) => s + i.usd, 0).toFixed(2),
      /* a partial read is never presented as the whole thing */
      partial: walletMeta.partial,
      gated: walletMeta.gated,
      ageMs: walletMeta.at ? Date.now() - walletMeta.at : null,
    },
    scene: {
      blobs: blobs.size,
      visible: [...blobs.values()].filter((b) => b.mesh.visible).length,
      view,
      selected: selectedId,
      hovered: hoveredId,
      currentSpeed: +currentSpeed.toFixed(3),
      camZ: +camera.position.z.toFixed(2),
    },
    tokenList: tokenListSize,
    quality: { tier: qualityTier, drops: quality.drops },
    reducedMotion,
    note: $("reef-note")?.hidden === false ? $("reef-note").textContent : null,
  }),
};
/* a visitor with no eyes gets the trench described instead of a black canvas */
if (isAgentView()) {
  mountAgentView({ render: () => trenchToText(window.trench.describe()) });
}

console.log("%c⚓ the trench", "font-size:1.6rem;font-weight:900;color:#9945ff");
console.log("solana, live. read-only, always. hack me: trench.rpc('getSlot'), trench.peekWallet(addr)");
