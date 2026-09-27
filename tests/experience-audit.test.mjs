import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { auditExperience, validateExperienceEntry, rayBlocked, experienceInputsHash } from '../tools/experience-audit.mjs';
import { auditPlan } from '../tools/plan-audit.mjs';

const source = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));
const copy = () => structuredClone(source);

test('plan 现有 experience 条目全部通过,门退出码为 0', () => {
  const { fails, results } = auditExperience(source);
  assert.deepEqual(fails, []);
  assert.ok(results.length >= 2);
  assert.equal(spawnSync(process.execPath, ['tools/check-experience.mjs']).status, 0);
});

test('突变:翠嶂山体挪开后,障景条目必须红(门不是摆设)', () => {
  const p = copy();
  const hill = p.hills.find(h => h.id === 'hill.cuizhang');
  hill.polygon = hill.polygon.map(([x, z]) => [x + 80, z]);
  const { fails } = auditExperience(p);
  assert.ok(fails.some(f => f.startsWith('X-01')), `挪动山体后 X-01 未失败: ${JSON.stringify(fails)}`);
});

test('突变:潇湘馆月洞门挪离正房轴线后,框景条目必须红', () => {
  const p = copy();
  const framed = p.experience.find(e => e.type === 'framed_view');
  if (!framed) return; // X3 之前没有框景条目,跳过
  const gate = p.regions.find(r => r.id === 'xiaoxiangguan').buildings.find(b => b.id === 'xiaoxiangguan.moon-gate');
  gate.x += 6;
  const insert = p.regions.find(r => r.id === 'xiaoxiangguan')
    .linears.find(w => w.id === 'xiaoxiangguan.courtyard-wall')
    .inserts.find(i => i.object === 'xiaoxiangguan.moon-gate');
  insert.at[0] += 6;
  const { fails } = auditExperience(p);
  assert.ok(fails.some(f => f.startsWith(framed.id)), `挪门后框景未失败: ${JSON.stringify(fails)}`);
});

test('突变:翠嶂挪离入口正前方后,X4 的迎面(approach_axis)条目必须红', () => {
  const p = copy();
  const axis = p.experience.find(e => e.type === 'approach_axis');
  if (!axis) return; // X4 之前没有 approach_axis 条目,跳过
  const hill = p.hills.find(h => h.id === 'hill.cuizhang');
  // 甲-2 判法(2026-09-15 拍板)下 X4 问的是「行进射线打不打得中山体」,不是形心测向,
  // 所以突变必须把整座山横挪出入口射线所在的 x——挪多少由山体自身与射线的相对位置算,不写死。
  const entryX = (axis.at ?? axis.path[1])[0];
  const east = Math.max(...hill.polygon.map(([x]) => x));
  const shift = -(east - entryX) - 10; // 整座山挪到入口射线以西 10 m 开外
  hill.polygon = hill.polygon.map(([x, z]) => [x + shift, z]);
  const { fails } = auditExperience(p);
  assert.ok(fails.some(f => f.startsWith(axis.id)), `挪动山体后 ${axis.id} 未失败: ${JSON.stringify(fails)}`);
});

test('突变:潇湘馆竹丛全挪去墙角远处后,遮映(filtered_view)条目必须红', () => {
  const p = copy();
  const filtered = p.experience.find(e => e.type === 'filtered_view');
  if (!filtered) return; // X4 之前没有 filtered_view 条目,跳过
  // 这条测的是**平面**验法本身还能不能红。D-34 起 X-05 改用 3D 验法(读落盘量值,竹一动就报「输入变了」,
  // 由下面「3D 尺子:竹的落位清单变了」那条守),所以在副本里显式换回平面尺子,并确保没有 hold。
  filtered.assert = 'occlusion-ratio';
  delete filtered.hold;
  const scenes = { xiaoxiangguan: structuredClone(JSON.parse(readFileSync('projects/daguanyuan/scenes/xiaoxiangguan.json', 'utf8'))) };
  for (const pl of scenes.xiaoxiangguan.placements) {
    if (pl.part === 'bamboo') { pl.dx -= 60; pl.dz -= 60; } // 挪去视点-正房连线够不到的角落
  }
  // AL-b b4 起尺子也数 scatters[] 的竹夹路;不清掉它,比例仍 0.79、照样红——红得对但原因错,测试就白测了。
  scenes.xiaoxiangguan.scatters = [];
  const { fails } = auditExperience(p, { loadScene: (id) => scenes[id] ?? null });
  const mine = fails.filter(f => f.startsWith(filtered.id));
  assert.ok(mine.length > 0, `竹丛挪开后 ${filtered.id} 未失败: ${JSON.stringify(fails)}`);
  assert.ok(mine.some(f => / 0\.0\d /.test(f) || f.includes('0.0')), `${filtered.id} 红了但比例不是掉到 0 附近: ${mine}`);
});

