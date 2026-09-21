// knowledge/docs/scenes/make-sketch.mjs — 景需求文档的平面小图。
//
// 用法:node knowledge/docs/scenes/make-sketch.mjs        (重画全部)
//      node knowledge/docs/scenes/make-sketch.mjs cuizhang
//
// 只读 plan.json / scenes/<景>.json / tools/shot-list.mjs / vegetation.ts 的
// HERO_TREES 表,不算任何几何,不引 three。图上每个点都能回溯到某一份数据,
// 所以它是"现在摆成了什么"的快照,不是设计稿。与 knowledge/docs/plan/make-plan.py
// 的分工:那张是全园总图,这里是一景一张、比例尺大到能看清一组峰和一台灯。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const plan = JSON.parse(readFileSync(resolve(ROOT, 'projects/daguanyuan/plan.json'), 'utf8'));
const { SHOTS } = await import(resolve(ROOT, 'tools/shot-list.mjs'));

/** 每景一个取景框(世界米)。翠嶂那张把正门也框进来,因为轴线是两景之间的事。 */
const FRAMES = {
  zhengmen: { minX: 10, maxX: 100, minZ: 212, maxZ: 266, shots: /^(gate_|cu_gate|cu_baogushi|cu_wall|cu_terrace|cu_lattice|cu_scroll|cu_tiaohuan$|mound_block|gate_face)/ },
  cuizhang: { minX: -66, maxX: 92, minZ: 176, maxZ: 250, shots: /^(mound_|cu_inscription|gate_face|gate_approach)/ },
  // 潇湘馆那张按院墙折线取框(x[−132,−91] z[66,120])四边各放 5 m,
  // 甬路北端 (−105,124) 与门外视点 (−105,122)、(−94,124) 都要在框内,否则
  // 「人从哪来、第一眼看什么」这一层就画不出来——那正是 D-29 要这张图解决的事。
  xiaoxiangguan: { minX: -137, maxX: -86, minZ: 61, maxZ: 129, shots: /^(moon_gate|xiaoxiang$|cu_xx_path|xx_court_gaze|cu_xiaoxiang)/ },
};

const heroTrees = (() => {
  const src = readFileSync(resolve(ROOT, 'builder/parts/zhiwu/vegetation.ts'), 'utf8');
  const block = src.slice(src.indexOf('const HERO_TREES'), src.indexOf('];', src.indexOf('const HERO_TREES')));
  return [...block.matchAll(/\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*'([^']+)'\s*\]/g)].map((m) => [+m[1], +m[2], m[3]]);
})();

