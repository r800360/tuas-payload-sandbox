import {
  P, MODE_NAME, STATE_NAME, scenarioCalm, runMission, nedToLl,
} from "./engine.js";
import { createView, attitudeOf } from "./scene.js";

const PRESETS = {
  calm: scenarioCalm(),
  wind: { ...scenarioCalm(), windE: 4 },
  gust: { ...scenarioCalm(), gust: 2.5, seed: 7 },
  inverted: { ...scenarioCalm(), invert: true },
  unguided: { ...scenarioCalm(), guided: false },
};

const $ = (id) => document.getElementById(id);
const playBtn = $("play");
const presetSel = $("preset");
const scrub = $("scrub");
const followBtn = $("follow");
const stage = $("stage");
const main = $("main");

let view;
try {
  view = createView($("view"), {
    target: $("tag-target"),
    payload: $("tag-payload"),
    carrier: $("tag-carrier"),
  }, (on) => {
    followBtn.setAttribute("aria-pressed", on ? "true" : "false");
    $("hint").textContent = on
      ? "Following · drag the view to look around"
      : "Drag to orbit · scroll to zoom · right-drag to pan";
  });
} catch (err) {
  const msg = String(err && (err.stack || err.message || err));
  $("result").textContent = msg.slice(0, 180);
  $("result").className = "pill bad";
}

let run = runMission(PRESETS.calm);
let index = 0;
let playing = true;
let speed = 2;
let last = 0;
let acc = 0;
let shown = -1;

function scenarioFromUi() {
  const base = { ...PRESETS[presetSel.value] };
  base.kp = Number($("kp").value);
  base.ki = Number($("ki").value);
  base.kd = Number($("kd").value);
  base.windE = Number($("wind").value);
  base.releaseAlt = Number($("alt").value);
  return base;
}

function syncLabels() {
  $("kpv").textContent = Number($("kp").value).toFixed(1);
  $("kiv").textContent = Number($("ki").value).toFixed(2);
  $("kdv").textContent = Number($("kd").value).toFixed(2);
  $("windv").textContent = Number($("wind").value).toFixed(1);
  $("altv").textContent = $("alt").value;
}

function edited() {
  const sc = PRESETS[presetSel.value];
  return Number($("kp").value) !== sc.kp
    || Number($("ki").value) !== sc.ki
    || Number($("kd").value) !== sc.kd
    || Number($("wind").value) !== sc.windE
    || Number($("alt").value) !== sc.releaseAlt;
}

function applyPreset() {
  const sc = PRESETS[presetSel.value];
  $("kp").value = sc.kp;
  $("ki").value = sc.ki;
  $("kd").value = sc.kd;
  $("wind").value = sc.windE;
  $("alt").value = sc.releaseAlt;
  syncLabels();
  rebuild();
}

function rebuild() {
  const t = run.samples[index] ? run.samples[index].t : 0;
  run = runMission(scenarioFromUi());
  index = run.samples.length - 1;
  for (let i = 0; i < run.samples.length; i++) {
    if (run.samples[i].t >= t - 1e-9) { index = i; break; }
  }
  scrub.max = String(run.samples.length - 1);
  shown = -1;
  acc = 0;
}

function pause() {
  playing = false;
  playBtn.textContent = "Play";
}

function togglePlay() {
  if (!playing && index >= run.samples.length - 1) {
    index = 0;
    if (view.isFollow()) view.useFollow(true);
  }
  playing = !playing;
  playBtn.textContent = playing ? "Pause" : "Play";
  acc = 0;
}

playBtn.onclick = togglePlay;
$("fwd").onclick = () => { pause(); index = Math.min(run.samples.length - 1, index + 1); };
$("back").onclick = () => { pause(); index = Math.max(0, index - 1); };
presetSel.onchange = applyPreset;
for (const id of ["kp", "ki", "kd", "wind", "alt"]) {
  $(id).oninput = () => { syncLabels(); rebuild(); };
}
$("rate").onchange = () => { speed = Number($("rate").value); };
scrub.oninput = () => { pause(); index = Number(scrub.value); };
$("readout").onclick = () => {
  const open = main.classList.toggle("full") === false;
  $("readout").setAttribute("aria-pressed", open ? "true" : "false");
  requestAnimationFrame(() => view.resize());
};
followBtn.onclick = () => view.useFollow(!view.isFollow());
$("overhead").onclick = () => view.overhead();
$("fit").onclick = () => view.fit(run);

