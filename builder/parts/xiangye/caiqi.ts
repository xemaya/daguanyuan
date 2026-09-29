import * as THREE from 'three';
import type { PartBuild, PartContext } from '../registry';
import { getPlan } from '@builder/compose/terrain';
import { Simplex, makeRng } from '@engine/core/Noise';
import { cached, recipeKey, dirtPathMaps } from '@engine/core/TextureLab';
import { planItem, planGround, type P2 } from './plan-data';

/**
 * 菜畦(单子 BB6,用户 2026-09-29 取甲档:茆堂以北到背山,e09 出村路两侧)。
 * 07-11「下面分畦列畝,佳蔬菜花,漫然無際」。
 *
 * 做法:
 *   畦   —— 田块是一片 Voronoi 拼块(每块 5–9 m),每块自己的垄向(东西或南北,±9° 抖),块与块之间留 0.4 m 田埂;
 *           块内一垄一沟(垄宽 1.0、沟 0.5),垄是低土埂实例、沟与垄下铺一层土片实例(盖住草地)。
 *   蔬菜 —— 垄上两行矮绿丛(十字叶卡,实例化),株距 0.4 m;
 *   菜花 —— 约四成田块种油菜:密的黄花丛(三片交叉卡,实例化),高 0.7–1.0 m。
 *   漫然無際 —— 一直铺到区多边形边界;南沿(茆堂那一侧)用噪声抖出参差边,不留整齐矩形。
 *   避让 —— plan 的水面(离水 2 m)、落脚面、泥墙青篱(1.5 m)、e09 与进村路(路两侧各 1.6 m)、背山脚。
 * 全部数据读 plan(区多边形、水、pads、墙篱走线、游线、背山锚点);**所有植株与垄都是 InstancedMesh**。
 * 局部坐标:原点在 plan 锚点(地面高按装配器的同一个 ground 取),几何按世界地面起伏。
 */
interface FieldSpec {
  clipSouthZ: number; roadClearM: number; waterClearM: number; wallClearM: number; hillClearM: number;
  roads: string[]; hill: string; rapeShare: number; plotM: number; bedM: number; furrowM: number; baulkM: number;
}
const PROVENANCE = [{ id: 'project:vegetable-plots', name: '菜畦', method: 'artistic_choice',
  note: '07-11「分畦列畝,佳蔬菜花,漫然無際」;位置按用户 2026-09-29 裁定(BB6 甲档)。田块 5–9 m 拼块、垄宽 1.0 沟 0.5、田埂 0.4、株距 0.4、油菜约四成——尺寸为艺术取值,范围与避让读 plan。' }];

const inPoly = (poly: readonly P2[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const segD = (px: number, pz: number, a: P2, b: P2) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L));
  return Math.hypot(a[0] + dx * t - px, a[1] + dz * t - pz);
};
const lineD = (pts: readonly P2[], x: number, z: number) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segD(x, z, pts[i - 1], pts[i])); return d; };

