/* Port of lib/tuas. tests/parity.mjs checks this against the C golden traces.
   Angles are degrees, clockwise from north. Positive u pulls the right brake. */

export const P = {
  DT: 0.05,
  VH: 7.5,
  VS: 2.4,
  YAW_DPS: 40.0,
  BRAKE_SLEW: 1.5,
  TEN_FT_M: 3.048,
  SCORE_M: 15.24,
  LOITER_M: 18.0,
  SURPLUS_M: 10.0,
  BLEED_DEG: 50.0,
  SPIRAL_LEAD_DEG: 90.0,
  KP: 3.0,
  KI: 0.08,
  KD: 0.45,
  U_LIM: 180.0,
  I_LIM: 30.0,
  D_ALPHA: 0.35,
  RELEASE_S: 0.35,
  DEADBAND: 3.0,
  ORIGIN_LAT: 32.8811,
  ORIGIN_LON: -117.2376,
};

export const MODE = { PURSUE: 0, BLEED: 1, SPIRAL: 2, RELEASE: 3 };
export const ST = { STANDBY: 1, TARGET: 2, ARMED: 3, DROP: 4 };

const DEG = Math.PI / 180;
const M_PER_DEG = 111320;

export function wrap360(deg) {
  deg = deg % 360;
  if (deg < 0) deg += 360;
  return deg;
}

export function wrap180(deg) {
  deg = wrap360(deg + 180) - 180;
  if (deg <= -180) deg += 360;
  return deg;
}

export function bearingDeg(north, east) {
  return wrap360(Math.atan2(east, north) / DEG);
}

