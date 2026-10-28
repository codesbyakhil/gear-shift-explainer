import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../anatomy/kit/iso-kit.mjs";
import * as G from "../anatomy/kit/lathe.mjs";
import * as A from "../anatomy/kit/audit.mjs";
import { tubePieces, tubeSvg } from "../anatomy/kit/tube.mjs";
import { kitScript } from "../anatomy/scripts/inline-kit.mjs";
import { TEETH, GEARS, IDLE, VISUAL, FINAL_DRIVE, TYRE, anglesOf } from "./model.mjs";
import { toothRing, gearBand, faceMatrix, gearSvg, cameraBasis } from "./gears.mjs";
import * as W from "./geometry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 600;
const HEIGHT = 470;
const AZIMUTH = 64;
const ELEVATION = 30;

const { M, ZL, ZM, ZR, ZT, LID, ZP, XP, CASE, RAILS, RAIL_R, LUG, SLEEVE, DOG, BLOCKER, SHAFT, MAIN, LAY, IDLER, SLEEVES } = W;

const PLATE = { x: -126, y: -66, w: 344, d: 116, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;
const MOTOR = { x0: -112, x1: -66, r: 22 };
const FLY = { x0: 186, x1: 196, r: 30 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [XP + 18, -20, ZP + 56], [XP - 18, 20, ZP + 56], [MOTOR.x0 - 6, 0, ZM + MOTOR.r + 14]],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: AZIMUTH, elevation: ELEVATION },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const CAM = cameraBasis(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const Faded = (list, style) => k.fadedSvg(list, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], a[2] ?? 0], P) - k.depthOf([b[0], b[1], b[2] ?? 0], P));

const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece: "box", ...rest });
}

// Axis frames: x along the shafts, u = +y, v = +z (right-handed).
const XF = (y, z) => G.frameOf([0, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const FM = XF(0, ZM);
const FLAY = XF(0, ZL);
const FID = XF(IDLER.y, IDLER.z);

const signed = (poly) => poly.reduce((a, [x, y], i) => {
  const [x2, y2] = poly[(i + 1) % poly.length];
  return a + x * y2 - x2 * y;
}, 0);
const screenOriented = (pts) => (signed(pts) < 0 ? [...pts].reverse() : pts);
function runsOf(flags, want) {
  const count = flags.length;
  const runs = [];
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
  let run = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      if (!run) run = [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

// A prism of any (concave) polygon in F's (u, v) plane, extruded along F.a.
function prismPaths(F, poly, s0, s1) {
  const ring = signed(poly) > 0 ? poly : [...poly].reverse();
  const n = ring.length;
  const W3 = (s, [x, y]) => [F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y, F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y, F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y];
  const capNear = G.dot3(F.a, V) > 0;
  const [nearS, farS] = capNear ? [s1, s0] : [s0, s1];
  const near = ring.map((p) => at(W3(nearS, p)));
  const far = ring.map((p) => at(W3(farS, p)));
  const normals = ring.map(([x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % n];
    return G.unit3(G.add3(G.mul3(F.u, y1 - y0), G.mul3(F.v, -(x1 - x0))));
  });
  const facing = normals.map((m) => G.dot3(m, V) > 1e-9);
  const outline = [];
  const crease = [];
  for (const run of runsOf(facing, false)) outline.push(k.pathOf(run.map((i) => near[i])));
  for (const run of runsOf(facing, true)) {
    crease.push(k.pathOf(run.map((i) => near[i])));
    outline.push(k.pathOf(run.map((i) => far[i])));
  }
  for (let i = 0; i < n; i++) if (facing[(i + n - 1) % n] !== facing[i]) outline.push(k.pathOf([near[i], far[i]]));
  const parts = [k.pathOf(screenOriented(near), true), k.pathOf(screenOriented(far), true)];
  const buckets = [[], [], [], [], []];
  for (let i = 0; i < n; i++) {
    if (!facing[i]) continue;
    const quad = screenOriented([near[i], near[(i + 1) % n], far[(i + 1) % n], far[i]]);
    parts.push(k.pathOf(quad, true));
    buckets[G.toneOf(normals[i], P)].push(k.pathOf(quad, true));
  }
  const capTone = G.toneOf(capNear ? F.a : G.mul3(F.a, -1), P);
  buckets[capTone].push(k.pathOf(screenOriented(near), true));
  return { fill: parts.join(""), outline: outline.join(""), crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((b) => b.join("")) };
}

function prism(name, F, poly, s0, s1, style = {}, { extra = "", inner = "", bias = 0, ref, ...rest } = {}) {
  const shape = record(A.prism(F, poly, s0, s1, { name, ...(rest.meta ?? {}) }));
  delete rest.meta;
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const centre = G.add3(G.add3(G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), G.mul3(F.u, cx)), G.mul3(F.v, cy));
  return put(name, ref ?? centre, S(prismPaths(F, poly, s0, s1), { tone: "mid", ...style, inner }) + extra, [shape], { bias, ...rest });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.4, steps = 2, bevel = 0, extra = "", inner = "", bias = 0, ...rest } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name, ...(rest.meta ?? {}) }, steps));
  delete rest.meta;
  return put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, ...rest });
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, rims, bevel = 0, owner, ...rest } = {}) {
  const opts = { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}), ...(rims ? { rims } : {}) };
  const paths = G.solidOf(profile, F, P, opts);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner, ...(rest.meta ?? {}) }));
  delete rest.meta;
  return put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, ...rest });
}
function disc(name, F, s0, s1, r, style = {}, options = {}) {
  return turned(name, F, [[s0, r], [s1, r]], style, options);
}
function ball(name, c, r, style = {}, { bias = 0, extra = "", ...rest } = {}) {
  const shape = record(A.ball(c, r, { name }));
  return put(name, c, S(G.sphereOf(c, r, P, { steps: 32 }), { tone: "mid", ...style }) + extra, [shape], { bias, ...rest });
}
const seam = (F, s, r, tone = "faint") => Ln(G.arcOf(F, s, r, P), { tone });

// ---------------------------------------------------------------- bench
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 10);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
const STRIP = { x: PLATE.x + 16, y: PLATE.y + PLATE.d - 12, w: PLATE.w - 32, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
const ticks = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.8, 3.4], P);
back.push(Ln(ticks.minor, { tone: "lo" }), Ln(ticks.major, { tone: "mid" }));
back.push(Dots([at([STRIP.x + 2, STRIP.y + 3, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 3, 0.6])], { size: 0.45 }));
record(A.slab(STRIP, 0, 0.6, { name: "stand.strip", ground: true }, 3));
const LABEL = { x: 100, y: PLATE.y + PLATE.d - 34, w: 34, d: 14, r: 1.2 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
back.push(Ln([22, 15, 18].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 3.6 + i * 3.2], [LABEL.x + 4 + w, LABEL.y + 3.6 + i * 3.2], 0.8, P)).join(""), { tone: "lo", free: true }));
back.push(Dots([at([LABEL.x + LABEL.w - 2.6, LABEL.y + 2.4, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d - 2.4, 0.8])], { size: 0.45 }));
record(A.slab(LABEL, 0, 0.8, { name: "stand.label", ground: true }, 3));

// Cradles under the case: cast blocks with a saddle face and two bolts each.
for (const x of [6, 132]) {
  box("stand.cradle", [x, -46, 2.4], [x + 22, -2, CASE.z0], { tone: "mid" }, {
    r: 1.2, steps: 3, bevel: 0.5, meta: { ground: true },
    extra: Dots([at([x + 4, -6, CASE.z0]), at([x + 18, -6, CASE.z0])], { size: 0.5, tone: "hi" }),
    inner: Ln(k.sideSeam({ x, y: -46, w: 22, d: 44, r: 1.2 }, 4, P, 3), { tone: "faint" }),
  });
  box("stand.cradle.foot", [x - 3, -49, 0], [x + 25, 1, 2.4], { tone: "lo" }, { r: 1.4, steps: 3, meta: { ground: true }, extra: Dots([at([x - 1, -1, 2.4]), at([x + 23, -1, 2.4])], { size: 0.45 }) });
}

