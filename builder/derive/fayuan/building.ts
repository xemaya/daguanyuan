import { RuleBook } from '../rules';
import { deriveFayuan, type FayuanSpec, type FayuanFrame } from './index';
import type { RoofType } from '../index';

/** Project-authored dimensions complete the gaps left intentionally by P1.
 * These inputs are design choices, not new historical rules or hidden defaults.
 */
export interface FayuanBuildingSpec extends FayuanSpec {
  paramSet: 'fayuan';
  roofType: RoofType;
  ridgeStyle: 'raised' | 'rolled';
  design: {
    note: string;
    columnBaseWidthM: number;
    eaveSupportHeightM: number;
    rafterPitchM: number;
    /** Horizontal distance from eave tip to hip/gable junction. */
    hipSetbackM?: number;
    /** Half-distance between the paired top purlins of a rolled ridge. */
    rolledHalfSpanM?: number;
  };
}

export interface FayuanBuildingFrame extends FayuanFrame {
  paramSet: 'fayuan';
  roofType: RoofType;
  ridgeStyle: 'raised' | 'rolled';
  hipSetbackM: number;
  /** Actual roof surface section, eave tip to centre, before platform offset. */
  roofSection: { s: number; y: number }[];
}

export function deriveFayuanBuilding(spec: FayuanBuildingSpec): FayuanBuildingFrame {
  if (spec.paramSet !== 'fayuan') throw new Error('法原建筑须显式使用 fayuan 参数集');
  if (!spec.design?.note?.trim()) throw new Error('施工尺寸须给 design.note，说明艺术输入依据');
  const positive = (v: number | undefined, label: string) => {
    if (v === undefined || !Number.isFinite(v) || v <= 0) throw new Error(`${label} 须显式给有限正数`);
  };
  for (const field of ['columnBaseWidthM','eaveSupportHeightM','rafterPitchM'] as const)
    positive(spec.design[field], field);
  if (!['硬山','悬山','歇山','攒尖'].includes(spec.roofType)) throw new Error(`未实现屋顶 ${spec.roofType}`);
  if (!['raised','rolled'].includes(spec.ridgeStyle)) throw new Error('ridgeStyle 非法');
  const form = spec.form ?? (spec.tier === 'C' ? 'pavilion' : 'hall');
  if (form === 'pavilion' && (spec.shape !== 'square' || spec.roofType !== '攒尖'))
    throw new Error('当前建筑几何只接方形攒尖亭；多边形亭不得静默画成四角亭');
  if (spec.roofType === '攒尖' && form !== 'pavilion') throw new Error('攒尖须用 pavilion 平面');
  if (spec.roofType === '攒尖' && spec.ridgeStyle === 'rolled') throw new Error('攒尖与卷棚不可叠作同一个屋顶');
  const frame = deriveFayuan(RuleBook.create('fayuan'), spec);
  const m = frame.m;
  m.base = spec.design.columnBaseWidthM;
  if (m.base <= m.columnD) throw new Error('柱础面宽必须大于柱径');
  m.rafterPitch = spec.design.rafterPitchM;
  if (m.rafterPitch <= m.rafterDia) throw new Error('椽中距必须大于椽径');
  m.eaveY += spec.design.eaveSupportHeightM;
  m.ridgeY += spec.design.eaveSupportHeightM;
  if (form === 'pavilion') { m.columnX = [-m.width / 2, m.width / 2]; m.rise = [0,0]; }
  const tip = m.eaveHalf + m.yanchu;
  let hipSetbackM = spec.roofType === '攒尖' ? tip : 0;
  if (spec.roofType === '歇山') {
    positive(spec.design.hipSetbackM, 'hipSetbackM');
    hipSetbackM = spec.design.hipSetbackM!;
    if (hipSetbackM <= m.yanchu || hipSetbackM >= Math.min(tip, m.width / 2 + m.yanchu))
      throw new Error('歇山收山位置必须在檐桁内侧且未到脊线/面阔中心');
  }
  let roofSection = [
    { s: 0, y: m.eaveY - m.eaveTip.drop },
    ...m.purlins.slice().reverse().map(p => ({ s: tip - p.x, y: m.eaveY + p.y })),
  ];
  if (spec.ridgeStyle === 'rolled') {
    positive(spec.design.rolledHalfSpanM, 'rolledHalfSpanM');
    const radius = spec.design.rolledHalfSpanM!;
    const [ridge, next] = m.purlins;
    if (!next || radius >= next.x || radius <= 0) throw new Error('卷棚双脊桁须位于最内一界内');
    const slope = (ridge.y - next.y) / next.x;
    const top = m.eaveY + ridge.y - slope * radius / 2;
    // A tangent quadratic cap joins the inner roof slope with zero derivative
    // at the centre. The ridge timber becomes a symmetric pair, never a single
    // upright purlin protruding through a lowered curved surface.
    roofSection = roofSection.filter(p => p.s < tip - radius);
    for (let i = 0; i <= 12; i++) {
      const x = radius * (1 - i / 12);
      roofSection.push({ s: tip - x, y: top - slope * x * x / (2 * radius) });
    }
    m.purlins = [{ x: radius, y: ridge.y - slope * radius, name: '卷棚双脊桁(单侧)' }, ...m.purlins.slice(1)];
    m.ridgeY = top;
  }
  frame.provenance.art.push({ id: 'project:building-dimensions', name: '施工尺寸与缺失细部的显式艺术输入',
    method: 'artistic_choice', note: `${spec.design.note}；输入=${JSON.stringify(spec)}` });
  return { ...frame, paramSet: 'fayuan', roofType: spec.roofType, ridgeStyle: spec.ridgeStyle,
    hipSetbackM, roofSection };
}
