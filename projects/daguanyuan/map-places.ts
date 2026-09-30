/**
 * 游园图上的地点表：把 `plan.json` 的区域翻成 `engine/ui/MapOverlay` 要的形状。
 *
 * 园子的知识留在 `projects/` 这一层——`engine/` 不许认识大观园（分层门）。
 *
 * **落点不用区域质心。** `missing` 的 `99-24` 记着：潇湘馆、沁芳闸、蓼汀花溆三个区的
 * 质心不在陆地上（潇湘馆的引泉沟就从质心旁 0.1 m 过），拿质心当落点会把人放进水里。
 * 所以取数顺序是 **入口 → 建筑锚点 → 质心兜底**，且落点一律回采地形高程。
 *
 * **`reachable` 只答"建没建成"**：区在建成名单里（`builtRegions()`，即有 `scenes/<区>.json`）且落点在地形窗口内。
 * 没建成的区在图上灰着并注明原因。
 * 建成了的区一律可点（`D-41` 撤掉了 99-27 的「走到过才解锁」）。
 */
import type { MapPlace } from '@engine/ui/MapOverlay';
import { TERRAIN, builtRegions } from '@builder/compose/terrain';

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

  const built = new Set(builtRegions());
  return regions.map((r) => {
    const { at, from } = landing(r);
    const mid = centroid(r.polygon);
    // 建成 = 有落位清单（scenes/<区>.json）。只看地形窗口会把窗口里的空地当成能去：
    // 稻香村入建成把窗口扩到 357×376 m，藕香榭、紫菱洲等五个未建区的落点也进了窗口（D-41）。
    const reachable = built.has(r.id) && inWindow(at[0], at[1]);
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
        : `${r.name ?? r.id} · 尚未建成——还没有落位清单`,
    };
  });
}
