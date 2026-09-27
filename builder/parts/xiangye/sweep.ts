import * as THREE from 'three';
import type { Station } from './path';

/**
 * 沿折线站点扫出一个闭合截面(乡野泥墙逐版、草檐)。截面点是 (n, y):n 沿站点的斜接法向,y 竖直。
 * 朝向不靠手算绕序:每个三角的面法线与「截面形心 → 三角中心」比,整体反了就翻。
 */
export interface SweepOptions {
  /** 每站对截面点的扰动(返回新的 n,y);用于草檐的蓬松起伏、逐版进出。 */
  warp?: (st: Station, j: number, i: number, n: number, y: number) => [number, number];
  /** 顶点色(返回 rgb 乘子)。 */
  color?: (s: number, n: number, y: number) => [number, number, number];
  /** uv:缺省侧面 (s, y)、近水平面 (s, n),都除以 tile。 */
  tile?: number;
  /** 截面弧长当 v(草檐:草秆横跨墙顶)。 */
  arcV?: boolean;
  caps?: boolean;
}

export function sweepSection(st: Station[], section: [number, number][], o: SweepOptions = {}): THREE.BufferGeometry {
  const C = section.length, tile = o.tile ?? 1;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], axis: number[] = [];
  const cy = section.reduce((a, p) => a + p[1], 0) / C, cn = section.reduce((a, p) => a + p[0], 0) / C;
  const arc = [0];
  for (let i = 1; i <= C; i++) arc.push(arc[i - 1] + Math.hypot(section[i % C][0] - section[i - 1][0], section[i % C][1] - section[i - 1][1]));
  const emit = (x: number, y: number, z: number, u: number, v: number, s: number, n: number, ax: number, az: number) => {
    pos.push(x, y, z); uv.push(u, v); axis.push(ax, cy, az);
    if (o.color) col.push(...o.color(s, n, y));
  };
  // 侧面:每个截面点复制一份给 C 号(uv 接缝)。
  st.forEach((S, j) => {
    for (let i = 0; i <= C; i++) {
      const [n0, y0] = section[i % C];
      const [n, y] = o.warp ? o.warp(S, j, i % C, n0, y0) : [n0, y0];
      const x = S.p[0] + S.n[0] * n, z = S.p[1] + S.n[1] * n;
      const i1 = section[(i + 1) % C], i0 = section[(i + C - 1) % C];
      const flat = Math.abs(i1[1] - i0[1]) < Math.abs(i1[0] - i0[0]) * 0.6;
      const u = S.s / tile, v = o.arcV ? arc[i] / tile : (flat ? n : y) / tile;
      emit(x, y, z, u, v, S.s, n, S.p[0] + S.n[0] * cn, S.p[1] + S.n[1] * cn);
    }
  });
  const idx: number[] = [];
  for (let j = 0; j < st.length - 1; j++) for (let i = 0; i < C; i++) {
    const a = j * (C + 1) + i, b = a + 1, c = a + C + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const sideCount = idx.length;
  // 端头:截面三角化。
  if (o.caps !== false) {
    const tri = THREE.ShapeUtils.triangulateShape(section.map(([n, y]) => new THREE.Vector2(n, y)), []);
    for (const [j, S] of [[0, st[0]], [st.length - 1, st[st.length - 1]]] as const) {
      const base = pos.length / 3;
      section.forEach(([n0, y0], i) => {
        const [n, y] = o.warp ? o.warp(S, j, i, n0, y0) : [n0, y0];
        const x = S.p[0] + S.n[0] * n, z = S.p[1] + S.n[1] * n;
        const dir = j === 0 ? -1 : 1;
        emit(x, y, z, n / tile, y / tile, S.s, n, S.p[0] + S.n[0] * cn - S.t[0] * dir * 10, S.p[1] + S.n[1] * cn - S.t[1] * dir * 10);
      });
      for (const [a, b, c] of tri) idx.push(base + a, base + b, base + c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (o.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // 朝向:侧面与端头分别按「轴 → 三角中心」判。端头的轴点沿切向退 10 m,等于判沿切向朝外。
  const fix = (from: number, to: number) => {
    let sum = 0;
    const P = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const A = (k: number) => new THREE.Vector3(axis[k * 3], axis[k * 3 + 1], axis[k * 3 + 2]);
    for (let t = from; t < to; t += 3) {
      const a = P(idx[t]), b = P(idx[t + 1]), c = P(idx[t + 2]);
      const nrm = b.clone().sub(a).cross(c.clone().sub(a));
      const cen = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      sum += nrm.dot(cen.sub(A(idx[t])));
    }
    if (sum < 0) for (let t = from; t < to; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  };
  fix(0, sideCount);
  const capTris = (idx.length - sideCount) / 2;
  if (capTris) { fix(sideCount, sideCount + capTris); fix(sideCount + capTris, idx.length); }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 沿站点的一条竖直带(草檐垂茬 alpha 卡):上沿 (nTop,yTop)、下沿 (nBot,yBot)。 */
export function hangingStrip(st: Station[], nTop: number, yTop: (s: number) => number, nBot: number, yBot: (s: number) => number, uPerM: number, u0 = 0): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  st.forEach((S, j) => {
    pos.push(S.p[0] + S.n[0] * nTop, yTop(S.s), S.p[1] + S.n[1] * nTop, S.p[0] + S.n[0] * nBot, yBot(S.s), S.p[1] + S.n[1] * nBot);
    uv.push(u0 + S.s * uPerM, 1, u0 + S.s * uPerM, 0);
    if (j) { const a = (j - 1) * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
