
const D = __DATA__;
const P = D.P;
const CAM = GEAR.cameraBasis(P);
const { GEARS, IDLE, kmh, anglesOf, createModel, RAIL_TRAVEL } = MODEL;
const stage = document.querySelector(".gs-stage");
const svg = stage.querySelector("svg");
const $ = (sel) => svg.querySelector(sel);
const $$ = (sel) => [...svg.querySelectorAll(sel)];
const readout = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const buttons = [...document.querySelectorAll("[data-pick]")];
const steps = [...document.querySelectorAll("[data-step]")];
const still = matchMedia("(prefers-reduced-motion: reduce)");
const at = (p) => iso(p, P);
const S = (paths, style) => solidSvg(paths, style);
const fmt = (n) => Math.round(n).toLocaleString("en-US");

const model = createModel();

// Gears: one band per gear, redrawn from its angle every frame.
const gears = D.gears.map((g) => {
  const el = $(`[data-gear="${g.name}"]`);
  const paths = el.querySelectorAll(":scope > path");
  return {
    ...g,
    ring: GEAR.toothRing(g.teeth, D.module).ring,
    tip: GEAR.toothRing(g.teeth, D.module).rt,
    el,
    sil: paths[0],
    fill: paths[1],
    shades: [paths[2], paths[3], paths[4], paths[5]],
    top: paths[6],
    face: paths[7],
    edge: paths[8],
    spin: el.querySelector("[data-spin]"),
    last: null,
  };
});
const KS = CAM.k;
// Redraw a turning part only once its rim has moved a quarter pixel.
const moved = (last, angle, r) => last === null || Math.abs(angle - last) * r * KS > 0.25;
function drawGear(g, angle) {
  if (!moved(g.last, angle, g.tip)) return;
  g.last = angle;
  const b = GEAR.gearBand(g.ring, g.F, g.x[0], g.x[1], angle, CAM);
  g.sil.setAttribute("d", b.body);
  g.fill.setAttribute("d", b.body);
  for (let i = 0; i < 4; i++) g.shades[i].setAttribute("d", b.shades[i]);
  g.top.setAttribute("d", b.top);
  g.face.setAttribute("d", b.face);
  g.edge.setAttribute("d", b.face);
  g.spin.setAttribute("transform", GEAR.faceMatrix(g.F, g.sNear, angle, CAM));
}

// Dog rings and blocker rings: teeth as ribs, hidden under the sleeve as it slides over them.
const rings = D.rings.map((r) => {
  const el = $(`[data-ring="${r.name}"]`);
  return { ...r, count: r.teeth, el, body: el.querySelector("[data-body]"), teeth: el.querySelector("[data-teeth]"), span: `${r.x[0].toFixed(2)}|${r.x[1].toFixed(2)}`, turn: null };
});
function drawRing(r, angle, sleeveShift) {
  const sl = D.sleeves[r.sleeve];
  let [a, b] = r.x;
  if (r.side > 0) a = Math.max(a, sl.x + D.sleeve.w + sleeveShift);
  else b = Math.min(b, sl.x + sleeveShift);
  const visible = b - a > 0.05;
  const span = visible ? `${a.toFixed(2)}|${b.toFixed(2)}` : "none";

  if (span !== r.span) {
    r.span = span;
    r.turn = null;
    r.body.innerHTML = visible ? S(G.disc(a, b, r.r, D.FM, P), { tone: r.kind === "dog" ? "hi" : "mid" }) : "";
  }
  if (!visible) {
    if (r.teeth.firstChild) r.teeth.innerHTML = "";
    return;
  }
  if (!moved(r.turn, angle, r.r)) return;
  r.turn = angle;
  r.teeth.innerHTML = fadedSvg(G.ribsOf(D.FM, a, b, r.r, r.count, P, { fade: [0.1, 0.55], seams: true, phase: angle }), { tone: "lo" });
}

