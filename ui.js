import {
  P, MODE, MODE_NAME, STATE_NAME, scenarioCalm, runMission, nedToLl, minTurnRadius,
} from "./engine.js";

const PRESETS = {
  calm: scenarioCalm(),
  wind: { ...scenarioCalm(), windE: 4 },
  gust: { ...scenarioCalm(), gust: 2.5, seed: 7 },
  inverted: { ...scenarioCalm(), invert: true },
  unguided: { ...scenarioCalm(), guided: false },
};

const MODE_COLOR = { 0: "#8ee0a8", 1: "#c9a6ff", 2: "#3ee0c5", 3: "#f0b429" };

const map = document.getElementById("map");
const chart = document.getElementById("chart");
const side = document.getElementById("side");
const transport = document.getElementById("transport");

let preset = "calm";
let run = runMission(PRESETS.calm);
let index = 0;
let playing = true;
let speed = 2;
let last = 0;
let shown = -1;

transport.innerHTML = `
  <button id="play" class="primary">Pause</button>
  <button id="back">Step back</button>
  <button id="fwd">Step</button>
  <select id="preset">
    <option value="calm">Calm</option>
    <option value="wind">Crosswind 4 m/s</option>
    <option value="gust">Gust</option>
    <option value="inverted">2025 inverted PID</option>
    <option value="unguided">Unguided chute</option>
  </select>
  <label class="slider">Kp <input id="kp" type="range" min="0" max="8" step="0.1" value="3"></label>
  <label class="slider">Ki <input id="ki" type="range" min="0" max="0.4" step="0.01" value="0.08"></label>
  <label class="slider">Kd <input id="kd" type="range" min="0" max="2" step="0.05" value="0.45"></label>
  <label class="slider">Wind E <input id="wind" type="range" min="-8" max="8" step="0.5" value="0"></label>
  <label class="slider">Release m <input id="alt" type="range" min="40" max="90" step="1" value="60"></label>
`;

const playBtn = document.getElementById("play");
const presetSel = document.getElementById("preset");

function scenarioFromUi() {
  const base = { ...PRESETS[presetSel.value] };
  base.kp = Number(document.getElementById("kp").value);
  base.ki = Number(document.getElementById("ki").value);
  base.kd = Number(document.getElementById("kd").value);
  base.windE = Number(document.getElementById("wind").value);
  base.releaseAlt = Number(document.getElementById("alt").value);
  return base;
}

function applyPreset(name) {
  const sc = PRESETS[name];
  document.getElementById("kp").value = sc.kp;
  document.getElementById("ki").value = sc.ki;
  document.getElementById("kd").value = sc.kd;
  document.getElementById("wind").value = sc.windE;
  document.getElementById("alt").value = sc.releaseAlt;
  rebuild();
}

function rebuild() {
  const t = run.samples[index] ? run.samples[index].t : 0;
  run = runMission(scenarioFromUi());
  index = 0;
  for (let i = 0; i < run.samples.length; i++) {
    if (run.samples[i].t >= t) { index = i; break; }
  }
  shown = -1;
}

playBtn.onclick = () => {
  if (!playing && index >= run.samples.length - 1) index = 0;
  playing = !playing;
  playBtn.textContent = playing ? "Pause" : "Play";
};
document.getElementById("fwd").onclick = () => { playing = false; playBtn.textContent = "Play"; index = Math.min(run.samples.length - 1, index + 1); draw(); };
document.getElementById("back").onclick = () => { playing = false; playBtn.textContent = "Play"; index = Math.max(0, index - 1); draw(); };
presetSel.onchange = () => applyPreset(presetSel.value);
for (const id of ["kp", "ki", "kd", "wind", "alt"]) {
  document.getElementById(id).oninput = () => { preset = "custom"; rebuild(); draw(); };
}

window.addEventListener("keydown", (ev) => {
  if (ev.key === " ") { ev.preventDefault(); playBtn.click(); }
  if (ev.key === "ArrowRight") document.getElementById("fwd").click();
  if (ev.key === "ArrowLeft") document.getElementById("back").click();
  if (ev.key === "End") { playing = false; playBtn.textContent = "Play"; index = run.samples.length - 1; shown = -1; }
});