// ---------------------------------------------------------------- case (far half)
const caseShapes = [];
const XC = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const WALL = [[0, CASE.z0], [CASE.yFar, CASE.z0], [CASE.yFar, CASE.top], [0, CASE.top]];
prism("case.front", XC, WALL, CASE.x0, CASE.x0 + CASE.wall, { tone: "mid" });
prism("case.floor", XC, [[0, CASE.z0], [CASE.yFar, CASE.z0], [CASE.yFar, CASE.z0 + CASE.floor], [0, CASE.z0 + CASE.floor]], CASE.x0 + CASE.wall, CASE.x1 - CASE.wall, { tone: "lo" });
prism("case.side", XC, [[CASE.yIn, CASE.z0 + CASE.floor], [CASE.yFar, CASE.z0 + CASE.floor], [CASE.yFar, CASE.top], [CASE.yIn, CASE.top]], CASE.x0 + CASE.wall, CASE.x1 - CASE.wall, { tone: "mid" });
prism("case.rear", XC, WALL, CASE.x1 - CASE.wall, CASE.x1, { tone: "mid" });
// Rail bosses cast on the inside of both end walls.
const BOSS = { y0: -12, z0: ZR - 5.5, z1: ZR + 5.5, w: 6 };
box("case.boss", [CASE.x0 + CASE.wall, BOSS.y0, BOSS.z0], [CASE.x0 + CASE.wall + BOSS.w, 0, BOSS.z1], { tone: "mid" }, { r: 0.6 });
box("case.boss", [CASE.x1 - CASE.wall - BOSS.w, BOSS.y0, BOSS.z0], [CASE.x1 - CASE.wall, 0, BOSS.z1], { tone: "mid" }, { r: 0.6 });
const halfDisc = (r, zc, yc = 0, N = 20) => Array.from({ length: N + 1 }, (_, i) => {
  const a = -Math.PI / 2 + (Math.PI * i) / N;
  return [yc + r * Math.cos(a), zc + r * Math.sin(a)];
});
const LID_NOTCH = 7.5;
{
  const N = 16;
  const notch = Array.from({ length: N + 1 }, (_, i) => {
    const a = Math.PI - (Math.PI * i) / N;
    return [XP + LID_NOTCH * Math.cos(a), -LID_NOTCH * Math.sin(a)];
  });
  const poly = [[CASE.x0 - 2, CASE.yFar - 2], [CASE.x1 + 2, CASE.yFar - 2], [CASE.x1 + 2, 0], ...notch.reverse(), [CASE.x0 - 2, 0]];
  prism("case.lid", G.frameOf([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]), poly, CASE.top, CASE.top + LID, { tone: "mid" }, {
    extra: Dots([10, 40, 70, 130, 154].map((x) => at([x, CASE.yFar + 2, CASE.top + LID])), { size: 0.5, tone: "hi" }),
  });
}

// Cast ribs inside the far wall and outside the rear wall, a data plate,
// bolts round the bearing bores, a breather and a detent plug on the lid.
for (const x of [33.5, 83.5, 133.5]) box("case.rib", [x, CASE.yIn, CASE.z0 + CASE.floor], [x + 2.5, CASE.yIn + 3, CASE.top], { tone: "mid" }, { r: 0.4 });
for (const [y0, y1] of [[-37, -34.5], [-25, -22.5]]) box("case.rib.rear", [CASE.x1, y0, CASE.z0], [CASE.x1 + 2, y1, CASE.top], { tone: "mid" }, { r: 0.4 });
{
  const plate = { y0: -20, y1: -11, z0: ZM + 18, z1: ZM + 32 };
  const X0 = CASE.x1, X1 = CASE.x1 + 0.6;
  const rules = [[plate.z1 - 3.4, 6.4], [plate.z1 - 6.4, 4.6], [plate.z1 - 9.4, 5.6]].map(([z, w]) => path3([[X1, plate.y1 - 1.8, z], [X1, plate.y1 - 1.8 - w, z]])).join("");
  box("case.plate", [X0, plate.y0, plate.z0], [X1, plate.y1, plate.z1], { tone: "lo" }, {
    r: 0.2,
    extra: Ln(path3([[X1, plate.y0 + 0.9, plate.z0 + 0.9], [X1, plate.y1 - 0.9, plate.z0 + 0.9], [X1, plate.y1 - 0.9, plate.z1 - 0.9], [X1, plate.y0 + 0.9, plate.z1 - 0.9]], true), { tone: "faint" }) + Ln(rules, { tone: "lo", free: true }) + Dots([at([X1, plate.y0 + 1.8, plate.z0 + 1.8]), at([X1, plate.y0 + 1.8, plate.z1 - 1.8])], { size: 0.45 }),
  });
}
{
  const bolts = (x, zc, r) => [2, 3, 4, 5, 6].map((i) => at([x, r * Math.cos((i * Math.PI) / 4), zc + r * Math.sin((i * Math.PI) / 4)]));
  put("case.bolts", [CASE.x1, -6, ZM], Dots([...bolts(CASE.x1, ZM, 11.5), ...bolts(CASE.x1, ZL, 11)], { size: 0.55, tone: "hi" }), [record(A.box([CASE.x1, -12, ZL - 12], [CASE.x1 + 0.05, 0, ZM + 12], { name: "case.bolts" }))], { bias: 0.05 });
}
{
  const top = CASE.top + LID;
  turned("lid.breather", G.frameOf([40, -32, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]), [[top, 2.2], [top + 2.6, 2.2], [top + 2.6, 3.4], [top + 4.2, 3.4], [top + 4.2, 1.6], [top + 5.4, 1.6]], { tone: "mid" });
  turned("lid.detent", G.frameOf([6, -7, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]), [[top, 2.6], [top + 1.8, 2.6], [top + 1.8, 1.6], [top + 2.8, 1.6]], { tone: "mid" }, { steps: 6 });
}

// ---------------------------------------------------------------- shafts and bearings
// Bearing retainers sit on the inside faces of the end walls; where a shaft
// crosses a cut wall only its near half shows, in front of the cut face.
const RET = 3;
function bearing(name, F, s0, s1, rIn, rOut) {
  const face = G.dot3(F.a, V) > 0 ? s1 : s0;
  const shape = record(A.ring(F, s0, s1, rIn, rOut, { name }));
  put(name, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, rOut, F, P), { tone: "mid", inner: Ln(G.circleOf(F, face, rIn + 1.2, P) + G.circleOf(F, face, rOut - 1, P), { tone: "faint" }) }) + Dots(G.dotsOf(F, face, (rIn + rOut + 0.2) / 2, 12, P, { all: true }), { size: 0.55, tone: "hi" }), [shape]);
}
const WIN = CASE.x0 + CASE.wall, WOUT = CASE.x1 - CASE.wall;
bearing("brg.input", FM, WIN, WIN + RET, SHAFT.input, 10);
bearing("brg.lay.front", FLAY, WIN, WIN + RET, SHAFT.lay, 9);
bearing("brg.output", FM, WOUT - RET, WOUT, SHAFT.main, 10);
bearing("brg.lay.rear", FLAY, WOUT - RET, WOUT, SHAFT.lay, 9);
{
  const shape = record(A.ring(FM, CASE.x1, CASE.x1 + 1.6, SHAFT.main, 8, { name: "seal.output" }));
  put("seal.output", G.add3(FM.o, [CASE.x1 + 0.8, 0, 0]), S(G.disc(CASE.x1, CASE.x1 + 1.6, 8, FM, P), { tone: "mid", inner: Ln(G.circleOf(FM, CASE.x1 + 1.6, 6.4, P), { tone: "faint" }) }), [shape]);
}
disc("cap.lay", FLAY, CASE.x1, CASE.x1 + 1.6, 8.5, { tone: "mid" }, { extra: Dots(G.dotsOf(FLAY, CASE.x1 + 1.6, 6.6, 4, P, { all: true, phase: 0.6 }), { size: 0.5, tone: "hi" }) });
function halfShaft(name, zc, r, s0, s1, owner) {
  prism(name, XC, halfDisc(r, zc), s0, s1, { tone: "hi" }, { meta: { owner } });
}
halfShaft("shaft.input.wall", ZM, SHAFT.input, CASE.x0, WIN, "shaft.input");
halfShaft("shaft.lay.wall", ZL, SHAFT.lay, CASE.x0, WIN, "shaft.lay");
halfShaft("shaft.main.wall", ZM, SHAFT.main, WOUT, CASE.x1, "shaft.main");
halfShaft("shaft.lay.wall", ZL, SHAFT.lay, WOUT, CASE.x1, "shaft.lay");
// The hidden lengths of each shaft, for the support check.
record(A.solid(FM, [[-52, 4], [-36, 4], [-36, SHAFT.input], [CASE.x0, SHAFT.input]], { name: "shaft.input.core", owner: "shaft.input" }));
record(A.disc(FM, WIN, 14, SHAFT.input, { name: "shaft.input.core", owner: "shaft.input" }));
record(A.disc(FM, 14, WOUT, SHAFT.main, { name: "shaft.main.core", owner: "shaft.main" }));
record(A.disc(FM, CASE.x1, CASE.x1 + 4, SHAFT.main, { name: "shaft.main.core", owner: "shaft.main" }));
record(A.disc(FLAY, WIN, WOUT, SHAFT.lay, { name: "shaft.lay.core", owner: "shaft.lay" }));

