#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import '../tests/ts-resolver.mjs';
const { auditPlan } = await import('./plan-audit.mjs');
const { locatePoint } = await import('../builder/plan/geometry.ts');

/**
 * 水系流向校验(单子 S):
 *  - 每条水系必须显式声明 flow_m_s,非负有限数(静水写 0,不许缺省);
 *  - flow_m_s > 0 的水系必须有至少两点的 centerline;
 *  - centerline 折点必须落在自己的 polygon 内。
 */
export function auditWaterFlow(plan) {
  const fails = [];
  for (const w of plan.water) {
    const label = `water ${w.id ?? w.name}`;
    const flow = w.flow_m_s;
    if (typeof flow !== 'number' || !Number.isFinite(flow) || flow < 0) {
      fails.push(`${label} 的 flow_m_s 缺失或非法(须为非负有限数,静水显式写 0)`);
      continue;
    }
    const line = w.centerline;
    if (flow > 0 && (!Array.isArray(line) || line.length < 2)) {
      fails.push(`${label} flow_m_s=${flow} 但缺 centerline(流动水系必须给出流向折线)`);
      continue;
    }
    if (Array.isArray(line)) {
      for (const p of line) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) {
          fails.push(`${label} 的 centerline 含非法坐标 (${JSON.stringify(p)})`);
          continue;
        }
        if (locatePoint(w.polygon, p) === 'outside')
          fails.push(`${label} 的 centerline 折点 (${p}) 落在水面多边形外`);
      }
    }
  }
  return fails;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const plan = JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json', import.meta.url), 'utf8'));
  const report = auditPlan(plan);
  const flowFails = auditWaterFlow(plan);
  report.fails.push(...flowFails);
  if (flowFails.length) report.complete = false;
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const message of report.fails) console.error(`失败：${message}`);
    for (const message of report.pending) console.warn(`待完成：${message}`);
    console.log(`平面几何检查：${report.fails.length} 项失败，${report.pending.length} 项待完成。`);
    console.log(`七条约束覆盖：${report.constraints.map(c => `${c.id}=${c.status}`).join('，')}。`);
    console.log(`${plan.regions.length} 区、${plan.water.length} 水、${plan.hills.length} 山；` +
      (report.complete ? '已实现断言全部通过。' : '当前结果不构成全园验收通过；P2几何输入另由check:p2检查。'));
  }
  // Final acceptance cannot silently inherit development-stage exceptions.
  if (report.fails.length || (process.argv.includes('--strict') && !report.complete)) process.exitCode = 1;
}
