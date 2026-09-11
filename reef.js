import "./lib/harness.js";   // must be first: patches rng/clock/fetch before anything reads them
import * as THREE from "three";
import diag from "./lib/diag.js";
import {
  fetchMarkets, fetchGlobal, fetchFearGreed, fetchTrending as fetchTrendingIds,
  demoData, hash, sortCoins, sizeFor as sizeForCoin, packPositions as packCircles,
  bagValue as sumBags, fmtPrice, fmtBig, pct, moodEmoji, describeReef,
  BAND_SPLIT as SPLIT, COINS as COIN_COUNT,
} from "./lib/market.js";
import { isAgentView, mountAgentView, reefToText } from "./lib/describe.js";

/* ================================================================
   the reef — dive the crypto market.
   A three-band ocean: blue chips in the shallows, majors in the
   mid waters, small caps in the deep. Creatures pulse on real
   Binance trade ticks; CoinGecko fills the fundamentals; your
   bags stay in localStorage; the soundscape follows the market's
   fear. Visualization only — no trading, no advice.
   ================================================================ */

const REFRESH_MS = 90_000;
const BAND_Z = [0, -55, -110];   // spacing must exceed max fit distance or the camera parks inside a band
const FOG_DENSITY = 0.014;

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
diag.install({ name: "reef", renderer });
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060e, FOG_DENSITY);   // applies to the dust
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
camera.position.set(0, 0, 26);
const lookTarget = new THREE.Vector3(0, 0, 0);

/* ---------------- creature shader ---------------- */
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
  uniform float uTime, uChange, uDim, uGlow, uTrend;
  varying vec3 vNormal, vView;
  varying float vDisp;
  void main() {
    vec3 up      = vec3(0.30, 1.00, 0.55);
    vec3 down    = vec3(1.00, 0.22, 0.50);
    vec3 neutral = vec3(0.45, 0.50, 0.95);
    vec3 base = uChange >= 0.0
      ? mix(neutral, up, smoothstep(0.0, 1.0, uChange))
      : mix(neutral, down, smoothstep(0.0, 1.0, -uChange));
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vView);
    float fresnel = pow(1.0 - abs(dot(N, V)), 2.2);
    vec3 col = mix(base * 0.18, base, fresnel * 1.5 + 0.22 + vDisp * 0.35);
    col += vec3(1.0) * uGlow * fresnel * 0.8;                         // hover / select rim
    col += vec3(1.0, 0.55, 0.12) * uTrend * fresnel                   // 🔥 trending halo
           * (0.45 + 0.35 * sin(uTime * 3.0));
    col *= uDim;
    float dist = length(vView);                                       // manual exp2 fog
    float f = 1.0 - exp(-pow(dist * ${FOG_DENSITY}, 2.0));
    col = mix(col, vec3(0.020, 0.024, 0.055), clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const sharedGeo = new THREE.IcosahedronGeometry(1, 5);

function makeCreature(seed) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 0.12 },
      uSpeed: { value: 0.5 },
      uSeed: { value: seed },
      uPulse: { value: 0 },
      uChange: { value: 0 },
      uDim: { value: 1 },
      uGlow: { value: 0 },
      uTrend: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  return new THREE.Mesh(sharedGeo, mat);
}

/* ---------------- plankton across the whole water column ---------------- */
const dustGeo = new THREE.BufferGeometry();
const DUST = 1100;
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 90;
  dustPos[i * 3 + 1] = (Math.random() - 0.5) * 60;
  dustPos[i * 3 + 2] = 20 - Math.random() * 100;
}
dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.09, color: 0x6a648a, transparent: true, opacity: 0.65,
}));
scene.add(dust);

/* ---------------- state ---------------- */
const blobs = new Map();   // id -> { mesh, coin, target, size, band, spring, springVel }
let coins = [];
let sortMode = "mcap";
let searchQ = "";
let selectedId = null;
let hoveredId = null;
let demoMode = false;
let lastDataAt = null;      // when coins last came back real
let lastTickAt = null;      // last binance trade that moved a price
let liveOn = false;         // websocket actually connected
let wsFailures = 0;         // reconnect churn — a socket that never sticks
let trending = new Set();
let focus = null;          // { id } while camera is visiting a creature
let bandFit = [16, 16, 16];
let bandTop = [6, 6, 6];
const watchlist = new Set(JSON.parse(localStorage.getItem("reef-watchlist") || "[]"));
let bags = JSON.parse(localStorage.getItem("reef-bags") || "[]");   // [{id, amt}]

