/**
 * 游园图上的地点表：把 `plan.json` 的区域翻成 `engine/ui/MapOverlay` 要的形状。
 *
 * 园子的知识留在 `projects/` 这一层——`engine/` 不许认识大观园（分层门）。
 *
 * **落点不用区域质心。** `missing` 的 `99-24` 记着：潇湘馆、沁芳闸、蓼汀花溆三个区的
 * 质心不在陆地上（潇湘馆的引泉沟就从质心旁 0.1 m 过），拿质心当落点会把人放进水里。
 * 所以取数顺序是 **入口 → 建筑锚点 → 质心兜底**，且落点一律回采地形高程。
 *
 * **`reachable` 只答"建没建成"。** 地形网格只覆盖 MVP 四区的窗口（`TERRAIN`），
 * 窗口外没有地形网格，走过去会掉进空的地方——没建成的区在图上灰着并注明原因。
 * 建成了但**还没走到过**的区由 `MapOverlay.setUnlocked` 解锁（99-27 收口：
 * 去过才上图，首次抵达只能靠腿），锁定时的说明写在 `lockedNote`。
 */
import type { MapPlace } from '@engine/ui/MapOverlay';
import { TERRAIN } from '@builder/compose/terrain';

interface PlanRegionLike {
  id: string;
  name?: string;
  polygon: [number, number][];
  entrances?: [number, number][];
  buildings?: { x: number; z: number; name?: string }[];
}

function centroid(poly: readonly (readonly [number, number])[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const c = x1 * z2 - x2 * z1;
    a += c;
    cx += (x1 + x2) * c;
    cz += (z1 + z2) * c;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return poly[0] as [number, number];
  return [cx / (6 * a), cz / (6 * a)];
}

/** 落点：入口 → 建筑锚点 → 质心兜底（见文件头注释，质心会落水）。 */
function landing(r: PlanRegionLike): { at: [number, number]; from: string } {
  const e = r.entrances?.[0];
  if (e) return { at: [e[0], e[1]], from: '入口' };
  const b = r.buildings?.[0];
  if (b && Number.isFinite(b.x) && Number.isFinite(b.z)) return { at: [b.x, b.z], from: '建筑锚点' };
  return { at: centroid(r.polygon), from: '质心兜底' };
}

/** 落地后面向区域质心——背对着自己刚到的地方很怪。 */
function facing(at: readonly [number, number], look: readonly [number, number]): number {
  const dx = look[0] - at[0];
  const dz = look[1] - at[1];
  if (Math.hypot(dx, dz) < 0.5) return 0;
  // PlayerController 的约定:forward = (−sin yaw, 0, −cos yaw)。
  return Math.atan2(-dx, -dz);
}

export function buildMapPlaces(regions: readonly PlanRegionLike[]): MapPlace[] {
  const inWindow = (x: number, z: number): boolean =>
    x >= TERRAIN.playMinX && x <= TERRAIN.playMaxX && z >= TERRAIN.playMinZ && z <= TERRAIN.playMaxZ;

  return regions.map((r) => {
    const { at, from } = landing(r);
    const mid = centroid(r.polygon);
    const reachable = inWindow(at[0], at[1]);
    const short = (r.name ?? r.id).split(/[(（]/)[0];
    return {
      id: r.id,
      name: short,
      polygon: r.polygon,
      target: { x: at[0], z: at[1] },
      yaw: facing(at, mid),
      reachable,
      note: reachable
        ? `${r.name ?? r.id} · 落点取${from} (${at[0].toFixed(0)}, ${at[1].toFixed(0)})`
        : `${r.name ?? r.id} · 尚未建成——地形网格只覆盖 MVP 四区，此处没有可站的地面`,
      lockedNote: reachable
        ? `${r.name ?? r.id} · 尚未走到——图只记足迹，首次抵达要靠腿走过去`
        : undefined,
    };
  });
}
