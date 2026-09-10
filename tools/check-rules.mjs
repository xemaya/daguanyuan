#!/usr/bin/env node
/**
 * check-rules.mjs — 研究稿与机读规则表的一致性门。
 *
 * 研究稿（knowledge/docs/**.md）是人读真源，带出处与两名核验者的裁决；
 * 规则表（knowledge/rules/*.json）是机读真源，代码只读它。
 * 两者必须条目对齐、状态一致，否则代码会拿着一条已被驳倒的规则算数。
 *
 * 门不校验公式与数值——研究稿里那部分是散文，自动抽取只会给出虚假的安全感。
 * 数值由誊写者负责，由 derive-assertions（手算校验）兜底。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 规则集 → 它覆盖的研究稿目录与章节文件名前缀。 */
const SETS = {
  'fashi.rules.json': { dir: 'knowledge/docs/fashi', chapters: /^0[1-7]-/ },
  'qing.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^0[1-4]-/ },
  'fayuan.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^0[56]-/ },
  'honglou.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^07-/ },
  // plants 与 missing 是跨章汇编/缺口清单,研究稿里没有对应的 ### 标题,
  // chapters 写 /^$/ 匹配不到任何文件:只校验 JSON 合法与依赖不悬空,不做条目对齐。
  'plants.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^$/ },
  'missing.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^$/ },
};

const STATUS_ZH = { 通过: 'ok', 存疑: 'contested', 驳倒: 'refuted' };

/** 从一篇研究稿里抽出 [{id, name, status}]。 */
function parseDoc(path) {
  const src = readFileSync(path, 'utf8');
  const out = [];
  // 规则块：### <id> <name> …… 直到下一个 ### 或 ##
  const blocks = src.split(/\n(?=### )/).slice(1);
  for (const b of blocks) {
    const head = /^### (\S+)\s+(.*)/.exec(b);
    if (!head) continue;
    const id = head[1];
    if (!/^\d{2}-\d{2}$/.test(id)) continue; // 跳过非规则小节
    const st = /\*\*核验状态\*\*[：:]\s*\*\*(通过|存疑|驳倒)\*\*/.exec(b);
    out.push({ id, name: head[2].trim(), status: st ? STATUS_ZH[st[1]] : null });
  }
  return out;
}

let failed = 0;
for (const [jsonName, { dir, chapters }] of Object.entries(SETS)) {
  const jsonPath = join('knowledge/rules', jsonName);
  let doc;
  try {
    doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error(`${jsonName}: 读不了或不是合法 JSON — ${e.message}`);
    failed++;
    continue;
  }
  const fromMd = new Map();
  for (const f of readdirSync(dir).filter((f) => chapters.test(f) && f.endsWith('.md'))) {
    for (const r of parseDoc(join(dir, f))) fromMd.set(r.id, r);
  }
  const fromJson = new Map(doc.rules.map((r) => [r.id, r]));

  // chapters 匹配不到任何文件的集合(plants/missing 这类跨章汇编)不做条目对齐
  const noAlign = chapters.source === '^$';
  const missingInJson = noAlign ? [] : [...fromMd.keys()].filter((id) => !fromJson.has(id));
  // json 允许多出 status=missing 的条目：那是批评稿指出的缺口，研究稿里本就没有
  const extraInJson = noAlign
    ? []
    : [...fromJson.values()].filter((r) => !fromMd.has(r.id) && r.status !== 'missing');
  const mismatched = noAlign
    ? []
    : [...fromJson.values()].filter(
        (r) => fromMd.has(r.id) && fromMd.get(r.id).status && fromMd.get(r.id).status !== r.status,
      );
  // 依赖必须指向本集合内已存在的 id
  const dangling = doc.rules.flatMap((r) =>
    (r.needs ?? []).filter((n) => !fromJson.has(n)).map((n) => `${r.id} → ${n}`),
  );
  // 每条必须声明消费它的推导链。文件按来源章节组织，参数集按消费方组织，两个轴不同：
  // 清《工程做法》06 章屋顶瓦作官式与苏式并存，整章塞进任何一个参数集都是错的。
  const PARAM_SETS = ['fashi', 'qing', 'fayuan', 'both', 'none'];
  const noParamSet = doc.rules.filter((r) => !PARAM_SETS.includes(r.paramSet));

  const bad =
    missingInJson.length + extraInJson.length + mismatched.length + dangling.length + noParamSet.length;
  console.log(
    `${jsonName.padEnd(20)} md ${String(fromMd.size).padStart(3)} 条 / json ${String(fromJson.size).padStart(3)} 条 ` +
      `/ 缺 ${missingInJson.length} / 多 ${extraInJson.length} / 状态不符 ${mismatched.length} ` +
      `/ 悬空依赖 ${dangling.length} / 缺参数集 ${noParamSet.length}`,
  );
  for (const id of missingInJson) console.error(`   json 缺 ${id}（${fromMd.get(id).name}）`);
  for (const r of extraInJson) console.error(`   json 多出 ${r.id}，研究稿里没有`);
  for (const r of mismatched) console.error(`   ${r.id} 状态不符：md=${fromMd.get(r.id).status} json=${r.status}`);
  for (const d of dangling) console.error(`   悬空依赖 ${d}`);
  for (const r of noParamSet) console.error(`   ${r.id} 的 paramSet 非法或缺失：${r.paramSet}`);
  if (bad) failed++;
}

process.exit(failed ? 1 : 0);