// Shaft pieces show only between the parts they carry.
const mainGaps = [[49, 53], [99, 103], [149, WOUT - RET]];
for (const [a, b] of mainGaps) disc("shaft.main", FM, a, b, SHAFT.main, { tone: "hi" }, { meta: { owner: "shaft.main" } });
const layGaps = [[14, 38], [49, 53], [64, 88], [99, 103], [114, 138], [149, WOUT - RET]];
for (const [a, b] of layGaps) disc("shaft.lay", FLAY, a, b, SHAFT.lay, { tone: "hi" }, { meta: { owner: "shaft.lay" } });
disc("shaft.output", FM, CASE.x1 + 1.6, 168, SHAFT.main, { tone: "hi" }, { meta: { owner: "shaft.main" } });

// ---------------------------------------------------------------- gears
const GEAR_LIST = [];
function phaseToward(fromCentre, toCentre) {
  return Math.atan2(toCentre[1] - fromCentre[1], toCentre[0] - fromCentre[0]);
}
function meshPhase(a, b) {
  const thAB = phaseToward(a.centre, b.centre);
  const pitchA = (2 * Math.PI) / a.teeth;
  let delta = ((thAB - a.phase) % pitchA + pitchA) % pitchA;
  if (delta > pitchA / 2) delta -= pitchA;
  const rA = (a.teeth * M) / 2, rB = (b.teeth * M) / 2;
  return thAB + Math.PI - (-delta * rA) / rB + Math.PI / b.teeth;
}
function gearDetails(spec, rr) {
  const bore = spec.bore;
  const parts = [];
  const circle = (r, tone, extra = "") => `<circle class="iso-line" data-tone="${tone}" cx="0" cy="0" r="${f2(r)}"${extra}/>`;
  parts.push(circle(bore + 2.6, "lo"));
  if (rr - bore > 9) {
    parts.push(circle(rr - 2.2, "faint"));
    const holeR = (bore + 2.6 + rr - 2.2) / 2;
    const holes = rr > 20 ? 6 : 4;
    for (let i = 0; i < holes; i++) {
      const t = (i / holes) * Math.PI * 2;
      parts.push(`<circle class="gr-hole" cx="${f2(holeR * Math.cos(t))}" cy="${f2(holeR * Math.sin(t))}" r="${f2(Math.min(2.4, (rr - bore) * 0.14))}"/>`);
    }
  }
  parts.push(`<circle class="gr-mark" cx="${f2(rr - 1.1)}" cy="0" r="0.55"/>`);
  return parts.join("");
}
function addGear(spec) {
  const T = toothRing(spec.teeth, M);
  const F = spec.F;
  const angles = anglesOf({ engine: 0, input: 0, output: 0 });
  const phi = spec.phase + angles[spec.name];
  const band = gearBand(T.ring, F, spec.x[0], spec.x[1], phi, CAM);
  const towards = G.dot3(F.a, V) > 0;
  const sNear = towards ? spec.x[1] : spec.x[0];
  const svg = gearSvg(spec.name, band, faceMatrix(F, sNear, phi, CAM), gearDetails(spec, T.rr), { tone: "mid" });
  const shape = record(A.ring(F, spec.x[0], spec.x[1], spec.bore, T.rp, { name: `gear.${spec.name}` }));
  GEAR_LIST.push({ name: spec.name, teeth: spec.teeth, F, x: spec.x, phase: spec.phase, sNear, bore: spec.bore });
  put(`gear.${spec.name}`, G.add3(F.o, G.mul3(F.a, (spec.x[0] + spec.x[1]) / 2)), svg, [shape]);
}
const centreOf = (F) => [G.dot3(F.o, [0, 1, 0]), G.dot3(F.o, [0, 0, 1])];
const phases = {};
for (const g of LAY) phases[g.name] = Math.PI / 2;
phases.LR = phaseToward(centreOf(FLAY), [IDLER.y, IDLER.z]);
for (const g of MAIN) if (g.partner) phases[g.name] = meshPhase({ centre: centreOf(FLAY), teeth: TEETH[g.partner], phase: phases[g.partner] }, { centre: centreOf(FM), teeth: g.teeth });
phases.ID = meshPhase({ centre: centreOf(FLAY), teeth: TEETH.LR, phase: phases.LR }, { centre: [IDLER.y, IDLER.z], teeth: TEETH.ID });
phases.MR = meshPhase({ centre: [IDLER.y, IDLER.z], teeth: TEETH.ID, phase: phases.ID }, { centre: centreOf(FM), teeth: TEETH.MR });
for (const g of LAY) addGear({ ...g, F: FLAY, phase: phases[g.name], bore: SHAFT.lay });
for (const g of MAIN) addGear({ ...g, F: FM, phase: phases[g.name], bore: g.shaft === "input" ? SHAFT.input : SHAFT.main });
addGear({ ...IDLER, F: FID, phase: phases.ID, bore: 3.2 });
disc("idler.shaft", FID, IDLER.x[1], 122, 3.2, { tone: "hi" }, { meta: { owner: "idler" } });
prism("idler.boss", XC, [[IDLER.y + 3.4, IDLER.z - 5], [CASE.yIn, IDLER.z - 8], [CASE.yIn, IDLER.z + 8], [IDLER.y + 3.4, IDLER.z + 5]], 122, 128, { tone: "mid" }, { meta: { owner: "idler" }, extra: Dots([at([128, IDLER.y - 6, IDLER.z])], { size: 0.5, tone: "hi" }) });

// ---------------------------------------------------------------- synchro rings and sleeves
const RING_LIST = [];
for (const sl of SLEEVES) {
  for (const ring of W.ringsOf(sl)) {
    const spec = ring.kind === "dog" ? DOG : BLOCKER;
    const name = `${ring.kind}.${sl.gears[ring.side]}`;
    const paths = G.disc(ring.x[0], ring.x[1], spec.r, FM, P);
    const ribs = G.ribsOf(FM, ring.x[0], ring.x[1], spec.r, spec.teeth, P, { fade: [0.1, 0.55], seams: true });
    const shape = record(A.ring(FM, ring.x[0], ring.x[1], SHAFT.main, spec.r, { name }));
    RING_LIST.push({ name, sleeve: SLEEVES.indexOf(sl), side: ring.side, kind: ring.kind, x: ring.x, r: spec.r, teeth: spec.teeth, gear: sl.gears[ring.side] });
    put(name, G.add3(FM.o, [(ring.x[0] + ring.x[1]) / 2, 0, 0]), `<g data-ring="${name}"><g data-body>${S(paths, { tone: ring.kind === "dog" ? "hi" : "mid" })}</g><g data-teeth>${Faded(ribs, { tone: "lo" })}</g></g>`, [shape]);
  }
}
const SLEEVE_PARTS = [];
SLEEVES.forEach((sl, index) => {
  const x0 = sl.x;
  const back = [[x0, SLEEVE.r - 1.1], [x0 + 0.9, SLEEVE.r], [x0 + SLEEVE.g0, SLEEVE.r]];
  const front = [[x0 + SLEEVE.g1, SLEEVE.r], [x0 + SLEEVE.w - 0.9, SLEEVE.r], [x0 + SLEEVE.w, SLEEVE.r - 1.1]];
  for (const [part, profile] of [["back", back], ["front", front]]) {
    const ring = [[profile[0][0], SHAFT.main], ...profile, [profile[profile.length - 1][0], SHAFT.main]];
    const shape = record(A.body(FM, ring, { name: `sleeve${index}.${part}` }));
    const item = put(`sleeve${index}.${part}`, G.add3(FM.o, [(profile[0][0] + profile[profile.length - 1][0]) / 2, 0, 0]), S(G.solidOf(profile, FM, P), { tone: "hi" }), [shape], { attrs: ` data-sleeve="${index}"` });
    SLEEVE_PARTS.push(item.name);
  }
  record(A.ring(FM, x0 + SLEEVE.g0, x0 + SLEEVE.g1, SHAFT.main, SLEEVE.groove, { name: `sleeve${index}.groove` }));
});