// Sliding parts: sleeves, forks, rails, lugs.
const railEls = [0, 1, 2].map((i) => $$(`[data-rail="${i}"], [data-sleeve="${i}"]`));
const railShift = [null, null, null];
function placeRail(i, p) {
  const dx = RAIL_TRAVEL * p;
  if (railShift[i] !== null && Math.abs(railShift[i] - dx) < 1e-3) return;
  railShift[i] = dx;
  const tr = translateAlong(P, [dx, 0, 0]);
  const v = axisVector(P, [dx, 0, 0]);
  for (const el of railEls[i]) {
    if (dx) el.setAttribute("transform", tr);
    else el.removeAttribute("transform");
    holdStill(el, dx ? v : [0, 0]);
  }
}

// The lever: rebuilt each frame from throw and lane.
const leverEls = { lower: $('[data-lever="lower"]'), ball: $('[data-lever="ball"]'), rod: $('[data-lever="rod"]'), top: $('[data-lever="top"]') };
let leverKey = "";
function drawLever(t, s) {
  const key = `${t.toFixed(4)}|${s.toFixed(4)}`;
  if (key === leverKey) return;
  leverKey = key;
  const L = GEO.leverAxis(t, s);
  const F = G.frameAlong(L.pivot, L.u);
  const len = D.lever.finger;
  const gateLen = (D.gateZ - 1.8 - D.lever.pivotZ) / L.u[2];
  leverEls.lower.innerHTML = S(G.disc(-len, -2, D.lever.shank, F, P, { steps: 16 }), { tone: "hi" }) + S(G.disc(-len - 0.01, -len + 2.2, D.lever.shank + 0.5, F, P, { steps: 16 }), { tone: "hi" });
  leverEls.ball.innerHTML = S(G.sphereOf(L.pivot, D.lever.ball, P, { steps: 32 }), { tone: "hi" });
  leverEls.rod.innerHTML = S(G.disc(2, gateLen, D.lever.rod, F, P, { steps: 16 }), { tone: "hi" });
  leverEls.top.innerHTML =
    S(G.disc(gateLen + 1.8, D.lever.knob - 3, D.lever.rod, F, P, { steps: 16 }), { tone: "hi" }) +
    S(G.disc(D.lever.knob - 9, D.lever.knob - 5.6, 2.8, F, P, { steps: 20 }), { tone: "mid" }) +
    S(G.sphereOf(L.at(D.lever.knob), D.lever.knobR, P, { steps: 40 }), { tone: "hi" });
}

// Clutch: the pedal pushes the bearing in; the diaphragm pulls the plate off the disc.
const clutch = { disc: $('[data-clutch="disc"]'), plate: $('[data-clutch="plate"]'), spring: $('[data-clutch="spring"]'), bearing: $('[data-clutch="bearing"]') };
const flyRibs = $('[data-ribs="flywheel"]');
const guideClip = $("[data-guide]");
const springBody = clutch.spring.querySelector("[data-body]"), springTeeth = clutch.spring.querySelector("[data-teeth]");
let clutchAt = 0, clutchTurn = null;
function drawClutch(c, engineAngle) {
  const C = D.clutch;
  if (Math.abs(c - clutchAt) > 1e-4) {
    clutchAt = c;
    const move = (el, dx) => (dx ? el.setAttribute("transform", translateAlong(P, [dx, 0, 0])) : el.removeAttribute("transform"));
    move(clutch.disc, 0.6 * c);
    move(clutch.plate, 1.2 * c);
    move(clutch.bearing, -2.4 * c);
    const ringAt = (s) => Array.from({ length: 40 }, (_, i) => at(G.pointOf(D.FM, s, 11.6, (i / 40) * Math.PI * 2)));
    guideClip.setAttribute("d", pathOf(G.hullOf([...ringAt(C.bearing[1] - 2.4 * c), ...ringAt(D.caseX0 + 1)]), true));
    springBody.innerHTML = S(G.solidOf([[C.spring[0] + 1.2 * c, 18.5], [C.spring[0] + 1.2 * c + 1, 18.5], [C.spring[1] - 2.4 * c, 8.2]], D.FM, P), { tone: "mid" });
    clutchTurn = null;
  }
  if (!moved(clutchTurn, engineAngle, 26)) return;
  clutchTurn = engineAngle;
  const rim = C.spring[0] + 1.2 * c + 1, tips = C.spring[1] - 2.4 * c;
  springTeeth.innerHTML = fadedSvg(G.ribsOf(D.FM, rim, tips, 18.5, 18, P, { r1: 8.2, phase: engineAngle, fade: [0.1, 0.5] }), { tone: "lo" });
  flyRibs.innerHTML = fadedSvg(G.ribsOf(D.FM, C.fly[0], C.fly[1], 26, 84, P, { fade: [0.1, 0.55], seams: true, phase: engineAngle }), { tone: "lo" });
}

