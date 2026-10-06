// Pembangun scene three.js untuk pohon espalier 3D. Dipisah dari React supaya komponen hanya mengurus siklus hidup.
// Port dari hero3D() di espalier.html, dengan dua perubahan: bentuk pohon berasal dari layoutTree3D(input)
// (bukan angka tetap), dan disesuaikan untuk three modern (warna sRGB, intensitas cahaya fisik: ×π dari r128).
import * as THREE from "three";
import { GROUND_Y, type Layout3D } from "@/lib/tree3d-layout";

type TubeObj = { mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>; curve: THREE.CatmullRomCurve3; total: number; rad: number };
type Anim =
  | { kind: "tube"; o: TubeObj; start: number; dur: number }
  | { kind: "pop"; o: THREE.Mesh; s: THREE.Vector3; start: number; dur: number };
type Fruit = { f: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>; base: number; ph: number };

export type TreeScene = { replant(): void; setReduced(v: boolean): void; dispose(): void };
export type SceneOptions = { reduced: boolean; onContextLost?: () => void; onReady?: () => void };

function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeBack = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createTreeScene(host: HTMLElement, layout: Layout3D, opts: SceneOptions): TreeScene {
  const T = THREE;
  const root = document.documentElement;
  let reduced = opts.reduced;

  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); // melempar bila WebGL tidak ada: ditangani pemanggil
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;cursor:grab;touch-action:pan-y;opacity:0;transition:opacity .5s ease";
  host.insertBefore(canvas, host.firstChild);
  // Pengait untuk tes browser (scripts/e2e-tree3d.mjs): ringkasan isi scene, dan penanda setelah frame pertama tergambar.
  host.dataset.cordons = String(layout.cordons.length); host.dataset.tiers = String(layout.tierYs.length);
  host.dataset.fruits = String(layout.cordons.reduce((a, c) => a + c.fruits, 0)); host.dataset.treeReady = "0";

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
  const hemi = new T.HemisphereLight(0xfffaf0, 0x5a4636, 0.85 * Math.PI); scene.add(hemi);
  const sun = new T.DirectionalLight(0xfff1d6, 0.95 * Math.PI);
  sun.position.set(-3.5, 5.5, 7); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 });
  sun.shadow.bias = -0.0006; scene.add(sun);
  const glow = new T.PointLight(0xe0bd4a, 6, 9, 1.4); glow.position.set(2.2, -0.5, 2.4); scene.add(glow);

  const rig = new T.Group(); scene.add(rig);
  const R = 4.3, CY = 0.05;

  // Dinding hanya menerima bayangan: halaman itu sendiri adalah dindingnya.
  const shadowMat = new T.ShadowMaterial({ opacity: 0.18 });
  const wall = new T.Mesh(new T.PlaneGeometry(12, 10), shadowMat);
  wall.position.z = -0.42; wall.receiveShadow = true; rig.add(wall);

  // Kisi Belgian fence, dipotong membentuk lingkaran.
  const latPts: number[] = [], s2 = Math.SQRT1_2;
  for (const [ux, uy] of [[s2, s2], [s2, -s2]]) {
    const nx = -uy, ny = ux;
    for (let d = -R + 0.3; d < R; d += 0.62) {
      const h = Math.sqrt(R * R - d * d);
      latPts.push(d * nx - h * ux, CY + d * ny - h * uy, -0.38, d * nx + h * ux, CY + d * ny + h * uy, -0.38);
    }
  }
  const latGeo = new T.BufferGeometry(); latGeo.setAttribute("position", new T.Float32BufferAttribute(latPts, 3));
  const latMat = new T.LineBasicMaterial({ transparent: true, opacity: 0.45 });
  rig.add(new T.LineSegments(latGeo, latMat));

  const barkMat = new T.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const leafMat = new T.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: T.DoubleSide });
  const fruitMat = new T.MeshStandardMaterial({ roughness: 0.32, metalness: 0.35 });
  const wireMat = new T.MeshStandardMaterial({ roughness: 0.35, metalness: 0.75 });

  const anim: Anim[] = [];
  const tube = (pts: number[][], r: number, seg = 72): TubeObj => {
    const curve = new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(p[0], p[1], p[2])));
    const mesh = new T.Mesh(new T.TubeGeometry(curve, seg, r, 10, false), barkMat);
    mesh.castShadow = true; rig.add(mesh);
    return { mesh, curve, total: seg, rad: 10 };
  };

  // Kawat berpaku di tiap tingkat, ditambah satu kawat di atas.
  const wireYs = [...layout.tierYs, layout.trunkTop - 0.1];
  wireYs.forEach((y) => {
    const half = Math.sqrt(Math.max(0, R * R - (y - CY) ** 2)) - 0.15;
    const w = new T.Mesh(new T.CylinderGeometry(0.013, 0.013, half * 2, 6), wireMat);
    w.rotation.z = Math.PI / 2; w.position.set(0, y, -0.05); w.castShadow = true; rig.add(w);
    [-half, half].forEach((x) => { const n = new T.Mesh(new T.SphereGeometry(0.045, 10, 8), wireMat); n.position.set(x, y, -0.2); rig.add(n); });
  });

  const trunk = tube([[0, GROUND_Y - 0.1, 0], [0.03, -1.6, 0.02], [-0.02, -0.2, 0], [0.015, 1.1, 0.01], [0, layout.trunkTop, 0]], 0.09, 90);
  anim.push({ kind: "tube", o: trunk, start: 0, dur: 1.1 });
  const ground = new T.Mesh(new T.BoxGeometry(2.2, 0.02, 0.3), barkMat);
  ground.position.set(0, GROUND_Y - 0.1, 0); ground.receiveShadow = true; rig.add(ground);

  const leafGeo = new T.SphereGeometry(1, 12, 8), fruitGeo = new T.SphereGeometry(1, 24, 18);
  const rand = mulberry(layout.seed);
  const fruits: Fruit[] = [];
  const K = layout.scale; // 1 untuk <= 4 tingkat; mengecil bila kawat dirapatkan (lihat layoutTree3D)
  const leafScale = new T.Vector3(0.17 * K, 0.065 * K, 0.03 * K), fruitScale = new T.Vector3(0.095 * K, 0.1 * K, 0.095 * K);
  let fruitIdx = 0;

  layout.cordons.forEach((c, bi) => {
    const { dir, y, len: L } = c;
    const b = tube([[0, y - 0.02, 0], [dir * 0.35, y - 0.07, 0.03], [dir * 1.0, y, 0.04], [dir * (L - 0.45), y, 0.03], [dir * (L - 0.1), y + 0.07, 0.01], [dir * L, y + 0.42, 0]], 0.052, 80);
    const st = 0.75 + bi * 0.17, du = 0.85;
    anim.push({ kind: "tube", o: b, start: st, dur: du });
    for (let k = 0; k < c.leaves; k++) {
      const u = 0.1 + (0.88 * (k + 0.5)) / c.leaves, p = b.curve.getPointAt(u), tg = b.curve.getTangentAt(u);
      const side = k % 2 ? 1 : -1, ang = Math.atan2(tg.y, tg.x) + side * 0.9;
      const m = new T.Mesh(leafGeo, leafMat);
      m.position.set(p.x + Math.cos(ang) * 0.14 * K, p.y + Math.sin(ang) * 0.14 * K, p.z + (k % 3) * 0.03 - 0.02);
      m.rotation.set(k % 2 ? 0.35 : -0.35, ((k % 3) - 1) * 0.4, ang);
      m.castShadow = true; m.scale.setScalar(0.0001); rig.add(m);
      anim.push({ kind: "pop", o: m, s: leafScale, start: st + du * u * 0.9, dur: 0.5 });
    }
    // Buah menggantung di bawah cordon pada tangkai pendek.
    for (let k = 0; k < c.fruits; k++) {
      const u = 0.3 + (0.62 * (k + 0.5)) / c.fruits, p = b.curve.getPointAt(u);
      const f = new T.Mesh(fruitGeo, fruitMat.clone());
      f.position.set(p.x + (k % 2 ? 0.04 : -0.03), p.y - 0.2 * K, p.z + 0.1);
      f.scale.setScalar(0.0001); f.castShadow = true; rig.add(f);
      const stalk = tube([[p.x, p.y - 0.02, p.z + 0.05], [f.position.x, f.position.y + 0.07 * K, f.position.z]], 0.009, 8);
      fruits.push({ f, base: f.position.y, ph: rand() * 6 });
      const start = 2.6 + fruitIdx++ * 0.13;
      anim.push({ kind: "tube", o: stalk, start: start - 0.15, dur: 0.2 }, { kind: "pop", o: f, s: fruitScale, start, dur: 0.6 });
    }
  });

  // Serbuk sari yang melayang.
  const PN = 110, pPos = new Float32Array(PN * 3), pSpd = new Float32Array(PN);
  const seedR = mulberry(7);
  for (let i = 0; i < PN; i++) { pPos[i * 3] = (seedR() - 0.5) * 8; pPos[i * 3 + 1] = (seedR() - 0.5) * 7; pPos[i * 3 + 2] = seedR() * 1.6 - 0.2; pSpd[i] = 0.08 + seedR() * 0.18; }
  const pGeo = new T.BufferGeometry(); pGeo.setAttribute("position", new T.BufferAttribute(pPos, 3));
  const dot = document.createElement("canvas"); dot.width = dot.height = 64;
  const dc = dot.getContext("2d")!, grd = dc.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.4, "rgba(255,255,255,.6)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  dc.fillStyle = grd; dc.fillRect(0, 0, 64, 64);
  const dotTex = new T.CanvasTexture(dot); dotTex.colorSpace = T.SRGBColorSpace;
  const pMat = new T.PointsMaterial({ size: 0.07, map: dotTex, transparent: true, opacity: 0.6, depthWrite: false });
  rig.add(new T.Points(pGeo, pMat));

  // Warna mengikuti tema halaman (variabel CSS yang sama dengan pohon SVG).
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  function themeColours() {
    const cs = getComputedStyle(root), c = (n: string) => new T.Color(cs.getPropertyValue(n).trim() || "#888888");
    const dark = isDark();
    barkMat.color = c("--bark"); leafMat.color = c("--leaf");
    fruitMat.color = c("--fruit");
    fruits.forEach((o) => { o.f.material.color = c("--fruit"); o.f.material.emissive = c("--fruit"); });
    wireMat.color = c("--wire").lerp(new T.Color(dark ? 0x9aa29c : 0xffffff), 0.35);
    latMat.color = c("--wire"); latMat.opacity = dark ? 0.7 : 0.55;
    pMat.color = c("--fruit");
    shadowMat.opacity = dark ? 0.5 : 0.2;
    hemi.intensity = (dark ? 0.5 : 0.85) * Math.PI; hemi.groundColor = c("--bark"); sun.intensity = (dark ? 0.75 : 0.95) * Math.PI;
    glow.color = c("--fruit");
    redraw();
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const k = Math.tan((16 * Math.PI) / 180);
    camera.position.set(0, 0.15, Math.max(3.75 / k, 4.15 / (k * camera.aspect)));
    camera.updateProjectionMatrix(); redraw();
  }

  // Interaksi: parallax mengikuti kursor, seret untuk memutar.
  let mx = 0, my = 0, drag = 0, dragging = false, lastX = 0;
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    mx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.8), -1, 1);
    my = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 0.8), -1, 1);
    if (dragging) { drag = clamp(drag + (e.clientX - lastX) * 0.006, -1.1, 1.1); lastX = e.clientX; if (reduced) redraw(); }
  };
  const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; canvas.style.cursor = "grabbing"; };
  const onUp = () => { dragging = false; canvas.style.cursor = "grab"; };
  window.addEventListener("pointermove", onMove, { passive: true });
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  function applyGrowth(t: number) {
    for (const a of anim) {
      const p = clamp((t - a.start) / a.dur, 0, 1);
      if (a.kind === "tube") a.o.mesh.geometry.setDrawRange(0, Math.ceil(easeOut(p) * a.o.total) * a.o.rad * 6);
      else { const s = p <= 0 ? 0.0001 : easeBack(p); a.o.scale.set(a.s.x * s, a.s.y * s, a.s.z * s); }
    }
  }

  let t0 = performance.now(), last = t0, visible = true, raf = 0, shown = false, pulse: { f: Fruit; s: number } | null = null, nextPulse = 5;
  const reveal = () => { if (!shown) { shown = true; canvas.style.opacity = "1"; host.dataset.treeReady = "1"; opts.onReady?.(); } };
  function frame(now: number) {
    raf = 0;
    const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
    applyGrowth(t);
    if (!dragging) drag *= 0.96;
    rig.rotation.y = lerp(rig.rotation.y, mx * 0.32 + drag + Math.sin(t * 0.35) * 0.05, 0.06);
    rig.rotation.x = lerp(rig.rotation.x, my * 0.1 - 0.02, 0.06);
    rig.position.y = lerp(rig.position.y, Math.min(1.2, window.scrollY * 0.0012), 0.1);
    for (let i = 0; i < PN; i++) {
      pPos[i * 3 + 1] += pSpd[i] * dt; pPos[i * 3] += Math.sin(t * 0.5 + i) * 0.0015;
      if (pPos[i * 3 + 1] > 3.6) pPos[i * 3 + 1] = -3.6;
    }
    pGeo.attributes.position.needsUpdate = true;
    fruits.forEach((o) => { o.f.position.y = o.base + Math.sin(t * 1.2 + o.ph) * 0.012; o.f.material.emissiveIntensity = 0.08; });
    // Kilau panen yang pelan pada satu buah setiap kali.
    if (fruits.length && t > nextPulse) { pulse = { f: fruits[Math.floor(rand() * fruits.length)], s: t }; nextPulse = t + 4.5; }
    if (pulse) { const k = (t - pulse.s) / 1.6; if (k < 1) pulse.f.f.material.emissiveIntensity = 0.08 + Math.sin(k * Math.PI) * 0.6; else pulse = null; }
    renderer.render(scene, camera); reveal();
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  // Mode reduced-motion: tanpa animasi; gambar utuh sekali, ulang hanya saat ada perubahan (resize, tema, seret).
  function redraw() {
    if (!reduced) return;
    applyGrowth(99);
    rig.rotation.y = drag; rig.rotation.x = -0.02; rig.position.y = 0;
    fruits.forEach((o) => { o.f.position.y = o.base; o.f.material.emissiveIntensity = 0.08; });
    renderer.render(scene, camera); reveal();
  }
  function start() { if (!reduced && visible && !document.hidden && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  themeColours(); resize();
  const ro = new ResizeObserver(resize); ro.observe(host);
  const mql = matchMedia("(prefers-color-scheme: dark)");
  const themeObs = new MutationObserver(themeColours); themeObs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  mql.addEventListener("change", themeColours);
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); }); io.observe(host);
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener("visibilitychange", onVis);
  const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; opts.onContextLost?.(); };
  canvas.addEventListener("webglcontextlost", onLost);
  if (reduced) redraw(); else start();

  return {
    replant() { t0 = performance.now(); nextPulse = 5; pulse = null; if (reduced) redraw(); else start(); },
    setReduced(v) { if (v === reduced) return; reduced = v; if (v) { cancelAnimationFrame(raf); raf = 0; redraw(); } else { t0 = performance.now(); start(); } },
    dispose() {
      cancelAnimationFrame(raf); raf = 0; ro.disconnect(); io.disconnect(); themeObs.disconnect();
      mql.removeEventListener("change", themeColours); document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("webglcontextlost", onLost);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      dotTex.dispose(); renderer.dispose(); canvas.remove();
      for (const k of ["cordons", "tiers", "fruits", "treeReady"]) delete host.dataset[k];
    },
  };
}