const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------- data ---------------- */
/* fetching and modelling live in lib/market.js so node can run them too —
   an agent asking about the reef gets answers from this exact code. */
const fetchMarket = () => fetchMarkets({ perPage: COIN_COUNT });

let mood = 50;
let globalStats = null;
async function fetchGlobals() {
  try {
    globalStats = await fetchGlobal();
    document.getElementById("global-mcap").textContent =
      `market ${fmtBig(globalStats.totalMcap)} · ${globalStats.change24h >= 0 ? "+" : ""}${globalStats.change24h.toFixed(1)}% 24h`;
  } catch (err) { diag.track("globals", err?.message ?? err); }
  try {
    const f = await fetchFearGreed();
    mood = f.value;
    document.getElementById("fng").textContent = `${moodEmoji(mood)} ${f.value} · ${f.label}`;
    sound.setMood(mood);
  } catch (err) {
    diag.track("fng", err?.message ?? err);
    document.getElementById("fng").textContent = "🌊 mood unknown";
  }
}

async function fetchTrending() {
  try {
    trending = new Set(await fetchTrendingIds());
    for (const [id, b] of blobs) b.mesh.material.uniforms.uTrend.value = trending.has(id) ? 1 : 0;
  } catch (err) { diag.track("trending", err?.message ?? err); }
}

/* ---------------- formatting ---------------- */

/* ---------------- layout ---------------- */
/* layout, sorting and sizing come from lib/market.js; the page keeps the
   mutable state (what's sorted, what's watched, what's in the bags) and
   hands it in. */
const packPositions = packCircles;
const currentList = () => sortCoins(coins, { sort: sortMode, watchlist, bags });
const sizeFor = (c, lo, hi) => sizeForCoin(c, lo, hi, { sort: sortMode, bags });

function fitDist(boundR) {
  const vFov = (camera.fov * Math.PI) / 180 / 2;
  const hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  return THREE.MathUtils.clamp((boundR * 1.15) / Math.tan(Math.min(vFov, hFov)), 9, 42);
}

function rebuildReef() {
  const list = currentList();
  let lo, hi;
  if (sortMode === "bags") {
    const vals = list.map((c) => Math.sqrt((bags.find((b) => b.id === c.id)?.amt ?? 0) * (c.current_price ?? 0)));
    lo = Math.min(...vals, 0); hi = Math.max(...vals, 1);
  } else {
    const caps = list.map((c) => c.market_cap || 1);
    lo = Math.log(Math.min(...caps)); hi = Math.log(Math.max(...caps));
  }

  // slice the current ordering into depth bands
  const bands = [
    list.slice(0, SPLIT[0]),
    list.slice(SPLIT[0], SPLIT[0] + SPLIT[1]),
    list.slice(SPLIT[0] + SPLIT[1]),
  ];

  const keep = new Set(list.map((c) => c.id));
  for (const [id, b] of blobs) {
    b.mesh.visible = keep.has(id);
    if (!keep.has(id) && selectedId === id) closeCard();
  }

  bands.forEach((bandCoins, k) => {
    if (!bandCoins.length) { bandFit[k] = 12; bandTop[k] = 4; return; }
    const items = bandCoins.map((c) => ({ id: c.id, size: sizeFor(c, lo, hi) }));
    const pos = packPositions(items);
    let boundR = 1;
    items.forEach((it, i) => {
      const c = bandCoins[i];
      let b = blobs.get(it.id);
      if (!b) {
        const mesh = makeCreature(hash(it.id) % 100);
        mesh.position.set(pos[i].x, pos[i].y, BAND_Z[k] - 25);   // swim in from the deep
        scene.add(mesh);
        b = { mesh, target: new THREE.Vector3(), size: it.size, spring: 0, springVel: 0 };
        blobs.set(it.id, b);
      }
      b.coin = c;
      b.size = it.size;
      b.band = k;
      b.mesh.visible = true;
      b.target.set(pos[i].x, pos[i].y, BAND_Z[k] + Math.sin(hash(it.id)) * 2.0);
      const chg24 = c.price_change_percentage_24h_in_currency ?? 0;
      const u = b.mesh.material.uniforms;
      u.uChange.value = THREE.MathUtils.clamp(chg24 / 5, -1, 1);
      u.uAmp.value = THREE.MathUtils.clamp(0.06 + Math.abs(chg24) * 0.02, 0.06, 0.4);
      u.uSpeed.value = THREE.MathUtils.clamp(0.3 + Math.abs(c.price_change_percentage_1h_in_currency ?? 0) * 0.5, 0.3, 2.5);
      u.uTrend.value = trending.has(c.id) ? 1 : 0;
      boundR = Math.max(boundR, Math.hypot(pos[i].x, pos[i].y) + it.size);
    });
    bandFit[k] = fitDist(boundR);
    bandTop[k] = boundR * 0.78 + 1.8;
  });

  applySearchDim();
  updateBagUI();
}

