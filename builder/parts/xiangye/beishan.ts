import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { mergeByMaterial } from '../merge';
import { noiseDisplace } from '../sculpt';
import { stoneMaterial } from '../materials';
import { grassTurfMaps, bakeColorMap, cached, recipeKey, mixHex } from '@engine/core/TextureLab';
import { Simplex, makeRng } from '@engine/core/Noise';
import { planItem } from './plan-data';

/**
 * 背山(单子 BB7)——plan `daoxiangcun.rock-01`「人力穿凿的背山」。07-14 宝玉批「背山山無脉」:
 * **它就该是一座孤零零、与四周不连的土石小山**——椭圆一座馒头土山,坡上露几块石头,山脚四面收干净,
 * 不向任何方向拖出山脊(反目标:别让它与青山连成脉)。
 *
 * 高度按视张角定(见 PROVENANCE):从 dx_approach (−184,2) 看,茆堂屋脊(世界 y≈5.9,57 m)仰角 0.073 rad;
 * 背山在 98.5 m 外,顶要高出这条线才读得出「屋后有山」:世界顶 ≥ 1.75 + 0.073×98.5 ≈ 8.9 m,
 * 当地地面 ≈ 1.0 m,取山高 8.5 m(顶约 9.5 m,露出屋脊线约 0.6 m 仰角当量)。
 * 局部坐标:原点在山脚中心;X 半径 8 m、Z 半径 10 m(区界 x=−232 以内)。
 */
const BS = { rx: 8, rz: 10, h: 8.5, rings: 36, segs: 72 };
const PROVENANCE = [{ id: 'project:back-hill', name: '背山', method: 'artistic_choice',
  note: '07-14「背山山無脉」:孤立土石小山,不与青山连脉;椭圆 16×20 m、高 8.5 m(按 dx_approach 视张角:茆堂屋脊仰角 0.073 rad,背山 98.5 m 外,顶须 ≥ 世界 8.9 m;地面 ≈1.0 m),坡露 7 块石。形状与尺寸为艺术取值。' }];

let TURF: THREE.MeshStandardMaterial | undefined;
/** 坡面:黄绿的草皮夹土。引擎的 grassTurfMaps 饱和翠绿(棚拍/园中读成卡通绿包),这里另烤一张贴近
 *  园中地表 splat 的黄绿,法线借草皮那张(形状对,颜色不用它的)。 */
function turfMaterial(): THREE.MeshStandardMaterial {
  if (!TURF) {
    const m = grassTurfMaps(), n = new Simplex(0xbe15);
    const map = cached(recipeKey('xiangye.backhill.albedo', 512), () => bakeColorMap({ size: 512, color: (u, v) => {
      const t = 0.5 + 0.5 * n.noise2D(u * 9, v * 9), f = 0.5 + 0.5 * n.noise2D(u * 41 + 3, v * 41);
      const c = mixHex(0x8e9a52, 0xb3ad6c, t * 0.7 + f * 0.3), dirt = mixHex(0x8e7a55, 0x8e7a55, 0);
      const k = Math.max(0, n.noise2D(u * 5 + 9, v * 5) - 0.35) * 0.9;
      return [c[0] + (dirt[0] - c[0]) * k, c[1] + (dirt[1] - c[1]) * k, c[2] + (dirt[2] - c[2]) * k];
    } }));
    TURF = new THREE.MeshStandardMaterial({ map, normalMap: m.normalMap, roughness: 1, metalness: 0, vertexColors: true });
  }
  return TURF;
}

export function buildBeishan(variant: string): PartBuild {
  const id = variant === 'default' ? 'daoxiangcun.rock-01' : variant;
  const item = planItem(id);
  void item;
  const s = new Simplex(9119), rng = makeRng(9119), group = new THREE.Group();
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const height = (u: number, a: number) => {
    // u:0 山顶 → 1 山脚;轮廓馒头形,四周一样收脚(无脉)。
    const base = Math.pow(Math.max(0, 1 - u * u), 1.25);
    const lump = 1 + 0.12 * s.noise2D(Math.cos(a) * 1.3 + 3, Math.sin(a) * 1.3) * u + 0.05 * s.noise2D(Math.cos(a) * 4, Math.sin(a) * 4 + u * 3);
    return BS.h * base * lump - 0.3 * u * u; // 山脚略沉进地
  };
  for (let j = 0; j <= BS.rings; j++) {
    const u = Math.min(1.06, (j / BS.rings) * 1.06);
    for (let i = 0; i <= BS.segs; i++) {
      const a = (i / BS.segs) * Math.PI * 2;
      const wob = 1 + 0.06 * s.noise2D(Math.cos(a) * 2 + 7, Math.sin(a) * 2);
      const x = Math.cos(a) * BS.rx * u * wob, z = Math.sin(a) * BS.rz * u * wob, y = height(u, a);
      pos.push(x, y, z); uv.push(x / 4, z / 4);
      const k = 0.78 + 0.18 * (y / BS.h) + 0.06 * s.noise2D(x * 0.3, z * 0.3);
      col.push(k, k, k);
      if (i < BS.segs && j < BS.rings) { const a0 = j * (BS.segs + 1) + i; idx.push(a0, a0 + 1, a0 + BS.segs + 1, a0 + 1, a0 + BS.segs + 2, a0 + BS.segs + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const hill = new THREE.Mesh(g, turfMaterial()); hill.castShadow = hill.receiveShadow = true; group.add(hill);
  // 露石:坡上几块,半埋。
  const stone = stoneMaterial(1);
  // 露石方位用黄金角错开、高低不一:随机两块并排落在同一高度时,从 e09 看读成一张脸(BB6 棚拍发现)。
  for (let k = 0; k < 7; k++) {
    const a = k * 2.39996 + rng() * 0.5, u = 0.3 + ((k * 0.37) % 0.55) + rng() * 0.08, r = 0.55 + rng() * 1.0;
    const x = Math.cos(a) * BS.rx * u, z = Math.sin(a) * BS.rz * u, y = height(u, a);
    const rg = new THREE.IcosahedronGeometry(r, 2);
    rg.scale(1.3, 0.8, 1);
    noiseDisplace(rg, r * 0.22, 1.4 / r, 900 + k, 3);
    rg.rotateY(rng() * Math.PI);
    rg.translate(x, y - r * 0.35, z);
    const m = new THREE.Mesh(rg, stone); m.castShadow = m.receiveShadow = true; group.add(m);
  }
  const root = mergeByMaterial(group);
  root.name = id;
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PROVENANCE } };
  root.userData.planObject = { id };
  return { kind: 'building', root, groundRadius: 14, frame: null,
    platform: { hx: 0.1, hz: 0.1, y: 0 },
    walkSurfaces: [],
    blockers: [{ cx: 0, cz: 0, hx: BS.rx * 0.8, hz: BS.rz * 0.8, h: BS.h }] } as unknown as PartBuild;
}
