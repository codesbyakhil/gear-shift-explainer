import { createModel, kmh, GEARS } from "./model.mjs";
const m = createModel();
let t = 0, last = "";
const dt = 1 / 60;
for (let i = 0; i < 60 * 40; i++) {
  m.step(dt); t += dt;
  const s = m.s;
  const key = `${s.phase}|${s.gear}`;
  if (key !== last || i % 30 === 0) {
    console.log(t.toFixed(2).padStart(6), s.phase.padEnd(9), String(s.gear).padEnd(2), "c", s.clutch.toFixed(2), "lane", s.lane.toFixed(2), "sl", s.sleeves.map((p) => p.toFixed(2)).join(","), "eng", s.engine.toFixed(0).padStart(5), "in", s.input.toFixed(0).padStart(5), "out", s.output.toFixed(0).padStart(5), "kmh", kmh(s.output).toFixed(0));
    last = key;
  }
}