// ---------------------------------------------------------------- shift rails, forks and lugs
const RAIL_FROM = -6, RAIL_TO = 162;
const ringAt = (F, s, r) => Array.from({ length: 40 }, (_, i) => at(G.pointOf(F, s, r, (i / 40) * Math.PI * 2)));
const hullClip = (F, s0, s1, r) => k.pathOf(G.hullOf([...ringAt(F, s0, r), ...ringAt(F, s1, r)]), true);
let clipCount = 0;
const halfArc = (F, s, r) => Array.from({ length: 21 }, (_, i) => at(G.pointOf(F, s, r, -Math.PI / 2 + (Math.PI * i) / 20)));
function railPiece(index, x0, x1, { clips = [], shapes = [{ s0: x0, s1: x1 }] } = {}) {
  const rail = RAILS[index];
  const F = XF(rail.y, ZR);
  let svg = S(G.disc(x0, x1, RAIL_R, F, P), { tone: "hi" });
  if (clips.length) {
    const id = `gs-clip${clipCount++}`;
    const parts = clips.map((c) => (c.half ? k.pathOf(G.hullOf([...halfArc(F, c.s0, RAIL_R + 0.6), ...halfArc(F, c.s1, RAIL_R + 0.6)]), true) : hullClip(F, c.s0, c.s1, RAIL_R + 0.6)));
    svg = `<clipPath id="${id}">${parts.map((d) => `<path data-hold d="${d}"/>`).join("")}</clipPath><g clip-path="url(#${id})">${svg}</g>`;
  }
  const recorded = shapes.map((c) => record(c.half ? A.prism(XC, halfDisc(RAIL_R, ZR, rail.y), c.s0, c.s1, { name: `${rail.name}.rod`, owner: `rail${index}` }) : A.disc(F, c.s0, c.s1, RAIL_R, { name: `${rail.name}.rod`, owner: `rail${index}` })));
  const mid = (shapes[0].s0 + shapes[shapes.length - 1].s1) / 2;
  return put(`${rail.name}.rod`, G.add3(F.o, [mid, 0, 0]), svg, recorded, { attrs: ` data-rail="${index}"` });
}
function forkBoss(index) {
  const rail = RAILS[index];
  const F = XF(rail.y, ZR);
  const fx = rail.fork;
  const shape = record(A.ring(F, fx - 6, fx + 6, RAIL_R, 4.2, { name: `${rail.name}.boss`, owner: `fork${index}` }));
  put(`${rail.name}.boss`, [fx, rail.y, ZR], S(G.disc(fx - 6, fx + 6, 4.2, F, P), {
    tone: "mid",
    inner: Ln(G.arcOf(F, fx - 3, 4.2, P) + G.arcOf(F, fx + 3, 4.2, P), { tone: "faint" }),
  }) + Dots([at([fx, rail.y, ZR + 4.2])], { size: 0.6, tone: "hi" }), [shape], { attrs: ` data-rail="${index}"` });
}
function lug(index) {
  const rail = RAILS[index];
  const y0 = rail.y - LUG.width / 2, y1 = rail.y + LUG.width / 2;
  box(`${rail.name}.lug`, [XP - LUG.half, y0, ZR - 3.2], [XP + LUG.half, y1, ZR + 3], { tone: "mid" }, { r: 0.6, attrs: ` data-rail="${index}"`, meta: { owner: `rail${index}` }, extra: Dots([at([XP - 3.4, rail.y, ZR + 3]), at([XP + 3.4, rail.y, ZR + 3])], { size: 0.45 }) });
  for (const [a, b] of [[XP - LUG.half, XP - LUG.slot], [XP + LUG.slot, XP + LUG.half]]) {
    box(`${rail.name}.jaw`, [a, y0, ZR + 3], [b, y1, ZR + LUG.height], { tone: "mid" }, { r: 0.4, attrs: ` data-rail="${index}"` });
  }
}
function fork(index) {
  const rail = RAILS[index];
  const sl = SLEEVES.find((s) => s.rail === index);
  const g0 = sl.x + SLEEVE.g0 + 0.2, g1 = sl.x + SLEEVE.g1 - 0.2;
  const rin = SLEEVE.groove, rout = SLEEVE.r + 2.3;
  const arc = [];
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const t = (-34 + (248 * i) / N) * (Math.PI / 180);
    arc.push([rout * Math.cos(t), ZM + rout * Math.sin(t)]);
  }
  for (let i = N; i >= 0; i--) {
    const t = (-34 + (248 * i) / N) * (Math.PI / 180);
    arc.push([rin * Math.cos(t), ZM + rin * Math.sin(t)]);
  }
  prism(`${rail.name}.yoke`, XC, arc, g0, g1, { tone: "hi" }, { attrs: ` data-rail="${index}"`, meta: { owner: `fork${index}` } });
  const top = ZM + rout - 0.6;
  const arm = [[-3, top], [3, top], [rail.y + 2.6, ZR - 3.6], [rail.y - 2.6, ZR - 3.6]];
  prism(`${rail.name}.arm`, XC, arm, g0 - 0.6, g1 + 0.6, { tone: "hi" }, { attrs: ` data-rail="${index}"`, meta: { owner: `fork${index}` } });
}
const BIN = WIN + BOSS.w, BOUT = WOUT - BOSS.w;
const RAIL_PIECES = [
  [[RAIL_FROM, 70], [82, 95], [105, RAIL_TO]].map(([a, b]) => [a, b, {}]),
  [
    [RAIL_FROM, 20, { clips: [{ s0: BIN, s1: 60 }, { s0: -20, s1: BIN, half: true }], shapes: [{ s0: RAIL_FROM, s1: BIN, half: true }, { s0: BIN, s1: 20 }] }],
    [32, 95, {}],
    [105, RAIL_TO, { clips: [{ s0: 90, s1: BOUT }, { s0: BOUT, s1: 180, half: true }], shapes: [{ s0: 105, s1: BOUT }, { s0: BOUT, s1: RAIL_TO, half: true }] }],
  ],
  [
    [RAIL_FROM, 95, { clips: [{ s0: BIN, s1: 110 }], shapes: [{ s0: BIN, s1: 95 }] }],
    [105, 120, {}],
    [132, RAIL_TO, { clips: [{ s0: 120, s1: BOUT }], shapes: [{ s0: 132, s1: BOUT }] }],
  ],
];
RAILS.forEach((rail, index) => {
  for (const [a, b, options] of RAIL_PIECES[index]) railPiece(index, a, b, options);
  forkBoss(index);
  lug(index);
  fork(index);
});
{
  const F2 = XF(RAILS[2].y, ZR);
  put("seal.rail5r", [BIN, RAILS[2].y, ZR], Ln(G.circleOf(F2, BIN, RAIL_R + 0.5, P), { tone: "lo" }), [record(A.ring(F2, BIN - 0.2, BIN, RAIL_R, RAIL_R + 0.5, { name: "seal.rail5r" }))], { bias: 0.05 });
}

