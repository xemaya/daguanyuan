import {allPlanLinears} from '../builder/plan/linears.ts';
import {compileBridgePath} from '../builder/plan/bridge-path.ts';
import {containsRing,locatePoint,pointOnSegment,segmentLocations,interiorsOverlap} from '../builder/plan/geometry.ts';
import {compileNarrativeRoute} from '../builder/plan/narrative-route.ts';
import {auditConstructions} from './construction-audit.mjs';

/** Cross-region construction is checked against the garden, buildings and its
 * named walking legs. It is not a claim that P4 has instanced these meshes. */
export function auditConnections(plan) {
 const fails=[],connections=[];
 const all=allPlanLinears(plan);
 if(new Set(all.map(l=>l.id)).size!==all.length)fails.push('线性构件id在区域与公共连接之间重复');
 const route=compileNarrativeRoute(plan.narrativeRoutes[0]);
 const buildings=auditConstructions(plan).objects;
 for(const spec of plan.connections??[])try {
  if(spec.kind!=='bridge'||!spec.id.startsWith('connection.'))throw new Error('当前公共连接须为有独立id的桥路径');
  const c=compileBridgePath(spec),polygon=c.polygon.map(p=>[p[0]+c.origin[0],p[1]+c.origin[1]]);
  if(!containsRing(plan.wall,polygon))throw new Error('桥面越出园墙');
  if(c.clearWidth<1.2)throw new Error('桥栏内保守净宽不足1.2m');
  for(const b of buildings)for(const f of b.footprints)if(f.body.length&&interiorsOverlap(f.body,polygon))throw new Error(`桥面切入${b.id}/${f.id}主体`);
  if(spec.object) {
   const matches=plan.regions.flatMap(r=>r.buildings).filter(b=>b.id===spec.object&&b.kind==='bridge');
   if(matches.length!==1||!spec.points.slice(1).some((b,i)=>pointOnSegment([matches[0].x,matches[0].z],spec.points[i],b)))throw new Error('命名桥锚点未绑定在桥路径上');
  }
  if(spec.railingMaterial==='vermilion'&&spec.object!=='liaoting_huaxu.red-railing-bridge')throw new Error('本项目朱栏例外仅用于原文折带朱栏板桥');
  if(!spec.routeLegs?.length||new Set(spec.routeLegs).size!==spec.routeLegs.length)throw new Error('公共桥须声明不重复的路线关联');
  const checks=[];
  for(const id of spec.routeLegs) {
   const leg=route.legs.find(e=>e.id===id);
   if(!leg)throw new Error(`未知路线${id}`);
   if(!leg.segments.some(s=>segmentLocations(s.a,s.b,polygon).some(t=>t.location==='inside')))throw new Error(`桥未覆盖声明路段${id}`);
   const waterPoints=[];
   for(const s of leg.segments)for(const w of plan.water)for(const t of segmentLocations(s.a,s.b,w.polygon).filter(t=>t.location==='inside')) {
    const n=Math.max(1,Math.ceil((t.to-t.from)*s.length/.4));
    for(let i=0;i<=n;i++) {
     const a=t.from+(t.to-t.from)*i/n,p=[s.a[0]+(s.b[0]-s.a[0])*a,s.a[1]+(s.b[1]-s.a[1])*a];
     waterPoints.push({point:p,water:w.id,depth:w.depth_m});
     if(locatePoint(polygon,p)==='outside')throw new Error(`未覆盖${id}的跨水点${p}`);
    }
   }
   checks.push({leg:id,waterPoints});
  }
  connections.push({spec,compiled:c,polygon,checks,runtimeVerified:false});
 }catch(e){fails.push(`${spec.id}：${e.message}`);}
 return {fails,connections};
}

/**
 * 单子 AD · 第三档「接缝连续性」。
 *
 * 任何「一段段拼起来」的东西(墙、廊、桥)，在每个内部折点沿路径切向 x±ε
 * 采样，比较墙脚高程与两侧地面材质；两条线性构件端点相接处再比标高。
 * 这一类缺陷人眼极难抓——得正好走到那个接缝才看得见；机器把全园接缝
 * 一次扫完。
 *
 * 四个量都取自 plan 与地形场，没有一个是从几何代码倒推的：
 *   - 墙脚高程跳变 > 0.12m 报：一块城砖厚，人眼在墙脚看得出的最小台阶；
 *   - 两侧地面材质不同即报：同一段墙脚下面换了料；
 *   - 标高与地面差 > 1.0m 报：整段墙悬空或埋进土里；
 *   - 相接处标高差 > 0.05m 报：压顶是一条连续线，肉眼对直线折断极敏感。
 * plan 的墙不带 height_m(墙高来自规则表)，所以比的是标高这个基准面，
 * 不是顶面——顶面在数据里根本不存在，拿代码里的数去比就成了复读。
 *
 * ⚠️ 阈值不许为了让它绿而调松(spec §2⑥ 第三档:「这道门写出来会立刻是
 * 红的，那正是它是门的证明」)。
 */
