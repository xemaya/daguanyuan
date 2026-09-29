import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { mergeByMaterial } from '../merge';
import { noiseDisplace, boxProjectedUV } from '../sculpt';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { stoneMaterial } from '../materials';
import { Simplex, makeRng, smoothstep, clamp } from '@engine/core/Noise';
import { planItem } from './plan-data';

/**
 * 石碣(单子 BB5;BB 收尾返工)。07-12「忽見路旁有一石碣,亦為留題之備」——**留题之备 = 空白待题,不刻字**。
 *
 * 碣不是碑:圆首、矮、厚、粗琢。第一版做成 1.45 m 高、0.2 m 薄、光面圆首 + 规整碑座,园中读成现代墓碑。
 * 这一版:
 *   身 —— 露地 1.0 m、宽 0.66 m、厚 0.34 m;圆首;整块粗琢起伏(不是磨光板),碑面中部只略平一些(空白待题);
 *   损 —— 边棱与圆首随机崩缺几口(往里咬 3–7 cm 的缺口);
 *   色 —— 顶点色:风化斑驳(深浅斑)、雨痕顺面往下、底部返潮发深并带一圈青苔;
 *   座 —— 不要碑座,直接埋进土里 0.3 m,脚下散两三块碎毛石。
 * 局部坐标:原点在地面、碑面朝 +Z。尺寸为艺术取值。
 */
const SJ = { w: 0.66, h: 1.0, t: 0.34, bury: 0.3 };
const PROVENANCE = [{ id: 'project:stone-tablet', name: '石碣', method: 'artistic_choice',
  note: '07-12「路旁有一石碣,亦為留題之備」:空白待题不刻字;碣=圆首、矮、厚、粗琢——露地 1.0 m、宽 0.66、厚 0.34,直接埋入土中 0.3 m,边棱崩缺、风化斑驳、脚下返潮带苔。尺寸与式样为艺术取值。' }];

export function buildShijie(variant: string): PartBuild {
  const id = variant === 'default' ? 'daoxiangcun.stone-tablet' : variant;
  const item = planItem(id);
  if (item.kind !== 'prop') throw new Error(`[shijie] ${id} 不是摆件`);
  const rng = makeRng(0x5ce), s = new Simplex(0x5ce);
  const stone = stoneMaterial(1, true), group = new THREE.Group();
  const r = SJ.w / 2, H = SJ.h + SJ.bury;
  // 碑身:细分的盒子,顶部按圆首收形——细分是为了粗琢起伏与崩缺有顶点可咬。
  const box = new THREE.BoxGeometry(SJ.w, H, SJ.t, 12, 20, 6);
  box.deleteAttribute('normal'); box.deleteAttribute('uv');
  // 合并同位顶点:盒子六个面各自一套顶点,沿各自法线扰动会在棱上裂缝(棚拍首轮看得见)。
  const g = mergeVertices(box);
  const p = g.attributes.position;
  const chips = Array.from({ length: 6 }, () => {
    const onTop = rng() < 0.5, side = rng() < 0.5 ? -1 : 1;
    const a = onTop ? (0.15 + rng() * 0.7) * Math.PI : 0;
    const y = onTop ? H / 2 - r + Math.sin(a) * r : -H / 2 + SJ.bury + rng() * (SJ.h - r);
    const x = onTop ? Math.cos(a) * r : side * r;
    return { c: new THREE.Vector3(x, y, (rng() < 0.5 ? -1 : 1) * SJ.t / 2), R: 0.05 + rng() * 0.06, depth: 0.03 + rng() * 0.04 };
  });
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // 圆首:y 在 H/2−r 以上的部分把 x 收进半圆。
    const topY = H / 2 - r;
    if (v.y > topY) v.y = topY + ((v.y - topY) / r) * Math.sqrt(Math.max(0, r * r - v.x * v.x));
    // 崩缺:离缺口中心近的顶点往里咬。
    for (const ch of chips) {
      const d = v.distanceTo(ch.c);
      if (d < ch.R) { const k = 1 - d / ch.R; v.z -= Math.sign(v.z) * ch.depth * k; v.x -= Math.sign(v.x) * ch.depth * 0.6 * k; }
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // 粗琢:整体起伏;碑面(+Z)中部压小一点——「待题」的那一块略平。
  noiseDisplace(g, 0.018, 4.5, 511, 3);
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > SJ.t / 2 - 0.03 && Math.abs(p.getX(i)) < r * 0.62 && p.getY(i) > -H / 2 + SJ.bury + 0.15 && p.getY(i) < H / 2 - r * 0.6)
      p.setZ(i, SJ.t / 2 + (p.getZ(i) - SJ.t / 2) * 0.35);
  }
  g.computeVertexNormals();
  g.translate(0, H / 2 - SJ.bury, 0);
  g.setAttribute('uv', boxProjectedUV(g, 1.5));
  // 顶点色:斑驳、雨痕、返潮、苔。
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const blot = 0.88 + 0.16 * s.noise2D(x * 5 + z * 3, y * 4);
    const streak = 1 - 0.1 * smoothstep(0.3, 0.9, 0.5 + 0.5 * s.noise2D(x * 14, y * 0.8 + 3));
    const damp = 1 - 0.32 * (1 - smoothstep(0, 0.35, y + 0.05 * s.noise2D(x * 6, z * 6)));
    const moss = (1 - smoothstep(0.02, 0.22, y)) * smoothstep(0.1, 0.5, 0.5 + 0.5 * s.noise2D(x * 9 + 1, z * 9 + y * 3));
    const k = blot * streak * damp;
    col[i * 3] = k * (1 - 0.3 * moss); col[i * 3 + 1] = k * (1 - 0.12 * moss); col[i * 3 + 2] = k * (1 - 0.42 * moss); // 苔:暗橄榄,不是亮绿
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const body = new THREE.Mesh(g, stone); body.castShadow = body.receiveShadow = true;
  body.rotation.z = 0.03; body.rotation.x = -0.02;
  group.add(body);
  // 脚下碎毛石。
  for (let k = 0; k < 3; k++) {
    const rg = new THREE.IcosahedronGeometry(0.1 + rng() * 0.08, 1);
    noiseDisplace(rg, 0.03, 8, 600 + k, 2);
    rg.scale(1.2, 0.6, 1);
    const a = rng() * Math.PI * 2, d = 0.42 + rng() * 0.2;
    rg.translate(Math.cos(a) * d, 0.02, Math.sin(a) * d * 0.7);
    const c = new Float32Array(rg.attributes.position.count * 3).fill(0.72);
    rg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.Mesh(rg, stone); m.castShadow = m.receiveShadow = true; group.add(m);
  }
  const root = mergeByMaterial(group);
  root.name = id;
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PROVENANCE } };
  root.userData.planObject = { id };
  return { kind: 'building', root, groundRadius: 1.2, frame: null,
    platform: { hx: 0.05, hz: 0.05, y: 0 },
    walkSurfaces: [],
    blockers: [{ cx: 0, cz: 0, hx: SJ.w / 2 + 0.05, hz: SJ.t / 2 + 0.05, h: SJ.h }] } as unknown as PartBuild;
}
