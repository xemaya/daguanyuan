#!/usr/bin/env node
/**
 * check-experience.mjs — PE 体验门(单子 X2)。
 *
 * 验 plan.json 的 experience 段:每条造景关系先过契约校验
 * (validateExperienceEntry),再跑它 assert 指定的验法。
 * 「验不了的不许进数据」在这里是硬的:type 未实现、assert 不符、
 * status 与 source 不匹配,都进 fails,不是警告。
 *
 * 与 check-plan.mjs 的关系:约束5(翠嶂障景)是 occlusion 的一个实例,
 * 两者共用 experience-audit.mjs 的 rayBlocked;约束5 照常报它的
 * 「平面≠三维」遗留项,本门不重复。
 */
import { readFileSync } from 'node:fs';
import { auditExperience, EXPERIENCE_TYPES, IMPLEMENTED_ASSERTS } from './experience-audit.mjs';

const plan = JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json', import.meta.url), 'utf8'));

if (!Array.isArray(plan.experience) || plan.experience.length === 0) {
  console.error('失败：plan.json 没有 experience 段(PE-1 契约未落)。');
  process.exit(1);
}

const { fails, results, held } = auditExperience(plan);

for (const r of results) {
  if (r.hold) {
    console.log(`HOLD  ${r.id} ${r.type} [${r.status}] — ${r.detail}`);
    console.log(`      挂起(${r.hold.decision}):${r.hold.reason} 等:${r.hold.until}`);
    if (r.pass) console.log(`      ↑ 这条已经通过——去 plan.json 撤掉 hold`);
    continue;
  }
  (r.pass ? console.log : console.error)(
    `${r.pass ? 'PASS' : 'FAIL'}  ${r.id} ${r.type} [${r.status}] — ${r.detail}`);
}

const unimplemented = EXPERIENCE_TYPES.filter((t) => !IMPLEMENTED_ASSERTS[t]);
console.log(`体验门：${results.length} 条造景关系，${fails.length} 项失败，${results.filter((r) => r.hold).length} 条挂起（${held.length} 项断言未过、不置红）。`);
console.log(`验法覆盖：${Object.keys(IMPLEMENTED_ASSERTS).join('、')}；本期未实现：${unimplemented.join('、')}（见 tools/experience-audit.mjs 注释）。`);
if (fails.length) process.exitCode = 1;