/* ---- 贴图与材质(全园一份) ---- */
let MATS: { soil: THREE.MeshStandardMaterial; veg: THREE.MeshStandardMaterial; rape: THREE.MeshStandardMaterial } | undefined;
function canvasTex(key: string, draw: (c: CanvasRenderingContext2D, S: number) => void, S = 256): THREE.Texture {
  return cached(recipeKey(key, S), () => {
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const c = cv.getContext('2d')!; c.clearRect(0, 0, S, S); draw(c, S);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; return t;
  });
}
function materials() {
  if (MATS) return MATS;
  const d = dirtPathMaps();
  const soil = new THREE.MeshStandardMaterial({ map: d.map, normalMap: d.normalMap, roughness: 1, metalness: 0, color: 0x8a8a80 }); // 土路贴图偏橙红,乘灰绿一档读成翻过的菜地土
  // 蔬菜:一丛阔叶(白菜/青菜一类),下深上浅,叶脉一笔。
  const vegTex = canvasTex('xiangye.veg-clump', (c, S) => {
    const rng = makeRng(0x7e9);
    for (let i = 0; i < 11; i++) {
      const a = -1.2 + (i / 10) * 2.4 + (rng() - 0.5) * 0.25, L = S * (0.42 + rng() * 0.32), W = L * (0.36 + rng() * 0.1);
      c.save(); c.translate(S / 2, S * 0.98); c.rotate(a);
      const g = c.createLinearGradient(0, 0, 0, -L);
      g.addColorStop(0, '#3f6b2a'); g.addColorStop(0.6, '#6f9d3e'); g.addColorStop(1, '#9cc55b');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(W, -L * 0.2, W * 1.05, -L * 0.8, 0, -L); c.bezierCurveTo(-W * 1.05, -L * 0.8, -W, -L * 0.2, 0, 0); c.fill();
      c.strokeStyle = 'rgba(220,240,190,0.5)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -L * 0.9); c.stroke();
      c.restore();
    }
  });
  // 油菜:细茎顶上一簇簇黄花,中下部是叶。
  const rapeTex = canvasTex('xiangye.rape-clump', (c, S) => {
    const rng = makeRng(0x4a9e);
    for (let i = 0; i < 9; i++) {
      const x0 = S * (0.2 + rng() * 0.6), top = S * (0.04 + rng() * 0.22), lean = (rng() - 0.5) * S * 0.12;
      c.strokeStyle = '#5f8a35'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(S / 2 + (x0 - S / 2) * 0.3, S); c.quadraticCurveTo(x0, S * 0.6, x0 + lean, top + S * 0.05); c.stroke();
      for (let k = 0; k < 16; k++) {
        const fx = x0 + lean + (rng() - 0.5) * S * 0.14, fy = top + rng() * S * 0.16;
        c.fillStyle = rng() < 0.8 ? '#f2cf22' : '#e2b514';
        c.beginPath(); c.arc(fx, fy, 3 + rng() * 4, 0, Math.PI * 2); c.fill();
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = -1 + rng() * 2, L = S * (0.25 + rng() * 0.2);
      c.save(); c.translate(S / 2, S); c.rotate(a); c.fillStyle = '#4f7d31';
      c.beginPath(); c.ellipse(0, -L / 2, L * 0.18, L / 2, 0, 0, Math.PI * 2); c.fill(); c.restore();
    }
  });
  const leafMat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  MATS = { soil, veg: leafMat(vegTex), rape: leafMat(rapeTex) };
  return MATS;
}

/* ---- 原型几何 ---- */
/** n 片竖卡绕 Y 均分,底边中点在原点,宽 w 高 h;法线统一朝上偏(双面卡不一面黑)。 */
function cards(n: number, w: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI, dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2, b = pos.length / 3;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, h, dz, -dx, h, -dz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let i = 0; i < 4; i++) nrm.push(0, 1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
/** 一段土垄:沿 X 长 L,截面圆拱(宽 w、高 h),两端斜收。 */
function ridgeGeo(L: number, w: number, h: number): THREE.BufferGeometry {
  const sec: P2[] = [[-w / 2, 0], [-w * 0.32, h * 0.8], [0, h], [w * 0.32, h * 0.8], [w / 2, 0]];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const xs = [-L / 2, -L / 2 + 0.15, L / 2 - 0.15, L / 2];
  xs.forEach((x, j) => {
    const end = j === 0 || j === 3;
    for (const [z, y] of sec) { pos.push(x, end ? y * 0.25 : y, end ? z * 0.8 : z); uv.push(x / 1.5, z / 1.5); }
  });
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { const a = j * 5 + i, c = a + 5; idx.push(a, a + 1, c, a + 1, c + 1, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function tile(size: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size); g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 1.5, uv.getY(i) * size / 1.5);
  return g;
}

export function buildCaiqi(variant: string, context?: PartContext): PartBuild {
  const id = variant === 'default' ? 'daoxiangcun.vegetable-plots' : variant;
  const item = planItem(id) as ReturnType<typeof planItem> & { field?: FieldSpec };
  const F = item.field;
  if (item.kind !== 'planting' || !F) throw new Error(`[caiqi] ${id} 不是带 field 规格的种植对象`);
  const plan = getPlan() as unknown as {
    regions: { id: string; polygon: P2[]; buildings: { id: string; x: number; z: number; layout?: { runs: { points: P2[] }[] } }[]; rocks?: { id: string; x: number; z: number }[]; pads?: { polygon: P2[] }[] }[];
    water: { id: string; polygon?: P2[] }[]; paths: { id: string; points: P2[] }[];
    narrativeRoutes: { legs: { id: string; points: P2[] }[] }[];
  };
  const region = plan.regions.find((r) => r.buildings.some((b) => b.id === id))!;
  const ground = context?.ground ?? planGround();
  const ox = item.x, oz = item.z, g0 = ground(ox, oz);
  const roads = F.roads.map((rid) => plan.paths.find((p) => p.id === rid)?.points ?? plan.narrativeRoutes.flatMap((r) => r.legs).find((l) => l.id === rid)?.points);
  if (roads.some((r) => !r)) throw new Error(`[caiqi] ${id} 的 roads 有找不到的走线`);
  const walls = region.buildings.flatMap((b) => b.layout?.runs.map((r) => r.points) ?? []);
  const hill = [...(region.rocks ?? []), ...region.buildings].find((o) => o.id === F.hill);
  if (!hill) throw new Error(`[caiqi] 找不到背山 ${F.hill}`);
  const waters = plan.water.filter((w) => w.polygon).map((w) => w.polygon!);
  const edge = new Simplex(0xca1);
  const ok = (x: number, z: number) => {
    if (!inPoly(region.polygon, x, z)) return false;
    if (z > F.clipSouthZ + 2.2 * edge.noise2D(x / 6, 1.7) + 1.1 * edge.noise2D(x / 2.3, 5)) return false;
    for (const w of waters) { if (inPoly(w, x, z) || lineD([...w, w[0]], x, z) < F.waterClearM) return false; }
    for (const p of region.pads ?? []) if (inPoly(p.polygon, x, z)) return false;
    for (const r of walls) if (lineD(r, x, z) < F.wallClearM) return false;
    for (const r of roads) if (lineD(r!, x, z) < F.roadClearM) return false;
    // 背山脚:BB7 的背山椭圆 8×10 m(beishan.ts),外放 hillClear。
    if (((x - hill.x) / (8 + F.hillClearM)) ** 2 + ((z - hill.z) / (10 + F.hillClearM)) ** 2 < 1) return false;
    return true;
  };
  // 田块:抖动网格上的种子点(Voronoi),每块一个垄向与作物。
  const rng = makeRng(0xca9), xs = region.polygon.map((p) => p[0]), zs = region.polygon.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.min(Math.max(...zs), F.clipSouthZ + 4);
  const seeds: { x: number; z: number; a: number; rape: boolean }[] = [];
  for (let x = minX; x < maxX; x += F.plotM) for (let z = minZ; z < maxZ; z += F.plotM)
    seeds.push({ x: x + rng() * F.plotM, z: z + rng() * F.plotM, a: (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.3, rape: rng() < F.rapeShare });
  const plotAt = (x: number, z: number) => {
    let b1 = -1, d1 = Infinity, d2 = Infinity;
    seeds.forEach((s, i) => { const d = Math.hypot(s.x - x, s.z - z); if (d < d1) { d2 = d1; d1 = d; b1 = i; } else if (d < d2) d2 = d; });
    return { i: b1, baulk: d2 - d1 < F.baulkM };
  };
  const pitch = F.bedM + F.furrowM;
  const soilT: THREE.Matrix4[] = [], ridgeT: THREE.Matrix4[] = [], vegT: THREE.Matrix4[] = [], rapeT: THREE.Matrix4[] = [];
  const vegC: THREE.Color[] = [], rapeC: THREE.Color[] = [];
  const M = (x: number, z: number, yaw: number, s = 1, sy = s, dy = 0) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return new THREE.Matrix4().compose(new THREE.Vector3(x - ox, ground(x, z) - g0 + dy, z - oz), q, new THREE.Vector3(s, sy, s));
  };
  let area = 0;
  // 土片:1.5 m 一格铺满可种范围(盖住草地),田埂也在内——田埂是土不是草。
  for (let x = minX; x < maxX; x += 1.5) for (let z = minZ; z < maxZ; z += 1.5) {
    const cx = x + 0.75, cz = z + 0.75;
    if (!ok(cx, cz)) continue;
    // 土片贴地倾斜:按四邻高差求坡面法线,整块转过去——平片在坡上会被地形从边上顶穿(草色斑)。
    const e = 0.8, hx = ground(cx + e, cz) - ground(cx - e, cz), hz = ground(cx, cz + e) - ground(cx, cz - e);
    const n = new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    soilT.push(new THREE.Matrix4().compose(new THREE.Vector3(cx - ox, ground(cx, cz) - g0 + 0.04, cz - oz), q, new THREE.Vector3(1, 1, 1))); area += 2.25;
  }
  // 垄与植株:按田块的垄向,在块内逐垄铺。
  seeds.forEach((s, pi) => {
    const ca = Math.cos(s.a), sa = Math.sin(s.a), R = F.plotM * 1.2;
    for (let u = -R; u <= R; u += pitch) {
      for (let v = -R; v <= R; v += 1.5) {
        // 垄段中心(沿垄向 v,垄间 u)。
        const x = s.x + v * ca - u * sa, z = s.z + v * sa + u * ca;
        const p = plotAt(x, z);
        if (p.i !== pi || p.baulk || !ok(x, z)) continue;
        ridgeT.push(M(x, z, -s.a, 1, 1, 0.01));
        // 垄上两行,株距 0.4。
        for (const off of [-0.25, 0.25]) for (let t = -0.6; t <= 0.6; t += s.rape ? 0.3 : 0.4) {
          const jx = (rng() - 0.5) * 0.08, jz = (rng() - 0.5) * 0.08;
          const px = x + t * ca - off * sa + jx, pz = z + t * sa + off * ca + jz;
          if (!ok(px, pz)) continue;
          if (s.rape) {
            rapeT.push(M(px, pz, rng() * Math.PI, 0.9 + rng() * 0.35, 0.85 + rng() * 0.4, 0.1));
            rapeC.push(new THREE.Color().setScalar(0.85 + rng() * 0.25));
          } else {
            vegT.push(M(px, pz, rng() * Math.PI, 0.85 + rng() * 0.4, 0.8 + rng() * 0.4, 0.1));
            const k = 0.8 + rng() * 0.3; vegC.push(new THREE.Color(k * (0.95 + rng() * 0.1), k, k * (0.85 + rng() * 0.2)));
          }
        }
      }
    }
  });
  const mats = materials(), root = new THREE.Group();
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, ts: THREE.Matrix4[], cs?: THREE.Color[], name = '') => {
    if (!ts.length) return;
    const m = new THREE.InstancedMesh(geo, mat, ts.length);
    ts.forEach((t, i) => m.setMatrixAt(i, t));
    if (cs) cs.forEach((c, i) => m.setColorAt(i, c));
    m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.computeBoundingBox();
    m.castShadow = name !== 'soil'; m.receiveShadow = true; m.name = `caiqi.${name}`;
    root.add(m);
  };
  inst(tile(1.62), mats.soil, soilT, undefined, 'soil');
  inst(ridgeGeo(1.5, F.bedM, 0.16), mats.soil, ridgeT, undefined, 'ridge');
  inst(cards(2, 0.5, 0.36), mats.veg, vegT, vegC, 'veg');
  inst(cards(3, 0.55, 0.85), mats.rape, rapeT, rapeC, 'rape');
  root.name = id;
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PROVENANCE } };
  root.userData.planObject = { id };
  root.userData.field = { areaM2: area, ridges: ridgeT.length, veg: vegT.length, rape: rapeT.length, plots: seeds.length };
  return { root, groundRadius: 40 };
}
