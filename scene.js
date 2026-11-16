/* World axes: +X east, +Y up, −Z north. Yaw is clockwise from north.
   Pitch and roll are display-only. The plant integrates heading only. */

import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { P, minTurnRadius } from "./engine.js";

const DEG = Math.PI / 180;
const G = 9.81;

const MODE_RGB = {
  0: [0.45, 0.78, 0.62],
  1: [0.73, 0.66, 0.96],
  2: [0.22, 0.72, 0.64],
  3: [0.89, 0.68, 0.29],
};

export function attitudeOf(s) {
  const flying = s.dropped && s.alt > 0.05 && s.pc !== "landed";
  const mean = 0.5 * (s.bl + s.br);
  const sink = flying ? P.VS * (1 + 0.25 * mean) : 0;
  const yawRate = flying ? P.YAW_DPS * (s.br - s.bl) : 0;
  const pitch = flying ? -Math.atan2(sink, P.VH) * 180 / Math.PI : 0;
  const roll = flying ? Math.atan2(P.VH * (yawRate * DEG), G) * 180 / Math.PI : 0;
  return { yaw: s.hdg, pitch, roll, sink, yawRate };
}

function ring(radius, color, y) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.45, radius + 0.45, 96),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function disc(radius, color, opacity, y) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 72),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function buildPayload() {
  const g = new THREE.Group();
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xd86a32, roughness: 0.62, metalness: 0.02 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xe7edf3, roughness: 0.45, metalness: 0.08 });
  const canopy = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const u = i / 6 - 0.5;
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 1.28), canopyMat);
    const arc = Math.cos(u * Math.PI);
    cell.position.set(u * 3.05, 2.32 + (arc - 0.72) * 0.55, -0.05);
    cell.rotation.z = -u * 0.65;
    cell.rotation.x = 0.1;
    canopy.add(cell);
  }
  const flapGeo = new THREE.BoxGeometry(0.7, 0.06, 0.38);
  const flapL = new THREE.Mesh(flapGeo, new THREE.MeshStandardMaterial({ color: 0xa24b22, roughness: 0.7, emissive: 0x5a2410 }));
  const flapR = new THREE.Mesh(flapGeo, new THREE.MeshStandardMaterial({ color: 0xa24b22, roughness: 0.7, emissive: 0x5a2410 }));
  flapL.position.set(-1.15, 2.12, 0.58);
  flapR.position.set(1.15, 2.12, 0.58);
  canopy.add(flapL, flapR);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), new THREE.MeshBasicMaterial({ color: 0xff5a5a }));
  const green = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), new THREE.MeshBasicMaterial({ color: 0x3dd68c }));
  red.position.set(-1.55, 2.28, 0);
  green.position.set(1.55, 2.28, 0);
  canopy.add(red, green);

  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.85), cloth);
  pod.position.set(0, 0.28, 0);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.36, 8), cloth);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.28, -0.58);
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.55, 12),
    new THREE.MeshStandardMaterial({ color: 0x2f9e8f, roughness: 0.35, metalness: 0.15 }),
  );
  bottle.position.set(0, 0.22, 0.05);
  const pts = [];
  for (const x of [-2.35, -0.85, 0.85, 2.35]) {
    pts.push(new THREE.Vector3(x, 2.35, 0.05), new THREE.Vector3(0, 0.48, 0));
  }
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xd5dee6 }),
  );
  g.add(canopy, pod, nose, bottle, lines);
  g.userData.flapL = flapL;
  g.userData.flapR = flapR;
  return g;
}

function buildCarrier() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd5dbe3, roughness: 0.42, metalness: 0.18 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x8d9bab, roughness: 0.5, metalness: 0.25 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.5), bodyMat));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 8), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0, -0.36);
  g.add(nose);
  const motors = [[0.52, 0.4], [-0.52, 0.4], [0.52, -0.4], [-0.52, -0.4]];
  const rotors = [];
  for (const [x, z] of motors) {
    const dir = new THREE.Vector3(x, 0.06, z);
    const len = dir.length();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 6), armMat);
    arm.position.copy(dir).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    g.add(arm);
    const hub = new THREE.Group();
    hub.position.set(x, 0.1, z);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 16),
      new THREE.MeshBasicMaterial({ color: 0xe2b34a, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.015, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xe2b34a, roughness: 0.4 }),
    );
    blade.position.y = 0.02;
    hub.add(disc, blade);
    g.add(hub);
    rotors.push(hub);
  }
  g.scale.setScalar(1.8);
  g.userData.rotors = rotors;
  return g;
}