// ---------------------------------------------------------------- lever, turret and gate
const ZF = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const LIDTOP = CASE.top + LID;
const TURRET = { r: 9, top: ZP + 2.6 };
function halfRing(rOut, rIn, N = 24) {
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = Math.PI + (Math.PI * i) / N;
    out.push([rOut * Math.cos(t), rOut * Math.sin(t)]);
  }
  for (let i = N; i >= 0; i--) {
    const t = Math.PI + (Math.PI * i) / N;
    out.push([rIn * Math.cos(t), rIn * Math.sin(t)]);
  }
  return out;
}
{
  const F = ZF(XP, 0, 0);
  prism("turret.flange", F, halfRing(13, LID_NOTCH), LIDTOP, LIDTOP + 1.6, { tone: "mid" }, { extra: Dots([-11, 11].map((x) => at([XP + x, -2.6, LIDTOP + 1.6])), { size: 0.5, tone: "hi" }) });
  prism("turret.tube", F, halfRing(TURRET.r, LID_NOTCH), LIDTOP + 1.6, ZP - 4, { tone: "mid" });
  prism("turret.seat", F, halfRing(TURRET.r, 3.6), ZP - 4, ZP - 2.6, { tone: "mid" });
  prism("turret.cup", F, halfRing(TURRET.r, 4.8), ZP - 2.6, TURRET.top, { tone: "mid" }, { extra: Dots([[-6.9, -3.2], [6.9, -3.2]].map(([x, y]) => at([XP + x, y, TURRET.top])), { size: 0.5, tone: "hi" }) });
}
const GATE_Z = ZP + W.LEVER.gate;
const GATE = { x: XP - 22, y: -24, w: 44, d: 48, r: 3 };
for (const [x, y] of [[XP - 15, -19], [XP + 15, -19]]) {
  turned("gate.post", ZF(x, y, 0), [[LIDTOP, 2.6], [LIDTOP + 1.2, 2.6], [LIDTOP + 1.2, 1.7], [GATE_Z - 3, 1.7], [GATE_Z - 3, 2.4], [GATE_Z - 1.8, 2.4]], { tone: "mid" });
}
const gateSlot = (() => {
  const w = 2.1;
  const c = (t, s) => W.gateCrossing(t, s);
  const xa = (c(1, 0)[0] - XP);
  const yl = [c(0, 1)[1], 0, c(0, -1)[1]];
  const [y1, y0, y2] = yl;
  return [[-xa - w, y1 - w], [xa + w, y1 - w], [xa + w, y1 + w], [w, y1 + w], [w, y0 - w], [xa + w, y0 - w], [xa + w, y0 + w], [w, y0 + w], [w, y2 - w], [xa + w, y2 - w], [xa + w, y2 + w], [-xa - w, y2 + w], [-xa - w, y2 - w], [-w, y2 - w], [-w, y0 + w], [-xa - w, y0 + w], [-xa - w, y0 - w], [-w, y0 - w], [-w, y1 + w], [-xa - w, y1 + w]].map(([x, y]) => [XP + x, y]);
})();
box("gate.plate", [GATE.x, GATE.y, GATE_Z - 1.8], [GATE.x + GATE.w, GATE.y + GATE.d, GATE_Z], { tone: "mid" }, {
  r: GATE.r, steps: 4, bevel: 0.6,
  extra:
    `<path class="gs-void" d="${k.onTop(gateSlot, GATE_Z, P, true)}"/>` +
    Ln(k.onTop(gateSlot, GATE_Z, P, true), { tone: "lo" }) +
    Ln(k.planOutline(k.insetPlan(GATE, 2.4), GATE_Z, P, 4), { tone: "faint" }) +
    Dots(k.corners(GATE, 4).map(([x, y]) => at([x, y, GATE_Z])), { size: 0.5, tone: "hi" }),
});

const LEVER_R = { shank: 1.5, rod: 1.9, ball: 4.4, knob: 5.6 };
const RIM = { shank: Math.sqrt(LEVER_R.ball ** 2 - LEVER_R.shank ** 2), rod: Math.sqrt(LEVER_R.ball ** 2 - LEVER_R.rod ** 2) };
function leverPieces(t, s) {
  const L = W.leverAxis(t, s);
  const F = G.frameAlong(L.pivot, L.u);
  const len = W.LEVER.finger;
  const gateLen = (GATE_Z - 1.8 - ZP) / L.u[2];
  const knobAt = L.at(W.LEVER.knob);
  return {
    lower: { svg: S(G.disc(-len, -RIM.shank, LEVER_R.shank, F, P, { steps: 16 }), { tone: "hi" }) + S(G.disc(-len - 0.01, -len + 2.2, LEVER_R.shank + 0.5, F, P, { steps: 16 }), { tone: "hi" }), shape: () => A.disc(F, -len, -RIM.shank, LEVER_R.shank + 0.5, { name: "lever.lower", owner: "lever" }) },
    ball: { svg: S(G.sphereOf(L.pivot, LEVER_R.ball, P, { steps: 32 }), { tone: "hi" }), shape: () => A.ball(L.pivot, LEVER_R.ball, { name: "lever.ball", owner: "lever" }) },
    rod: { svg: S(G.disc(RIM.rod, gateLen, LEVER_R.rod, F, P, { steps: 16 }), { tone: "hi" }), shape: () => A.disc(F, RIM.rod, gateLen, LEVER_R.rod, { name: "lever.rod", owner: "lever" }) },
    top: { svg: S(G.disc(gateLen + 1.8, W.LEVER.knob - 3, LEVER_R.rod, F, P, { steps: 16 }), { tone: "hi" }) + S(G.disc(W.LEVER.knob - 9, W.LEVER.knob - 5.6, 2.8, F, P, { steps: 20 }), { tone: "mid" }) + S(G.sphereOf(knobAt, LEVER_R.knob, P, { steps: 40 }), { tone: "hi" }), shape: () => A.disc(F, gateLen + 1.8, W.LEVER.knob + 5.6, LEVER_R.knob, { name: "lever.top", owner: "lever" }) },
  };
}
{
  const pieces = leverPieces(0, 0);
  const L = W.leverAxis(0, 0);
  const refs = { lower: L.at(-10), ball: L.pivot, rod: L.at(14), top: L.at(40) };
  for (const key of ["lower", "ball", "rod", "top"]) put(`lever.${key}`, refs[key], pieces[key].svg, [record(pieces[key].shape())], { attrs: ` data-lever="${key}"` });
}

