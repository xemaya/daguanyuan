import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { auditExperience, validateExperienceEntry, rayBlocked } from '../tools/experience-audit.mjs';
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
  // D-33 起 X-05 挂着 hold;这条测的是验法本身还能不能红,所以先摘掉。
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