function resize(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(r.width * dpr));
  canvas.height = Math.max(1, Math.floor(r.height * dpr));
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}

function fit(s) {
  if (!s.dropped) return { n0: -50, n1: 260, e0: -90, e1: 90 };
  let n0 = -35, n1 = 110, e0 = -45, e1 = 45;
  for (const p of run.samples) {
    if (!p.dropped || p.t > s.t) continue;
    n0 = Math.min(n0, p.n - 15);
    n1 = Math.max(n1, p.n + 15);
    e0 = Math.min(e0, p.e - 15);
    e1 = Math.max(e1, p.e + 15);
  }
  if (e1 - e0 < 80) {
    const mid = (e0 + e1) / 2;
    e0 = mid - 40;
    e1 = mid + 40;
  }
  return { n0, n1, e0, e1 };
}

function drawMap() {
  const { g, w, h } = resize(map);
  const s = run.samples[index];
  const b = fit(s);
  const pad = 28;
  const spanN = b.n1 - b.n0;
  const spanE = b.e1 - b.e0;
  const scale = Math.min((w - pad * 2) / spanE, (h - pad * 2) / spanN);
  const ox = (w - spanE * scale) / 2;
  const oy = (h - spanN * scale) / 2;
  const X = (e) => ox + (e - b.e0) * scale;
  const Y = (n) => oy + (b.n1 - n) * scale;

  g.clearRect(0, 0, w, h);
  g.strokeStyle = "#1d2833";
  g.lineWidth = 1;
  for (let n = Math.ceil(b.n0 / 20) * 20; n < b.n1; n += 20) {
    g.beginPath(); g.moveTo(X(b.e0), Y(n)); g.lineTo(X(b.e1), Y(n)); g.stroke();
  }
  for (let e = Math.ceil(b.e0 / 20) * 20; e < b.e1; e += 20) {
    g.beginPath(); g.moveTo(X(e), Y(b.n0)); g.lineTo(X(e), Y(b.n1)); g.stroke();
  }

  function ring(radius, color, dash) {
    g.beginPath();
    g.arc(X(0), Y(0), radius * scale, 0, Math.PI * 2);
    g.strokeStyle = color;
    g.setLineDash(dash);
    g.stroke();
    g.setLineDash([]);
  }
  ring(P.SCORE_M, "#f0b429", [4, 4]);
  ring(minTurnRadius(), "#8eb6ff", [2, 3]);
  ring(P.TEN_FT_M, "#ff5d5d", []);

  g.beginPath();
  for (let i = 1; i <= index; i++) {
    const a = run.samples[i];
    if (!a.dropped) continue;
    g.strokeStyle = MODE_COLOR[a.mode] || "#3ee0c5";
    g.lineWidth = 2;
    g.moveTo(X(run.samples[i - 1].e), Y(run.samples[i - 1].n));
    g.lineTo(X(a.e), Y(a.n));
    g.stroke();
    g.beginPath();
  }

  const aircraft = (n, e, hdg, color) => {
    g.save();
    g.translate(X(e), Y(n));
    g.rotate((hdg - 90) * Math.PI / 180);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(10, 0); g.lineTo(-8, 6); g.lineTo(-4, 0); g.lineTo(-8, -6); g.closePath();
    g.fill();
    g.restore();
  };
  if (s.uasN > b.n1 || s.uasN < b.n0) {
    g.fillStyle = "#f0b429";
    g.fillText(`carrier ${s.uasN.toFixed(0)} m north`, 12, 18);
  } else {
    aircraft(s.uasN, 0, 180, "#f0b429");
    g.fillStyle = "#f0b429";
    g.fillText("carrier", X(0) + 12, Y(s.uasN) - 8);
  }
  if (s.dropped) aircraft(s.n, s.e, s.hdg, "#3ee0c5");

  g.strokeStyle = "#ff5d5d";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(X(0) - 7, Y(0)); g.lineTo(X(0) + 7, Y(0));
  g.moveTo(X(0), Y(0) - 7); g.lineTo(X(0), Y(0) + 7);
  g.stroke();

  g.font = "12px Segoe UI";
  if (s.dropped && s.dist > 22) {
    g.fillStyle = "#3ee0c5";
    g.fillText("payload", X(s.e) + 12, Y(s.n) - 8);
  }
  g.fillStyle = "#8ea0b3";
  g.fillText("amber 50 ft    blue min turn    red 10 ft", 12, h - 10);
  const wx = w - 70, wy = 28;
  g.strokeStyle = "#8eb6ff";
  g.beginPath();
  g.moveTo(wx, wy);
  g.lineTo(wx + s.we * 4, wy - s.wn * 4);
  g.stroke();
  g.fillStyle = "#8eb6ff";
  g.fillText("wind", wx - 28, wy - 8);
}