// ---------------------------------------------------------------- motor, clutch, load
const MZ = ZM;
const CL = { fly: [-58, -52], disc: [-52, -50], plate: [-50, -46], spring: [-46, -40], bearing: [-40, -36], guide: [-36, CASE.x0] };
const FMOT = XF(0, MZ);
// Motor stand: two legs and a top plate.
box("stand.motor.top", [MOTOR.x0 + 2, -20, MZ - MOTOR.r - 8], [MOTOR.x1 - 2, 20, MZ - MOTOR.r - 4], { tone: "mid" }, { r: 1.5, steps: 3, bevel: 0.5, meta: { ground: true } });
for (const x of [MOTOR.x0 + 4, MOTOR.x1 - 12]) {
  box("stand.motor.leg", [x, -16, 2.4], [x + 8, 16, MZ - MOTOR.r - 8], { tone: "mid" }, { r: 1, steps: 3, meta: { ground: true }, inner: Ln(k.sideSeam({ x, y: -16, w: 8, d: 32, r: 1 }, 30, P, 3), { tone: "faint" }) });
  box("stand.motor.foot", [x - 3, -19, 0], [x + 11, 19, 2.4], { tone: "lo" }, { r: 1.2, steps: 3, meta: { ground: true }, extra: Dots([at([x - 1, 16, 2.4]), at([x + 9, 16, 2.4])], { size: 0.45 }) });
}
box("stand.motor.brace", [MOTOR.x0 + 12, -3, 30], [MOTOR.x1 - 12, 3, 36], { tone: "lo" }, { meta: { ground: true } });
turned("motor.endbell.rear", FMOT, [[MOTOR.x0 - 7, 15], [MOTOR.x0 - 6, 18.5, 1], [MOTOR.x0 - 3, 20.5, 1], [MOTOR.x0, 21]], { tone: "mid" });
const motorBody = turned("motor.body", FMOT, [[MOTOR.x0, MOTOR.r], [MOTOR.x1, MOTOR.r]], { tone: "mid" }, {
  extra: Faded(G.ribsOf(FMOT, MOTOR.x0 + 3, MOTOR.x1 - 3, MOTOR.r, 36, P, { fade: [0.08, 0.5], seams: true }), { tone: "lo" }),
});
for (const x of [MOTOR.x0 + 8, MOTOR.x1 - 14]) box("motor.foot", [x, -15, MZ - MOTOR.r - 4], [x + 6, 15, MZ - MOTOR.r + 6], { tone: "mid" }, { meta: { seated: true, cut: [motorBody.shapes[0]] }, extra: Dots([at([x + 3, 12, MZ - MOTOR.r - 0.01]), at([x + 3, -12, MZ - MOTOR.r])], { size: 0.5, tone: "hi" }) });
turned("motor.endbell.front", FMOT, [[MOTOR.x1, 21], [MOTOR.x1 + 3, 20.5, 1], [MOTOR.x1 + 6, 17, 1], [MOTOR.x1 + 7, 12]], { tone: "mid" }, { extra: Dots(G.dotsOf(FMOT, MOTOR.x1 + 7, 9.5, 4, P, { all: true, phase: Math.PI / 4 }), { size: 0.5, tone: "hi" }) });
disc("motor.shaft", FMOT, MOTOR.x1 + 7, CL.fly[0], 3.6, { tone: "hi" });
box("motor.terminal", [MOTOR.x0 + 16, -4, MZ + Math.sqrt(MOTOR.r ** 2 - 16)], [MOTOR.x0 + 32, 4, MZ + MOTOR.r + 9], { tone: "mid" }, {
  r: 1, steps: 3, bevel: 0.4,
  extra: Ln(k.planOutline({ x: MOTOR.x0 + 17.4, y: -2.6, w: 13.2, d: 5.2, r: 0.8 }, MZ + MOTOR.r + 9, P, 3), { tone: "faint" }) + Dots([[MOTOR.x0 + 18.4, -1.6], [MOTOR.x0 + 29.6, 1.6]].map(([x, y]) => at([x, y, MZ + MOTOR.r + 9])), { size: 0.45 }),
});

// Clutch: flywheel on the motor shaft, friction disc on the input spline,
// pressure plate and diaphragm spring, release bearing on its guide tube.
// The guide tube runs from the wall flange into the release bearing; its clip
// follows the bearing's face, so the tube shows wherever the bearing has left it.
{
  const profile = [[CL.spring[1], 6.2], [CASE.x0 - 4, 6.2], [CASE.x0 - 4, 11], [CASE.x0, 11]];
  const shape = record(A.body(FM, [[CL.bearing[1], 5.6], [CL.bearing[1], 6.2], ...profile.slice(1), [CASE.x0, 5.6]], { name: "clutch.guide" }));
  const flange = Dots(G.dotsOf(FM, CASE.x0 - 4, 9, 4, P, { all: true, phase: 0.4 }), { size: 0.5, tone: "hi" });
  put("clutch.guide", G.add3(FM.o, [-22, 0, 0]), `<clipPath id="gs-guide"><path data-guide d="${hullClip(FM, CL.bearing[1], CASE.x0 + 1, 11.6)}"/></clipPath><g clip-path="url(#gs-guide)">${S(G.solidOf(profile, FM, P), { tone: "mid" })}</g>` + flange, [shape]);
}
const flyRing = G.ribsOf(FM, CL.fly[0], CL.fly[1], 26, 84, P, { fade: [0.1, 0.55], seams: true });
put("clutch.flywheel", G.add3(FM.o, [-55, 0, 0]), `${S(G.disc(CL.fly[0], CL.fly[1], 26, FM, P), { tone: "mid" })}<g data-ribs="flywheel">${Faded(flyRing, { tone: "lo" })}</g>`, [record(A.disc(FM, CL.fly[0], CL.fly[1], 26, { name: "clutch.flywheel" }))]);
put("clutch.disc", G.add3(FM.o, [-51, 0, 0]), `<g data-clutch="disc">${S(G.disc(CL.disc[0], CL.disc[1], 20, FM, P), { tone: "hi" })}</g>`, [record(A.ring(FM, CL.disc[0], CL.disc[1], 4, 20, { name: "clutch.disc" }))]);
put("clutch.plate", G.add3(FM.o, [-48, 0, 0]), `<g data-clutch="plate">${S(G.disc(CL.plate[0], CL.plate[1], 21, FM, P), { tone: "mid" })}</g>`, [record(A.ring(FM, CL.plate[0], CL.plate[1], 6.5, 21, { name: "clutch.plate" }))]);
put("clutch.spring", G.add3(FM.o, [-43, 0, 0]), `<g data-clutch="spring"><g data-body>${S(G.solidOf([[CL.spring[0], 18.5], [CL.spring[0] + 1, 18.5], [CL.spring[1], 8.2]], FM, P), { tone: "mid" })}</g><g data-teeth></g></g>`, [record(A.body(FM, [[CL.spring[0], 7], [CL.spring[0], 18.5], [CL.spring[0] + 1, 18.5], [CL.spring[1], 8.2], [CL.spring[1], 7]], { name: "clutch.spring" }))]);
put("clutch.bearing", G.add3(FM.o, [-38, 0, 0]), `<g data-clutch="bearing">${S(G.disc(CL.bearing[0], CL.bearing[1], 8.4, FM, P), { tone: "hi" })}</g>`, [record(A.ring(FM, CL.bearing[0], CL.bearing[1], 6.2, 8.4, { name: "clutch.bearing" }))]);

// Load: coupling, shaft, a heavy flywheel standing in for the car, a pillow block.
const FLOAD = FM;
disc("coupling.out", FM, 168, 172, 11, { tone: "mid" }, { extra: Dots(G.dotsOf(FM, 172, 8, 6, P, { all: true }), { size: 0.55, tone: "hi" }) });
disc("coupling.in", FM, 172, 176, 11, { tone: "mid" });
disc("shaft.load", FM, 176, FLY.x0, 5.2, { tone: "hi" }, { meta: { owner: "shaft.load" } });
record(A.disc(FM, 176, 214, 5.2, { name: "shaft.load.core", owner: "shaft.load" }));
put("load.flywheel", G.add3(FM.o, [(FLY.x0 + FLY.x1) / 2, 0, 0]), `<g data-load>${S(G.solidOf([[FLY.x0, 28], [FLY.x0 + 0.8, FLY.r], [FLY.x1 - 0.8, FLY.r], [FLY.x1, 28]], FM, P), { tone: "hi" })}<g data-spin transform="${faceMatrix(FM, FLY.x1, 0, CAM)}">${[0, 1, 2, 3, 4, 5].map((i) => `<circle class="gr-hole" cx="${f2(17 * Math.cos((i * Math.PI) / 3))}" cy="${f2(17 * Math.sin((i * Math.PI) / 3))}" r="3.4"/>`).join("")}<circle class="iso-line" data-tone="lo" cx="0" cy="0" r="8"/><circle class="iso-line" data-tone="faint" cx="0" cy="0" r="25"/><circle class="gr-mark" cx="27" cy="0" r="0.8"/></g></g>`, [record(A.ring(FM, FLY.x0, FLY.x1, 5.2, FLY.r, { name: "load.flywheel" }))]);
disc("shaft.load.rear", FM, FLY.x1, 200, 5.2, { tone: "hi" }, { meta: { owner: "shaft.load" } });
disc("shaft.load.end", FM, 212, 214, 5.2, { tone: "hi" }, { meta: { owner: "shaft.load" } });
box("stand.pillow", [200, -14, 2.4], [212, 14, MZ - 11], { tone: "mid" }, { r: 1, steps: 3, meta: { ground: true }, inner: Ln(k.sideSeam({ x: 200, y: -14, w: 12, d: 28, r: 1 }, 14, P, 3), { tone: "faint" }) });
box("stand.pillow.foot", [197, -18, 0], [215, 18, 2.4], { tone: "lo" }, { r: 1.2, steps: 3, meta: { ground: true }, extra: Dots([at([199, 15, 2.4]), at([213, 15, 2.4])], { size: 0.45 }) });
{
  const shape = record(A.ring(FM, 200, 212, 5.2, 11, { name: "pillow.housing" }));
  put("pillow.housing", G.add3(FM.o, [206, 0, 0]), S(G.disc(200, 212, 11, FM, P), { tone: "mid", inner: seam(FM, 206, 11) }) + Dots([at([206, 0, MZ + 11])], { size: 0.6, tone: "hi" }), [shape]);
}

