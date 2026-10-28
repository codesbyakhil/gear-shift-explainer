// The gearbox as numbers: tooth counts, ratios, and a small drive model
// (engine, clutch, synchro, car) that both the build and the page run.

export const MODULE = 1.6;
export const TEETH = { D: 19, LD: 35, M3: 23, L3: 31, M2: 29, L2: 25, M1: 36, L1: 18, MR: 34, LR: 18, ID: 14, M5: 16, L5: 38 };
export const CONSTANT = TEETH.LD / TEETH.D;
export const FINAL_DRIVE = 3.91;
export const TYRE = 1.94;
export const IDLE = 850;
export const RAIL_TRAVEL = 6;
export const VISUAL = 1 / 150;

// rail 0 is 1-2 (nearest the viewer), 1 is 3-4, 2 is 5-R. A positive throw slides
// the sleeve rearward (+x); the lever's finger moves the same way, the knob the other.
export const GEARS = {
  1: { rail: 0, side: 1, main: "M1", lay: "L1", ratio: CONSTANT * (TEETH.M1 / TEETH.L1), name: "1st" },
  2: { rail: 0, side: -1, main: "M2", lay: "L2", ratio: CONSTANT * (TEETH.M2 / TEETH.L2), name: "2nd" },
  3: { rail: 1, side: 1, main: "M3", lay: "L3", ratio: CONSTANT * (TEETH.M3 / TEETH.L3), name: "3rd" },
  4: { rail: 1, side: -1, main: "D", lay: null, ratio: 1, name: "4th" },
  5: { rail: 2, side: 1, main: "M5", lay: "L5", ratio: CONSTANT * (TEETH.M5 / TEETH.L5), name: "5th" },
  R: { rail: 2, side: -1, main: "MR", lay: "LR", ratio: -CONSTANT * (TEETH.MR / TEETH.LR), name: "reverse" },
};
export const LANE_OF_RAIL = [1, 0, -1];
export const ACCEL = { 1: 1350, 2: 860, 3: 620, 4: 450, 5: 320, R: 700 };

export const kmh = (outRpm) => (Math.abs(outRpm) / FINAL_DRIVE) * TYRE * 0.06;
export const ratioOf = (gear) => (gear === "N" ? 0 : GEARS[gear].ratio);