const anchors = new Map();
for (const r of plan.regions) {
  for (const b of r.buildings ?? []) anchors.set(b.id, [b.x, b.z]);
  for (const k of r.rocks ?? []) anchors.set(k.id, [k.x, k.z]);
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function draw(regionId) {
  const F = FRAMES[regionId];
  const region = plan.regions.find((r) => r.id === regionId);
  const scene = JSON.parse(readFileSync(resolve(ROOT, `projects/daguanyuan/scenes/${regionId}.json`), 'utf8'));
  const S = 8; // px / m
  const W = (F.maxX - F.minX) * S, H = (F.maxZ - F.minZ) * S;
  // 画布宽度取 max(W, 标题所需):潇湘馆那张框只有 51 m 宽(408 px),
  // 标题一行要 ~500 px,不给下限标题会被裁掉半句。只影响窄框。
  const CW = Math.max(W, 520);
  const X = (x) => ((x - F.minX) * S).toFixed(1);
  const Y = (z) => ((z - F.minZ) * S).toFixed(1); // 世界 +Z 朝南,画面向下=南
  const pts = (poly) => poly.map(([x, z]) => `${X(x)},${Y(z)}`).join(' ');
  const inFrame = (x, z) => x >= F.minX && x <= F.maxX && z >= F.minZ && z <= F.maxZ;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW + 40}" height="${H + 60}" viewBox="-20 -40 ${CW + 40} ${H + 60}" font-family="'PingFang SC','Noto Sans CJK SC',sans-serif" font-size="11">`);
  out.push(`<rect x="-20" y="-40" width="${CW + 40}" height="${H + 60}" fill="#fbfaf6"/>`);
  out.push(`<text x="0" y="-22" font-size="14" font-weight="bold">${esc(region.name)}(${regionId})— 现状平面,1 px = ${(1 / S).toFixed(3)} m,上=北(−Z)</text>`);
  // 网格 10 m
  for (let x = Math.ceil(F.minX / 10) * 10; x <= F.maxX; x += 10) out.push(`<line x1="${X(x)}" y1="0" x2="${X(x)}" y2="${H}" stroke="#e6e2d8" stroke-width="0.5"/><text x="${X(x)}" y="-6" fill="#999" font-size="9" text-anchor="middle">x${x}</text>`);
  for (let z = Math.ceil(F.minZ / 10) * 10; z <= F.maxZ; z += 10) out.push(`<line x1="0" y1="${Y(z)}" x2="${W}" y2="${Y(z)}" stroke="#e6e2d8" stroke-width="0.5"/><text x="-4" y="${+Y(z) + 3}" fill="#999" font-size="9" text-anchor="end">z${z}</text>`);
  // 水
  for (const w of plan.water ?? []) if (w.polygon) out.push(`<polygon points="${pts(w.polygon)}" fill="#cfe3ee" stroke="#8fb6c9" stroke-width="0.8"/>`);
  // 山
  for (const h of plan.hills ?? []) out.push(`<polygon points="${pts(h.polygon)}" fill="#e3e9d3" stroke="#8a9a6a" stroke-width="1" stroke-dasharray="4 2"/><text x="${X(h.polygon[0][0]) }" y="${+Y(h.polygon[0][1]) - 4}" fill="#6a7a4a" font-size="10">${esc(h.id)} 高 ${h.height_m} m</text>`);
  // 区界
  for (const r of plan.regions) if (r.polygon?.some(([x, z]) => inFrame(x, z))) out.push(`<polygon points="${pts(r.polygon)}" fill="none" stroke="#b08a5a" stroke-width="1" stroke-dasharray="6 3"/><text x="${X(r.polygon[0][0]) + 3}" y="${+Y(r.polygon[0][1]) + 12}" fill="#8a6a3a" font-size="10">${esc(r.id)} 区(标高 ${r.elevation_m ?? 0} m)</text>`);
  // 路(旧路基,只画框内段)
  // 旧路基是绕全园一圈的闭环,只画连续落在框内的那几段,不许把出框再进框的点连成假线。
  for (const p of plan.paths ?? []) {
    let run = [];
    const flush = () => { if (run.length > 1) out.push(`<polyline points="${pts(run)}" fill="none" stroke="#c9a87a" stroke-width="3" stroke-linejoin="round" opacity="0.8"/>`); run = []; };
    for (const pt of p.points) (inFrame(pt[0], pt[1]) ? run.push(pt) : flush());
    flush();
  }
  // 线性:墙、桥
  for (const r of plan.regions) for (const l of r.linears ?? []) if (l.points.some(([x, z]) => inFrame(x, z))) {
    const col = l.kind === 'wall' ? '#444' : l.kind === 'bridge' ? '#6a8aa0' : '#888';
    out.push(`<polyline points="${pts(l.points)}" fill="none" stroke="${col}" stroke-width="${l.kind === 'wall' ? 3 : 4}"/>`);
    out.push(`<text x="${X(l.points[0][0])}" y="${+Y(l.points[0][1]) - 5}" fill="${col}" font-size="9">${esc(l.id)}</text>`);
  }
  // 建筑 / 岩石锚点
  // 墙类建筑的锚点落在墙线上,标签抬到线上方,免得和同一条线上的门屋标签叠字。
  // 挨得近的两件(潇湘馆甬路东西两个花池只隔 2.5 m)标签会摞成一团:
  // 按「前面有几个邻居」把标签逐行往下错开,错的是标签不是锚点。
  const drawn = [];
  for (const b of region.buildings ?? []) if (b.x != null) {
    const near = drawn.filter((d) => Math.hypot(d[0] - b.x, d[1] - b.z) < 5).length;
    const lift = (b.kind === 'wall' ? -10 : 4) + near * 12;
    drawn.push([b.x, b.z]);
    out.push(`<rect x="${+X(b.x) - 5}" y="${+Y(b.z) - 5}" width="10" height="10" fill="#7a4a2a"/><text x="${+X(b.x) + 8}" y="${+Y(b.z) + lift}" fill="#5a3a1a" font-weight="bold">${esc(b.name)} (${b.x},${b.z})</text>`);
  }
  for (const k of region.rocks ?? []) out.push(`<polygon points="${+X(k.x)},${+Y(k.z) - 6} ${+X(k.x) + 6},${+Y(k.z)} ${+X(k.x)},${+Y(k.z) + 6} ${+X(k.x) - 6},${+Y(k.z)}" fill="#8a8f96"/><text x="${+X(k.x) + 8}" y="${+Y(k.z) + 4}" fill="#4a4f56">${esc(k.id.replace(regionId + '.', ''))} (${k.x},${k.z})</text>`);
  // scenes 散置件(锚点+dx/dz)与占地
  for (const c of scene.clearances ?? []) {
    const a = anchors.get(c.anchor); if (!a) continue;
    const cx = a[0] + (c.dx ?? 0), cz = a[1] + (c.dz ?? 0);
    out.push(`<rect x="${X(cx - c.hx)}" y="${Y(cz - c.hz)}" width="${(2 * c.hx * S).toFixed(1)}" height="${(2 * c.hz * S).toFixed(1)}" fill="none" stroke="#c55" stroke-width="0.8" stroke-dasharray="2 2"/>`);
  }
  // 同一构件档摆了三件以上的(两溜高照那种),只画点、合成一个标签,免得四个标签叠成一团。
  const byPart = new Map();
  for (const p of scene.placements ?? []) {
    const a = anchors.get(p.anchor); if (!a) continue;
    const px = a[0] + (p.dx ?? 0), pz = a[1] + (p.dz ?? 0);
    if (!byPart.has(p.part)) byPart.set(p.part, []);
    byPart.get(p.part).push({ px, pz, label: p.tag ?? `${p.part}:${p.variant}` });
  }
  for (const [part, list] of byPart) {
    for (const { px, pz } of list) out.push(`<circle cx="${X(px)}" cy="${Y(pz)}" r="4" fill="#5a6e8a"/>`);
    if (list.length >= 3) {
      const cx = list.reduce((s, q) => s + q.px, 0) / list.length, cz = list.reduce((s, q) => s + q.pz, 0) / list.length;
      out.push(`<text x="${+X(cx)}" y="${+Y(cz) + 16}" fill="#3a4e6a" font-size="9" text-anchor="middle">${esc(part)} ×${list.length}</text>`);
    } else for (const { px, pz, label } of list) out.push(`<text x="${+X(px) + 6}" y="${+Y(pz) - 4}" fill="#3a4e6a" font-size="9">${esc(label)} (${px.toFixed(1)},${pz.toFixed(1)})</text>`);
  }
  // 手放树(vegetation.ts 的 HERO_TREES)与**点名种的树**(scenes 的 trees[],单子 AV2)。
  // 两处都要画:AV2 之后翠嶂的八棵在 scenes 里,只读 HERO_TREES 的话这张平面会
  // 画出一座一棵树也没有的山——而它是「现在摆成了什么」的快照,不许少画。
  for (const [x, z, sp] of heroTrees) if (inFrame(x, z)) out.push(`<circle cx="${X(x)}" cy="${Y(z)}" r="6" fill="#7fae5a" opacity="0.8"/><text x="${+X(x) + 7}" y="${+Y(z) + 4}" fill="#4a7a2a" font-size="9">${esc(sp)}</text>`);
  for (const t of scene.trees ?? []) if (inFrame(t.x, t.z)) out.push(`<circle cx="${X(t.x)}" cy="${Y(t.z)}" r="6" fill="#4f8a3a" opacity="0.9"/><text x="${+X(t.x) + 7}" y="${+Y(t.z) + 4}" fill="#2f6a1a" font-size="9">${esc(t.species)}${t.tilt ? ` ↗${(t.tilt * 180 / Math.PI).toFixed(0)}°` : ''}</text>`);
  // 十七回游线节点
  const route = (plan.narrativeRoutes ?? []).find((r) => r.id === 'ch17');
  for (const n of route?.nodes ?? []) if (inFrame(n.at[0], n.at[1])) out.push(`<circle cx="${X(n.at[0])}" cy="${Y(n.at[1])}" r="7" fill="#fff" stroke="#b0402a" stroke-width="1.5"/><text x="${X(n.at[0])}" y="${+Y(n.at[1]) + 3.5}" fill="#b0402a" font-size="9" text-anchor="middle">${n.order}</text><text x="${+X(n.at[0]) + 9}" y="${+Y(n.at[1]) + 12}" fill="#b0402a" font-size="9">${esc(n.name)}</text>`);
  // 体验断言 X-04 轴线
  for (const e of plan.experience ?? []) if (e.type === 'approach_axis' && e.path && inFrame(e.at[0], e.at[1])) {
    const [a, b] = e.path;
    out.push(`<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1]) - 24 * S}" stroke="#b0402a" stroke-width="1" stroke-dasharray="5 3"/><text x="${+X(b[0]) + 4}" y="${+Y(b[1]) - 20 * S}" fill="#b0402a" font-size="9">${e.id} 轴线 x=${b[0]}</text>`);
  }
  // 机位
  for (const s of SHOTS) if (F.shots.test(s.id) && inFrame(s.pos[0], s.pos[2])) {
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    // 贴脸机位(cu_*)挤在门前几米里,图上只画点不写名,名单在文档的机位表里。
    const closeup = /^cu_/.test(s.id);
    const len = closeup ? 2 : 5;
    out.push(`<line x1="${X(s.pos[0])}" y1="${Y(s.pos[2])}" x2="${X(s.pos[0] + fx * len)}" y2="${Y(s.pos[2] + fz * len)}" stroke="#2a6ab0" stroke-width="1.5"/><circle cx="${X(s.pos[0])}" cy="${Y(s.pos[2])}" r="${closeup ? 2 : 3}" fill="#2a6ab0"/>`);
    if (!closeup) out.push(`<text x="${+X(s.pos[0]) + 5}" y="${+Y(s.pos[2]) + 11}" fill="#2a6ab0" font-size="9">${s.id}</text>`);
  }
  out.push(`<text x="0" y="${H + 14}" fill="#666" font-size="9">■ 建筑锚点  ◆ plan 岩石锚点  ● scenes 散置件  ● 手放树(HERO_TREES)  ○ 十七回游线节点  ─ 机位(短线=朝向;小点=贴脸 cu_* 机位,名单见文档)  虚线框=占地登记  棕线=plan 路径(翠嶂那张是旧路基,潇湘馆那张是院内甬路)</text>`);
  out.push('</svg>');
  writeFileSync(resolve(HERE, `${regionId}.svg`), out.join('\n'));
  console.log(`wrote knowledge/docs/scenes/${regionId}.svg`);
}

const only = process.argv[2];
for (const id of Object.keys(FRAMES)) if (!only || only === id) draw(id);
