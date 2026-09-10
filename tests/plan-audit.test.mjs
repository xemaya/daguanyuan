import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { auditPlan } from '../tools/plan-audit.mjs';
const source = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));
const copy = () => structuredClone(source);

test('plan audit exposes unfinished constraints, never claiming seven passed', () => {
  const result = auditPlan(source);
  assert.deepEqual(result.fails, []);
  assert.equal(result.constraints.length, 7);
  assert.equal(result.complete, false);
  assert.equal(result.constraints.find(c => c.id === 6).status, 'incomplete');
  assert.equal(result.diagnostics.route.regionLabels, 14);
  assert.equal(spawnSync(process.execPath, ['tools/check-plan.mjs', '--strict', '--json']).status, 1);
});
test('a new outside entrance fails instead of being waived as P2 work', () => {
  const p = copy();
  p.regions.find(r => r.id === 'xiaoxiangguan').entrances.push([240,240]);
  assert.ok(auditPlan(p).fails.some(f => f.includes('xiaoxiangguan') && f.includes('entrance')));
});
test('east/west constraint uses palace axis instead of world origin', () => {
  const p = copy();
  p.regions.find(r => r.id === 'shengqin_biesu').buildings.find(x => x.name.includes('缀锦阁')).x = 10;
  assert.ok(auditPlan(p).fails.some(f => f.startsWith('约束1')));
});
test('waterside pavilion must be in water, not just east of origin', () => {
  const p = copy();
  const b = p.regions.find(r => r.id === 'ouxiangxie').buildings.find(b => b.name.includes('藕香榭'));
  b.x = 200; b.z = 200;
  assert.ok(auditPlan(p).fails.some(f => f.startsWith('约束2')));
});
test('occlusion consumes real hill and still requires 3D evidence', () => {
  const original = auditPlan(source), p = copy();
  const small = [[-5,200],[5,200],[5,210],[-5,210],[-5,200]];
  p.regions.find(r => r.id === 'cuizhang').polygon = small;
  assert.deepEqual(auditPlan(p).diagnostics.gateSightlines, original.diagnostics.gateSightlines);
  p.hills.find(h => h.name.startsWith('翠嶂')).polygon = small;
  assert.ok(auditPlan(p).diagnostics.gateSightlines.intersected < original.diagnostics.gateSightlines.intersected);
  assert.equal(original.constraints.find(c => c.id === 5).status, 'incomplete');
});