// Each shaft's angle follows from the input, layshaft and output angles.
export function anglesOf(phi) {
  const lay = -phi.input * (TEETH.D / TEETH.LD);
  const free = (main, lay2) => -lay * (TEETH[lay2] / TEETH[main]);
  const idler = -lay * (TEETH.LR / TEETH.ID);
  return {
    engine: phi.engine,
    input: phi.input,
    lay,
    output: phi.output,
    D: phi.input,
    LD: lay,
    L3: lay, L2: lay, L1: lay, LR: lay, L5: lay,
    M3: free("M3", "L3"),
    M2: free("M2", "L2"),
    M1: free("M1", "L1"),
    M5: free("M5", "L5"),
    ID: idler,
    MR: -idler * (TEETH.ID / TEETH.MR),
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const approach = (value, target, dt, tau) => target + (value - target) * Math.exp(-dt / tau);

// Durations of the shift, in figure seconds (about three times a quick real shift).
export const STEPS = { clutchIn: 0.32, out: 0.34, across: 0.3, reach: 0.14, syncMin: 0.22, syncTau: 0.13, engage: 0.24, clutchOut: 0.55 };

const TOUR = [
  { do: "wait", for: 1.2 },
  { do: "shift", to: 1 },
  { do: "rev", to: 4200 },
  { do: "shift", to: 2 },
  { do: "rev", to: 4000 },
  { do: "shift", to: 3 },
  { do: "rev", to: 3800 },
  { do: "shift", to: 4 },
  { do: "rev", to: 3600 },
  { do: "shift", to: 5 },
  { do: "cruise", for: 2.2 },
  { do: "shift", to: "N" },
  { do: "stop" },
  { do: "wait", for: 0.6 },
  { do: "shift", to: "R" },
  { do: "back", to: 260, for: 1.6 },
  { do: "shift", to: "N" },
  { do: "stop" },
  { do: "wait", for: 1.4 },
];

export function createModel() {
  const s = {
    gear: "N",
    lane: 0,
    laneTo: 0,
    sleeves: [0, 0, 0],
    clutch: 0,
    engine: IDLE,
    input: IDLE,
    output: 0,
    phi: { engine: 0, input: 0, output: 0 },
    job: null,
    mode: "drive",
    want: IDLE,
    braking: false,
    tour: { on: true, step: 0, clock: 0 },
    phase: "neutral",
  };

  const gearOn = () => (s.gear === "N" ? null : GEARS[s.gear]);

  function shift(to) {
    if (s.job && s.job.to === to) return;
    if (to !== "N" && GEARS[to].ratio < 0 && s.output > 30) to = "N";
    if (to !== "N" && GEARS[to].ratio > 0 && s.output < -30) to = "N";
    const from = s.job ? s.job.to : s.gear;
    if (from === to && !s.job) return;
    s.job = { to, step: "clutchIn", clock: 0, from: s.gear, start: s.clutch };
  }

  function sleeveTarget(gear) {
    return gear === "N" ? 0 : GEARS[gear].side;
  }

  function stepJob(dt) {
    const job = s.job;
    job.clock += dt;
    const target = job.to === "N" ? null : GEARS[job.to];
    const engagedRail = s.sleeves.findIndex((p) => p !== 0);
    switch (job.step) {
      case "clutchIn": {
        s.clutch = Math.max(s.clutch, job.start + (1 - job.start) * smooth(0, STEPS.clutchIn, job.clock));
        if (job.clock >= STEPS.clutchIn) next("out");
        break;
      }
      case "out": {
        if (engagedRail < 0) {
          s.gear = "N";
          next(target && LANE_OF_RAIL[target.rail] !== s.lane ? "across" : target ? "reach" : "across");
          break;
        }
        const p = s.sleeves[engagedRail];
        const nextP = Math.sign(p) * Math.max(0, Math.abs(p) - dt / STEPS.out);
        s.sleeves[engagedRail] = nextP;
        if (Math.abs(nextP) < 0.6) s.gear = "N";
        if (nextP === 0) next(target && LANE_OF_RAIL[target.rail] === s.lane ? "reach" : "across");
        break;
      }
      case "across": {
        const lane = target ? LANE_OF_RAIL[target.rail] : 0;
        if (job.laneFrom === undefined) job.laneFrom = s.lane;
        s.lane = job.laneFrom + (lane - job.laneFrom) * smooth(0, STEPS.across, job.clock);
        if (job.clock >= STEPS.across) {
          s.lane = lane;
          next(target ? "reach" : "clutchOut");
        }
        break;
      }
      case "reach": {
        s.sleeves[target.rail] = target.side * 0.17 * smooth(0, STEPS.reach, job.clock);
        if (job.clock >= STEPS.reach) next("sync");
        break;
      }
      case "sync": {
        const want = s.output * target.ratio;
        s.input = approach(s.input, want, dt, STEPS.syncTau);
        const close = Math.abs(s.input - want) <= Math.max(10, Math.abs(want) * 0.01);
        if (job.clock >= STEPS.syncMin && close) {
          s.input = want;
          next("engage");
        }
        break;
      }
      case "engage": {
        const share = smooth(0, STEPS.engage, job.clock);
        s.sleeves[target.rail] = target.side * (0.17 + 0.83 * share);
        s.input = s.output * target.ratio;
        if (share > 0.55) s.gear = job.to;
        if (job.clock >= STEPS.engage) next("clutchOut");
        break;
      }
      case "clutchOut": {
        const launching = target && Math.abs(s.output) < 40;
        const span = launching ? STEPS.clutchOut * 2.4 : STEPS.clutchOut;
        s.clutch = 1 - smooth(0, span, job.clock);
        if (job.clock >= span) {
          s.clutch = 0;
          s.job = null;
        }
        break;
      }
    }
    function next(step) {
      job.step = step;
      job.clock = 0;
    }
  }

  function drive(dt) {
    const g = gearOn();
    const lock = 1 - s.clutch;
    const shifting = s.job && s.job.step !== "clutchOut";
    if (shifting && s.clutch > 0.02) {
      const g2 = s.job.to === "N" ? null : GEARS[s.job.to];
      const matched = g2 ? Math.max(IDLE, s.output * g2.ratio) : IDLE;
      const late = s.job.step === "sync" || s.job.step === "engage";
      s.engine = approach(s.engine, late ? matched : Math.max(IDLE, s.engine * 0.85), dt, 0.45);
    }
    if (!g) {
      if (lock > 0) s.input += (s.engine - s.input) * Math.min(1, lock * dt * 9);
      else if (!s.job || s.job.step !== "sync") s.input = approach(s.input, 0, dt, 2.6);
      if (lock > 0.98) s.input = s.engine;
      s.output = approach(s.output, 0, dt, s.braking ? 0.8 : s.job ? 40 : 12);
      if (Math.abs(s.output) < 1) s.output = 0;
      if (!shifting) s.engine = approach(s.engine, IDLE, dt, 0.5);
      return;
    }
    s.input = s.output * g.ratio;
    if (lock <= 0) return;
    const throttle = s.mode === "rev" || s.mode === "hold" || s.mode === "cruise";
    const slip = s.engine - s.input;
    if (lock < 1 || Math.abs(slip) > 3) {
      if (slip > 0 && (throttle || Math.abs(s.input) < 900)) {
        s.engine = approach(s.engine, Math.max(s.engine, 1450), dt, 0.3);
        s.input += slip * Math.min(1, lock * lock * 3.2 * dt);
        s.output = s.input / g.ratio;
      } else {
        s.engine += (s.input - s.engine) * Math.min(1, lock * dt * 7);
      }
      if (lock >= 1 && Math.abs(s.engine - s.input) < 3) s.engine = s.input;
      return;
    }
    s.engine = s.input;
    let rate = 0;
    if (s.mode === "rev") rate = s.want > s.engine ? ACCEL[s.gear] : 0;
    if (s.mode === "cruise" || s.mode === "hold") rate = (s.want - s.engine) * 1.4;
    s.engine = Math.max(IDLE * 0.98, s.engine + rate * dt);
    s.input = s.engine;
    s.output = s.input / g.ratio;
  }

  function stepTour(dt) {
    const t = s.tour;
    const cue = TOUR[t.step];
    t.clock += dt;
    const done = () => {
      t.step = (t.step + 1) % TOUR.length;
      t.clock = 0;
    };
    s.braking = false;
    switch (cue.do) {
      case "wait":
        s.mode = "idle";
        if (t.clock >= cue.for) done();
        break;
      case "shift":
        if (t.clock === dt) shift(cue.to);
        if (!s.job) done();
        break;
      case "rev":
        s.mode = "rev";
        s.want = cue.to;
        if (!s.job && Math.abs(s.engine) >= cue.to - 1) done();
        break;
      case "cruise":
        s.mode = "cruise";
        s.want = Math.abs(s.engine);
        if (t.clock >= cue.for) done();
        break;
      case "stop":
        s.mode = "idle";
        s.braking = true;
        if (s.output === 0 && !s.job) done();
        break;
      case "back":
        s.mode = "hold";
        s.want = 1200;
        if (t.clock >= cue.for) done();
        break;
    }
  }

  function step(dt) {
    if (s.tour.on) stepTour(dt);
    else if (s.mode === "hold" && s.gear === "N") s.braking = true;
    if (s.job) stepJob(dt);
    drive(dt);
    const k = (rpm) => (rpm / 60) * Math.PI * 2 * VISUAL * dt;
    s.phi.engine += k(Math.abs(s.engine));
    s.phi.input += k(s.input);
    s.phi.output += k(s.output);
    s.phase = phaseOf();
  }

  function phaseOf() {
    const job = s.job;
    if (!job) return s.gear === "N" ? "neutral" : "drive";
    return job.step;
  }

  // The reader takes over: hold the engine at a cruising 2,400 rpm in whatever gear they pick.
  function select(to) {
    s.tour.on = false;
    s.mode = "hold";
    s.want = to === "R" ? 1200 : 2400;
    s.braking = to === "N";
    shift(to);
  }

  function resumeTour() {
    s.tour.on = true;
    s.tour.step = 0;
    s.tour.clock = 0;
    if (s.gear !== "N" || s.job) {
      s.tour.step = TOUR.findIndex((cue) => cue.do === "shift" && cue.to === "N");
    }
  }

  return { s, step, select, shift, resumeTour, gearOn };
}

export const TOUR_LENGTH = TOUR.length;
