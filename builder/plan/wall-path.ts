import type { Point2 } from './geometry.ts';
import { pointOnSegment, segmentRelation } from './geometry.ts';
import { WALL_STYLE } from '../parts/qiangyuan/wall-style.ts';

export interface WallInsert {
  at: Point2;
  variant: 'moon' | 'lattice:ice' | 'lattice:wan' | 'lattice:haitang';
  object?: string;
}
export interface WallPathSpec {
  id: string;
  kind: 'wall';
  points: readonly Point2[];
  elevation_m: number;
  foundationDepth_m: number;
  inserts: WallInsert[];
  basis: string;
  /** 真(园墙):虎皮石墙脚随路径弧长起伏("隨勢砌去"),即便 flushEnds
   * 恒为真也不退回院墙的平脚青石。缺省/假:院墙做法不变(潇湘馆/栊翠庵)。 */
  gardenFoot?: boolean;
}
export interface WallPanel {
  center: Point2;
  yaw: number;
  length: number;
  variant: string;
  startMiter: number;
  endMiter: number;
  insert?: WallInsert;
  /** 这一段在整条折线上的起点里程(局部 x=-length/2 处的弧长)，供
   * gardenFoot 墙按路径弧长连续取样墙脚沉深，见 wall.ts 的 groundStation。 */
  startStation: number;
}
export interface WallBox { cx:number; cz:number; hx:number; hz:number; rot:number; minY:number; maxY:number }
export interface WallPlatform { cx:number; cz:number; hx:number; hz:number; rot:number; y:number }
export interface CompiledWallPath {
  origin: Point2;
  panels: WallPanel[];
  joints: {center:Point2; radius:number; minY:number; maxY:number}[];
  blockers: WallBox[];
  platforms: WallPlatform[];
  length: number;
}
const dist=(a:Point2,b:Point2)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
export function wallLocalPoint(panel: WallPanel,x:number,z:number): Point2 {
  return [panel.center[0]+x*Math.cos(panel.yaw)+z*Math.sin(panel.yaw),
    panel.center[1]-x*Math.sin(panel.yaw)+z*Math.cos(panel.yaw)];
}
/** x shear at each end gives the two panels the same miter plane. The
 * transition is confined to the plain end; openings keep their own dimensions. */
export function wallMiterX(x:number,z:number,length:number,start:number,end:number): number {
  const band=Math.min(.65,length/2), half=length/2;
  const a=Math.max(0,1-(x+half)/band), b=Math.max(0,1-(half-x)/band);
  return x+z*(start*a+end*b);
}