// ---------------------------------------------------------------- tachometers
const DIALS = [
  { name: "engine", x: -40, y: 27, max: 7000, red: 6000 },
  { name: "output", x: 182, y: 30, max: 5000, red: 99999 },
];
const DIAL_R = 15, DIAL_Z = 40, DIAL_H = 7;
for (const d of DIALS) {
  const top = DIAL_Z + DIAL_H;
  cylinderPart(`dial.${d.name}.foot`, d.x, d.y, 7, 0, 2, "lo");
  cylinderPart(`dial.${d.name}.post`, d.x, d.y, 2.2, 2, DIAL_Z - 4, "mid");
  cylinderPart(`dial.${d.name}.cup`, d.x, d.y, 4, DIAL_Z - 2, 2, "mid");
  const ticks = k.radialTicks(d.x, d.y, DIAL_R - 2.6, 35, 5, top, [1.3, 2.8], P, -0.75 * Math.PI, 1.5 * Math.PI);
  const shape = record(A.cylinder(d.x, d.y, DIAL_R, DIAL_Z, DIAL_H, { name: `dial.${d.name}` }));
  put(`dial.${d.name}`, [d.x, d.y, DIAL_Z + 3], S(k.cylinder(d.x, d.y, DIAL_R, DIAL_Z, DIAL_H, P, 64, 0.8), { tone: "hi", crease: "lo" }) +
    Ln(k.knurl(d.x, d.y, DIAL_R, top - 2.6, top, 72, P, 0.3), { tone: "lo" }) +
    Ln(k.sideArc(d.x, d.y, DIAL_R, top - 2.6, P, 40), { tone: "faint" }) +
    Ln(k.ring(d.x, d.y, DIAL_R - 1.8, top, P, 64), { tone: "lo" }) +
    Ln(ticks.minor, { tone: "lo" }) + Ln(ticks.major, { tone: "mid" }) +
    Ln(k.ring(d.x, d.y, 1.3, top, P, 16), { tone: "mid" }) +
    `<path class="iso-line" data-tone="lit" data-free="start" data-needle="${d.name}" style="stroke-width:1.1" d=""/>`, [shape]);
}
function cylinderPart(name, x, y, r, z, h, tone) {
  const shape = record(A.cylinder(x, y, r, z, h, { name, ground: name.endsWith("foot") }));
  put(name, [x, y, z + h / 2], S(k.cylinder(x, y, r, z, h, P, 28), { tone }), [shape]);
}

// ---------------------------------------------------------------- page
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const groups = R.items.map((item) => `<g class="it" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>`);

const LABEL_TEXT =
  "A five-speed manual gearbox on a test bench with the near half of its case cut away. An electric motor drives the input shaft through a clutch; the output shaft turns a heavy flywheel that stands in for the car. Inside, the input gear drives a layshaft below the main shaft, and five gear pairs and a reverse idler are always in mesh. Three synchro sleeves on the output shaft are moved by forks on three rails, which the shift lever's finger pushes through an H-shaped gate. Two dials read engine and output speed.";
const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label: LABEL_TEXT, body: [...back, `<g class="gb">${groups.join("")}</g>`] });

const knobAt = (t, s) => at(W.leverAxis(t, s).at(W.LEVER.knob)).map(f2);
const spots = [["N", 0, 0], ...Object.entries(GEARS).map(([g, spec]) => [g, spec.side, W.LANE_OF_RAIL ? W.LANE_OF_RAIL[spec.rail] : [1, 0, -1][spec.rail]])].map(([g, t, s]) => ({ gear: g === "N" || g === "R" ? g : Number(g), at: knobAt(t, s) }));
const DATA = {
  P,
  module: M,
  view: [WIDTH, HEIGHT],
  FM,
  gears: GEAR_LIST,
  rings: RING_LIST,
  sleeves: SLEEVES.map((s) => ({ x: s.x })),
  sleeve: SLEEVE,
  lever: { finger: W.LEVER.finger, knob: W.LEVER.knob, pivotZ: ZP, shank: LEVER_R.shank, rod: LEVER_R.rod, ball: LEVER_R.ball, knobR: LEVER_R.knob },
  gateZ: GATE_Z,
  clutch: CL,
  caseX0: CASE.x0,
  loadFace: FLY.x1,
  dials: DIALS.map((d) => ({ name: d.name, x: d.x, y: d.y, r: DIAL_R, top: DIAL_Z + DIAL_H, max: d.max })),
  spots,
};

function moduleScript(file, ns, imports = {}) {
  const src = readFileSync(join(HERE, file), "utf8");
  const names = [...src.matchAll(/^export (?:const|function|let) (\w+)/gm)].map((m) => m[1]);
  const body = src
    .replace(/^import \{([^}]*)\} from "([^"]+)";$/gm, (_, list, from) => `const {${list}} = ${imports[from]};`)
    .replace(/^export /gm, "");
  return `const ${ns} = (() => {${body}\nreturn { ${names.join(", ")} };})();\n`;
}
const latheSource = readFileSync(join(HERE, "..", "anatomy", "kit", "lathe.mjs"), "utf8").replace(/^import .*$/m, "");
const latheNames = [...latheSource.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const latheScript = `const G = (() => {${latheSource.replace(/^export /gm, "")}\nreturn { ${latheNames.join(", ")} };})();\n`;
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const SCRIPT = kitScript() + latheScript + moduleScript("model.mjs", "MODEL") + moduleScript("gears.mjs", "GEAR") + moduleScript("geometry.mjs", "GEO", { "./model.mjs": "MODEL" }) + LIVE;

const CSS = readFileSync(join(HERE, "gear-shift.css"), "utf8");
const PICKS = ["1", "2", "3", "4", "5", "R", "N"];
const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "Five-speed gearbox, cut away",
    hint: "1–5 · R · N · or click the gate",
    readout: "N · 850 rpm · 0 km/h",
    keys: [
      { mark: "lit", label: "Power path: the gear pair carrying the drive and the sleeve that locks it" },
      { mark: "raised", label: "Synchro sleeves, blocker rings and dog teeth on the output shaft" },
      { mark: "edge", label: "Rails and forks, pushed by the lever's finger through the H-gate" },
    ],
    caption:
      "The input shaft's 19-tooth gear drives the layshaft's 35-tooth gear whenever the clutch is engaged, so all five pairs turn all the time; the gears on the output shaft ride free until a sleeve locks one to it. To shift, the clutch frees the input side, the lever slides one rail, fork and sleeve, the sleeve presses a blocker ring onto its gear's cone until friction brings the input to that gear's speed, and only then slides over the dog teeth. Ratios 3.68, 2.14, 1.37, 1.00 (fourth locks input straight to output) and 0.78; reverse 3.48 through the idler, so the output turns backwards. Road speed assumes a 3.91 final drive and a 1.94 m tyre. Shafts are drawn at 1/150 of their real speed and each shift is slowed about three times.",
    body:
      `<div class="iso-stage gs-stage" tabindex="0" role="slider" aria-label="Gearbox. Press 1 to 5, R for reverse or N for neutral, or arrow keys to shift up and down; you can also click a position in the gate." aria-valuetext="Neutral">${svg}<span class="gs-sr" role="status" aria-live="polite" data-status></span></div>` +
      `<div class="gs-picks" role="group" aria-label="Pick a gear">${PICKS.map((g) => `<button type="button" data-pick="${g}" aria-pressed="${g === "N"}">${g}</button>`).join("")}</div>`,
  });
