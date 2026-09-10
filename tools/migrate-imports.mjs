#!/usr/bin/env node
/**
 * migrate-imports.mjs — 一次性脚本：把搬家后断掉的相对 import 改写成别名。
 *
 * 做法：对每个源文件，按它的**旧**位置解析每个相对 specifier，得到旧的目标文件；
 * 在搬家表里查它的新位置；同目录内的保持相对，跨目录的改成 @layer/ 别名。
 * 跑完即可删除；留在仓库里只是为了让这次搬家可复现。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve as pres } from 'node:path';

const MOVES = {
  'src/core/Engine': 'engine/core/Engine',
  'src/core/Input': 'engine/core/Input',
  'src/core/PostFX': 'engine/core/PostFX',
  'src/core/TextureLab': 'engine/core/TextureLab',
  'src/core/Noise': 'engine/core/Noise',
  'src/core/Context': 'engine/core/Context',
  'src/world/Atmosphere': 'engine/render/Atmosphere',
  'src/world/Water': 'engine/render/Water',
  'src/fx/SkyShader': 'engine/render/SkyShader',
  'src/fx/Clouds': 'engine/render/Clouds',
  'src/fx/WaterMaterials': 'engine/render/WaterMaterials',
  'src/fx/TerrainMaterials': 'engine/render/TerrainMaterials',
  'src/player/PlayerController': 'engine/player/PlayerController',
  'src/world/Collision': 'engine/player/Collision',
  'src/world/Interaction': 'engine/player/Interaction',
  'src/ui/HUD': 'engine/ui/HUD',
  'src/ui/Menu': 'engine/ui/Menu',
  'src/ui/Dialogue': 'engine/ui/Dialogue',
  'src/ui/ui.css': 'engine/ui/ui.css',
  'src/audio/Synth': 'engine/audio/Synth',
  'src/audio/Audio': 'engine/audio/Audio',
  'src/fashi/cai': 'builder/derive/fashi/cai',
  'src/fashi/puzuo': 'builder/derive/fashi/puzuo',
  'src/fashi/zhu': 'builder/derive/fashi/zhu',
  'src/fashi/juzhe': 'builder/derive/fashi/juzhe',
  'src/fashi/yanchu': 'builder/derive/fashi/yanchu',
  'src/fashi/derive': 'builder/derive/index',
  'src/fx/Sculpt': 'builder/parts/sculpt',
  'src/cn/materials': 'builder/parts/materials',
  'src/cn/registry': 'builder/parts/registry',
  'src/cn/merge': 'builder/parts/merge',
  'src/cn/index': 'builder/parts/index',
  'src/cn/parts/building': 'builder/parts/damu/building',
  'src/cn/parts/wall': 'builder/parts/qiangyuan/wall',
  'src/cn/parts/taihu': 'builder/parts/shishan/taihu',
  'src/cn/parts/bridge': 'builder/parts/shuigong/bridge',
  'src/cn/parts/bamboo': 'builder/parts/zhiwu/bamboo',
  'src/fx/FoliageMaterials': 'builder/parts/zhiwu/foliage-materials',
  'src/world/Vegetation': 'builder/parts/zhiwu/vegetation',
  'src/world/Garden': 'builder/compose/composer',
  'src/world/World': 'builder/compose/world',
  'src/world/Terrain': 'builder/compose/terrain',
  'src/main': 'projects/daguanyuan/main',
  'src/viewer': 'projects/daguanyuan/viewer',
};
const BACK = Object.fromEntries(Object.entries(MOVES).map(([o, n]) => [n, o]));

const ALIAS = [
  ['engine/', '@engine/'],
  ['builder/', '@builder/'],
  ['knowledge/', '@knowledge/'],
  ['projects/daguanyuan/', '@project/'],
];
const toAlias = (p) => {
  for (const [prefix, a] of ALIAS) if (p.startsWith(prefix)) return a + p.slice(prefix.length);
  return null;
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const root = process.cwd();
let changed = 0;
const skipped = [];
for (const file of ['engine', 'builder', 'projects'].flatMap((d) => walk(d))) {
  const newNoExt = file.replace(/\.ts$/, '');
  const oldNoExt = BACK[newNoExt];
  if (!oldNoExt) {
    skipped.push(file);
    continue;
  }
  const src = readFileSync(file, 'utf8');
  const rewrite = (whole, spec) => {
    const bare = spec.replace(/\.(ts|css)$/, '');
    const suffix = spec.endsWith('.css') ? '.css' : '';
    const oldTarget = pres(dirname(oldNoExt), bare).replace(`${root}/`, '');
    const newTarget = MOVES[oldTarget] ?? MOVES[oldTarget + suffix];
    if (!newTarget) return whole;
    const alias = toAlias(newTarget);
    if (!alias) return whole;
    const out =
      dirname(newTarget) === dirname(newNoExt) ? `./${newTarget.split('/').pop()}` : alias;
    return whole.replace(spec, out);
  };
  let out = src.replace(/from '(\.[^']*)'/g, rewrite);
  out = out.replace(/import '(\.[^']*)'/g, rewrite);
  if (out !== src) {
    writeFileSync(file, out);
    changed++;
  }
}
console.log(`改写了 ${changed} 个文件`);
if (skipped.length) console.log(`不在搬家表里(未改写): ${skipped.join(', ')}`);
