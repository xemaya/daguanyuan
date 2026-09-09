import * as THREE from 'three';
import type { GameContext } from '../core/Context';
import { buildPart, type PartBuild } from '../cn/registry';
import '../cn/index';
import type { BuildingResult } from '../cn/parts/building';
import { stoneMaterial } from '../cn/materials';
import { roundedBox } from '../fx/Sculpt';
import { POND } from './Terrain';
import { mergeByMaterial } from '../cn/merge';

/**
 * 装配器:把构件按 scene 表放进园子,并把每类构件的落脚(平台)与阻挡登记
 * 到碰撞层。构件自己不知道园子,园子也不读构件内部——只认 registry 的名字。
 */

interface Placement {
  part: string;
  variant?: string;
  x: number;
  z: number;
  /** 绕 Y 的朝向(弧度),0 = 构件正面朝南(+Z)。 */
  yaw?: number;
  /** 相对地面的抬升;`y` 给了就用绝对高度。 */
  dy?: number;
  y?: number;
  /** 建筑离水面时垫一块青石墩到地。 */
  pier?: boolean;
  tag?: string;
}

/** 十七回游线:正门 → 翠嶂 → 沁芳亭桥 → 潇湘馆。 */
const SCENE: Placement[] = [
  // 正门与南墙。
  { part: 'building', variant: 'men', x: 0, z: 24.4, yaw: 0, tag: '正门' },
  { part: 'wall', variant: 'plain', x: 6.0, z: 25.2, yaw: 0 },
  { part: 'wall', variant: 'lattice', x: 12.0, z: 25.2, yaw: 0 },
  { part: 'wall', variant: 'plain', x: 18.0, z: 25.2, yaw: 0 },
  { part: 'wall', variant: 'cloud', x: 25.0, z: 25.2, yaw: 0 },
  { part: 'wall', variant: 'plain', x: -6.0, z: 25.2, yaw: 0 },
  { part: 'wall', variant: 'lattice', x: -12.0, z: 25.2, yaw: 0 },
  { part: 'wall', variant: 'plain', x: -18.0, z: 25.2, yaw: 0 },
  { part: 'wall', variant: 'cloud', x: -25.0, z: 25.2, yaw: 0 },
  // 东西墙(只做南段,北段由林岗围合)。
  { part: 'wall', variant: 'cloud', x: 29.0, z: 21.0, yaw: Math.PI / 2 },
  { part: 'wall', variant: 'plain', x: 29.0, z: 14.0, yaw: Math.PI / 2 },
  { part: 'wall', variant: 'cloud', x: 29.0, z: 7.0, yaw: Math.PI / 2 },
  { part: 'wall', variant: 'cloud', x: -29.0, z: 21.0, yaw: -Math.PI / 2 },
  { part: 'wall', variant: 'plain', x: -29.0, z: 14.0, yaw: -Math.PI / 2 },
  { part: 'wall', variant: 'cloud', x: -29.0, z: 7.0, yaw: -Math.PI / 2 },

  // 翠嶂假山:进门迎面,缝从南入北出。
  { part: 'taihu', variant: 'mound', x: 0, z: 13.0, yaw: 0, tag: '翠嶂' },
  { part: 'taihu', variant: 'peak2', x: -6.2, z: 15.5, yaw: 0.6 },
  { part: 'taihu', variant: 'edge3', x: 4.4, z: 10.2, yaw: 1.2 },

  // 沁芳亭桥:两段曲桥夹一座亭,亭立在池中。
  { part: 'bridge', variant: 'zigzag', x: -0.9, z: 1.9, yaw: Math.atan2(6.6, 2.4), y: 0, tag: '沁芳桥南' },
  { part: 'building', variant: 'ting', x: 0.9, z: -2.4, yaw: -0.78, y: 0.0, pier: true, tag: '沁芳亭' },
  { part: 'bridge', variant: 'zigzag', x: 5.05, z: -7.68, yaw: 0.79, y: 0, tag: '沁芳桥北' },
  { part: 'taihu', variant: 'peak', x: 8.4, z: 1.6, yaw: 2.4 },
  { part: 'taihu', variant: 'peak3', x: -8.2, z: -6.4, yaw: -1.1 },

  // 潇湘馆:院墙 + 月洞门 + 漏窗 + 正房 + 廊 + 竹。
  { part: 'wall', variant: 'plain', x: 2.6, z: -13.5, yaw: 0 },
  { part: 'wall', variant: 'moon', x: 8.6, z: -13.5, yaw: 0, tag: '潇湘馆月洞门' },
  { part: 'wall', variant: 'lattice:wan', x: 14.6, z: -13.5, yaw: 0 },
  { part: 'wall', variant: 'plain', x: 17.6, z: -16.5, yaw: Math.PI / 2 },
  { part: 'wall', variant: 'plain', x: 17.6, z: -22.5, yaw: Math.PI / 2 },
  { part: 'wall', variant: 'cloud', x: -0.4, z: -17.5, yaw: -Math.PI / 2 },
  { part: 'wall', variant: 'plain', x: -0.4, z: -23.5, yaw: -Math.PI / 2 },
  { part: 'wall', variant: 'plain', x: 5.6, z: -26.5, yaw: 0 },
  { part: 'wall', variant: 'plain', x: 11.6, z: -26.5, yaw: 0 },
  { part: 'building', variant: 'tang', x: 9.4, z: -20.6, yaw: 0, tag: '潇湘馆' },
  { part: 'building', variant: 'lang', x: 2.4, z: -20.0, yaw: Math.PI / 2, tag: '潇湘馆西廊' },
  { part: 'bamboo', variant: 'grove', x: 14.2, z: -17.6 },
  { part: 'bamboo', variant: 'clump', x: 4.6, z: -15.6 },
  { part: 'bamboo', variant: 'clump', x: 12.6, z: -24.4 },
  { part: 'bamboo', variant: 'grove', x: 20.5, z: -20.0 },
  { part: 'bamboo', variant: 'clump', x: -3.4, z: -15.2 },
  { part: 'bamboo', variant: 'clump', x: -6.0, z: -12.0 },
  { part: 'bamboo', variant: 'clump', x: 11.8, z: -9.6 },
  { part: 'taihu', variant: 'peak4', x: 5.0, z: -17.0, yaw: 0.4 },
];