const page = k.pageHtml({ title: "Gear shift", theme: THEME, body, script: SCRIPT, width: 680 });
const name = THEME === "light" ? "gear-shift-light.html" : "gear-shift.html";
writeFileSync(join(HERE, name), page);

// The published page: the same plate, themed by the viewer, with the six steps
// of a shift (lit live as the model runs) and the ratios worked out from the teeth.
const tokens = (re) => k.ISO_CSS.match(re)[1];
const DARK = tokens(/\.iso\{([^}]*)\}/);
const LIGHT = tokens(/\.iso\[data-theme="light"\]\{([^}]*)\}/);
const MONO = `"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace`;
const THEME_CSS = `
/* One centred column: the figure plate, then the six steps of a shift, then the ratio table. */
:root{--gs-page:#f2f2ef;--gs-text:#57575a;--gs-strong:#18181a;--gs-muted:#8c8c90;--gs-rule:#d4d4d6;--gs-on:#000000;--gs-sans:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--gs-mono:${MONO}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--gs-page:#0b0b0b;--gs-text:#a3a3a3;--gs-strong:#e6e6e6;--gs-muted:#6e6e6e;--gs-rule:#2a2a2a;--gs-on:#ffffff;color-scheme:dark}}
:root[data-theme="dark"]{--gs-page:#0b0b0b;--gs-text:#a3a3a3;--gs-strong:#e6e6e6;--gs-muted:#6e6e6e;--gs-rule:#2a2a2a;--gs-on:#ffffff;color-scheme:dark}
.iso{${LIGHT};--gs-void:#cfcfcb;--anatomy-mono:${MONO}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .iso{${DARK};--gs-void:#0f0f0f;--anatomy-mono:${MONO}}}
:root[data-theme="dark"] .iso{${DARK};--gs-void:#0f0f0f;--anatomy-mono:${MONO}}
.gs-void{fill:var(--gs-void)}
body{background:var(--gs-page);color:var(--gs-text);font:15px/1.6 var(--gs-sans);-webkit-font-smoothing:antialiased}
.gs-page{box-sizing:border-box;max-width:760px;margin:0 auto;padding-block:40px 72px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.gs-page *,.gs-page *::before,.gs-page *::after{box-sizing:border-box}
.gs-head{display:grid;gap:8px}
.gs-eyebrow{font:500 11px/1 var(--gs-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--gs-muted)}
.gs-head h1{margin:0;font:600 clamp(26px,5vw,34px)/1.15 var(--gs-sans);letter-spacing:-.01em;color:var(--gs-strong);text-wrap:balance}
.gs-head p{margin:0;max-width:62ch}
.gs-page .iso-figure{margin:24px 0 8px}
.gs-section{display:grid;gap:14px;margin-top:36px}
.gs-section h2{margin:0;font:500 11px/1 var(--gs-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--gs-muted)}
.gs-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 28px;counter-reset:step}
.gs-steps li{counter-increment:step;display:grid;align-content:start;grid-template-columns:28px minmax(0,1fr);gap:2px 8px;padding:12px 0;border-top:1px solid var(--gs-rule)}
.gs-steps li::before{content:counter(step,decimal-leading-zero);grid-row:span 2;font:500 12px/1.6 var(--gs-mono);color:var(--gs-muted);font-variant-numeric:tabular-nums}
.gs-steps b{font-weight:600;color:var(--gs-strong)}
.gs-steps span{font-size:14px;max-width:60ch}
.gs-steps li[data-on]{border-top-color:var(--gs-on)}
.gs-steps li[data-on]::before{color:var(--gs-on)}
.gs-table-wrap{overflow-x:auto}
.gs-table{width:100%;border-collapse:collapse;font:13px/1.5 var(--gs-mono);font-variant-numeric:tabular-nums}
.gs-table th,.gs-table td{text-align:right;padding:8px 10px;border-top:1px solid var(--gs-rule);white-space:nowrap}
.gs-table th:first-child,.gs-table td:first-child,.gs-table th:nth-child(2),.gs-table td:nth-child(2){text-align:left}
.gs-table thead th{font-weight:500;color:var(--gs-muted);border-top:0;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.gs-table td:first-child{color:var(--gs-strong)}
.gs-note{margin:0;font-size:13px;color:var(--gs-muted);max-width:66ch}
@media (max-width:600px){.gs-steps{grid-template-columns:minmax(0,1fr)}}
`;
const STEPS = [
  ["clutchIn", "Clutch in", "The release bearing presses the diaphragm spring, which lifts the pressure plate off the friction disc. The engine no longer drives the input shaft."],
  ["out", "Out of gear", "The lever's finger pulls its rail back to the middle. The fork slides the sleeve off the old gear's dog teeth, and that gear spins free again."],
  ["across", "Across the gate", "In neutral the finger can move sideways into another rail's slot. The other rails stay where they are."],
  ["sync", "Synchronise", "The sleeve pushes a blocker ring onto the new gear's cone. Friction speeds up or slows down the input shaft, layshaft and free gears until the new gear turns with the output shaft."],
  ["engage", "Dogs engage", "With the speeds equal, the blocker lets the sleeve through. It slides over the dog teeth and locks the new gear to the output shaft."],
  ["clutchOut", "Clutch out", "The disc is clamped again and the engine drives through the new pair. The car's speed did not change during the shift; the engine's did."],
];
const kmhAt = (ratio) => (3000 / Math.abs(ratio) / FINAL_DRIVE) * TYRE * 0.06;
const pairOf = { 1: "18 → 36", 2: "25 → 29", 3: "31 → 23", 4: "locked 1 : 1", 5: "38 → 16", R: "18 → 14 → 34" };
const rows = Object.entries(GEARS).map(([g, spec]) => `<tr><td>${g === "R" ? "R" : spec.name}</td><td>${pairOf[g]}</td><td>${Math.abs(spec.ratio).toFixed(2)}</td><td>${kmhAt(spec.ratio).toFixed(0)}${g === "R" ? " back" : ""}</td></tr>`).join("");
const artifact =
  `<title>Five-Speed Gearbox</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n` +
  `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&display=swap">` +
  `<style>${k.ISO_CSS}${THEME_CSS}</style>` +
  `<main class="iso gs-page"><header class="gs-head"><span class="gs-eyebrow">Manual transmission</span><h1>How a gear shift works</h1><p>A five-speed gearbox on a test bench, cut in half along its shafts. Every gear pair is always in mesh. A shift only changes which gear a sliding sleeve locks to the output shaft, once the clutch has freed the engine and a synchro ring has matched the speeds.</p></header>` +
  body +
  `<section class="gs-section" aria-labelledby="gs-steps-h"><h2 id="gs-steps-h">One shift, in order</h2><ol class="gs-steps">${STEPS.map(([key, head, text]) => `<li data-step="${key}"><b>${head}</b><span>${text}</span></li>`).join("")}</ol></section>` +
  `<section class="gs-section" aria-labelledby="gs-ratios-h"><h2 id="gs-ratios-h">The ratios, from the teeth</h2><div class="gs-table-wrap"><table class="gs-table"><thead><tr><th>Gear</th><th>Layshaft → output teeth</th><th>Ratio</th><th>km/h at 3,000 rpm</th></tr></thead><tbody>${rows}</tbody></table></div>` +
  `<p class="gs-note">Every forward pair runs through the constant-mesh pair first: the input's 19 teeth drive the layshaft's 35, a factor of 1.84. Reverse adds a 14-tooth idler, which turns the output backwards. Road speeds assume a 3.91 final drive and a 1.94 m tyre.</p></section></main>` +
  `<script type="module">${SCRIPT.replace(/<\/(script)/gi, "<\\/$1")}</script>`;
writeFileSync(join(HERE, "five-speed-gearbox.html"), artifact);

console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`);
A.auditOrExit(R, P, {});
