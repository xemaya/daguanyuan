/**
 * 足迹：玩家走到过哪些区。
 *
 * 游园图(99-27)收口后的唯一判定源——去过才上图、才可传送,首次抵达只能靠腿
 * (ART_DIRECTION §5.5)。状态只活在本局:游戏没有存档机制,重开即从正门重新游起,
 * 这与「图是游历的记录」一致。
 *
 * 「到过」= 进入区域多边形,或走到离边界 5 m 以内——出生点在正门外 2 m,
 *  polygon 的边贴着门,没有这点余量,开局连脚下这块地都不算到过。
 */
import { locatePoint, type Point2, type Ring2 } from '@builder/plan/geometry';

/** 边界余量(米):走到墙根/门洞边就算到过这个区。 */
const MARGIN = 5;

export interface VisitedRegionLike {
  id: string;
  polygon: Ring2;
}

function distanceToRing(ring: Ring2, p: Point2): number {
  let best = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + dx * t), p[1] - (az + dz * t)));
  }
  return best;
}

export class VisitedRegions {
  private readonly seen = new Set<string>();
  private readonly regions: readonly VisitedRegionLike[];

  constructor(regions: readonly VisitedRegionLike[]) {
    this.regions = regions;
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  /** 每帧喂玩家脚下坐标;返回本帧新解锁的区域 id(多数时候是空数组)。 */
  update(x: number, z: number): string[] {
    const fresh: string[] = [];
    const p: Point2 = [x, z];
    for (const r of this.regions) {
      if (this.seen.has(r.id)) continue;
      if (locatePoint(r.polygon, p) !== 'outside' || distanceToRing(r.polygon, p) <= MARGIN) {
        this.seen.add(r.id);
        fresh.push(r.id);
      }
    }
    return fresh;
  }
}