/** 池岸的驳石:沿池边等角度找"刚露出水"的地方摆小石。 */
function shoreStones(ground: (x: number, z: number) => number): Placement[] {
  const out: Placement[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.13;
    // 沿径向从池心往外找第一个高于 0.22 的点。
    let r = 0.5;
    let x = POND.cx;
    let z = POND.cz;
    for (; r < 16; r += 0.25) {
      x = POND.cx + Math.cos(a) * r * (POND.rx / Math.max(POND.rx, POND.rz));
      z = POND.cz + Math.sin(a) * r * (POND.rz / Math.max(POND.rx, POND.rz));
      if (ground(x, z) > 0.22) break;
    }
    // 桥头两处不摆,留给路。
    if (Math.hypot(x + 1.6, z - 5.2) < 2.6 || Math.hypot(x - 8.7, z + 10.4) < 3.0) continue;
    if (i % 3 === 0) continue;
    out.push({ part: 'taihu', variant: `edge${(i % 5) + 1}`, x, z, yaw: a + i * 0.7, dy: -0.08 });
  }
  return out;
}

export function buildGarden(ctx: GameContext): void {
  const ground = ctx.collision.terrainHeight;
  const cache = new Map<string, PartBuild>();
  const updaters: ((dt: number, t: number) => void)[] = [];
  const stone = stoneMaterial(1);
  const group = new THREE.Group();
  group.name = 'Garden';
  ctx.scene.add(group);
  // 静态件(墙/石/桥/屋)先收进这里,最后按材质合并;会动的(竹)直接进 group。
  const staticGroup = new THREE.Group();

  const all = [...SCENE, ...shoreStones(ground)];
  let calls = 0;
  for (const p of all) {
    const key = `${p.part}:${p.variant ?? 'default'}`;
    let part = cache.get(key);
    let fresh = false;
    if (!part) {
      part = buildPart(p.part, p.variant) ?? undefined;
      if (!part) {
        console.warn(`[garden] 未登记构件 ${key}`);
        continue;
      }
      cache.set(key, part);
      fresh = true;
      let tris = 0;
      part.root.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (!mm.isMesh) return;
        const g = mm.geometry;
        const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        tris += n * ((mm as THREE.InstancedMesh).isInstancedMesh ? (mm as THREE.InstancedMesh).count : 1);
      });
      console.info(`[garden] ${key} ${(tris / 1000).toFixed(1)}k tris`);
      if (part.update) updaters.push(part.update);
    }
    calls++;
    const yaw = p.yaw ?? 0;
    const y = p.y ?? ground(p.x, p.z) + (p.dy ?? 0);
    const obj = fresh ? part.root : part.root.clone();
    obj.position.set(p.x, y, p.z);
    obj.rotation.y = yaw;
    obj.name = p.tag ?? key;
    if (part.update) group.add(obj);
    else staticGroup.add(obj);

    registerColliders(ctx, p.part, p.variant ?? 'default', part, p.x, y, p.z, yaw);

    if (p.pier) {
      // 从地面(池底)砌一块青石墩到构件底面。
      const b = part as BuildingResult;
      const hx = b.platform?.hx ?? 2;
      const hz = b.platform?.hz ?? 2;
      const gy = ground(p.x, p.z);
      const h = Math.max(0.05, y - gy + 0.02);
      const pier = new THREE.Mesh(roundedBox(hx * 2 - 0.1, h, hz * 2 - 0.1, 0.03, 2), stone);
      pier.position.set(p.x, gy + h / 2 - 0.01, p.z);
      pier.rotation.y = yaw;
      pier.receiveShadow = true;
      pier.castShadow = true;
      group.add(pier);
    }
  }
  const merged = mergeByMaterial(staticGroup);
  merged.name = 'GardenStatic';
  group.add(merged);
  console.info(`[garden] ${calls} 件, ${cache.size} 种, 合并后 ${merged.children.length} 个 mesh`);

  ctx.tick((dt, t) => {
    for (const u of updaters) u(dt, t);
  });
}