function applySearchDim() {
  const q = searchQ.trim().toLowerCase();
  for (const [, b] of blobs) {
    const m = !q || b.coin.name.toLowerCase().includes(q) || b.coin.symbol.toLowerCase().includes(q);
    b.mesh.userData.dimTarget = m ? 1 : 0.12;
  }
}

/* ---------------- diving: wheel / touch / rail ---------------- */
let targetCamZ = BAND_Z[0] + 26;
let dove = false;
const camZBounds = () => [BAND_Z[2] + 8, BAND_Z[0] + 44];

function setDepthByBand(k) {
  targetCamZ = BAND_Z[k] + bandFit[k];
  focus = null;
}
addEventListener("wheel", (e) => {
  if (!document.getElementById("coin-card").hidden && e.target.closest(".coin-card")) return;
  targetCamZ = THREE.MathUtils.clamp(targetCamZ - e.deltaY * 0.06, ...camZBounds());
  focus = null;
  markDove();
}, { passive: true });

function markDove() {
  if (dove) return;
  dove = true;
  document.getElementById("dive-hint").style.opacity = "0";
}

document.querySelectorAll(".depth-rail button").forEach((b) =>
  b.addEventListener("click", () => { setDepthByBand(+b.dataset.band); markDove(); }));

function currentBand() {
  let best = 0, bd = 1e9;
  BAND_Z.forEach((z, k) => {
    const d = Math.abs(camera.position.z - (z + bandFit[k]));
    if (d < bd) { bd = d; best = k; }
  });
  return best;
}

/* ---------------- pointer: hover, tap vs drag ---------------- */
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2(0, 0);
const tooltip = document.getElementById("tooltip");
let pointerActive = false;
let drag = null;   // { y0, camZ0, moved }

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
      targetCamZ = THREE.MathUtils.clamp(drag.camZ0 + (e.clientY - drag.y0) * 0.16, ...camZBounds());
      focus = null;
      markDove();
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
  sound.blip();
  sound.pluck(1);
  selectedId = id;
  focus = { id };
  fillCard(b.coin);
});

function pickBlob() {
  if (!pointerActive) return null;
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects([...blobs.values()].filter((b) => b.mesh.visible).map((b) => b.mesh));
  if (!hits.length) return null;
  for (const [id, b] of blobs) if (b.mesh === hits[0].object) return id;
  return null;
}

/* ---------------- coin card ---------------- */
const card = document.getElementById("coin-card");
const $ = (id) => document.getElementById(id);

function fillCard(c) {
  if (!c) return;
  card.hidden = false;
  $("card-img").src = c.image || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
  $("card-name").textContent = (trending.has(c.id) ? "🔥 " : "") + c.name;
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
  $("conv-sym").textContent = c.symbol.toUpperCase();
  $("conv-coin").value = 1;
  $("conv-usd").value = c.current_price?.toFixed(2) ?? "";
  const w = $("card-watch");
  w.classList.toggle("on", watchlist.has(c.id));
  w.textContent = watchlist.has(c.id) ? "★" : "☆";
  drawSpark(c);
}

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
  ctx.strokeStyle = up ? "#6dff9e" : "#ff5e8a";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.lineTo(X(data.length - 1), cv.height);
  ctx.lineTo(X(0), cv.height);
  ctx.closePath();
  ctx.fillStyle = up ? "rgba(109,255,158,.12)" : "rgba(255,94,138,.12)";
  ctx.fill();
}

function closeCard() {
  card.hidden = true;
  selectedId = null;
  focus = null;
}
$("card-close").addEventListener("click", closeCard);