test('诚实规则:art 来源不许标 ok,ok 必须有原文回目与引文', () => {
  const base = copy().experience[0];
  assert.ok(validateExperienceEntry({ ...base, source: { kind: 'art' }, status: 'ok' })
    .some(f => f.includes('art')));
  assert.ok(validateExperienceEntry({ ...base, source: { ref: '07-03' }, status: 'ok' })
    .some(f => f.includes('原文')));
  assert.ok(validateExperienceEntry({ ...base, source: { kind: 'art', note: '我们做的' }, status: 'underdetermined' })
    .every(f => !f.includes('art') && !f.includes('原文')));
});

test('验不了的不许进数据:未实现 type 与错误 assert 都被拦', () => {
  const base = copy().experience[0];
  assert.ok(validateExperienceEntry({ ...base, id: 'X-99', type: 'borrowed_view', assert: 'ray' })
    .some(f => f.includes('验不了')));
  assert.ok(validateExperienceEntry({ ...base, id: 'X-99', assert: 'vibes' })
    .some(f => f.includes('assert')));
});

test('约束5 与体验门共用 rayBlocked,两者对同一视线同判', () => {
  const hill = source.hills.find(h => h.id === 'hill.cuizhang');
  const gate = source.gates.find(g => g.name.includes('正门'));
  const house = source.regions.find(r => r.id === 'xiaoxiangguan').buildings.find(b => b.id === 'xiaoxiangguan.main-house');
  assert.equal(rayBlocked([gate.x, gate.z], [house.x, house.z], hill.polygon), true);
  // 约束5 诊断照常产出(重构未改行为)。
  const report = auditPlan(source);
  assert.ok(report.diagnostics.gateSightlines.tested > 0);
});

test('hold(D-33):缺 decision/reason/until 任一项必须红——挂起不许没有出处', () => {
  for (const bad of [{}, { decision: 'D-33', reason: '尺子是平面的,不认墙不认高' }, { decision: 'x', reason: '尺子是平面的,不认墙不认高', until: 'AL-c' }]) {
    const p = copy();
    p.experience[0].hold = bad;
    const { fails } = auditExperience(p);
    assert.ok(fails.some((f) => f.includes('hold')), `残缺 hold ${JSON.stringify(bad)} 没红`);
  }
});

test('hold:挂起条目的断言失败进 held 不进 fails,但结果里带 hold、照打实测', () => {
  const p = copy();
  const hill = p.hills.find(h => h.id === 'hill.cuizhang');
  hill.polygon = hill.polygon.map(([x, z]) => [x + 80, z]);
  const x01 = p.experience.find((e) => e.id === 'X-01');
  x01.hold = { decision: 'D-33', reason: '测试用:把一条必红的断言挂起', until: '测试' };
  const { fails, results, held } = auditExperience(p);
  assert.ok(!fails.some((f) => f.startsWith('X-01')), 'X-01 挂起后仍进了 fails');
  assert.ok(held.some((f) => f.startsWith('X-01')), 'X-01 的失败没进 held');
  const r = results.find((r) => r.id === 'X-01');
  assert.equal(r.pass, false);
  assert.equal(r.hold.decision, 'D-33');
});

/* 单子 AL-c c1:filtered_view 的第二把尺子 `occlusion-ratio-3d`。量值由 tools/visibility-probe.mjs 在活世界里
 * 量好落盘,门只读盘比区间。下面这几条不起浏览器:喂假的量值,测「门怎么对待量值」——每条都断言红的**原因**(P-34)。 */
