// Where everything is, in world units (about 1 px of the drawing): x runs along
// the shafts from the motor to the load, y across (the viewer is on +y, so the
// near half of every housing is cut away at y = 0), z up from the bench top.

import { MODULE, TEETH, RAIL_TRAVEL } from "./model.mjs";

export const M = MODULE;
export const ZL = 58;
export const ZM = ZL + 27 * M;
export const ZR = ZM + 40;
export const ZT = ZR + 11;
export const LID = 4;
export const ZP = ZR + 22;
export const XP = 100;

export const CASE = { x0: -8, x1: 164, wall: 8, yFar: -44, yIn: -40, z0: 18, floor: 4, top: ZT };
export const RAILS = [
  { name: "rail12", y: 7, fork: 76 },
  { name: "rail34", y: 0, fork: 26 },
  { name: "rail5r", y: -7, fork: 126 },
];
export const RAIL_R = 2.6;
export const LUG = { half: 5, width: 6, height: 7, slot: 1.8, depth: 4 };
export const LEVER = { finger: 18.5, knob: 48, gate: 27, travel: RAIL_TRAVEL, lane: 7 };

const pitch = (n) => (n * M) / 2;
export const GEAR_W = 11;

// Main shaft line: gear, dog ring, gap, blocker ring, sleeve, blocker, gap, dog, gear.
export const MAIN = [
  { name: "D", teeth: TEETH.D, x: [3, 14], shaft: "input", partner: "LD" },
  { name: "M3", teeth: TEETH.M3, x: [38, 49], shaft: "main", partner: "L3" },
  { name: "M2", teeth: TEETH.M2, x: [53, 64], shaft: "main", partner: "L2" },
  { name: "M1", teeth: TEETH.M1, x: [88, 99], shaft: "main", partner: "L1" },
  { name: "MR", teeth: TEETH.MR, x: [103, 114], shaft: "main", partner: null },
  { name: "M5", teeth: TEETH.M5, x: [138, 149], shaft: "main", partner: "L5" },
];
export const LAY = [
  { name: "LD", teeth: TEETH.LD, x: [3, 14] },
  { name: "L3", teeth: TEETH.L3, x: [38, 49] },
  { name: "L2", teeth: TEETH.L2, x: [53, 64] },
  { name: "L1", teeth: TEETH.L1, x: [88, 99] },
  { name: "LR", teeth: TEETH.LR, x: [103, 114] },
  { name: "L5", teeth: TEETH.L5, x: [138, 149] },
];

// Reverse idler: meshes the layshaft's reverse gear and the main reverse gear.
const rLR = pitch(TEETH.LR) + pitch(TEETH.ID);
const rMR = pitch(TEETH.MR) + pitch(TEETH.ID);
const C = 27 * M;
const zi = (rLR * rLR - rMR * rMR + C * C) / (2 * C);
export const IDLER = { name: "ID", teeth: TEETH.ID, x: [103, 114], y: -Math.sqrt(rLR * rLR - zi * zi), z: ZL + zi };

// Synchro sleeves sit between their two gears; side +1 is the gear at larger x.
export const SLEEVES = [
  { rail: 0, x: 70, gears: { "-1": "M2", 1: "M1" } },
  { rail: 1, x: 20, gears: { "-1": "D", 1: "M3" } },
  { rail: 2, x: 120, gears: { "-1": "MR", 1: "M5" } },
];
export const SLEEVE = { w: 12, r: 13.5, groove: 11, g0: 4.5, g1: 7.5 };
export const DOG = { w: 3, r: 11.4, teeth: 30 };
export const BLOCKER = { w: 2, r: 11.4, teeth: 30 };
export const SHAFT = { main: 5, input: 5.5, lay: 6.5, spline: 4 };

// The rings beside each sleeve, from the sleeve outward.
export function ringsOf(sleeve) {
  const x0 = sleeve.x, x1 = sleeve.x + SLEEVE.w;
  return [
    { side: -1, kind: "blocker", x: [x0 - BLOCKER.w, x0] },
    { side: -1, kind: "dog", x: [x0 - BLOCKER.w - 1 - DOG.w, x0 - BLOCKER.w - 1] },
    { side: 1, kind: "blocker", x: [x1, x1 + BLOCKER.w] },
    { side: 1, kind: "dog", x: [x1 + BLOCKER.w + 1, x1 + BLOCKER.w + 1 + DOG.w] },
  ];
}

// The lever: a rigid rod through the pivot ball. Throw t and lane s put the
// finger tip at (XP + 6t, 7s); the knob and the gate crossing follow the rod.
export function leverAxis(throwShare, lane) {
  const fx = LEVER.travel * throwShare;
  const fy = LEVER.lane * lane;
  const h = Math.sqrt(LEVER.finger * LEVER.finger - fx * fx - fy * fy);
  const u = [-fx / LEVER.finger, -fy / LEVER.finger, h / LEVER.finger];
  return { u, pivot: [XP, 0, ZP], tip: [XP + fx, fy, ZP - h], at: (len) => [XP + u[0] * len, u[1] * len, ZP + u[2] * len] };
}
export const gateCrossing = (throwShare, lane) => {
  const L = leverAxis(throwShare, lane);
  const len = LEVER.gate / L.u[2];
  return L.at(len);
};