$("card-watch").addEventListener("click", () => {
  if (!selectedId) return;
  watchlist.has(selectedId) ? watchlist.delete(selectedId) : watchlist.add(selectedId);
  localStorage.setItem("reef-watchlist", JSON.stringify([...watchlist]));
  fillCard(coins.find((c) => c.id === selectedId));
  if (sortMode === "watched") rebuildReef();
});

$("conv-coin").addEventListener("input", () => {
  const c = coins.find((x) => x.id === selectedId);
  if (c?.current_price) $("conv-usd").value = (+$("conv-coin").value * c.current_price).toFixed(2);
});
$("conv-usd").addEventListener("input", () => {
  const c = coins.find((x) => x.id === selectedId);
  if (c?.current_price) $("conv-coin").value = (+$("conv-usd").value / c.current_price).toPrecision(6);
});

/* ---------------- sorts / search / keys ---------------- */
document.querySelectorAll(".sorts button").forEach((b) =>
  b.addEventListener("click", () => {
    sortMode = b.dataset.sort;
    document.querySelectorAll(".sorts button").forEach((x) => x.classList.toggle("active", x === b));
    if (sortMode === "bags" && !bags.length) openBags();
    rebuildReef();
    setDepthByBand(0);
  }));

const search = document.getElementById("search");
search.addEventListener("input", () => { searchQ = search.value; applySearchDim(); });
search.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = searchQ.trim().toLowerCase();
    const c = coins.find((x) => x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q));
    if (c && blobs.get(c.id)?.mesh.visible) {
      selectedId = c.id;
      focus = { id: c.id };
      fillCard(c);
      markDove();
    }
  }
});
addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing) { e.preventDefault(); search.focus(); }
  if (e.key === "Escape") { closeCard(); closeBags(); search.blur(); }
  if (!typing && ["1", "2", "3"].includes(e.key)) { setDepthByBand(+e.key - 1); markDove(); }
});

/* ---------------- my bags (local-only holdings tracker) ---------------- */
const bagsPanel = $("bags-panel");
function openBags() {
  bagsPanel.hidden = false;
  $("coin-list").innerHTML = coins
    .map((c) => `<option value="${c.symbol.toUpperCase()}">${c.name}</option>`).join("");
  renderBagList();
}
function closeBags() { bagsPanel.hidden = true; }
$("bags-close").addEventListener("click", closeBags);
$("bag-total").addEventListener("click", openBags);

$("bag-add-btn").addEventListener("click", () => {
  const q = $("bag-coin").value.trim().toLowerCase();
  const amt = parseFloat($("bag-amt").value);
  const c = coins.find((x) => x.symbol.toLowerCase() === q || x.name.toLowerCase() === q || x.id === q);
  if (!c || !(amt > 0)) return;
  const existing = bags.find((b) => b.id === c.id);
  existing ? (existing.amt = amt) : bags.push({ id: c.id, amt });
  saveBags();
  $("bag-coin").value = ""; $("bag-amt").value = "";
});

function saveBags() {
  localStorage.setItem("reef-bags", JSON.stringify(bags));
  renderBagList();
  updateBagUI();
  if (sortMode === "bags") rebuildReef();
}

const bagValue = () => sumBags(bags, coins);

function renderBagList() {
  const ul = $("bag-list");
  ul.innerHTML = "";
  for (const b of bags) {
    const c = coins.find((x) => x.id === b.id);
    if (!c) continue;
    const li = document.createElement("li");
    li.innerHTML = `<span>${b.amt} ${c.symbol.toUpperCase()}</span>` +
      `<span class="bag-val">${fmtBig(c.current_price * b.amt)}</span>`;
    const rm = document.createElement("button");
    rm.textContent = "×";
    rm.title = "remove";
    rm.addEventListener("click", () => { bags = bags.filter((x) => x.id !== b.id); saveBags(); });
    li.appendChild(rm);
    ul.appendChild(li);
  }
  $("bag-total-inline").textContent = fmtBig(bagValue());
}

function updateBagUI() {
  const pill = $("bag-total");
  pill.hidden = !bags.length;
  if (bags.length) pill.textContent = "🎒 " + fmtBig(bagValue());
}
setInterval(updateBagUI, 3000);   // live ticks move the total

