/**
 * 单子 BE1:`plan.connections[]` 里哪几条这一次该建(`P-37`)。
 *
 * composer 以前只遍历各区的 `linears[]`,`plan.connections` 一条都不建——四座桥
 * 从 P2 起就是纸上的桥,稻香村那座靠 scenes 里一条借道落位挂出来(BB2)。
 * 这里是「遍历 connections」的判定那一半,纯函数、不碰 three,好让三处读同一份:
 *   - `composer.ts` 拿真窗口(`TERRAIN`)调它,把 `build` 变成落位,`skipped` 写构建日志;
 *   - `tools/manifest-diff.mjs --coverage` 拿它数「窗口内应建几座」;
 *   - `tests/connection-compose.test.mjs` 把窗口临时扩大,断言窗口外那两座也会建(不改真窗口)。
 *
 * 规则(单子原文):**一座连接的全部折点都在当前地形窗口内才建**,否则跳过并记「未建:窗口外」。
 * 查全部折点而不只查首尾:窗口是矩形,首尾在内、中间折点出界的桥会有一截悬在没有地形网格的地方。
 * 入建成一个区、窗口一扩,落进来的连接自动开始建,不用回来改代码。
 */
export interface ConnectionWindow { minX: number; maxX: number; minZ: number; maxZ: number }
export interface ConnectionLike { id: string; kind: string; points: readonly (readonly [number, number])[] }
export interface ConnectionPick<C extends ConnectionLike> {
  build: C[];
  skipped: { id: string; reason: '窗口外'; outside: [number, number][] }[];
}

export function pickConnections<C extends ConnectionLike>(connections: readonly C[], win: ConnectionWindow): ConnectionPick<C> {
  const build: C[] = [];
  const skipped: ConnectionPick<C>['skipped'] = [];
  for (const c of connections) {
    const outside = c.points
      .filter(([x, z]) => !(x >= win.minX && x <= win.maxX && z >= win.minZ && z <= win.maxZ))
      .map(([x, z]) => [x, z] as [number, number]);
    if (outside.length) skipped.push({ id: c.id, reason: '窗口外', outside });
    else build.push(c);
  }
  return { build, skipped };
}

/** 连接的 kind → 装配器认的构件名。与 `region.linears[]` 那张表同一套(`composer.ts` plannedPlacements)。 */
export function connectionPart(kind: string): string | null {
  return kind === 'bridge' ? 'garden-bridge' : kind === 'wall' ? 'garden-wall' : kind === 'corridor' ? 'garden-corridor' : null;
}
