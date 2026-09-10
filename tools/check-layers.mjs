#!/usr/bin/env node
/**
 * check-layers.mjs — 分层依赖门。
 *
 * 分层一旦被反向依赖破掉就名存实亡，而这种破坏在 tsc 眼里完全合法，
 * 所以必须单独立一道门。规则见 docs/superpowers/specs/2026-09-10-layered-architecture-design.md §2。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 每层不许 import 哪些别名前缀。 */
const FORBIDDEN = {
  engine: ['@builder/', '@knowledge/', '@project/'],
  builder: ['@project/'],
};
/** 额外规则：这些目录下不许出现的裸包名。 */
const NO_PACKAGE = { 'builder/derive': ['three'] };

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const violations = [];
for (const [layer, banned] of Object.entries(FORBIDDEN)) {
  for (const file of walk(layer)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (banned.some((b) => spec.startsWith(b))) {
        violations.push(`${file}: ${layer} 层不许 import ${spec}`);
      }
      // 跨层的相对路径同样违规（别名之外还能靠 ../.. 爬出去）
      if (spec.startsWith('..')) {
        const climbs = spec.split('/').filter((s) => s === '..').length;
        const depth = file.split('/').length - 1;
        if (climbs >= depth) violations.push(`${file}: 相对路径爬出了本层 (${spec})`);
      }
    }
  }
}
for (const [dir, pkgs] of Object.entries(NO_PACKAGE)) {
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      if (pkgs.includes(m[1])) violations.push(`${file}: ${dir} 不许 import '${m[1]}'`);
    }
  }
}

if (violations.length) {
  console.error(`分层门失败，${violations.length} 处违规：`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('分层门通过：engine 无反向依赖，builder 不认识 projects，derive 不碰 three。');