function drawChart() {
  const { g, w, h } = resize(chart);
  g.clearRect(0, 0, w, h);
  const t1 = run.samples[run.samples.length - 1].t || 1;
  const xOf = (t) => 36 + (t / t1) * (w - 48);
  g.strokeStyle = "#243140";
  g.beginPath(); g.moveTo(36, 8); g.lineTo(36, h - 16); g.lineTo(w - 8, h - 16); g.stroke();
  g.font = "11px Segoe UI";
  g.fillStyle = "#8ea0b3";
  g.fillText("alt", 6, 16);
  g.fillText("err", 6, h - 20);

  g.beginPath();
  run.samples.forEach((s, i) => {
    const y = 8 + (1 - s.alt / P.SCORE_M / 6) * (h - 28);
    if (i === 0) g.moveTo(xOf(s.t), y); else g.lineTo(xOf(s.t), y);
  });
  g.strokeStyle = "#3ee0c5";
  g.stroke();

  g.beginPath();
  run.samples.forEach((s, i) => {
    const y = h / 2 - (s.error / 180) * (h / 2 - 10);
    if (i === 0) g.moveTo(xOf(s.t), y); else g.lineTo(xOf(s.t), y);
  });
  g.strokeStyle = "#f0b429";
  g.stroke();

  const s = run.samples[index];
  g.strokeStyle = "#e8eef5";
  g.beginPath();
  g.moveTo(xOf(s.t), 6); g.lineTo(xOf(s.t), h - 16); g.stroke();
}

function row(active, dim, label, value) {
  const cls = active ? "active" : dim ? "dim" : "";
  return `<tr class="${cls}"><td>${label}</td><td>${value}</td></tr>`;
}