export function compileWallPath(spec: WallPathSpec): CompiledWallPath {
  const pts=spec.points;
  if(spec.kind!=='wall'||!spec.id||!spec.basis?.trim()||pts.length<2||
    !Number.isFinite(spec.elevation_m)||!Number.isFinite(spec.foundationDepth_m)||spec.foundationDepth_m<0)
    throw new Error('墙路径需id、依据、有效标高/基础深度及至少两个点');
  if(pts.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))))throw new Error('墙路径坐标非法');
  const closed=dist(pts[0],pts[pts.length-1])<1e-7, n=pts.length-1;
  const origin:Point2=[(Math.min(...pts.map(p=>p[0]))+Math.max(...pts.map(p=>p[0])))/2,
    (Math.min(...pts.map(p=>p[1]))+Math.max(...pts.map(p=>p[1])))/2];
  const legs=Array.from({length:n},(_,i)=>{
    const a=pts[i],b=pts[i+1],length=dist(a,b);
    if(length<.65)throw new Error('墙折线段不得短于0.65m');
    return {a,b,length,dx:(b[0]-a[0])/length,dz:(b[1]-a[1])/length};
  });
  const legStart:number[]=[];
  { let acc=0; for(const l of legs) { legStart.push(acc); acc+=l.length; } }
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
    const relation=segmentRelation(pts[i],pts[i+1],pts[j],pts[j+1]);
    if(j===i+1||(closed&&i===0&&j===n-1)) { if(relation!=='touch')throw new Error('墙路径回折重叠'); }
    else if(relation!=='none')throw new Error('墙路径不得自交或自接触');
  }
  const miter=(a:typeof legs[number],b:typeof legs[number])=>{
    const dot=a.dx*b.dx+a.dz*b.dz;
    if(dot<-.5)throw new Error('墙转角超过120度，须增加转折空间');
    return (a.dx*b.dz-a.dz*b.dx)/(1+dot);
  };
  const joints:CompiledWallPath['joints']=[];
  for(let i=closed?0:1;i<n;i++) {
    const k=miter(legs[(i+n-1)%n],legs[i]);
    if(Math.abs(k)>1e-8)joints.push({center:[pts[i][0]-origin[0],pts[i][1]-origin[1]],radius:WALL_STYLE.footHalf*Math.sqrt(1+k*k),minY:-spec.foundationDepth_m,maxY:WALL_STYLE.collisionTop});
  }
  const selected=spec.inserts.map(insert=>{
    if(!['moon','lattice:ice','lattice:wan','lattice:haitang'].includes(insert.variant))throw new Error('墙内嵌件类型未实现');
    const indices=legs.map((l,i)=>pointOnSegment(insert.at,l.a,l.b)?i:-1).filter(i=>i>=0);
    if(indices.length!==1)throw new Error('门窗锚点须唯一落在一条直墙上，不能在拐角');
    const leg=indices[0],s=dist(legs[leg].a,insert.at);
    if(s<3.65||legs[leg].length-s<3.65)throw new Error('门窗须离墙转角至少3.65m，保留完整六米模块与斜接区');
    return {insert,leg,s};
  });
  const panels:WallPanel[]=[];
  for(let i=0;i<n;i++) {
    const l=legs[i],ins=selected.filter(s=>s.leg===i).sort((a,b)=>a.s-b.s),parts:{a:number;b:number;insert?:WallInsert}[]=[];
    let at=0;
    for(const v of ins) {
      if(v.s-3<at-1e-7)throw new Error('墙内门窗模块重叠');
      if(v.s-3>at+1e-7)parts.push({a:at,b:v.s-3});
      parts.push({a:v.s-3,b:v.s+3,insert:v.insert});at=v.s+3;
    }
    if(at<l.length-1e-7)parts.push({a:at,b:l.length});
    for(const part of parts) {
      const size=part.b-part.a;
      if(size<.65)throw new Error('门窗间剩余墙段短于0.65m，须调整布局');
      const count=part.insert?1:Math.ceil(size/6);
      const widths=Array.from({length:count},(_,j)=>j===count-1?size-6*(count-1):6);
      if(count>1&&widths[count-1]<.65) widths[count-2]=widths[count-1]=(6+widths[count-1])/2;
      let offset=part.a;
      for(let j=0;j<count;j++) {
        const a=offset,b=a+widths[j],s=(a+b)/2;offset=b;
        panels.push({center:[l.a[0]+l.dx*s-origin[0],l.a[1]+l.dz*s-origin[1]],yaw:Math.atan2(-l.dz,l.dx),
          length:b-a,variant:part.insert?.variant??'plain',insert:part.insert,
          startMiter:a<1e-7&&(closed||i>0)?miter(legs[(i+n-1)%n],l):0,
          endMiter:b>l.length-1e-7&&(closed||i<n-1)?-miter(l,legs[(i+1)%n]):0,
          startStation:legStart[i]+a});
      }
    }
  }
  const blockers:WallBox[]=[],platforms:WallPlatform[]=[];
  const box=(panel:WallPanel,a:number,b:number,lo:number,hi:number)=>{
    if(b-a<1e-7)return;
    const p=wallLocalPoint(panel,(a+b)/2,0);
    blockers.push({cx:p[0],cz:p[1],hx:(b-a)/2,hz:WALL_STYLE.footHalf,rot:panel.yaw,minY:lo,maxY:hi});
  };
  for(const panel of panels) {
    const half=panel.length/2;
    if(panel.variant!=='moon') { box(panel,-half,half,-spec.foundationDepth_m,WALL_STYLE.collisionTop);continue; }
    const gate=WALL_STYLE.gate;
    // Sill is a walkable platform, not a blocker that prevents stepping onto it.
    box(panel,-half,-gate.sillWidth/2,-spec.foundationDepth_m,gate.sillY);
    box(panel,gate.sillWidth/2,half,-spec.foundationDepth_m,gate.sillY);
    const rows=Math.ceil((WALL_STYLE.collisionTop-gate.sillY)/.1);
    for(let k=0;k<rows;k++) {
      const lo=gate.sillY+k*(WALL_STYLE.collisionTop-gate.sillY)/rows,hi=gate.sillY+(k+1)*(WALL_STYLE.collisionTop-gate.sillY)/rows;
      const dy=Math.max(Math.abs(lo-gate.centerY),Math.abs(hi-gate.centerY));
      const gap=Math.sqrt(Math.max(0,gate.clearRadius**2-dy**2));
      box(panel,-half,-gap,lo,hi);box(panel,gap,half,lo,hi);
    }
    platforms.push({cx:panel.center[0],cz:panel.center[1],hx:gate.sillWidth/2,hz:gate.sillDepth/2,rot:panel.yaw,y:gate.sillY});
  }
  return {origin,panels,joints,blockers,platforms,length:legs.reduce((s,l)=>s+l.length,0)};
}
