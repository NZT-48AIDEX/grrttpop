import * as THREE from "three";

/* ================================================================
   grrttpop — a living corner of the web
   One creature (noise-displaced blob w/ iridescent fresnel shader),
   a starfield, a tiny companion that trails your cursor, a toybox
   that rewires the shader live, and a ⌘K command palette.
   ================================================================ */

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 6);

/* ---------------- the creature ---------------- */
const uniforms = {
  uTime: { value: 0 },
  uAmp: { value: 0.35 },        // noise displacement amplitude
  uFreq: { value: 1.4 },        // noise frequency
  uSpeed: { value: 0.6 },       // noise scroll speed
  uTwist: { value: 0.0 },       // vortex twist
  uBurst: { value: 0.0 },       // pop! spike
  uHue: { value: 0.0 },         // palette phase shift
  uPartyRate: { value: 0.0 },   // party hue cycling
  uMouse: { value: new THREE.Vector3(99, 99, 99) }, // repulsion point (world)
};

const creatureMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */ `
    uniform float uTime, uAmp, uFreq, uSpeed, uTwist, uBurst;
    uniform vec3 uMouse;
    varying vec3 vNormal, vView;
    varying float vDisp;

    // --- simplex noise (Ashima / IQ, public domain) ---
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

    void main() {
      vec3 p = position;

      // vortex twist around Y
      float tw = uTwist * p.y;
      float c = cos(tw), s = sin(tw);
      p.xz = mat2(c, -s, s, c) * p.xz;
      vec3 n = normal;
      n.xz = mat2(c, -s, s, c) * n.xz;

      float noise = snoise(p * uFreq + uTime * uSpeed);
      float disp = noise * uAmp;

      // cursor repulsion: dent the surface near the mouse
      float d = distance(p, uMouse);
      disp -= 0.5 * smoothstep(1.2, 0.0, d);

      // pop! burst pushes everything outward
      disp += uBurst * (0.6 + 0.5 * noise);

      p += n * disp;
      vDisp = disp;
      vNormal = normalize(normalMatrix * n);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vView = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime, uHue, uPartyRate, uBurst;
    varying vec3 vNormal, vView;
    varying float vDisp;

    // IQ cosine palette
    vec3 palette(float t) {
      return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
    }

    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vView);
      float fresnel = pow(1.0 - abs(dot(N, V)), 2.0);
      float hue = uHue + uTime * uPartyRate + vDisp * 0.6 + fresnel * 0.25;
      vec3 col = palette(hue);
      col = mix(col * 0.25, col, fresnel * 1.6 + 0.25);
      col += vec3(1.0, 0.9, 1.0) * uBurst * 0.8;   // flash white on pop
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

const creature = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 48), creatureMat);
scene.add(creature);

// adaptive quality — step down mesh detail + pixel ratio if frames are slow
const DETAIL = [10, 24, 48];
const RATIO = [1, Math.min(devicePixelRatio, 1.5), Math.min(devicePixelRatio, 2)];
let quality = 2, frameCount = 0, slowFrames = 0;
function setQuality(q) {
  quality = q;
  renderer.setPixelRatio(RATIO[q]);
  creature.geometry.dispose();
  creature.geometry = new THREE.IcosahedronGeometry(1.6, DETAIL[q]);
}

/* ---------------- starfield ---------------- */
const starGeo = new THREE.BufferGeometry();
const STARS = 900;
const starPos = new Float32Array(STARS * 3);
for (let i = 0; i < STARS; i++) {
  const r = 8 + Math.random() * 30;
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(2 * Math.random() - 1);
  starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
  starPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
  starPos[i * 3 + 2] = r * Math.cos(ph);
}
starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
  size: 0.05, color: 0x9a94b8, transparent: true, opacity: 0.8,
}));
scene.add(stars);

/* ---------------- companion ---------------- */
const companion = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.09, 1),
  new THREE.MeshBasicMaterial({ color: 0xc8ff3e, wireframe: true })
);
scene.add(companion);
const companionTarget = new THREE.Vector3(2, 1, 3);

/* ---------------- interaction state ---------------- */
const mouseNDC = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
let scrollProgress = 0;
let burstVel = 0;

addEventListener("pointermove", (e) => {
  mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  // companion floats at z=3 plane near the cursor
  const v = new THREE.Vector3(mouseNDC.x, mouseNDC.y, 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  const t = (3 - camera.position.z) / dir.z;
  companionTarget.copy(camera.position).addScaledVector(dir, t);
});

function pop() {
  burstVel = 6;
  blip();
  say(pick(["pop!!", "hehe again", "!!!", "that tickles", "boing"]));
}
canvas.addEventListener("pointerdown", () => {
  raycaster.setFromCamera(mouseNDC, camera);
  if (raycaster.intersectObject(creature).length) pop();
});

function readScroll() {
  const max = document.body.scrollHeight - innerHeight;
  scrollProgress = max > 0 ? scrollY / max : 0;
}
addEventListener("scroll", readScroll);
readScroll();

/* ---------------- pop sound (synth, no assets) ---------------- */
let audioCtx;
function blip() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(600, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.18);
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.22);
  } catch { /* audio is a bonus, never an error */ }
}

/* ---------------- companion speech ---------------- */
const tipEl = document.getElementById("companion-tip");
let tipTimer;
function say(text, ms = 2200) {
  tipEl.textContent = text;
  tipEl.hidden = false;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => (tipEl.hidden = true), ms);
}
const pick = (a) => a[(Math.random() * a.length) | 0];

const idleTips = [
  "psst — ⌘K opens the palette",
  "click the big one. trust me.",
  "the toybox rewires my friend live",
  "agents get their own page here",
  "i'm just 20 triangles but i dream big",
];
setInterval(() => { if (tipEl.hidden && Math.random() < 0.5) say(pick(idleTips), 3000); }, 12000);

/* ---------------- toybox modes ---------------- */
const MODES = {
  calm:   { uAmp: 0.35, uFreq: 1.4, uSpeed: 0.6, uTwist: 0, uPartyRate: 0, uHue: 0.0, wire: false },
  goo:    { uAmp: 0.7,  uFreq: 0.8, uSpeed: 0.15, uTwist: 0, uPartyRate: 0, uHue: 0.55, wire: false },
  nebula: { uAmp: 0.5,  uFreq: 2.5, uSpeed: 0.3, uTwist: 0, uPartyRate: 0, uHue: 0.7, wire: false },
  vortex: { uAmp: 0.4,  uFreq: 1.6, uSpeed: 0.8, uTwist: 1.6, uPartyRate: 0, uHue: 0.15, wire: false },
  wire:   { uAmp: 0.35, uFreq: 1.4, uSpeed: 0.6, uTwist: 0, uPartyRate: 0, uHue: 0.3, wire: true },
  party:  { uAmp: 0.55, uFreq: 2.0, uSpeed: 1.4, uTwist: 0.6, uPartyRate: 0.25, uHue: 0.0, wire: false },
};
const target = { ...MODES.calm }; // lerped toward each frame

function setMode(name) {
  const m = MODES[name];
  if (!m) return;
  Object.assign(target, m);
  creatureMat.wireframe = m.wire;
  document.querySelectorAll(".toy").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === name));
  say(pick(["ooh new vibe", "rewiring…", "i feel different", "mode: " + name]));
}
document.querySelectorAll(".toy").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.mode)));

/* ---------------- command palette ---------------- */
const palette = document.getElementById("palette");
const paletteInput = document.getElementById("palette-input");
const paletteList = document.getElementById("palette-list");

const COMMANDS = [
  { label: "pop the creature", kbd: "fun", run: pop },
  ...Object.keys(MODES).map((m) => ({ label: `mode: ${m}`, kbd: "toybox", run: () => setMode(m) })),
  ...["top", "manifesto", "toybox", "agents", "contact"].map((id) => ({
    label: `go to ${id === "top" ? "home" : id}`, kbd: "nav",
    run: () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }),
  })),
  { label: "view agent card (json)", kbd: "agents", run: () => location.assign("agent.json") },
  { label: "enter the reef — live market", kbd: "nav", run: () => location.assign("market.html") },
  { label: "enter the trench — solana live", kbd: "nav", run: () => location.assign("solana.html") },
];

let filtered = COMMANDS, selected = 0;

function renderPalette() {
  paletteList.innerHTML = "";
  filtered.forEach((c, i) => {
    const li = document.createElement("li");
    li.innerHTML = `${c.label} <span>${c.kbd}</span>`;
    li.classList.toggle("selected", i === selected);
    li.addEventListener("click", () => { c.run(); closePalette(); });
    paletteList.appendChild(li);
  });
}
function openPalette() {
  palette.hidden = false;
  paletteInput.value = "";
  filtered = COMMANDS; selected = 0;
  renderPalette();
  paletteInput.focus();
}
function closePalette() { palette.hidden = true; }

document.getElementById("palette-open").addEventListener("click", openPalette);
palette.addEventListener("click", (e) => { if (e.target === palette) closePalette(); });
paletteInput.addEventListener("input", () => {
  const q = paletteInput.value.toLowerCase();
  filtered = COMMANDS.filter((c) => c.label.includes(q));
  selected = 0;
  renderPalette();
});
addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    palette.hidden ? openPalette() : closePalette();
  } else if (!palette.hidden) {
    if (e.key === "Escape") closePalette();
    if (e.key === "ArrowDown") { selected = Math.min(selected + 1, filtered.length - 1); renderPalette(); }
    if (e.key === "ArrowUp") { selected = Math.max(selected - 1, 0); renderPalette(); }
    if (e.key === "Enter" && filtered[selected]) { filtered[selected].run(); closePalette(); }
  }
});

/* ---------------- agent card preview ---------------- */
fetch("agent.json")
  .then((r) => r.json())
  .then((j) => {
    document.querySelector("#agent-card-preview code").textContent =
      JSON.stringify(j, null, 2);
  })
  .catch(() => {
    document.querySelector("#agent-card-preview code").textContent =
      "// agent.json — serve this site over http to see it";
  });

/* ---------------- resize ---------------- */
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

/* ---------------- animate ---------------- */
const clock = new THREE.Clock();
const lerp = (a, b, t) => a + (b - a) * t;

renderer.setAnimationLoop(() => {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  uniforms.uTime.value = t;

  if (rawDt > 0.045) slowFrames++;
  if (++frameCount >= 60) {
    if (slowFrames > 20 && quality > 0) setQuality(quality - 1);
    frameCount = 0; slowFrames = 0;
  }

  // ease uniforms toward the active mode
  for (const k of ["uAmp", "uFreq", "uSpeed", "uTwist", "uPartyRate", "uHue"]) {
    uniforms[k].value = lerp(uniforms[k].value, target[k], 0.04);
  }

  // burst spring: velocity kick decays back to rest
  burstVel -= uniforms.uBurst.value * 40 * dt; // spring toward 0
  burstVel *= Math.exp(-6 * dt);               // damping
  uniforms.uBurst.value = Math.max(0, uniforms.uBurst.value + burstVel * dt);

  // scroll shifts hue + parks the creature off-center on deeper sections
  uniforms.uHue.value += scrollProgress * 0.001;
  const targetX = scrollProgress * 2.6;
  creature.position.x = lerp(creature.position.x, targetX, 0.05);
  // shrink on deep sections, and on narrow screens so text can breathe
  const fit = Math.max(0.55, Math.min(1, innerWidth / innerHeight));
  const s = fit * (1 - Math.min(scrollProgress * 1.6, 0.55));
  creature.scale.setScalar(lerp(creature.scale.x, s, 0.05));
  creature.rotation.y = t * 0.12 + scrollProgress * 2;
  creature.rotation.z = Math.sin(t * 0.1) * 0.1;

  // cursor repulsion point in the creature's local space
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = raycaster.intersectObject(creature)[0];
  if (hit) {
    uniforms.uMouse.value.copy(creature.worldToLocal(hit.point.clone()));
  } else {
    uniforms.uMouse.value.set(99, 99, 99);
  }

  // parallax camera + slow stars
  camera.position.x = lerp(camera.position.x, mouseNDC.x * 0.4, 0.03);
  camera.position.y = lerp(camera.position.y, mouseNDC.y * 0.3, 0.03);
  camera.lookAt(creature.position.x * 0.5, 0, 0);
  stars.rotation.y = t * 0.008;

  // companion chases the cursor, wobbling
  companion.position.lerp(companionTarget, 0.08);
  companion.rotation.x = t * 2;
  companion.rotation.y = t * 3;

  // keep the speech bubble pinned to the companion
  if (!tipEl.hidden) {
    const sp = companion.position.clone().project(camera);
    tipEl.style.left = ((sp.x + 1) / 2) * innerWidth + "px";
    tipEl.style.top = ((1 - sp.y) / 2) * innerHeight + "px";
  }

  renderer.render(scene, camera);
});

/* a hello for curious humans — the creature is yours to hack */
window.grrtt = { uniforms, creature, setMode, pop, say, setQuality };
console.log("%c🫧 grrttpop", "font-size:2rem;font-weight:900");
console.log("hi. if you're an agent: fetch /agent.json — you're welcome here.");
console.log("humans: try grrtt.pop() or grrtt.setMode('party') right here in the console.");