window.addEventListener("keydown", (ev) => {
  const tag = ev.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (ev.key === " ") { ev.preventDefault(); togglePlay(); }
  if (ev.key === "ArrowRight") $("fwd").click();
  if (ev.key === "ArrowLeft") $("back").click();
  if (ev.key === "Home") { pause(); index = 0; }
  if (ev.key === "End") { pause(); index = run.samples.length - 1; }
});

function mark(id, on) {
  $(id).classList.toggle("on", on);
}

function signed(v) {
  const n = v.toFixed(1);
  return `${v >= 0 ? "+" : ""}${n}°`;
}

function drawHorizon(att) {
  const c = $("horizon");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = 132;
  const h = 78;
  c.width = Math.floor(w * dpr);
  c.height = Math.floor(h * dpr);
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.translate(w / 2, h / 2);
  g.rotate(-att.roll * Math.PI / 180);
  const py = (att.pitch / 25) * (h * 0.42);
  g.fillStyle = "#2d6f9a";
  g.fillRect(-w, -h * 2 + py, w * 2, h * 2);
  g.fillStyle = "#6d5a38";
  g.fillRect(-w, py, w * 2, h * 2);
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-w, py);
  g.lineTo(w, py);
  g.stroke();
  g.restore();
  g.strokeStyle = "#e2b34a";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w / 2 - 22, h / 2);
  g.lineTo(w / 2 - 8, h / 2);
  g.moveTo(w / 2 + 8, h / 2);
  g.lineTo(w / 2 + 22, h / 2);
  g.moveTo(w / 2, h / 2 - 4);
  g.lineTo(w / 2, h / 2 + 8);
  g.stroke();
}

function drawSpark() {
  const c = $("spark");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = 160;
  const h = 32;
  c.width = Math.floor(w * dpr);
  c.height = Math.floor(h * dpr);
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const lastT = run.samples[run.samples.length - 1].t || 1;
  const alt0 = run.samples[0].alt || 1;
  const xOf = (t) => (t / lastT) * (w - 2) + 1;
  g.beginPath();
  run.samples.forEach((s, i) => {
    const y = 2 + (1 - s.alt / alt0) * (h - 6);
    if (i === 0) g.moveTo(xOf(s.t), y);
    else g.lineTo(xOf(s.t), y);
  });
  g.strokeStyle = "#3dbea5";
  g.stroke();
  g.beginPath();
  run.samples.forEach((s, i) => {
    const y = h / 2 - (s.error / 180) * (h / 2 - 3);
    if (i === 0) g.moveTo(xOf(s.t), y);
    else g.lineTo(xOf(s.t), y);
  });
  g.strokeStyle = "#e2b34a";
  g.stroke();
  const s = run.samples[index];
  g.strokeStyle = "#e8eef4";
  g.beginPath();
  g.moveTo(xOf(s.t), 1);
  g.lineTo(xOf(s.t), h - 1);
  g.stroke();
}

function bar(id, value, limit) {
  const w = Math.max(0, Math.min(100, Math.abs(value) / limit * 100));
  $(id).style.width = `${w}%`;
}