/* ---------------- realtime: Binance trade ticks ---------------- */
let ws = null, wsKey = "";
const liveDot = $("live-dot");
const symbolMap = new Map();

function setLive(on) {
  liveOn = on;
  liveDot.textContent = (on ? "●" : "○") + " live";
  liveDot.classList.toggle("on", on);
}

function connectTicks() {
  if (demoMode || !coins.length) return;
  symbolMap.clear();
  for (const c of coins) if (!symbolMap.has(c.symbol)) symbolMap.set(c.symbol.toLowerCase(), c.id);
  const key = [...symbolMap.keys()].sort().join(",");
  if (key === wsKey && ws) return;   // same coin set, keep the socket
  wsKey = key;
  ws?.close();
  const streams = [...symbolMap.keys()].map((s) => s + "usdt@miniTicker").join("/");
  try { ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=" + streams); }
  catch (err) { wsFailures++; diag.track("ws", err?.message ?? "constructor threw"); setLive(false); return; }
  ws.onopen = () => setLive(true);
  ws.onclose = (e) => {
    if (!e.wasClean) { wsFailures++; diag.track("ws", `closed ${e.code}${e.reason ? " " + e.reason : ""}`, { streams: symbolMap.size }); }
    setLive(false); ws = null; setTimeout(connectTicks, 8000);
  };
  ws.onerror = () => { wsFailures++; diag.track("ws", "socket error (blocked, offline, or geo-restricted)"); ws?.close(); };
  ws.onmessage = (ev) => {
    try {
      const { data: d } = JSON.parse(ev.data);
      const id = symbolMap.get(d.s.replace(/USDT$/, "").toLowerCase());
      const c = coins.find((x) => x.id === id);
      if (!c) return;
      const old = c.current_price;
      const nu = +d.c;
      c.current_price = nu;
      const rel = old ? Math.abs(nu - old) / old : 0;
      lastTickAt = Date.now();
      if (rel > 0.00008) {
        const b = blobs.get(id);
        if (b?.mesh.visible) {
          b.springVel += Math.min(rel * 9000, 5);   // heartbeat on real movement
          sound.pluck(Math.min(rel * 4000, 1));
        }
        if (selectedId === id) $("card-price").textContent = fmtPrice(nu);
      }
    } catch (err) { diag.track("tick", err?.message ?? "malformed tick"); }
  };
}

/* ---------------- soundscape (opt-in) ---------------- */
const sound = {
  ctx: null, filter: null, master: null, on: false, lastPluck: 0,
  ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 250 + mood * 9;
    this.filter.connect(this.master);
    for (const [freq, type, g] of [[55, "sine", .05], [82.41, "triangle", .022], [110.0, "sine", .014]]) {
      const o = this.ctx.createOscillator(), og = this.ctx.createGain();
      o.type = type; o.frequency.value = freq; og.gain.value = g;
      o.connect(og).connect(this.filter);
      o.start();
    }
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 60;
    lfo.connect(lg).connect(this.filter.frequency);
    lfo.start();
  },
  toggle() {
    this.ensure();
    this.ctx.resume();
    this.on = !this.on;
    this.master.gain.linearRampToValueAtTime(this.on ? 0.6 : 0, this.ctx.currentTime + 1.2);
    const btn = $("sound-btn");
    btn.textContent = this.on ? "🔊" : "🔇";
    btn.classList.toggle("on", this.on);
  },
  setMood(v) {
    if (this.filter) this.filter.frequency.linearRampToValueAtTime(250 + v * 9, this.ctx.currentTime + 2);
  },
  pluck(strength = 1) {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPluck < 0.35) return;
    this.lastPluck = now;
    const notes = [220, 261.6, 293.7, 329.6, 392, 440];
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.value = notes[(Math.random() * notes.length) | 0] * (mood > 55 ? 2 : 1);
    g.gain.setValueAtTime(0.028 * strength, now);
    g.gain.exponentialRampToValueAtTime(0.0004, now + 0.6);
    o.connect(g).connect(this.master);
    o.start(); o.stop(now + 0.65);
  },
  blip() {
    try {
      this.ensure();
      this.ctx.resume();
      const now = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(500, now);
      o.frequency.exponentialRampToValueAtTime(150, now + 0.12);
      g.gain.setValueAtTime(0.09, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      g.connect(this.ctx.destination);   // audible even when ambience is off
      o.connect(g);
      o.start(); o.stop(now + 0.16);
    } catch { /* silence is fine */ }
  },
};
$("sound-btn").addEventListener("click", () => sound.toggle());

