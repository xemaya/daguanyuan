import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { mergeByMaterial } from '../merge';
import { roundedBox, noiseDisplace } from '../sculpt';
import { stoneMaterial } from '../materials';
import { makeRng } from '@engine/core/Noise';
import { planItem } from './plan-data';
import { roughWoodMaterial, thatchUnderMaterial } from './materials';

/**
 * 土井井台(单子 BA4)+ 桔槔、辘轳(单子 BB3)。
 * 07-11「篱外山坡之下,有一土井,旁有桔槔轆轤之屬」——「土井」,所以不做石雕井栏:
 * 一圈毛石砌的矮井圈 + 井口周围一方毛石铺的井台,井里一汪暗水。全部尺寸为艺术取值。
 *
 * 局部坐标:原点在井台底面中心。variant = plan 里井的 id(default = daoxiangcun.well)。
 */
const JT = { pad: 2.4, padH: 0.16, curbR: 0.52, curbT: 0.16, curbH: 0.46, water: 0.34 };
const PROVENANCE = [{ id: 'project:well-platform', name: '土井井台', method: 'artistic_choice',
  note: '07-11「土井」只给名目:毛石井台 2.4 m 见方、高 0.16 m;毛石井圈外径 1.04 m、高 0.46 m;井水面低于井口 0.34 m(井身不建模,水面须高过地面才不被地形吃掉)。' },
  { id: 'project:well-windlass', name: '辘轳', method: 'artistic_choice',
    note: '07-11「旁有桔槔轆轤之屬」。辘轳:井口两侧两根木柱(高 1.25 m),架一根卷筒(径 0.22、长 1.0 m),一端曲柄(臂 0.42 m + 把手),绳绕卷筒垂进井口挂一只木桶。尺寸为艺术取值。' },
  { id: 'project:well-shadoof', name: '桔槔', method: 'artistic_choice',
    note: '桔槔:井台西侧立一根叉头木柱(高 2.6 m),横一根杠杆(长 4.2 m,支点偏向坠石端),短臂坠一块石,长臂端垂绳挂木桶、落在井台前沿(不与辘轳的桶挤在井口);杠杆长臂下斜 24°(桶放下的姿态)。尺寸为艺术取值。' }];

