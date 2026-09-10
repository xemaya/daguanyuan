import { isClosedRing, isSimpleRing, signedArea, locatePoint, containsRing,
  interiorsOverlap, segmentLocations } from '../builder/plan/geometry.ts';

import { validatePlanObjects } from '../builder/plan/objects.ts';

// Only exact pre-P2 defects are pending. New bad entrances must fail.
const knownOutside = new Set([
  'zhengmen:entrance:55,244',
  'zhengmen:雪白粉墙·下面虎皮石(随势砌去):20,240',
  'qinfang_ting_qiao:entrance:-4,178',
  'daoxiangcun:土井·桔槔辘轳:-202,-8',
  'nuanxiangwu:entrance:148,-22',
  'nuanxiangwu:夹道西过街门(外额穿云·内额度月):148,-20',
  'nuanxiangwu:夹道东过街门(外接山坡):208,-20',
]);

/** Passing implemented assertions is not proof of all seven source constraints. */
export function auditPlan(plan) {
  const fails = [], pending = [], constraints = [], diagnostics = {};
  const ok = (condition, message) => { if (!condition) fails.push(message); };
  const checkRing = (poly, label) => {
    const valid = isClosedRing(poly) && isSimpleRing(poly);
    ok(valid, `${label} 多边形未闭合、自相交、重边或包含非法坐标`);
    if (valid) ok(Math.abs(signedArea(poly)) > 1, `${label} 面积近于零`);
    return valid;
  };
  fails.push(...validatePlanObjects(plan.regions));
  const wallValid = checkRing(plan.wall, '外墙');
  const validRegions = new Set();
  for (const [kind, items] of [['region', plan.regions], ['water', plan.water], ['hill', plan.hills]]) {
    for (const item of items) {
      const label = `${kind} ${item.id ?? item.name}`;
      if (!checkRing(item.polygon, label)) continue;
      if (kind === 'region') validRegions.add(item.id);
      if (wallValid) ok(containsRing(plan.wall, item.polygon), `${label} 有顶点或边段落在墙外`);
    }
  }
  for (let i = 0; i < plan.regions.length; i++) for (let j = i + 1; j < plan.regions.length; j++) {
    const a = plan.regions[i], b = plan.regions[j];
    if (validRegions.has(a.id) && validRegions.has(b.id))
      ok(!interiorsOverlap(a.polygon, b.polygon), `区域内部重叠：${a.id} × ${b.id}`);
  }
  for (const r of plan.regions) {
    ok(['A', 'B', 'C', 'C-r'].includes(r.tier), `${r.id} 的 tier 非法：${r.tier}`);
    if (!validRegions.has(r.id)) continue;
    const anchor = (name, p) => {
      if (locatePoint(r.polygon, p) !== 'outside') return;
      (knownOutside.has(`${r.id}:${name}:${p}`) ? pending : fails)
        .push(`${r.id} 的 ${name} (${p}) 在区域外`);
    };
    for (const e of r.entrances ?? []) anchor('entrance', e);
    for (const b of r.buildings ?? []) anchor(b.name, [b.x, b.z]);
  }
  const ids = new Set(plan.regions.map(r => r.id));
  ok(ids.size === plan.regions.length, '区域 id 重复');
  for (const id of plan.route_ch17) ok(ids.has(id), `游线里的 ${id} 不是任何区域`);
  const spot = (name, region) => plan.regions.filter(r => !region || r.id === region)
    .flatMap(r => r.buildings ?? []).find(b => b.name.includes(name));
  const xy = b => [b.x, b.z];
  const record = (id, passed, remaining = []) => {
    constraints.push({ id, status: remaining.length ? 'incomplete' : 'checked', passed, remaining });
    for (const requirement of remaining) pending.push(`约束${id}：${requirement}`);
  };
  const daguan = spot('大观楼'), zhuijin = spot('缀锦阁'), hanfang = spot('含芳阁');
  const c1 = !!(daguan && zhuijin && hanfang && zhuijin.x > daguan.x && hanfang.x < daguan.x);
  ok(c1, '约束1：缀锦阁须在大观楼以东、含芳阁须在大观楼以西（非世界原点东西）');
  record(1, c1 ? ['两阁相对大观楼的东西关系'] : []);
  if (!c1) constraints.at(-1).status = 'failed';
  const ouxiang = spot('藕香榭', 'ouxiangxie');
  const c2 = !!(ouxiang && daguan && ouxiang.x > daguan.x &&
    plan.water.some(w => isSimpleRing(w.polygon) && locatePoint(w.polygon, xy(ouxiang)) === 'inside'));
  ok(c2, '约束2：藕香榭须在主轴以东，且锚点在实际水体内部');
  record(2, c2 ? ['藕香榭在主轴以东、池中'] : [], ['隔水闻乐的距离与遮挡尚未验证']);
  record(3, [], ['凸碧—凹晶—竹栏—藕香榭的通行连接、上山里程和坡度尚未验证']);
  record(4, [], ['水系各段进出与岔流合流拓扑尚未验证']);
  const gate = plan.gates.find(g => g.name.includes('正门'));
  const hill = plan.hills.find(h => h.name.startsWith('翠嶂'));
  ok(!!gate && !!hill, '约束5：缺少正门或实际翠嶂山体');
  const targets = plan.regions.filter(r => r.id !== 'cuizhang' && r.id !== 'zhengmen')
    .flatMap(r => (r.buildings ?? []).map(b => ({ region: r.id, name: b.name, point: xy(b) })));
  if (gate && hill && isSimpleRing(hill.polygon)) {
    const clear = targets.filter(t => !segmentLocations(xy(gate), t.point, hill.polygon)
      .some(s => s.location === 'inside'));
    diagnostics.gateSightlines = { basis: 'hill polygon, building anchors; plan view only',
      tested: targets.length, intersected: targets.length - clear.length, clear };
    // Plan-view intersections say nothing about actual terrain/roof heights.
    record(5, [`${targets.length - clear.length}/${targets.length} 条锚点射线穿过实际山体平面`],
      ['需以真实地形及建筑顶部/边缘验证门内视点遮挡；平面相交不等于三维遮挡']);
    for (const t of clear) pending.push(`约束5：平面无遮挡 ${t.region}/${t.name}`);
  } else record(5, [], ['山体数据无效，无法测试视线']);
  diagnostics.route = { regionLabels: plan.route_ch17.length, requiredNarrativeNodes: 29 };
  record(6, [], ['缺少29节点的实际连续路径及可走通证据；禁止用区域中心连线计算55%路程比例']);
  const southGate = spot('向南的正门', 'nuanxiangwu');
  const westGate = spot('西过街门', 'nuanxiangwu'), eastGate = spot('东过街门', 'nuanxiangwu');
  const southFacing = southGate?.facing === 'south';
  ok(southFacing, '约束7：暖香坞正门须朝南');
  const northLane = !!(southGate && westGate && eastGate && westGate.x < eastGate.x &&
    westGate.z < southGate.z && eastGate.z < southGate.z);
  diagnostics.nuanxiangLane = { northOfGate: northLane };
  record(7, southFacing ? ['正门朝南'] : [], [
    ...(northLane ? [] : ['现有夹道两端位于正门南侧，与裁决的北侧夹道冲突']),
    '夹道连续线形、东西门题额及东端接坡仍待整体空间验收',
  ]);
  return { fails, pending, constraints, diagnostics, complete: fails.length === 0 && pending.length === 0 };
}
