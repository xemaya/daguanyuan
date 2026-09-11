import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTerrainField } from '@builder/compose/terrain-from-plan.ts';
import {compileCorridor} from '@builder/plan/corridor-path.ts';
import {compileBridgePath} from '@builder/plan/bridge-path.ts';
import { locatePoint } from '@builder/plan/geometry.ts';

const plan = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));
const field = makeTerrainField(plan, { seed: 17910000 });

const centroid = (poly) => {
  let x = 0, z = 0;
  const n = poly.length - 1;
  for (let i = 0; i < n; i++) { x += poly[i][0]; z += poly[i][1]; }
  return [x / n, z / n];
};

// 三条沁芳溪与潇湘馆引泉沟是带状环（去程一岸、回程另一岸），顶点平均质心
// 落在河湾环抱的陆地上（实测在环外 8.8~18.8m），不是水体的错，是采样点的错。
// 水体断言改采「近似最深点」：包围盒网格上内深最大的点，保证在多边形内部。
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segD(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
  const L = vx * vx + vz * vz;
  let t = L > 1e-9 ? (wx * vx + wz * vz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(wx - vx * t, wz - vz * t);
}
function interiorPoint(poly) {
  const [cx, cz] = centroid(poly);
  if (inPoly(cx, cz, poly)) return [cx, cz];
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  let best = null, bestD = -1;
  // 网格要细到能落进最窄的水体——引泉沟是约 1m 宽的细环。
  const step = Math.min(Math.max(maxX - minX, maxZ - minZ) / 40, 0.3);
  for (let x = minX; x <= maxX; x += step) {
    for (let z = minZ; z <= maxZ; z += step) {
      if (!inPoly(x, z, poly)) continue;
      let d = 1e9;
      for (let i = 0; i + 1 < poly.length; i++)
        d = Math.min(d, segD(x, z, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]));
      if (d > bestD) { bestD = d; best = [x, z]; }
    }
  }
  return best;
}

test('水体多边形内部采样低于水面', () => {
  for (const w of plan.water) {
    const [cx, cz] = interiorPoint(w.polygon);
    assert.ok(field.height(cx, cz) < 0, `${w.name} 中心应在水下，实际 ${field.height(cx, cz).toFixed(2)}`);
  }
});

test('堆山中心高于其标称高程的一半', () => {
  for (const h of plan.hills) {
    const [cx, cz] = centroid(h.polygon);
    assert.ok(field.height(cx, cz) > h.height_m * 0.5,
      `${h.name} 中心应接近 ${h.height_m}m，实际 ${field.height(cx, cz).toFixed(2)}`);
  }
});

test('控制点同面坡度不超12%，线性结构边界允许明示单阶', () => {
  const surfaces = [...plan.regions.flatMap(r=>r.linears??[]),...(plan.connections??[])].filter(l=>l.kind==='corridor'||l.kind==='bridge').map(spec=>{
    const c=spec.kind==='corridor'?compileCorridor(spec):compileBridgePath(spec);
    const poly=(spec.kind==='corridor'?c.deckPolygon:c.polygon).map(p=>[p[0]+c.origin[0],p[1]+c.origin[1]]);
    return {poly,y:spec.elevation_m+(spec.kind==='corridor'?spec.platformH_m:0),step:(spec.kind==='corridor'?spec.platformH_m:spec.deckThickness_m)+.08,id:spec.id};
  });
  const at=(x,z)=>{let h=field.height(x,z),surface=null;for(const s of surfaces)if(locatePoint(s.poly,[x,z])!=='outside'&&s.y>h){h=s.y;surface=s;}return {h,surface};};
  for (const p of plan.paths) {
    for (let i = 1; i < p.points.length; i++) {
      const [ax, az] = p.points[i - 1];
      const [bx, bz] = p.points[i];
      const d = Math.hypot(bx - ax, bz - az);
      if (d < 1) continue;
      const a=at(ax,az),b=at(bx,bz),delta=Math.abs(b.h-a.h),grade=delta/d;
      const step=a.surface?.id!==b.surface?.id&&delta<=Math.max(a.surface?.step??0,b.surface?.step??0);
      assert.ok(grade < 0.12 || step, `${p.name} 第 ${i} 段坡度 ${(grade * 100).toFixed(1)}%`);
    }
  }
});

test('显式落脚面：陆地台地逐网格平整，桥与港洞保留水下地形', () => {
  let graded = 0, decks = 0, portals = 0;
  for (const r of plan.regions) for (const pad of r.pads ?? []) {
    const center = field.height(...pad.anchor);
    if (pad.kind === 'grade') {
      graded++;
      const xs = pad.polygon.map(p=>p[0]), zs = pad.polygon.map(p=>p[1]);
      for(let x=Math.min(...xs); x<=Math.max(...xs); x+=.5)
        for(let z=Math.min(...zs); z<=Math.max(...zs); z+=.5) {
          if(locatePoint(pad.polygon,[x,z])==='outside')continue;
          assert.ok(Math.abs(field.height(x,z)-pad.elevation_m)<.001, `${pad.id} (${x},${z}) 不在显式标高 ${pad.elevation_m}`);
        }
      assert.equal(center,pad.elevation_m);
    } else {
      assert.ok(center<0, `${pad.id} 下方须保留水域，不把结构面当土方`);
      if(pad.kind==='deck') { decks++; assert.ok(pad.elevation_m>0); }
      else { portals++; assert.equal(pad.kind,'water-opening'); }
    }
  }
  assert.equal(graded,11); assert.equal(decks,3); assert.equal(portals,1);
});

test('仍采用区域整地的陆地区域中心平缓（不把池面或新台地质心当基础）', () => {
  for (const r of plan.regions) {
    if (!r.buildings?.length || r.pads?.length || r.grading==='pads') continue;
    const [cx,cz]=centroid(r.polygon);
    const hs=[[0,0],[3,0],[0,3],[3,3],[-3,0],[0,-3]].map(([dx,dz])=>field.height(cx+dx,cz+dz));
    assert.ok(Math.max(...hs)-Math.min(...hs)<.08,`${r.id} 整地高差过大`);
    assert.ok(Math.min(...hs)>=0,`${r.id} 应声明跨水面，不能以平池底冒充平地`);
  }
});

test('确定性：同一 seed 两次采样完全一致', () => {
  const a = makeTerrainField(plan, { seed: 42 });
  const b = makeTerrainField(plan, { seed: 42 });
  for (const [x, z] of [[0,0],[100,-80],[-200,150]]) {
    assert.equal(a.height(x, z), b.height(x, z));
  }
});