/** 把局部 (lx, lz) 按 yaw 转到世界。 */
function toWorld(x: number, z: number, yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

function registerColliders(
  ctx: GameContext,
  part: string,
  variant: string,
  built: PartBuild,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const col = ctx.collision;
  const kind = variant.replace(/[:\d].*$/, '');
  if (part === 'building') {
    const b = built as BuildingResult;
    col.addPlatform(x, z, b.platform.hx, b.platform.hz, y + b.platform.y, yaw, '台基');
    for (const bl of b.blockers) {
      const [cx, cz] = toWorld(x, z, yaw, bl.cx, bl.cz);
      col.addBox(cx, cz, bl.hx, bl.hz, y, y + bl.h, yaw + (bl.rot ?? 0));
    }
    return;
  }
  if (part === 'wall') {
    const box = new THREE.Box3().setFromObject(built.root);
    const hx = (box.max.x - box.min.x) / 2;
    col.addBox(x, z, hx, 0.2, y, y + 2.7, yaw, 'wall');
    if (kind === 'moon') {
      // 月洞门:墙体两段留中间 2.2m 通行。
      col.colliders.pop();
      const gap = 1.15;
      const [ax, az] = toWorld(x, z, yaw, -(gap + (hx - gap) / 2), 0);
      const [bx, bz] = toWorld(x, z, yaw, gap + (hx - gap) / 2, 0);
      col.addBox(ax, az, (hx - gap) / 2, 0.2, y, y + 2.7, yaw, 'wall');
      col.addBox(bx, bz, (hx - gap) / 2, 0.2, y, y + 2.7, yaw, 'wall');
    }
    return;
  }
  if (part === 'taihu') {
    if (kind === 'mound') {
      for (const sx of [-1, 1]) {
        const [cx, cz] = toWorld(x, z, yaw, sx * 1.9, 0);
        col.addCircle(cx, cz, 1.25, y, y + 3, '假山');
      }
    } else {
      const box = new THREE.Box3().setFromObject(built.root);
      const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.36;
      col.addCircle(x, z, r, y, y + (box.max.y - box.min.y), '石');
    }
    return;
  }
  if (part === 'bridge' && kind === 'zigzag') {
    const segs = [
      { x0: -4.5, x1: -0.75, z0: 0, z1: 1.5 },
      { x0: -2.25, x1: 2.25, z0: -1.5, z1: 0 },
      { x0: 0.75, x1: 4.5, z0: 0, z1: 1.5 },
    ];
    for (const s of segs) {
      const [cx, cz] = toWorld(x, z, yaw, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
      col.addPlatform(cx, cz, (s.x1 - s.x0) / 2, (s.z1 - s.z0) / 2, y + 0.35, yaw, '桥面');
    }
    // 踏步。
    for (const sx of [-1, 1]) {
      const [cx, cz] = toWorld(x, z, yaw, sx * 4.7, sx < 0 ? 0.75 : 0.75);
      col.addPlatform(cx, cz, 0.3, 0.75, y + 0.15, yaw, '桥阶');
    }
    // 栏杆:外沿 + 转折处的横档。
    const rails: [number, number, number, number][] = [
      [-4.5, 1.5, -0.75, 1.5],
      [-4.5, 0, -2.25, 0],
      [-2.25, -1.5, 2.25, -1.5],
      [-0.75, 0, 0.75, 0],
      [0.75, 1.5, 4.5, 1.5],
      [2.25, 0, 4.5, 0],
      [-0.75, 0, -0.75, 1.5],
      [-2.25, -1.5, -2.25, 0],
      [2.25, -1.5, 2.25, 0],
      [0.75, 0, 0.75, 1.5],
    ];
    for (const [ax, az, bx, bz] of rails) {
      const [cx, cz] = toWorld(x, z, yaw, (ax + bx) / 2, (az + bz) / 2);
      const len = Math.hypot(bx - ax, bz - az);
      const along = Math.atan2(-(bz - az), bx - ax);
      col.addBox(cx, cz, len / 2, 0.06, y + 0.3, y + 1.0, yaw + along, '桥栏');
    }
    return;
  }
  if (part === 'bamboo' && kind === 'clump') {
    col.addCircle(x, z, 0.4, y, y + 2, '竹');
  }
}