const X05 = () => {
  const p = copy();
  const e = p.experience.find((x) => x.id === 'X-05');
  delete e.hold;
  e.assert = 'occlusion-ratio-3d';
  p.experience = [e];
  return { p, e };
};
const sceneXX = () => JSON.parse(readFileSync('projects/daguanyuan/scenes/xiaoxiangguan.json', 'utf8'));
const fakeMeasure = (p, e, scene, over = {}) => ({
  [e.id]: { ratio: 0.3, views: [{ from: e.from[0], A: 1000, B: 700, ratio: 0.3, visible: true }], visible: true, commit: 'test', inputsHash: experienceInputsHash(p, e, scene), ...over },
});

test('3D 尺子:量值在区间内且输入指纹对得上 → 通过', () => {
  const { p, e } = X05(); const scene = sceneXX();
  const { fails } = auditExperience(p, { loadScene: () => scene, measured: fakeMeasure(p, e, scene) });
  assert.deepEqual(fails, []);
});

test('3D 尺子:量值越界 → 红,原因是「3D 遮挡比例 … 不在」', () => {
  const { p, e } = X05(); const scene = sceneXX();
  const { fails } = auditExperience(p, { loadScene: () => scene, measured: fakeMeasure(p, e, scene, { ratio: 0.79 }) });
  assert.ok(fails.length === 1 && fails[0].includes('3D 遮挡比例 0.79'), JSON.stringify(fails));
});

test('3D 尺子:竹的落位清单变了 → 红,原因是「输入变了」,不拿过期量值判', () => {
  const { p, e } = X05(); const scene = sceneXX();
  const measured = fakeMeasure(p, e, scene);           // 按原清单量的
  const moved = structuredClone(scene);
  moved.scatters[0].offset_m += 0.5;                   // 之后有人改了竹夹路
  const { fails } = auditExperience(p, { loadScene: () => moved, measured });
  assert.ok(fails.length === 1 && fails[0].includes('输入变了'), JSON.stringify(fails));
});

test('3D 尺子:摘 hold / 改区间 / 换 assert 不让量值作废(指纹只含从哪看、看谁、墙、房、竹)', () => {
  const { p, e } = X05(); const scene = sceneXX();
  const h0 = experienceInputsHash(p, e, scene);
  assert.equal(experienceInputsHash(p, { ...e, ratio: [0, 0.9], assert: 'occlusion-ratio', hold: { decision: 'D-1' } }, scene), h0);
  assert.notEqual(experienceInputsHash(p, { ...e, from: [[-100, 122]] }, scene), h0);
});

test('3D 尺子:指纹只收视线走廊碰得到的区——稻香村改房不让 X-05 过期,潇湘馆改房照样过期(单子 BA)', () => {
  const { p, e } = X05(); const scene = sceneXX();
  const h0 = experienceInputsHash(p, e, scene);
  const far = structuredClone(p);
  far.regions.find((r) => r.id === 'daoxiangcun').buildings[0].x += 5;
  assert.equal(experienceInputsHash(far, e, scene), h0);
  const near = structuredClone(p);
  near.regions.find((r) => r.id === 'xiaoxiangguan').buildings[0].x += 0.5;
  assert.notEqual(experienceInputsHash(near, e, scene), h0);
});

test('3D 尺子:没量过 → 红,原因是「没有 3D 量值」;视点看不见目标 → 红,原因是「看不见目标」', () => {
  const { p, e } = X05(); const scene = sceneXX();
  const none = auditExperience(p, { loadScene: () => scene, measured: {} }).fails;
  assert.ok(none.length === 1 && none[0].includes('没有 3D 量值'), JSON.stringify(none));
  const blind = auditExperience(p, { loadScene: () => scene, measured: fakeMeasure(p, e, scene, { visible: false, ratio: null }) }).fails;
  assert.ok(blind.length === 1 && blind[0].includes('看不见目标'), JSON.stringify(blind));
});

test('平面尺子照判,有 3D 量值就并排打出来(只量不判,不改 pass)', () => {
  const p = copy(); const scene = sceneXX();
  const e = p.experience.find((x) => x.id === 'X-05');
  e.assert = 'occlusion-ratio'; // 测平面尺子这一路;D-34 起 X-05 本身已改用 3D 验法
  const { results } = auditExperience(p, { loadScene: () => scene, measured: fakeMeasure(p, e, scene, { ratio: 0.99 }) });
  const r = results.find((x) => x.id === 'X-05');
  assert.ok(r.note && r.note.includes('参照·3D') && r.note.includes('0.99'), r.detail);
});