function updateHud() {
  const s = run.samples[index];
  const att = attitudeOf(s);
  const ll = nedToLl(s.n, s.e);
  const id = (1 << 3) | (s.state & 7);
  const miss = run.miss;
  const inside = miss != null && miss <= P.SCORE_M;
  const guiding = s.pc === "guidance_step";
  const result = $("result");
  result.textContent = miss == null
    ? "running"
    : `${miss.toFixed(1)} m ${inside ? "inside" : "outside"} 50 ft${edited() ? " · edited" : ""}`;
  result.className = `pill ${inside ? "good" : "bad"}`;

  $("yaw").textContent = `${att.yaw.toFixed(1)}°`;
  $("pitch").textContent = signed(att.pitch);
  $("roll").textContent = signed(att.roll);
  $("rates").textContent = `sink ${att.sink.toFixed(1)} m/s · yaw rate ${signed(att.yawRate).replace("°", "°/s")}`;
  $("chip-state").textContent = STATE_NAME[s.state] || s.state;
  $("chip-mode").textContent = s.dropped ? MODE_NAME[s.mode] : "ATTACHED";
  $("chip-pc").textContent = s.pc;
  $("phase").textContent = !s.dropped
    ? "On the carrier. Brakes stay locked while the radio state machine runs."
    : s.alt <= 0
      ? "On the ground."
      : s.pc === "drop_pulse"
        ? "Release pulse. Both brakes hold for 0.35 s, then steering starts."
        : s.mode === 1
          ? "Above the glide slope. Heading is held 50° off the bearing to bleed height."
          : s.mode === 2
            ? "Still high, inside the loiter. Extra lead tightens the spiral."
            : s.pc === "ballistic"
              ? "Unguided. Brakes stay open and the chute drifts with the wind."
              : guiding
                ? "On the glide slope. Desired heading is the bearing to the target."
                : "On the ground.";

  $("v-dist").textContent = `${s.dist.toFixed(1)} m, ${s.bearing.toFixed(1)}°`;
  $("v-sur").textContent = `${s.surplus.toFixed(1)} m`;
  $("v-des").textContent = `${s.desired.toFixed(1)}°`;
  $("v-err").textContent = `${s.error.toFixed(1)}°`;
  $("v-u").textContent = `${s.u.toFixed(1)} → ${s.bl.toFixed(2)} / ${s.br.toFixed(2)}`;
  $("v-pos").textContent = `${s.n.toFixed(1)}, ${s.e.toFixed(1)}, ${s.alt.toFixed(1)}`;
  mark("row-dist", true);
  mark("row-sur", s.dropped);
  mark("row-des", guiding);
  mark("row-err", guiding);
  mark("row-u", guiding || s.pc === "drop_pulse");
  mark("row-pos", true);

  $("m-i").textContent = s.integ.toFixed(2);
  $("m-p").textContent = s.prev.toFixed(2);
  $("m-d").textContent = s.dFilt.toFixed(2);
  $("t-p").textContent = s.p.toFixed(1);
  $("t-i").textContent = s.i.toFixed(1);
  $("t-d").textContent = s.d.toFixed(1);
  $("t-l").textContent = s.bl.toFixed(2);
  $("t-r").textContent = s.br.toFixed(2);
  bar("bar-p", s.p, 180);
  bar("bar-i", s.i, 180);
  bar("bar-d", s.d, 180);
  bar("bar-l", s.bl, 1);
  bar("bar-r", s.br, 1);

  $("packet").textContent = `Bottle A, state in bits 2:0. Id ${id} (${id.toString(2).padStart(8, "0")}). Standby on A is 9, the 2024 heartbeat.`;
  $("ll").textContent = `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)} · Geisel`;
  $("clock").textContent = `${s.t.toFixed(2)} s`;
  scrub.value = String(index);
  const north = s.uasN;
  $("tag-carrier").textContent = Math.abs(north) < 25
    ? "Carrier"
    : `Carrier ${Math.abs(north).toFixed(0)} m ${north >= 0 ? "N" : "S"}`;
  $("tag-payload").textContent = s.alt > 1 ? `Payload ${s.alt.toFixed(0)} m` : "Payload";
  drawHorizon(att);
  drawSpark();
}

new ResizeObserver(() => view.resize()).observe(stage);

function frame(now) {
  if (!last) last = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (playing) {
    acc += dt * speed;
    while (acc >= P.DT && index < run.samples.length - 1) {
      acc -= P.DT;
      index++;
    }
    if (index >= run.samples.length - 1) {
      playing = false;
      playBtn.textContent = "Play";
      acc = 0;
    }
  }
  view.show(run, index);
  view.render(dt);
  if (shown !== index) {
    shown = index;
    updateHud();
  }
  requestAnimationFrame(frame);
}

scrub.max = String(run.samples.length - 1);
requestAnimationFrame(frame);
