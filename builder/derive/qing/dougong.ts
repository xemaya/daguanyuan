/**
 * 斗科:踩数 ↔ 拽架 [04-02]、每拽架 3 斗口与每踩高 2 斗口 [01-07]、
 * 斗科总高 [04-04]。攒数是输入不是常量(04-06 更正值;01-05 攒数推面阔
 * 已驳倒,引用即抛),所以这里不推面阔。
 */
import type { RuleBook } from '../rules';

export interface DougongSpec {
  /** 踩数(三/五/七/九踩)。与 zhaijia 二选一 [04-02]。 */
  cai?: number;
  /** 单侧拽架数(出跳数)。 */
  zhaijia?: number;
  /** P2项目显式输入；与pingbanM成对，不将存疑的04-04当实测。 */
  heightM?: number;
  pingbanM?: number;
}

export interface Dougong {
  /** 踩数 = 2 × 出跳数 + 1 [04-02]。 */
  cai: number;
  /** 单侧拽架数。 */
  zhaijia: number;
  /** 拽架总长(米):正心桁中 → 挑檐桁中,每拽架 3 斗口 [01-07]。 */
  zhaijiaTotalM: number;
  /** 每踩高(米)= 2 斗口 [01-07 乙标 unverifiable,禁止拿它做精度断言]。 */
  layerM: number;
  /** 斗科总高(斗口)= 踩数 + 4.2,大斗底至梁底 [04-04 存疑,与 70 斗口柱高互为约束]。 */
  heightDk: number;
  /** 平板枋高(斗口)= 2 [04-04]。 */
  pingbanDk: number;
}

export function deriveDougong(book: RuleBook, spec: DougongSpec, dkM: number): Dougong {
  if (!Number.isFinite(dkM) || dkM <= 0) throw new Error('斗口须为有限正数');
  if ((spec.heightM === undefined) !== (spec.pingbanM === undefined)) throw new Error('斗科heightM和pingbanM须成对给出');
  for (const v of [spec.heightM, spec.pingbanM])
    if (v !== undefined && (!Number.isFinite(v) || v <= 0)) throw new Error('斗科显式高度须为有限正数');
  const perTiao = book.num('04-02', 'caiPerTiao');
  const base = book.num('04-02', 'caiBase');
  let cai: number;
  let zhaijia: number;
  if (spec.cai !== undefined) {
    cai = spec.cai;
    zhaijia = (cai - base) / perTiao;
  } else if (spec.zhaijia !== undefined) {
    zhaijia = spec.zhaijia;
    cai = perTiao * zhaijia + base;
  } else {
    throw new Error('斗科需给踩数(cai)或拽架数(zhaijia)之一 [04-02]');
  }
  if (![3,5,7,9].includes(cai) || !Number.isInteger(zhaijia) ||
    (spec.cai !== undefined && spec.zhaijia !== undefined && spec.zhaijia !== zhaijia))
    throw new Error('斗科踩数与拽架须合法且一致');
  const zhaijiaTotalM = zhaijia * book.num('01-07', 'perZhaijiaDk') * dkM;
  const layerM = book.num('01-07', 'caiHeightDk') * dkM;
  const heightDk = spec.heightM !== undefined
    ? book.artChoice('project:dougong-height', '调用方显式斗科总高，不使用04-04总尺度比例', spec.heightM / dkM)
    : cai + book.num('04-04', 'dougongHeightOffsetDk');
  const pingbanDk = spec.pingbanM !== undefined
    ? book.artChoice('project:pingban-height', '调用方显式平板枋高度', spec.pingbanM / dkM)
    : book.num('04-04', 'pingbanFangDk');
  return { cai, zhaijia, zhaijiaTotalM, layerM, heightDk, pingbanDk };
}