function makeRibbon() {
  const geo = new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

function writeRibbon(mesh, samples, count, pointAt, colorAt, width, cam) {
  if (count < 2) {
    mesh.visible = false;
    return;
  }
  const need = (count - 1) * 6;
  let pos = mesh.geometry.getAttribute("position");
  if (!pos || pos.count < need) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    mesh.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(need * 3), 3));
    mesh.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(need * 3), 3));
    pos = mesh.geometry.getAttribute("position");
  }
  const pa = pos.array;
  const ca = mesh.geometry.getAttribute("color").array;
  let v = 0;
  const pt = (i) => pointAt(samples[i]);
  for (let i = 0; i < count - 1; i++) {
    const a = pt(i);
    const b = pt(i + 1);
    if (cam) {
      const mx = (a.x + b.x) / 2 - cam.position.x;
      const my = (a.y + b.y) / 2 - cam.position.y;
      const mz = (a.z + b.z) / 2 - cam.position.z;
      if (mx * mx + my * my + mz * mz < 144) continue;
    }
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const px = -tz * width;
    const pz = tx * width;
    const c0 = colorAt(samples[i]);
    const c1 = colorAt(samples[i + 1]);
    const quad = [
      [a.x - px, a.y, a.z - pz, c0],
      [a.x + px, a.y, a.z + pz, c0],
      [b.x + px, b.y, b.z + pz, c1],
      [a.x - px, a.y, a.z - pz, c0],
      [b.x + px, b.y, b.z + pz, c1],
      [b.x - px, b.y, b.z - pz, c1],
    ];
    for (const p of quad) {
      const o = v * 3;
      pa[o] = p[0];
      pa[o + 1] = p[1];
      pa[o + 2] = p[2];
      ca[o] = p[3][0];
      ca[o + 1] = p[3][1];
      ca[o + 2] = p[3][2];
      v++;
    }
  }
  pos.needsUpdate = true;
  mesh.geometry.getAttribute("color").needsUpdate = true;
  mesh.geometry.setDrawRange(0, v);
  if (v > 0) mesh.geometry.computeBoundingSphere();
  mesh.visible = v > 0;
}

