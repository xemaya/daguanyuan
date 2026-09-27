/**
 * 乡野线性构件(黄泥矮墙、青篱)共用的折线工具:按弧长取站点、转角斜接、按开口切段。
 * plan 的走线是 `layout.runs[].points`(x,z 平面折线);构件沿它扫出截面。
 */
export type P2 = [number, number];
export interface Station {
  /** 平面位置。 */
  p: P2;
  /** 沿线单位切向。 */
  t: P2;
  /** 左手法向(已按斜接放大:转角处截面沿它伸出,两腿面对得上)。 */
  n: P2;
  /** 弧长。 */
  s: number;
}

export function polylineLength(pts: readonly P2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** 按 ≤step 取站点,保留每个折点;折点处法向取两腿平分方向并按 1/cos(半角) 放大。 */
export function stations(pts: readonly P2[], step: number): Station[] {
  if (pts.length < 2) throw new Error('[xiangye] 折线至少两点');
  const legs = pts.slice(1).map((b, i) => {
    const a = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) throw new Error('[xiangye] 折线有重合点');
    return { a, len, t: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] as P2 };
  });
  const left = (t: P2): P2 => [-t[1], t[0]];
  const out: Station[] = [];
  let s0 = 0;
  legs.forEach((leg, i) => {
    const n = Math.max(1, Math.ceil(leg.len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const f = k / n, p: P2 = [leg.a[0] + leg.t[0] * leg.len * f, leg.a[1] + leg.t[1] * leg.len * f];
      let nn = left(leg.t), tt = leg.t;
      if (k === n && i < legs.length - 1) {
        const b = legs[i + 1].t, m: P2 = [leg.t[0] + b[0], leg.t[1] + b[1]], ml = Math.hypot(m[0], m[1]);
        if (ml < 0.5) throw new Error('[xiangye] 折线转角过急(超过约 150°)');
        tt = [m[0] / ml, m[1] / ml];
        const nl = left(tt), c = nl[0] * nn[0] + nl[1] * nn[1];
        nn = [nl[0] / c, nl[1] / c];
      }
      out.push({ p, t: tt, n: nn, s: s0 + leg.len * f });
    }
    s0 += leg.len;
  });
  return out;
}

/** 折线上弧长 [s0,s1] 的子折线(保留中间折点)。 */
export function subPolyline(pts: readonly P2[], s0: number, s1: number): P2[] {
  const out: P2[] = [];
  let acc = 0;
  const at = (a: P2, b: P2, f: number): P2 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lo = Math.max(s0, acc), hi = Math.min(s1, acc + len);
    if (hi > lo + 1e-6) {
      if (!out.length) out.push(at(a, b, (lo - acc) / len));
      out.push(at(a, b, (hi - acc) / len));
    }
    acc += len;
  }
  return out;
}

/** 点投到折线上的弧长(取最近腿)。 */
export function arcAt(pts: readonly P2[], q: P2): { s: number; dist: number } {
  let best = { s: 0, dist: Infinity }, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const f = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / (len * len)));
    const d = Math.hypot(a[0] + dx * f - q[0], a[1] + dz * f - q[1]);
    if (d < best.dist) best = { s: acc + f * len, dist: d };
    acc += len;
  }
  return best;
}

/** 按开口(弧长中心 ± 半宽)把一条走线切成若干实段。 */
export function splitByOpenings(pts: readonly P2[], cuts: { s: number; width: number }[]): P2[][] {
  const L = polylineLength(pts), spans: [number, number][] = [];
  let at = 0;
  for (const c of [...cuts].sort((a, b) => a.s - b.s)) {
    const lo = c.s - c.width / 2, hi = c.s + c.width / 2;
    if (lo < at - 1e-6 || hi > L + 1e-6) throw new Error('[xiangye] 开口重叠或出了走线');
    if (lo - at > 0.3) spans.push([at, lo]);
    at = hi;
  }
  if (L - at > 0.3) spans.push([at, L]);
  return spans.map(([a, b]) => subPolyline(pts, a, b));
}