const SEAM_EPS = 0.25;
const SEAM_GROUND_TOL = 0.12;
const SEAM_ELEV_TOL = 0.05;
const SEAM_FLOAT_TOL = 1.0;

/** 墙脚跟着地面走的那几类。桥是跨空构件——桥面本来就该架在水上，
 *  拿「墙脚悬空」「两侧地面材质不同」去判它是判据错，不是世界错
 *  (桥自己的验收在 auditConnections：净宽、越界、桥面切入建筑)。 */
const GROUND_FOLLOWING = new Set(['wall', 'corridor', 'fence', 'railing', 'path', 'steps']);

function seamNorm(x, z) { const d = Math.hypot(x, z) || 1; return [x / d, z / d]; }

export function auditSeams(plan, field) {
 const seams = [], fails = [];
 const specs = allPlanLinears(plan).filter((s) => Array.isArray(s.points) && s.points.length >= 2);
 for (const spec of specs) {
  const pts = spec.points;
  if (!GROUND_FOLLOWING.has(spec.kind)) continue; // 跨空构件跳过墙脚类断言，仍参与下面的相接标高比对
  for (let i = 1; i < pts.length - 1; i++) {
   const [px, pz] = pts[i - 1], [cx, cz] = pts[i], [nx, nz] = pts[i + 1];
   const inDir = seamNorm(cx - px, cz - pz), outDir = seamNorm(nx - cx, nz - cz);
   const a = [cx - inDir[0] * SEAM_EPS, cz - inDir[1] * SEAM_EPS];
   const b = [cx + outDir[0] * SEAM_EPS, cz + outDir[1] * SEAM_EPS];
   const ga = field.height(a[0], a[1]), gb = field.height(b[0], b[1]);
   const sa = field.surface ? field.surface(a[0], a[1]) : null;
   const sb = field.surface ? field.surface(b[0], b[1]) : null;
   const rec = { id: spec.id, station: i, kind: spec.kind, deltaGround: Math.abs(ga - gb), surfaceA: sa, surfaceB: sb };
   seams.push(rec);
   if (rec.deltaGround > SEAM_GROUND_TOL)
    fails.push(`${spec.id} 第${i}个折点墙脚高程跳 ${rec.deltaGround.toFixed(3)}m（>${SEAM_GROUND_TOL}m）`);
   if (sa && sb && sa !== sb)
    fails.push(`${spec.id} 第${i}个折点两侧地面材质不同：${sa} / ${sb}`);
  }
  // 整段的标高与实际地面的落差：一段被抬走时，每一站的墙脚都悬空。
  for (let i = 0; i < pts.length; i++) {
   const g = field.height(pts[i][0], pts[i][1]);
   const drop = Math.abs((spec.elevation_m ?? g) - g);
   if (drop > SEAM_FLOAT_TOL) {
    fails.push(`${spec.id} 第${i}站标高 ${spec.elevation_m}m 与地面 ${g.toFixed(2)}m 差 ${drop.toFixed(2)}m（墙脚悬空或埋入）`);
    break;
   }
  }
 }
 // 两条不同线性构件端点相接处：压顶线在这种地方折断最扎眼。
 for (let i = 0; i < specs.length; i++) for (let j = i + 1; j < specs.length; j++) {
  const A = specs[i], B = specs[j];
  for (const pa of [A.points[0], A.points[A.points.length - 1]])
   for (const pb of [B.points[0], B.points[B.points.length - 1]]) {
    if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 0.6) continue;
    const d = Math.abs((A.elevation_m ?? 0) - (B.elevation_m ?? 0));
    seams.push({ id: `${A.id}|${B.id}`, station: -1, kind: 'junction', deltaGround: d, surfaceA: null, surfaceB: null });
    if (d > SEAM_ELEV_TOL)
     fails.push(`${A.id} 与 ${B.id} 相接处标高差 ${d.toFixed(3)}m（>${SEAM_ELEV_TOL}m）`);
   }
 }
 return { seams, fails };
}