export function createView(canvas, tags, onFollow) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x10161d, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10161d);
  scene.fog = new THREE.Fog(0x10161d, 420, 1300);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.2, 4000);
  camera.position.set(50, 40, 50);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 3;
  controls.maxDistance = 900;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.target.set(0, 20, -40);
  controls.enabled = false;

  scene.add(new THREE.HemisphereLight(0xd7e3ef, 0x1b2732, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.45);
  sun.position.set(-60, 90, 40);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9eb4c9, 0.45);
  fill.position.set(40, 30, -50);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(700, 64),
    new THREE.MeshStandardMaterial({ color: 0x17202b, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(600, 30, 0x3d5166, 0x243140);
  grid.position.y = 0.04;
  scene.add(grid);

  scene.add(disc(P.SCORE_M, 0xe2b34a, 0.16, 0.06));
  scene.add(disc(P.TEN_FT_M, 0xf07167, 0.28, 0.08));
  scene.add(ring(P.SCORE_M, 0xe2b34a, 0.22));
  scene.add(ring(minTurnRadius(), 0x8eb4e8, 0.24));
  scene.add(ring(P.TEN_FT_M, 0xf07167, 0.26));

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 5, 8),
    new THREE.MeshStandardMaterial({ color: 0xf07167, emissive: 0x8a3030, emissiveIntensity: 0.4, roughness: 0.4 }),
  );
  pole.position.y = 2.5;
  scene.add(pole);

  const north = new THREE.Group();
  const northMat = new THREE.MeshBasicMaterial({ color: 0xd5dee8 });
  const northShaft = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 6), northMat);
  northShaft.position.set(0, 0.2, -(P.SCORE_M + 8));
  const northHead = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.2, 4), northMat);
  northHead.rotation.x = Math.PI / 2;
  northHead.position.set(0, 0.2, -(P.SCORE_M + 12));
  north.add(northShaft, northHead);
  scene.add(north);

  const payload = buildPayload();
  const carrier = buildCarrier();
  scene.add(payload, carrier);

  const air = makeRibbon();
  const shadowPath = makeRibbon();
  shadowPath.material.transparent = true;
  shadowPath.material.opacity = 0.28;
  const carrierPath = makeRibbon();
  scene.add(shadowPath, air, carrierPath);

  const dropLine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0x3dbea5, transparent: true, opacity: 0.65 }),
  );
  scene.add(dropLine);

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 20),
    new THREE.MeshBasicMaterial({ color: 0x05080c, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.1;
  scene.add(blob);

  const hdg = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.08, 7),
    new THREE.MeshBasicMaterial({ color: 0x3dbea5 }),
  );
  shaft.position.z = -3.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 8), new THREE.MeshBasicMaterial({ color: 0x3dbea5 }));
  head.rotation.x = Math.PI / 2;
  head.position.z = -7.4;
  hdg.add(shaft, head);
  scene.add(hdg);

  const wind = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(P.SCORE_M + 8, 2, 0), 8, 0x8eb4e8, 2, 1);
  wind.visible = false;
  scene.add(wind);

  const _dir = new THREE.Vector3();
  let follow = true;
  let snap = true;
  let current = null;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function place(el, world, hide) {
    if (!el) return;
    if (hide) {
      el.style.visibility = "hidden";
      return;
    }
    const rectW = canvas.clientWidth;
    const rectH = canvas.clientHeight;
    const v = world.clone().project(camera);
    const behind = world.clone().sub(camera.position).dot(camera.getWorldDirection(_dir)) <= 0;
    let x = (v.x * 0.5 + 0.5) * rectW;
    let y = (-v.y * 0.5 + 0.5) * rectH;
    const pad = 8;
    let ax = "-50%";
    let ay = "-140%";
    const edge = behind || x < pad || x > rectW - pad || y < pad || y > rectH - pad;
    if (x < pad) { x = pad; ax = "0%"; }
    else if (x > rectW - pad) { x = rectW - pad; ax = "-100%"; }
    if (y < pad) { y = pad; ay = "0%"; }
    else if (y > rectH - pad) { y = rectH - pad; ay = "-100%"; }
    el.style.visibility = "visible";
    el.style.transform = `translate(${x}px, ${y}px) translate(${ax}, ${ay})`;
    el.classList.toggle("edge", edge);
  }

  function show(run, index) {
    current = { run, index, s: run.samples[index] };
  }

  function updateTrails() {
    const { run, index } = current;
    const dropped = [];
    for (let i = 0; i <= index; i++) if (run.samples[i].dropped) dropped.push(run.samples[i]);
    const amber = [0.89, 0.7, 0.29];
    const dim = [0.15, 0.2, 0.26];
    writeRibbon(air, dropped, dropped.length, (p) => ({ x: p.e, y: Math.max(p.alt, 0.4), z: -p.n }), (p) => MODE_RGB[p.mode] || amber, 0.7, camera);
    writeRibbon(shadowPath, dropped, dropped.length, (p) => ({ x: p.e, y: 0.18, z: -p.n }), () => dim, 0.9, camera);
    const flown = run.samples.slice(0, index + 1);
    const calt = run.samples[0].alt;
    writeRibbon(carrierPath, flown, flown.length, (p) => ({ x: 0, y: calt, z: -p.uasN }), () => amber, 0.22, camera);
  }

  function applyPose(s, dt) {
    const att = attitudeOf(s);
    const calt = current.run.samples[0].alt;
    carrier.position.set(0, calt, -s.uasN);
    carrier.rotation.set(0, -Math.PI, 0);
    const spin = Math.max(dt, 0.016) * 28;
    for (const hub of carrier.userData.rotors) hub.rotation.y += spin;

    if (!s.dropped) {
      payload.position.set(0, calt - 3.5, -s.n);
      payload.rotation.set(0, -Math.PI, 0);
    } else {
      payload.position.set(s.e, Math.max(s.alt, 0), -s.n);
      payload.rotation.order = "YXZ";
      payload.rotation.set(-att.pitch * DEG, -att.yaw * DEG, -att.roll * DEG);
    }
    const flap = (mesh, amount) => {
      mesh.rotation.x = amount * 0.9;
      mesh.material.emissiveIntensity = 0.2 + amount * 0.8;
    };
    flap(payload.userData.flapL, s.dropped ? s.bl : 0);
    flap(payload.userData.flapR, s.dropped ? s.br : 0);

    const gy = s.dropped ? Math.max(s.alt, 0) : calt;
    const gx = s.dropped ? s.e : 0;
    const gz = s.dropped ? -s.n : -s.uasN;
    dropLine.visible = s.dropped && s.alt > 0.4;
    dropLine.scale.y = Math.max(s.alt, 0.01);
    dropLine.position.set(s.e, s.alt / 2, -s.n);
    blob.position.set(gx, 0.1, gz);
    const spread = 1 + (s.dropped ? s.alt : calt) / 50;
    blob.scale.set(spread, spread, 1);
    blob.material.opacity = Math.max(0.12, 0.4 - (s.dropped ? s.alt : 0) / 220);
    hdg.position.set(s.dropped ? s.e : 0, 0.3, s.dropped ? -s.n : -s.uasN);
    hdg.rotation.y = -(s.dropped ? s.hdg : 180) * DEG;

    const wv = new THREE.Vector3(s.we, 0, -s.wn);
    const mag = wv.length();
    wind.visible = mag > 0.2;
    if (wind.visible) {
      wind.position.set(P.SCORE_M + 7, 1.5, 0);
      wind.setDirection(wv.normalize());
      wind.setLength(5 + mag * 4, 1.8, 0.9);
    }

    place(tags.target, new THREE.Vector3(0, 6.2, 0), false);
    place(tags.payload, payload.position.clone().add(new THREE.Vector3(0, 3.4, 0)), follow);
    place(tags.carrier, carrier.position.clone().add(new THREE.Vector3(0, 2.2, 0)), false);
    return att;
  }

  function chase(s) {
    const yaw = (s.dropped ? s.hdg : 180) * DEG;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const pos = s.dropped
      ? new THREE.Vector3(s.e, Math.max(s.alt, 0), -s.n)
      : new THREE.Vector3(0, current.run.samples[0].alt, -s.uasN);
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(7);
    const cam = pos.clone().addScaledVector(fwd, -16).add(side);
    cam.y = pos.y + 14;
    const look = pos.clone().lerp(new THREE.Vector3(0, 0, 0), s.dropped ? 0.22 : 0.38);
    look.y = Math.max(2, pos.y * 0.45);
    return { cam, look };
  }

  function render(dt) {
    if (!current) return;
    applyPose(current.s, dt);
    if (follow) {
      const { cam, look } = chase(current.s);
      const k = snap ? 1 : 1 - Math.exp(-8 * Math.max(dt, 0.016));
      camera.position.lerp(cam, k);
      controls.target.lerp(look, k);
      camera.lookAt(controls.target);
      snap = false;
    } else {
      controls.update();
    }
    updateTrails();
    renderer.render(scene, camera);
  }

  function useFollow(on) {
    follow = on;
    controls.enabled = !on;
    if (on) snap = true;
    else controls.update();
    if (onFollow) onFollow(on);
  }

  function releaseFollow() {
    follow = false;
    controls.enabled = true;
    if (onFollow) onFollow(false);
  }

  function dropBox(run) {
    const box = new THREE.Box3();
    for (const s of run.samples) {
      if (s.dropped) box.expandByPoint(new THREE.Vector3(s.e, Math.max(s.alt, 0), -s.n));
    }
    box.expandByPoint(new THREE.Vector3(0, 0, 0));
    const rel = run.samples.find((s) => s.dropped);
    if (rel) box.expandByPoint(new THREE.Vector3(0, rel.alt, -rel.n));
    box.expandByScalar(P.SCORE_M * 0.35 + 4);
    return box;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (!follow || ev.button > 2) return;
    follow = false;
    controls.enabled = true;
    controls.update();
    if (onFollow) onFollow(false);
  }, true);

  canvas.addEventListener("wheel", () => {
    if (!follow) return;
    follow = false;
    controls.enabled = true;
    controls.update();
    if (onFollow) onFollow(false);
  }, { capture: true, passive: true });

  function overhead() {
    if (!current) return;
    releaseFollow();
    const sphere = dropBox(current.run).getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin((camera.fov * DEG) / 2) * 1.08;
    controls.target.set(sphere.center.x, 0, sphere.center.z);
    camera.position.set(sphere.center.x + 0.2, Math.max(dist, 30), sphere.center.z + dist * 0.012);
    controls.update();
  }

  function fit(run) {
    releaseFollow();
    const sphere = dropBox(run).getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin((camera.fov * DEG) / 2) * 1.05;
    const dir = new THREE.Vector3(0.62, 0.55, 0.78).normalize();
    controls.target.copy(sphere.center);
    controls.target.y *= 0.35;
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    controls.update();
  }

  resize();
  return { resize, show, render, useFollow, overhead, fit, isFollow: () => follow };
}