export function buildJingtai(variant: string): PartBuild {
  const id = variant === 'default' ? 'daoxiangcun.well' : variant;
  const item = planItem(id);
  if (item.kind !== 'prop') throw new Error(`[jingtai] ${id} 不是井这类摆件`);
  const rng = makeRng(8117), stone = stoneMaterial(1), group = new THREE.Group();
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; group.add(o); };
  // 井台:几块毛石板拼成一方(板缝就是「砌」的读法),井口处留空。
  const n = 4, cell = JT.pad / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const cx = -JT.pad / 2 + cell * (i + 0.5), cz = -JT.pad / 2 + cell * (j + 0.5);
    if (Math.hypot(cx, cz) < JT.curbR) continue;
    const h = JT.padH * (0.85 + rng() * 0.3);
    const g = roundedBox(cell - 0.03, h, cell - 0.03, 0.03, 2);
    noiseDisplace(g, 0.008, 5, 900 + i * 7 + j, 2);
    g.translate(cx, h / 2, cz);
    add(g, stone);
  }
  // 井圈:一圈毛石块。
  const blocks = 12;
  for (let k = 0; k < blocks; k++) {
    const a = (k / blocks) * Math.PI * 2, w = (2 * Math.PI * (JT.curbR - JT.curbT / 2)) / blocks - 0.02;
    const h = JT.curbH * (0.92 + rng() * 0.16);
    const g = roundedBox(w, h, JT.curbT, 0.025, 2);
    noiseDisplace(g, 0.01, 6, 700 + k, 2);
    g.translate(0, h / 2, JT.curbR - JT.curbT / 2);
    g.rotateY(a);
    add(g, stone);
  }
  // 井水:暗、微反光。井口内无井身几何,水面放在地面以上、井口以下。
  const water = new THREE.Mesh(new THREE.CircleGeometry(JT.curbR - JT.curbT + 0.01, 24), new THREE.MeshStandardMaterial({ color: 0x1d2622, roughness: 0.15, metalness: 0 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = JT.curbH - JT.water;
  group.add(water);
  /* ---- 辘轳(BB3):井口东西两柱、卷筒、曲柄、绳、桶 ---- */
  const wood = roughWoodMaterial(), rope = thatchUnderMaterial();
  const log = (a: THREE.Vector3, b: THREE.Vector3, r: number, seed: number, mat: THREE.Material = wood, seg = 8) => {
    const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r * 0.94, r, d.length(), seg, 2);
    if (mat === wood) noiseDisplace(g, r * 0.06, 6, seed, 2);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add(g, mat);
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const W = { postX: 0.78, postH: 1.25, drumY: 1.05, drumR: 0.11, drumL: 1.0, crank: 0.42 };
  for (const sx of [-1, 1]) {
    log(V(sx * W.postX, JT.padH - 0.05, 0), V(sx * W.postX, W.postH, 0), 0.07, 30 + sx);
    // 柱头开叉托卷筒:一块小横木。
    const cap = roundedBox(0.2, 0.08, 0.16, 0.02, 2); cap.translate(sx * W.postX, W.drumY - W.drumR - 0.04, 0); add(cap, wood);
  }
  log(V(-W.drumL / 2 - 0.25, W.drumY, 0), V(W.drumL / 2 + 0.1, W.drumY, 0), W.drumR, 40, wood, 10);
  // 卷筒上绕的绳(略粗一圈)。
  log(V(-0.22, W.drumY, 0), V(0.22, W.drumY, 0), W.drumR + 0.018, 41, rope, 10);
  // 曲柄:西端,轴 → 臂 → 把手。
  const cx = -W.drumL / 2 - 0.25;
  log(V(cx, W.drumY, 0), V(cx, W.drumY - W.crank, 0.02), 0.03, 42);
  log(V(cx, W.drumY - W.crank, 0.02), V(cx - 0.28, W.drumY - W.crank, 0.02), 0.03, 43);
  // 绳垂进井口,挂一只木桶(桶半浸在井口下)。
  const bucket = (x: number, y: number, z: number, seed: number) => {
    const b = new THREE.CylinderGeometry(0.17, 0.14, 0.28, 12, 1, true); b.translate(x, y, z); add(b, wood);
    const bot = new THREE.CircleGeometry(0.14, 12); bot.rotateX(Math.PI / 2); bot.translate(x, y - 0.14, z); add(bot, wood);
    for (const hy of [-0.08, 0.08]) { const h = new THREE.TorusGeometry(0.16 + hy * -0.1, 0.012, 4, 16); h.rotateX(Math.PI / 2); h.translate(x, y + hy, z); add(h, rope); }
    const arc = new THREE.TorusGeometry(0.16, 0.012, 4, 12, Math.PI); arc.translate(x, y + 0.14, z); add(arc, rope);
    void seed;
  };
  log(V(0, W.drumY - W.drumR, 0), V(0, JT.curbH + 0.12, 0), 0.012, 44, rope, 5);
  bucket(0, JT.curbH - 0.02, 0, 45);

  /* ---- 桔槔(BB3):井台西侧叉柱 + 杠杆 + 坠石 + 垂绳挂桶 ---- */
  const S = { postX: -1.8, postZ: 1.35, postH: 2.6, arm: 2.7, short: 1.5, tilt: 24 * Math.PI / 180 };
  log(V(S.postX, -0.3, S.postZ), V(S.postX, S.postH, S.postZ), 0.09, 50);
  for (const sz of [-1, 1]) log(V(S.postX, S.postH - 0.05, S.postZ), V(S.postX, S.postH + 0.22, S.postZ + sz * 0.1), 0.035, 51 + sz);
  const pivot = V(S.postX, S.postH + 0.06, S.postZ);
  const tip = V(S.postX + S.arm * Math.cos(S.tilt), pivot.y - S.arm * Math.sin(S.tilt), S.postZ);
  const tail = V(S.postX - S.short * Math.cos(S.tilt), pivot.y + S.short * Math.sin(S.tilt), S.postZ);
  log(tail, tip, 0.055, 53, wood, 8);
  // 坠石:绑在短臂端,一块扁圆毛石。
  const weight = new THREE.IcosahedronGeometry(0.22, 1); weight.scale(1, 0.8, 1); noiseDisplace(weight, 0.03, 4, 54, 2);
  weight.translate(tail.x, tail.y - 0.3, tail.z); add(weight, stone);
  log(V(tail.x, tail.y, tail.z), V(tail.x, tail.y - 0.12, tail.z), 0.015, 55, rope, 5);
  // 长臂端垂绳挂桶,桶落在井口东北侧的台面上方。
  const hang = V(tip.x, JT.padH + 0.38, tip.z);
  log(tip, hang, 0.012, 56, rope, 5);
  bucket(hang.x, hang.y - 0.14, hang.z, 57);

  const root = mergeByMaterial(group);
  root.name = id;
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PROVENANCE } };
  root.userData.planObject = { id };
  return { kind: 'building', root, groundRadius: 2.4, frame: null,
    platform: { hx: JT.pad / 2, hz: JT.pad / 2, y: JT.padH },
    walkSurfaces: [],
    blockers: [{ cx: 0, cz: 0, hx: 0.88, hz: JT.curbR, h: 1.3 }, { cx: -1.8, cz: 1.35, hx: 0.12, hz: 0.12, h: 2.7 }] } as unknown as PartBuild;
}
