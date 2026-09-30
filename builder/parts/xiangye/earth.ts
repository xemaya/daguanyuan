import { makeRng } from '@engine/core/Noise';

/**
 * 黄泥版筑的共用做法(茅屋土壁与黄泥矮墙同一套)。
 * 单子 BD1(D-36 推翻条件触发):层线、泥抹痕、穿棍孔已改归贴图(materials.ts 的 earthWallMaterial),
 * 本文件只剩版线序列——几何按它分行,只为门窗洞对齐与塌角。下面是 D-36 ② 那一版的原始说明:
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