const loadSpin = $("[data-load] [data-spin]");
const needles = Object.fromEntries(D.dials.map((d) => [d.name, $(`[data-needle="${d.name}"]`)]));
const dialState = Object.fromEntries(D.dials.map((d) => [d.name, { x: 0, v: 0 }]));
function needleAt(d, value) {
  const share = Math.max(0, Math.min(1.02, value / d.max));
  const a = -0.75 * Math.PI + share * 1.5 * Math.PI;
  const r = d.r - 4;
  return lineOnTop([d.x - Math.sin(a) * 3, d.y + Math.cos(a) * 3], [d.x + Math.sin(a) * r, d.y - Math.cos(a) * r], d.top + 0.2, P);
}

// What carries the power, and what to watch during a shift.
let litKey = "";
function markLit() {
  const s = model.s;
  const job = s.job;
  let names = [];
  let sleeve = -1;
  if (job && job.to !== "N" && ["reach", "sync", "engage", "clutchOut"].includes(job.step)) {
    const g = GEARS[job.to];
    names = [g.main];
    sleeve = g.rail;
  }
  if (!job || job.step === "clutchOut") {
    if (s.gear !== "N") {
      const g = GEARS[s.gear];
      names = s.gear === "4" || s.gear === 4 ? ["D"] : ["D", "LD", g.lay, g.main];
      if (s.gear === "R") names.push("ID");
      sleeve = g.rail;
    }
  }
  const key = names.join(",") + "|" + sleeve;
  if (key === litKey) return;
  litKey = key;
  for (const g of gears) g.el.toggleAttribute("data-lit", names.includes(g.name));
  $$("[data-sleeve] .iso-solid").forEach((el) => el.toggleAttribute("data-lit", el.closest("[data-sleeve]").dataset.sleeve === String(sleeve)));
}

const STEP_WORDS = { clutchIn: "clutch in", out: "out of gear", across: "across the gate", reach: "sleeve on the cone", sync: "syncing", engage: "dogs engage", clutchOut: "clutch out" };
const nameOf = (g) => (g === "N" ? "neutral" : GEARS[g].name);
const short = (g) => (g === "N" ? "N" : g === "R" ? "R" : GEARS[g].name);
function readoutText() {
  const s = model.s;
  const job = s.job;
  const speed = kmh(s.output);
  const road = `${Math.round(speed)} km/h${s.output < -1 ? " back" : ""}`;
  if (job && job.step !== "clutchOut") {
    const to = short(job.to);
    if (job.step === "sync" || job.step === "reach") return `syncing ${to} · input ${fmt(s.input)} rpm · ${road}`;
    if (job.step === "engage") return `${to} engaging · ${fmt(s.input)} rpm · ${road}`;
    return `${STEP_WORDS[job.step]} · ${fmt(s.engine)} rpm · ${road}`;
  }
  if (job && job.step === "clutchOut") return `clutch out · ${short(job.to)} · ${fmt(s.engine)} rpm · ${road}`;
  if (s.gear === "N") return `N · ${fmt(s.engine)} rpm · ${road}`;
  const g = GEARS[s.gear];
  return `${short(s.gear)} · ${Math.abs(g.ratio).toFixed(2)} : 1 · ${fmt(s.engine)} rpm · ${road}`;
}
let lastPhase = "";
function announce() {
  const s = model.s;
  const phase = s.job ? `${STEP_WORDS[s.job.step]}${s.job.to !== "N" ? ", " + nameOf(s.job.to) : ""}` : s.gear === "N" ? "neutral" : `in ${nameOf(s.gear)}`;
  if (phase !== lastPhase) {
    lastPhase = phase;
    if (document.activeElement === stage && status) status.textContent = phase;
    stage.setAttribute("aria-valuetext", s.gear === "N" ? "Neutral" : `In ${nameOf(s.gear)}`);
    const step = s.job ? (s.job.step === "reach" ? "sync" : s.job.step) : "";
    steps.forEach((el) => el.toggleAttribute("data-on", el.dataset.step === step));
  }
  buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pick === String(s.job ? s.job.to : s.gear))));
}

