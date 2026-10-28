// Spur gears with involute teeth, drawn as extruded toothed outlines. The page
// redraws every turning gear each frame from these functions, so they depend
// only on the projection: nothing from the kit.

const LIGHT_UP = 1.2;
const BANDS = [0, 0.2, 0.42, 0.62];

export function cameraBasis(P) {
  const a = (P.azimuth * Math.PI) / 180;
  const e = (P.elevation * Math.PI) / 180;
  const sinA = Math.sin(a), cosA = Math.cos(a), sinE = Math.sin(e), cosE = Math.cos(e);
  const k = P.scale * Math.sqrt(1.6);
  const L0 = [-sinA, cosA, LIGHT_UP];
  const l = Math.hypot(L0[0], L0[1], L0[2]);
  return {
    k,
    V: [cosA * cosE, sinA * cosE, sinE],
    L: [L0[0] / l, L0[1] / l, L0[2] / l],
    screen: (p) => [P.origin[0] + (p[0] * sinA - p[1] * cosA) * k, P.origin[1] + ((p[0] * cosA + p[1] * sinA) * sinE - p[2] * cosE) * k],
    vector: (d) => [(d[0] * sinA - d[1] * cosA) * k, ((d[0] * cosA + d[1] * sinA) * sinE - d[2] * cosE) * k],
  };
}

const toneBand = (score) => {
  let tone = 0;
  while (tone < BANDS.length && score >= BANDS[tone]) tone++;
  return tone;
};
const dot3g = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const inv = (alpha) => Math.tan(alpha) - alpha;

// One gear's outline in its own plane, counter-clockwise, tooth 0 centred on +u.
export function toothRing(teeth, module, { addendum = 1, dedendum = 1.25, pressure = 20, backlash = 0.05, flank = 3 } = {}) {
  const rp = (teeth * module) / 2;
  const rb = rp * Math.cos((pressure * Math.PI) / 180);
  const rt = rp + addendum * module;
  const rr = rp - dedendum * module;
  const half = Math.PI / (2 * teeth) - backlash / (2 * teeth);
  const atPitch = inv((pressure * Math.PI) / 180);
  const psi = (r) => {
    const rr2 = Math.max(r, rb);
    return half + atPitch - inv(Math.acos(Math.min(1, rb / rr2)));
  };
  const start = Math.max(rb, rr);
  const radii = [rr];
  if (start > rr + 1e-6) radii.push(start);
  for (let i = 1; i <= flank; i++) radii.push(start + ((rt - start) * i) / flank);
  const ring = [];
  for (let t = 0; t < teeth; t++) {
    const c = (t * 2 * Math.PI) / teeth;
    for (const r of radii) ring.push([r * Math.cos(c - psi(r)), r * Math.sin(c - psi(r))]);
    for (let i = radii.length - 1; i >= 0; i--) ring.push([radii[i] * Math.cos(c + psi(radii[i])), radii[i] * Math.sin(c + psi(radii[i]))]);
    const g = c + Math.PI / teeth;
    ring.push([rr * Math.cos(g), rr * Math.sin(g)]);
  }
  return { ring, rp, rb, rt, rr };
}

const f1 = (v) => Math.round(v * 10) / 10;

// The drawing of one turned toothed band from s0 to s1 along F.a, at angle phi.
// Returns path data: `body` (the near face and every visible flank, all wound
// the same way, for the paper fill and the doubled silhouette stroke), the four
// side tones and the top, and the near face with its tone and its edge.
export function gearBand(ring, F, s0, s1, phi, cam) {
  const n = ring.length;
  const towards = dot3g(F.a, cam.V) > 0;
  const sNear = towards ? s1 : s0;
  const sFar = towards ? s0 : s1;
  const c = Math.cos(phi), s = Math.sin(phi);
  const Su = cam.vector(F.u), Sv = cam.vector(F.v), Sa = cam.vector(F.a);
  const O = cam.screen(F.o);
  const nearX = O[0] + Sa[0] * sNear, nearY = O[1] + Sa[1] * sNear;
  const dx = Sa[0] * (sFar - sNear), dy = Sa[1] * (sFar - sNear);
  const uV = dot3g(F.u, cam.V), vV = dot3g(F.v, cam.V), uL = dot3g(F.u, cam.L), vL = dot3g(F.v, cam.L);
  const px = new Float64Array(n), py = new Float64Array(n);
  const near = new Array(n), far = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = ring[i][0] * c - ring[i][1] * s;
    const y = ring[i][0] * s + ring[i][1] * c;
    px[i] = x;
    py[i] = y;
    const X = nearX + Su[0] * x + Sv[0] * y;
    const Y = nearY + Su[1] * x + Sv[1] * y;
    near[i] = f1(X) + " " + f1(Y);
    far[i] = f1(X + dx) + " " + f1(Y + dy);
  }
  const faceD = "M" + (towards ? near : near.slice().reverse()).join("L") + "Z";
  const buckets = [[], [], [], [], []];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = px[j] - px[i], ey = py[j] - py[i];
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len, ny = -ex / len;
    if (nx * uV + ny * vV <= 1e-6) continue;
    const quad = towards ? "M" + near[j] + "L" + near[i] + "L" + far[i] + "L" + far[j] + "Z" : "M" + near[i] + "L" + near[j] + "L" + far[j] + "L" + far[i] + "Z";
    buckets[toneBand(nx * uL + ny * vL)].push(quad);
  }
  const sides = buckets.map((list) => list.join(""));
  const faceTone = toneBand(dot3g(F.a, cam.L) * (towards ? 1 : -1));
  return { body: faceD + sides.join(""), shades: sides.slice(0, 4), top: sides[4], face: faceD, faceTone };
}

// The matrix that lays a group's (x, y) onto the face plane at s, turned by phi.
export function faceMatrix(F, s, phi, cam) {
  const Su = cam.vector(F.u), Sv = cam.vector(F.v), Sa = cam.vector(F.a);
  const O = cam.screen(F.o);
  const c = Math.cos(phi), sn = Math.sin(phi);
  const a = Su[0] * c + Sv[0] * sn, b = Su[1] * c + Sv[1] * sn;
  const cc = -Su[0] * sn + Sv[0] * c, d = -Su[1] * sn + Sv[1] * c;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return `matrix(${r4(a)} ${r4(b)} ${r4(cc)} ${r4(d)} ${r4(O[0] + Sa[0] * s)} ${r4(O[1] + Sa[1] * s)})`;
}

// Markup for a gear: the slots the page rewrites each frame. Tone follows the kit.
export function gearSvg(name, band, matrix, details, { tone = "hi", lit = false } = {}) {
  const shade = band.faceTone === 4 ? `class="iso-top"` : `class="iso-shade" data-shade="${band.faceTone}"`;
  return (
    `<g class="iso-solid gr" data-seamless${lit ? " data-lit" : ""} data-gear="${name}">` +
    `<path class="gr-sil" data-tone="${tone}" d="${band.body}"/>` +
    `<path class="iso-fill" d="${band.body}"/>` +
    band.shades.map((d, i) => `<path class="iso-shade" data-shade="${i}" d="${d}"/>`).join("") +
    `<path class="iso-top" d="${band.top}"/>` +
    `<path ${shade} data-face d="${band.face}"/>` +
    `<path class="iso-line gr-edge" data-tone="lo" d="${band.face}"/>` +
    `<g data-spin transform="${matrix}">${details}</g>` +
    `</g>`
  );
}