export function nedToLl(north, east) {
  const lat = P.ORIGIN_LAT + north / M_PER_DEG;
  const lon = P.ORIGIN_LON + east / (M_PER_DEG * Math.cos(P.ORIGIN_LAT * DEG));
  return { lat, lon };
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

export function navigate(north, east, alt) {
  const dn = -north;
  const de = -east;
  const glide = P.VH / P.VS;
  const dist = Math.hypot(dn, de);
  const bearing = bearingDeg(dn, de);
  const surplus = alt - dist / glide;
  const nav = { dist, bearing, surplus, inside10: dist <= P.TEN_FT_M, mode: MODE.PURSUE, desired: bearing };
  if (surplus > P.SURPLUS_M && dist > P.LOITER_M) {
    nav.mode = MODE.BLEED;
    nav.desired = wrap360(bearing + P.BLEED_DEG);
  } else if (surplus > 6 && dist > 14) {
    let extra = (dist - 11) * 4;
    if (extra < 0) extra = 0;
    if (extra > 40) extra = 40;
    nav.mode = MODE.SPIRAL;
    nav.desired = wrap360(bearing + P.SPIRAL_LEAD_DEG + extra);
  }
  return nav;
}

function brakesFromU(u) {
  const mag = Math.min(1, Math.abs(u) / P.U_LIM);
  if (u > P.DEADBAND) return { left: 0, right: mag };
  if (u < -P.DEADBAND) return { left: mag, right: 0 };
  return { left: 0, right: 0 };
}

function slew(current, target, rate, dt) {
  const step = rate * dt;
  let d = target - current;
  if (d > step) d = step;
  if (d < -step) d = -step;
  return current + d;
}

function pidStep(pid, error, dt) {
  if (!pid.ready || dt <= 0 || dt > 0.5) {
    pid.prev = error;
    pid.dFilt = 0;
    pid.ready = 1;
    const p = pid.kp * error;
    const i = pid.ki * pid.integral;
    return { p, i, d: 0, u: clamp(p + i, -P.U_LIM, P.U_LIM) };
  }
  const deriv = (error - pid.prev) / dt;
  pid.dFilt = P.D_ALPHA * deriv + (1 - P.D_ALPHA) * pid.dFilt;
  const unsat = pid.kp * error + pid.ki * pid.integral + pid.kd * pid.dFilt;
  const pushing = (unsat >= P.U_LIM && error > 0) || (unsat <= -P.U_LIM && error < 0);
  if (!pushing) pid.integral = clamp(pid.integral + error * dt, -P.I_LIM, P.I_LIM);
  pid.prev = error;
  const p = pid.kp * error;
  const i = pid.ki * pid.integral;
  const d = pid.kd * pid.dFilt;
  return { p, i, d, u: clamp(p + i + d, -P.U_LIM, P.U_LIM) };
}

function plantStep(plant, cmdL, cmdR, windN, windE, dt) {
  const psi = plant.hdg * DEG;
  const mean = 0.5 * (plant.bl + plant.br);
  const sink = P.VS * (1 + 0.25 * mean);
  plant.bl = slew(plant.bl, cmdL, P.BRAKE_SLEW, dt);
  plant.br = slew(plant.br, cmdR, P.BRAKE_SLEW, dt);
  plant.n += (P.VH * Math.cos(psi) + windN) * dt;
  plant.e += (P.VH * Math.sin(psi) + windE) * dt;
  plant.alt -= sink * dt;
  if (plant.alt < 0) plant.alt = 0;
  const yaw = P.YAW_DPS * (plant.br - plant.bl);
  plant.hdg = wrap360(plant.hdg + yaw * dt);
}

export function scenarioCalm() {
  return {
    windN: 0, windE: 0, gust: 0, releaseN: 90, releaseAlt: 60,
    kp: P.KP, ki: P.KI, kd: P.KD, invert: false, guided: true, seed: 1,
  };
}

function gustEast(sc, t) {
  const phase = (sc.seed % 360) * DEG;
  return sc.windE + sc.gust * Math.sin(0.35 * t + phase);
}

export function createMission(sc) {
  return {
    sc,
    n: 220, e: 0, alt: sc.releaseAlt, hdg: 180, bl: 0, br: 0,
    uasN: 220,
    t: 0,
    state: ST.STANDBY,
    dropped: false,
    landed: false,
    releaseLeft: 0,
    miss: null,
    pid: { kp: sc.kp, ki: sc.ki, kd: sc.kd, integral: 0, prev: 0, dFilt: 0, ready: false },
  };
}

export function stepMission(m) {
  const dt = P.DT;
  const windN = m.sc.windN;
  const windE = gustEast(m.sc, m.t);
  let cmdL = 0;
  let cmdR = 0;
  let error = 0;
  let terms = { p: 0, i: 0, d: 0, u: 0 };
  let pc = "fsm_armed";

  m.t += dt;
  m.uasN -= 12 * dt;
  if (!m.dropped) {
    m.n = m.uasN;
    m.e = 0;
    m.alt = m.sc.releaseAlt;
    m.hdg = 180;
  }

  if (!m.dropped && m.uasN <= m.sc.releaseN) {
    m.dropped = true;
    m.state = ST.DROP;
    m.releaseLeft = P.RELEASE_S;
    m.n = m.sc.releaseN;
    m.hdg = 180;
  } else if (m.t >= 0.4 && m.t < 0.8 && m.state === ST.STANDBY) {
    m.state = ST.TARGET;
  } else if (m.t >= 0.8 && m.t < 1.2 && m.state === ST.TARGET) {
    m.state = ST.ARMED;
  }

  let nav = navigate(m.n, m.e, m.alt);

  if (!m.dropped) {
    pc = m.state === ST.STANDBY ? "fsm_standby" : m.state === ST.TARGET ? "fsm_target" : "fsm_armed";
  } else if (m.releaseLeft > 0) {
    m.releaseLeft -= dt;
    cmdL = 1;
    cmdR = 1;
    nav = { ...nav, mode: MODE.RELEASE };
    pc = "drop_pulse";
  } else if (m.alt <= 0) {
    m.landed = true;
    nav = { ...nav, mode: MODE.PURSUE };
    pc = "landed";
  } else if (!m.sc.guided) {
    pc = "ballistic";
  } else {
    error = wrap180(nav.desired - m.hdg);
    if (m.sc.invert) error = -error;
    terms = pidStep(m.pid, error, dt);
    const b = brakesFromU(terms.u);
    cmdL = b.left;
    cmdR = b.right;
    pc = "guidance_step";
  }

  if (m.dropped && m.alt > 0) {
    plantStep(m, cmdL, cmdR, windN, windE, dt);
  }

  if (m.landed || (m.dropped && m.alt <= 0 && m.releaseLeft <= 0)) {
    m.landed = true;
    m.alt = 0;
    m.miss = Math.hypot(m.n, m.e);
  }

  return {
    t: m.t, n: m.n, e: m.e, alt: m.alt, hdg: m.hdg, uasN: m.uasN,
    dist: nav.dist, bearing: nav.bearing, desired: nav.desired,
    error, surplus: nav.surplus, p: terms.p, i: terms.i, d: terms.d, u: terms.u,
    integ: m.pid.integral, prev: m.pid.prev, dFilt: m.pid.dFilt,
    bl: m.bl, br: m.br, wn: windN, we: windE,
    state: m.state, mode: nav.mode, ten: nav.inside10 ? 1 : 0,
    dropped: m.dropped ? 1 : 0, pc, landed: m.landed, miss: m.miss,
    kp: m.pid.kp, ki: m.pid.ki, kd: m.pid.kd,
  };
}

export function runMission(sc, limit = 20000) {
  const m = createMission(sc);
  const samples = [];
  let guard = 0;
  let landed = false;
  while (!landed && guard < limit) {
    const s = stepMission(m);
    landed = s.landed;
    samples.push(s);
    guard++;
  }
  return { samples, miss: m.miss, steps: guard };
}

export const MODE_NAME = ["PURSUE", "BLEED", "SPIRAL", "RELEASE"];
export const STATE_NAME = { 1: "STANDBY", 2: "TARGET_ACQUIRED", 3: "ARMED", 4: "DROP" };

export function minTurnRadius() {
  return P.VH / (P.YAW_DPS * DEG);
}
