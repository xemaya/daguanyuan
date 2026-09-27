import * as THREE from 'three';
import { Simplex, makeRng } from '@engine/core/Noise';

/**
 * 黄泥版筑的共用做法(茅屋土壁与黄泥矮墙同一套,单子 BA 返工 D-36 ②)。
 *
 * 第一轮棚拍的病:版高一律一尺、层线又直又齐、一版一色 → 读成浅色木板。这里改三件:
 *   ① **版高不等**:每版 0.26–0.38 m(夹板一次夯多高,本来就看人看土),同一栋房四面同一套层线;
 *   ② **层线起伏断续**:层线沿墙上下摆 ±2 cm,外皮逐段鼓瘪;再用**泥抹痕**(补泥)盖掉一些层线;
 *   ③ **塌角**:墙端、门窗边的版头随机缩进、啃掉一块。
 * 返潮仍由调用方写顶点色。所有数都是艺术取值(`provenance.art` 见调用方)。
 */

/** 版线高度序列(含 0),一直排到 maxH 以上。 */
export function liftSequence(seed: number, maxH: number, min = 0.26, max = 0.38): number[] {
  const rng = makeRng(seed), out = [0];
  while (out[out.length - 1] < maxH) out.push(out[out.length - 1] + min + rng() * (max - min));
  return out;
}

/** 把序列裁到 [0,H]:零头不足 `minLast` 就并进上一版。返回 [y0,y1,序号] 行。 */
export function rowsUpTo(seq: number[], H: number, minLast = 0.13): [number, number, number][] {
  const rows: [number, number, number][] = [];
  for (let k = 0; k + 1 < seq.length && seq[k] < H - 1e-6; k++) rows.push([seq[k], Math.min(seq[k + 1], H), k]);
  if (rows.length > 1 && rows[rows.length - 1][1] - rows[rows.length - 1][0] < minLast) {
    const last = rows.pop()!;
    rows[rows.length - 1][1] = last[1];
  }
  return rows;
}

/** 层线的上下摆:第 k 条线在沿墙 a 处的偏移(0 号线贴地不摆)。 */
export function lineWobble(seed: number, amp = 0.02): (k: number, a: number) => number {
  const s = new Simplex(seed);
  return (k, a) => (k <= 0 ? 0 : amp * (0.7 * s.noise2D(a * 0.9, k * 3.7) + 0.3 * s.noise2D(a * 3.1, k * 5.3 + 9)));
}

/**
 * 泥抹痕一块:局部平面(x 沿墙、y 高、z 朝外),不规则扁圆,中间微鼓。
 * 顶点色 `tone`(补的泥与墙色略有出入)。uv 由调用方按墙面投影。
 */
export function mudPatch(cx: number, cy: number, rx: number, ry: number, seed: number, tone: number, dome = 0.009): THREE.BufferGeometry {
  const rng = makeRng(seed), s = new Simplex(seed);
  const N = 18, pos: number[] = [cx, cy, dome], idx: number[] = [];
  const ph = rng() * 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, k = 0.7 + 0.3 * (0.5 + 0.5 * s.noise2D(Math.cos(a) * 1.3 + ph, Math.sin(a) * 1.3));
    pos.push(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, 0.0015);
  }
  for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const col = new Float32Array((N + 1) * 3);
  for (let i = 0; i <= N; i++) col.set([tone, tone * 0.99, tone * 0.97], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 穿棍孔:层线上一个小暗洞(拆模后留下),断续有无。 */
export function tieHole(cx: number, cy: number, seed: number): THREE.BufferGeometry {
  const g = mudPatch(cx, cy, 0.02 + (seed % 7) * 0.001, 0.014, seed, 0.3, 0.0015);
  return g;
}