function draw() {
  const s = model.s;
  const angles = anglesOf(s.phi);
  for (const g of gears) drawGear(g, g.phase + angles[g.name]);
  const shifts = s.sleeves.map((p) => RAIL_TRAVEL * p);
  for (const r of rings) {
    const rail = r.sleeve;
    const shift = shifts[rail];
    const angle = r.kind === "dog" ? angles[r.gear] : angles.output;
    drawRing(r, angle, shift);
  }
  s.sleeves.forEach((p, i) => placeRail(i, p));
  const L = model.s;
  const rail = s.sleeves.findIndex((p) => p !== 0);
  drawLever(rail >= 0 ? s.sleeves[rail] : 0, s.lane);
  drawClutch(s.clutch, angles.engine);
  loadSpin.setAttribute("transform", GEAR.faceMatrix(D.FM, D.loadFace, angles.output, CAM));
  markLit();
  const text = readoutText();
  if (readout.textContent !== text) readout.textContent = text;
  announce();
}

function steerNeedles(dt, calm) {
  const s = model.s;
  const values = { engine: s.engine, output: Math.abs(s.output) };
  for (const d of D.dials) {
    const st = dialState[d.name];
    const target = values[d.name];
    if (calm) st.x = target;
    else {
      const w = 14;
      st.v += (w * w * (target - st.x) - 2 * w * st.v) * dt;
      st.x += st.v * dt;
    }
    needles[d.name].setAttribute("d", needleAt(d, st.x));
  }
}

let frame = 0, last = 0, visible = false, quietTimer = 0;
const speed = () => window.__driveSpeed ?? 1;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) * speed() : 1 / 60;
  last = now;
  const calm = still.matches;
  const sub = 4;
  for (let i = 0; i < sub; i++) model.step(dt / sub);
  draw();
  steerNeedles(dt, calm);
  frame = visible && !calm ? requestAnimationFrame(tick) : 0;
}
const run = () => {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
};
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);

function settleNow() {
  for (let i = 0; i < 4000 && model.s.job; i++) model.step(1 / 120);
  draw();
  steerNeedles(1, true);
}

function pick(to) {
  clearTimeout(quietTimer);
  model.select(to);
  if (still.matches) settleNow();
  quietTimer = setTimeout(() => {
    if (!still.matches) model.resumeTour();
    run();
  }, 9000);
  run();
}
const ORDER = ["R", "N", 1, 2, 3, 4, 5];
stage.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  let to = null;
  if (["1", "2", "3", "4", "5"].includes(key)) to = Number(key);
  if (key === "r") to = "R";
  if (key === "n" || key === "0") to = "N";
  const now = model.s.job ? model.s.job.to : model.s.gear;
  const here = ORDER.indexOf(now);
  if (key === "arrowup" || key === "arrowright") to = ORDER[Math.min(ORDER.length - 1, here + 1)];
  if (key === "arrowdown" || key === "arrowleft") to = ORDER[Math.max(0, here - 1)];
  if (to === null) return;
  event.preventDefault();
  pick(to);
});
buttons.forEach((b) => b.addEventListener("click", () => {
  const v = b.dataset.pick;
  pick(v === "R" || v === "N" ? v : Number(v));
}));

// Clicking near the knob's six gate positions picks that gear.
stage.addEventListener("click", (event) => {
  const box = svg.getBoundingClientRect();
  const x = ((event.clientX - box.left) / box.width) * D.view[0];
  const y = ((event.clientY - box.top) / box.height) * D.view[1];
  let best = null, dist = 26;
  for (const spot of D.spots) {
    const d = Math.hypot(spot.at[0] - x, spot.at[1] - y);
    if (d < dist) {
      dist = d;
      best = spot.gear;
    }
  }
  if (best !== null) pick(best);
});
stage.addEventListener("focus", () => status && (status.textContent = lastPhase));

if (still.matches) {
  model.s.tour.on = false;
}
draw();
steerNeedles(1, true);
