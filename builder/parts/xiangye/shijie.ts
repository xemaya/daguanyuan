import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { mergeByMaterial } from '../merge';
import { roundedBox, noiseDisplace } from '../sculpt';
import { stoneMaterial } from '../materials';
import { planItem } from './plan-data';

/**
 * 石碣(单子 BB5)。07-12「忽見路旁有一石碣,亦為留題之備」——**留题之备 = 空白待题,不刻字**。
 * 一块圆首立石(正面磨平、四边凿痕起伏、微斜)+ 一块埋进土里一截的毛石座;不做龟趺、不做碑额雕饰(乡野,C-r 不施彩画)。
 * 局部坐标:原点在碑座底面中心,碑面朝 +Z。尺寸为艺术取值。variant = plan 里石碣的 id。
 */
const SJ = { w: 0.68, h: 1.45, t: 0.2, baseW: 1.0, baseD: 0.5, baseH: 0.32 };
const PROVENANCE = [{ id: 'project:stone-tablet', name: '石碣', method: 'artistic_choice',
  note: '07-12「路旁有一石碣,亦為留題之備」:空白待题,碑面磨平不刻字;圆首立石 0.68×1.45×0.2 m、素面碑座 1.0×0.5×0.32 m。尺寸与式样为艺术取值。' }];

export function buildShijie(variant: string): PartBuild {
  const id = variant === 'default' ? 'daoxiangcun.stone-tablet' : variant;
  const item = planItem(id);
  if (item.kind !== 'prop') throw new Error(`[shijie] ${id} 不是摆件`);
  const stone = stoneMaterial(1), group = new THREE.Group();
  const add = (g: THREE.BufferGeometry) => { const m = new THREE.Mesh(g, stone); m.castShadow = true; m.receiveShadow = true; group.add(m); };
  // 碑座:一方素石,微微不平。
  // 首轮棚拍/园中人眼读成一块现代墓碑(规整素座 + 光面圆首):座改成一块不规整的毛石、埋进土里一截,
  // 碑身外轮廓与四边加凿痕起伏、整体微斜——读成路旁一块旧碣,不读成碑林里的新碑。
  const base = roundedBox(SJ.baseW, SJ.baseH, SJ.baseD, 0.06, 5);
  noiseDisplace(base, 0.035, 3, 311, 3);
  base.translate(0, SJ.baseH / 2 - 0.1, 0);
  add(base);
  // 碑身:圆首。外轮廓挤出,正面(+Z)磨平,四周边棱倒圆、凿痕只在侧边与圆首背面。
  const r = SJ.w / 2, sh = new THREE.Shape();
  sh.moveTo(-r, 0); sh.lineTo(r, 0); sh.lineTo(r, SJ.h - r);
  sh.absarc(0, SJ.h - r, r, 0, Math.PI, false);
  sh.lineTo(-r, 0);
  const body = new THREE.ExtrudeGeometry(sh, { depth: SJ.t - 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 16 });
  body.translate(0, SJ.baseH - 0.1, -(SJ.t - 0.03) / 2);
  // 只让背面与侧边带凿痕起伏(z < 前面),碑面保持平——空白待题。
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const edge = Math.max(Math.abs(x) / r, 0);
    // 轮廓起伏(凿边):离中线越远越毛;碑面(正面)中部保持平——空白待题。
    const k = 0.018 * Math.sin(y * 23 + x * 9) + 0.012 * Math.sin(y * 57 + 1.3);
    p.setX(i, x + Math.sign(x) * k * edge);
    if (z < SJ.t / 2 - 0.02) p.setZ(i, z + 0.008 * Math.sin(x * 31 + y * 17));
  }
  body.rotateZ(0.035);
  body.computeVertexNormals();
  add(body);
  const root = mergeByMaterial(group);
  root.name = id;
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PROVENANCE } };
  root.userData.planObject = { id };
  return { kind: 'building', root, groundRadius: 1.4, frame: null,
    platform: { hx: SJ.baseW / 2, hz: SJ.baseD / 2, y: SJ.baseH - 0.04 },
    walkSurfaces: [],
    blockers: [{ cx: 0, cz: 0, hx: SJ.baseW / 2, hz: SJ.baseD / 2, h: SJ.baseH + SJ.h }] } as unknown as PartBuild;
}
