import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { mergeByMaterial } from '../merge';
import { roundedBox, noiseDisplace } from '../sculpt';
import { stoneMaterial } from '../materials';
import { makeRng } from '@engine/core/Noise';
import { planItem } from './plan-data';

/**
 * 土井井台(单子 BA4,只做井台;桔槔、辘轳归第二轮)。
 * 07-11「篱外山坡之下,有一土井,旁有桔槔轆轤之屬」——「土井」,所以不做石雕井栏:
 * 一圈毛石砌的矮井圈 + 井口周围一方毛石铺的井台,井里一汪暗水。全部尺寸为艺术取值。
 *
 * 局部坐标:原点在井台底面中心。variant = plan 里井的 id(default = daoxiangcun.well)。
 */
const JT = { pad: 2.4, padH: 0.16, curbR: 0.52, curbT: 0.16, curbH: 0.46, water: 0.34 };
const PROVENANCE = [{ id: 'project:well-platform', name: '土井井台', method: 'artistic_choice',
  note: '07-11「土井」只给名目:毛石井台 2.4 m 见方、高 0.16 m;毛石井圈外径 1.04 m、高 0.46 m;井水面低于井口 0.34 m(井身不建模,水面须高过地面才不被地形吃掉)。桔槔辘轳第二轮。' }];

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
  const root = mergeByMaterial(group);
  root.name = id;
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PROVENANCE } };
  root.userData.planObject = { id };
  return { kind: 'building', root, groundRadius: 2.4, frame: null,
    platform: { hx: JT.pad / 2, hz: JT.pad / 2, y: JT.padH },
    walkSurfaces: [],
    blockers: [{ cx: 0, cz: 0, hx: JT.curbR, hz: JT.curbR, h: JT.curbH }] } as unknown as PartBuild;
}
