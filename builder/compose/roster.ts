/**
 * roster.ts —— 世界自报的构件清单（单子 AD 第一档对账的真源；单子 Z 搬出来共享）。
 *
 * 为什么要单独一个模块：清单本来挂在 `composer.ts` 建的 `Garden` 组上，
 * 于是只有「起屋叠石」这一步能往里登记。但 `world.ts` 的构建顺序是
 * 开天→理地→引水→**植树**→圈地→起屋叠石——**「植树」比 `Garden` 组早**，
 * 它建出来的东西（按 plan 的 `planting` 条目长出来的花池）没地方登记，
 * 于是对账门把 `xiaoxiangguan.path-bed-west/east` 报成「数据说有、世界没有」，
 * 而它们其实好好地长在那儿。
 *
 * 这是 spec §1.5 ②「世界自报的清单是残缺的」在另一层复发：门只看得见
 * 登记进来的东西，一整个构建步骤不登记，它就整步隐形。
 *
 * 清单是**一个数组实例**，`composer` 把它挂上 `Garden.userData.constructions`，
 * 谁先建谁先登记，顺序即构建顺序。`world.build()` 每次开头清空一次，
 * 免得热重载时越攒越多。
 */

export interface WorldObject {
  /** 对得上 plan 对象就是它的稳定 id，对不上就是 `${part}:${variant}`。 */
  id: string;
  name?: string;
  part: string;
  variant: string;
  position: [number, number, number];
  yaw: number;
  /**
   * 这件东西**就是** plan 的哪个对象。
   * ⚠️ 不能从「相对谁摆」推：竹丛相对正房摆，不等于竹丛就是正房。
   */
  planId: string | null;
  /** 构件本地包围盒 [sx, sy, sz]，接缝门要靠它算端点。 */
  size?: [number, number, number] | null;
  [key: string]: unknown;
}

const roster: WorldObject[] = [];

/** 同一个数组实例，`composer` 把它挂上 `Garden.userData.constructions`。 */
export function getRoster(): WorldObject[] {
  return roster;
}

export function resetRoster(): void {
  roster.length = 0;
}

export function registerObject(o: WorldObject): void {
  roster.push(o);
}