function drawSide() {
  const s = run.samples[index];
  const ll = nedToLl(s.n, s.e);
  const id = (1 << 3) | (s.state & 7);
  const guiding = s.pc === "guidance_step";
  const miss = run.miss;
  const inside = miss != null && miss <= P.SCORE_M;
  const bar = (v, color) => {
    const w = Math.max(0, Math.min(100, Math.abs(v) / 180 * 100));
    return `<div class="bar"><span style="width:${w}%;background:${color}"></span></div>`;
  };
  const phase = !s.dropped ? "Payload is still on the carrier. The radio state machine is running. Brakes stay locked."
    : s.pc === "drop_pulse" ? "Both servos go to the release angle and stay there for 0.35 s. Steering starts after that pulse."
    : s.mode === 1 ? "Altitude is above the glide slope, so the nose is held 50° off the bearing to bleed height."
    : s.mode === 2 ? "Still high and inside the loiter disk. Lead past 90° tightens the turn toward v/ω."
    : s.mode === 0 && guiding ? "On the glide slope. Desired heading is the bearing to the target."
    : "On the ground.";

  side.innerHTML = `
    <div class="miss">${s.dropped ? s.alt.toFixed(1) : s.uasN.toFixed(0)}<small>${s.dropped ? "m altitude" : "m north, still attached"}</small></div>
    <div class="muted">${miss == null ? "still flying" : `this run lands ${miss.toFixed(1)} m ${inside ? "inside" : "outside"} the 50 ft ring`}</div>
    <div class="chips" style="margin-top:8px">
      <span class="chip on">${STATE_NAME[s.state]}</span>
      <span class="chip">${s.dropped ? MODE_NAME[s.mode] : "ATTACHED"}</span>
      <span class="chip">t ${s.t.toFixed(2)} s</span>
      <span class="chip">${edited() ? "edited" : presetSel.value}</span>
    </div>
    <p class="note">${phase}</p>
    <h2>This tick</h2>
    <table>
      ${row(!s.dropped, false, "pc", s.pc)}
      ${row(true, false, "dist, bearing", `${s.dist.toFixed(1)} m, ${s.bearing.toFixed(1)}°`)}
      ${row(s.dropped, !s.dropped, "surplus = alt - dist/glide", `${s.surplus.toFixed(1)} m`)}
      ${row(guiding, !guiding, "desired heading", `${s.desired.toFixed(1)}°`)}
      ${row(guiding, !guiding, "error = wrap(desired - hdg)", `${s.error.toFixed(1)}°`)}
      ${row(guiding, !guiding, "P = kp * error", s.p.toFixed(1))}
      ${row(guiding, !guiding, "I = ki * integral", s.i.toFixed(1))}
      ${row(guiding, !guiding, "D = kd * d_filt", s.d.toFixed(1))}
      ${row(guiding || s.pc === "drop_pulse", false, "u and brakes L / R", `${s.u.toFixed(1)} → ${s.bl.toFixed(2)} / ${s.br.toFixed(2)}`)}
      ${row(true, false, "plant n, e, hdg", `${s.n.toFixed(1)}, ${s.e.toFixed(1)}, ${s.hdg.toFixed(1)}°`)}
    </table>
    <h2>PID memory</h2>
    <div class="mem">
      <div>integral<b>${s.integ.toFixed(2)}</b></div>
      <div>prev error<b>${s.prev.toFixed(2)}</b></div>
      <div>d filter<b>${s.dFilt.toFixed(2)}</b></div>
    </div>
    <div class="bars">
      ${bar(s.p, "#8ee0a8")}${bar(s.i, "#c9a6ff")}${bar(s.d, "#f0b429")}
    </div>
    <h2>Packet id byte</h2>
    <p class="note">Bottle A is bits 5:3, state is bits 2:0. Standby on bottle A is <b>0b00001001 = 9</b>, which is the id in the 2024 flight logs. Now: <b>${id}</b> (${id.toString(2).padStart(8, "0")}).</p>
    <p class="note">Lat ${ll.lat.toFixed(5)}, lon ${ll.lon.toFixed(5)}. Origin is the sketch default, Geisel Library.</p>
    <p class="muted">Kp ${Number(document.getElementById("kp").value).toFixed(1)} · Ki ${Number(document.getElementById("ki").value).toFixed(2)} · Kd ${Number(document.getElementById("kd").value).toFixed(2)} · wind ${Number(document.getElementById("wind").value).toFixed(1)} m/s east. Space plays. Arrows step one 50 ms tick. Sliders recompute locally.</p>
  `;
}

function edited() {
  const sc = PRESETS[presetSel.value];
  if (!sc) return true;
  return Number(document.getElementById("kp").value) !== sc.kp
    || Number(document.getElementById("ki").value) !== sc.ki
    || Number(document.getElementById("kd").value) !== sc.kd
    || Number(document.getElementById("wind").value) !== sc.windE
    || Number(document.getElementById("alt").value) !== sc.releaseAlt;
}

function draw() {
  drawMap();
  drawChart();
  drawSide();
}

function frame(now) {
  if (playing && now - last > 50) {
    last = now;
    index = Math.min(run.samples.length - 1, index + speed);
    if (index >= run.samples.length - 1) {
      playing = false;
      playBtn.textContent = "Play";
    }
  }
  if (shown !== index) {
    shown = index;
    draw();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
