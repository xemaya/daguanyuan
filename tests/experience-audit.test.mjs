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
