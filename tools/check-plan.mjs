#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import '../tests/ts-resolver.mjs';
const { auditPlan } = await import('./plan-audit.mjs');

const plan = JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json', import.meta.url), 'utf8'));
const report = auditPlan(plan);
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  for (const message of report.fails) console.error(`失败：${message}`);
  for (const message of report.pending) console.warn(`待完成：${message}`);
  console.log(`平面几何检查：${report.fails.length} 项失败，${report.pending.length} 项待完成。`);
  console.log(`七条约束覆盖：${report.constraints.map(c => `${c.id}=${c.status}`).join('，')}。`);
  console.log(`${plan.regions.length} 区、${plan.water.length} 水、${plan.hills.length} 山；` +
    (report.complete ? '已实现断言全部通过。' : '当前结果不构成 P2 或全园验收通过。'));
}
// Final acceptance cannot silently inherit development-stage exceptions.
if (report.fails.length || (process.argv.includes('--strict') && !report.complete)) process.exitCode = 1;