/* ---------------- refresh cycle ---------------- */
/* Failure ladder: live api → cached last-good payload (real data,
   Binance ticks keep prices fresh) → demo reef only if we've never
   seen real data. Fast retry until live again. */
let demoTimer = null;
let retryTimer = null;

function loadCache() {
  try {
    const j = JSON.parse(localStorage.getItem("reef-cache") || "null");
    return j?.coins?.length ? j : null;
  } catch { return null; }
}
const timeAgo = (t) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? m + "m ago" : Math.round(m / 60) + "h ago";
};

async function refresh(first = false) {
  try {
    coins = await fetchMarket();
    demoMode = false;
    lastDataAt = Date.now();
    localStorage.setItem("reef-cache", JSON.stringify({ t: Date.now(), coins }));
    note("");
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  } catch (err) {
    diag.track("market", err?.message ?? err, { demoMode });
    const cache = loadCache();
    if (cache && (demoMode || !coins.length)) {
      coins = cache.coins;
      demoMode = false;
      lastDataAt = cache.t;
      note(`🌊 market api busy — real data from ${timeAgo(cache.t)}, ticks still live · retrying…`);
    } else if (!coins.length) {
      coins = demoData();
      demoMode = true;
      note("🌊 can't reach market data (rate limit or adblocker?) — demo reef · retrying…");
      demoTimer ??= setInterval(() => {   // fake heartbeat so the demo still feels alive
        const vis = [...blobs.values()].filter((b) => b.mesh.visible);
        const b = vis[(Math.random() * vis.length) | 0];
        if (b) { b.springVel += 1.5 + Math.random() * 2; sound.pluck(0.6); }
      }, 1800);
    } else if (!demoMode) {
      note(`🌊 refresh failed — prices tick live, fundamentals may lag · retrying…`);
    }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(refresh, 20_000);
  }
  rebuildReef();
  if (coins.length) diag.ready({ page: "reef" });   // alive even if the tab is hidden and never paints
  if (selectedId) fillCard(coins.find((c) => c.id === selectedId));
  if (first) {   // stagger the extras so a fresh load never bursts the rate limit
    const spread = window.__harness?.fixtures ? 0 : 1;   // nothing to dodge when replaying
    setTimeout(fetchGlobals, 2500 * spread);
    setTimeout(fetchTrending, 5500 * spread);
  }
  connectTicks();
}
function note(msg) {
  const el = document.getElementById("reef-note");
  el.textContent = msg;
  el.hidden = !msg;
}
refresh(true);
setInterval(refresh, REFRESH_MS);
setInterval(fetchGlobals, 5 * 60_000);
setInterval(fetchTrending, 60 * 60_000);

/* ---------------- resize + animate ---------------- */
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (coins.length) rebuildReef();
}
addEventListener("resize", resize);
resize();

const bandLabelEls = document.querySelectorAll("#band-labels span");
const BAND_NAMES = ["the shallows · blue chips", "mid waters · majors", "the deep · small caps"];
const railBtns = document.querySelectorAll(".depth-rail button");
const proj = new THREE.Vector3();

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  diag.frame(rawDt);
  // frame-rate-independent smoothing for camera travel (works even at 1fps)
  const kCam = 1 - Math.exp(-3.2 * rawDt);
  const kLook = 1 - Math.exp(-5 * rawDt);

  /* hover */
  const hovId = pickBlob();
  if (hovId !== hoveredId) {
    hoveredId = hovId;
    canvas.style.cursor = hovId ? "pointer" : "default";
    if (hovId) {
      const c = blobs.get(hovId).coin;
      const chg = c.price_change_percentage_24h_in_currency ?? 0;
      tooltip.innerHTML = `${trending.has(c.id) ? "🔥 " : ""}<b>${c.name}</b> ` +
        `${fmtPrice(c.current_price)} <span class="${chg >= 0 ? "up" : "down"}">${pct(chg)}</span>`;
    }
    tooltip.hidden = !hovId;
  }

  /* creatures */
  for (const [id, b] of blobs) {
    if (!b.mesh.visible) continue;
    const u = b.mesh.material.uniforms;
    u.uTime.value = t;
    const bobY = Math.sin(t * 0.6 + u.uSeed.value) * 0.12;
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
    u.uDim.value = lerp(u.uDim.value, b.mesh.userData.dimTarget ?? 1, 0.08);
    b.mesh.rotation.y = t * 0.1 + u.uSeed.value;
  }

  /* camera: focused visit, or free dive */
  if (focus) {
    const b = blobs.get(focus.id);
    if (b?.mesh.visible) {
      const p = b.mesh.position;
      const dist = (b.size * 3.2 + 2.6) / Math.min(1, Math.max(0.5, camera.aspect));
      camera.position.x = lerp(camera.position.x, p.x, kCam);
      camera.position.y = lerp(camera.position.y, p.y + b.size * 0.4, kCam);
      camera.position.z = lerp(camera.position.z, p.z + dist, kCam);
      lookTarget.lerp(p, kLook);
      targetCamZ = p.z + dist;   // exit the visit right where we are
    } else focus = null;
  } else {
    camera.position.x = lerp(camera.position.x, mouseNDC.x * 1.4, kCam * 0.6);
    camera.position.y = lerp(camera.position.y, mouseNDC.y * 0.9, kCam * 0.6);
    camera.position.z = lerp(camera.position.z, targetCamZ, kCam);
    lookTarget.lerp(new THREE.Vector3(camera.position.x * 0.5, camera.position.y * 0.5, camera.position.z - 12), kLook);
  }
  camera.lookAt(lookTarget);
  dust.rotation.z = t * 0.004;

  /* depth rail + band labels */
  const active = currentBand();
  railBtns.forEach((btn, k) => btn.classList.toggle("active", k === active));
  bandLabelEls.forEach((el, k) => {
    proj.set(0, bandTop[k], BAND_Z[k]).project(camera);
    const behind = proj.z > 1 || proj.z < -1;
    const distFade = 1 - Math.min(Math.abs(camera.position.z - (BAND_Z[k] + bandFit[k])) / 45, 1);
    el.textContent = BAND_NAMES[k];
    el.style.opacity = behind ? "0" : (0.85 * distFade).toFixed(2);
    el.style.left = ((proj.x + 1) / 2) * innerWidth + "px";
    el.style.top = ((1 - proj.y) / 2) * innerHeight + "px";
  });

  renderer.render(scene, camera);
  if (coins.length) diag.ready({ page: "reef" });   // alive = painted, with data
});

/* hackable, like everything here */
window.reef = {
  blobs, get coins() { return coins; }, refresh, watchlist,
  get bags() { return bags; }, dive: setDepthByBand, sound,
  /* the reef in words, for anything without eyes */
  describe: () => describeReef(coins, { trending, mood, global: globalStats, sort: sortMode }),
  /* one structured snapshot, for anything without eyes */
  state: () => {
    const vis = [...blobs.values()].filter((b) => b.mesh.visible);
    return {
      ...diag.snapshot(),
      data: {
        source: demoMode ? "demo" : "coingecko",
        demoMode,
        coins: coins.length,
        ageMs: lastDataAt ? Date.now() - lastDataAt : null,
        mood,
        trending: trending.size,
      },
      ws: {
        connected: liveOn,
        readyState: ["connecting", "open", "closing", "closed"][ws?.readyState] ?? "none",
        sinceLastTickMs: lastTickAt ? Date.now() - lastTickAt : null,
        streams: symbolMap.size,
        failures: wsFailures,
      },
      reef: {
        blobs: blobs.size,
        visible: vis.length,
        band: currentBand(),
        sort: sortMode,
        search: searchQ || null,
        selected: selectedId,
        hovered: hoveredId,
        camZ: +camera.position.z.toFixed(2),
      },
      bags: { count: bags.length, valueUsd: +bagValue().toFixed(2) },
      sound: { on: sound.on },
      note: document.getElementById("reef-note")?.hidden === false
        ? document.getElementById("reef-note").textContent : null,
    };
  },
};
/* a visitor with no eyes gets the reef described instead of a black canvas */
if (isAgentView()) {
  mountAgentView({ render: () => reefToText(window.reef.describe(), { demoMode, live: liveOn }) });
}

console.log("%c🪸 the reef", "font-size:1.6rem;font-weight:900");
console.log("dive: scroll, or keys 1/2/3 · hack me: reef.dive(2), reef.coins, reef.sound.toggle()");
