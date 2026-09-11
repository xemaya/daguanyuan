import {deriveFayuanBuilding,type FayuanBuildingSpec} from './fayuan/building';
import {deriveFayuanAssembly,type FayuanAssemblySpec} from './fayuan/assembly';
import {deriveQingConstruction,type QingConstruction,type QingBuildingSpec} from './qing/building';
import {deriveRusticBuilding,type RusticSpec} from './rustic/building';
import type {Point2} from '../plan/geometry';

export interface Construction {
  status?:'frame-ready';
  spec:FayuanBuildingSpec|QingBuildingSpec|FayuanAssemblySpec|RusticSpec;
  options:{platformH?:number};
  site?:{placement:'absolute';baseElevationM:number;waterLevelM:number;support:'water-piers'};
  upperStorey?:QingConstruction['upperStorey'];
}
type StructuralFrame=ReturnType<typeof deriveFayuanBuilding>|ReturnType<typeof deriveRusticBuilding>|ReturnType<typeof deriveQingConstruction>['lower'];
interface Module {id:string;at:[number,number,number];frame:StructuralFrame;roofMode:string}

/** One compiler for the 32 building contracts, with explicit mesh availability.
 * It does not instantiate scene meshes or infer occupancy from old point labels.
 */
export function compileConstruction(c:Construction) {
  if(!Number.isFinite(c.options?.platformH)||c.options.platformH!<=0)throw new Error('施工规格须显式声明正台基高');
  const s=c.spec,platformH=c.options.platformH!;
  let modules:Module[],pendingGeometry:string[]=[],gallery:ReturnType<typeof deriveFayuanAssembly>['gallery']=null;
  let boat:ReturnType<typeof deriveFayuanAssembly>['boat']=null;
  if(s.paramSet==='qing') {
    const a=deriveQingConstruction({status:c.status as 'frame-ready',spec:s,options:{platformH},upperStorey:c.upperStorey});
    modules=[{id:'main',at:[0,0,0],frame:a.lower,roofMode:c.upperStorey?.lowerRoof??'full'}];
    if(a.upper)modules.push({id:'upper',at:[0,c.upperStorey!.floorHeightM,0],frame:a.upper,roofMode:'full'});
    pendingGeometry=a.pendingGeometry;
  } else if(s.paramSet==='fayuan-assembly') {
    const a=deriveFayuanAssembly(s);modules=a.modules;pendingGeometry=a.pendingGeometry;gallery=a.gallery;boat=a.boat;
  } else if(s.paramSet==='rustic') {
    modules=[{id:'main',at:[0,0,0],frame:deriveRusticBuilding(s),roofMode:'full'}];
    pendingGeometry=['rustic-timber-joints','thatch','earth-walls'];
  } else if(s.paramSet==='fayuan')modules=[{id:'main',at:[0,0,0],frame:deriveFayuanBuilding(s),roofMode:'full'}];
  else throw new Error('未知施工参数集，禁止替换成默认房屋');
  if(pendingGeometry.length&&c.status!=='frame-ready')throw new Error('未生成几何的规格须标frame-ready');
  if(boat&&(!c.site||c.site.placement!=='absolute'||c.site.support!=='water-piers'||
    !Number.isFinite(c.site.baseElevationM)||!Number.isFinite(c.site.waterLevelM)||c.site.baseElevationM+platformH<=c.site.waterLevelM))
    throw new Error('舡坞须声明水上桩承及绝对落位，不能把河床当柱脚起点');
  return {modules,gallery,boat,platformH,pendingGeometry,meshFactoryAvailable:pendingGeometry.length===0,
    site:c.site??null,
    totalHeight:platformH+Math.max(...modules.filter(m=>m.roofMode!=='none').map(m=>m.at[1]+m.frame.m.ridgeY))};
}

export function constructionFootprints(c:ReturnType<typeof compileConstruction>,object:{x:number;z:number;facing:string}) {
  const yaw={south:0,west:-Math.PI/2,north:Math.PI,east:Math.PI/2}[object.facing];
  if(yaw===undefined)throw new Error('施工占地须声明有效朝向');
  const world=([x,z]:Point2):Point2=>[object.x+Math.cos(yaw)*x+Math.sin(yaw)*z,object.z-Math.sin(yaw)*x+Math.cos(yaw)*z];
  const box=(hx:number,hz:number,x=0,z=0):Point2[]=>[[-hx+x,-hz+z],[hx+x,-hz+z],[hx+x,hz+z],[-hx+x,hz+z],[-hx+x,-hz+z]];
  const footprints=c.modules.map(m=>{
    const f=m.frame.m;
    return {id:m.id,body:box(f.width/2,f.depthHalf,m.at[0],m.at[2]).map(world),
      columns:f.columnX.flatMap(x=>[-f.depthHalf,f.depthHalf].map(z=>world([x+m.at[0],z+m.at[2]]))),columnRadius:f.columnD/2,
      // Conservative roof reservation, including bracket projection and corner
      // push. A shared-roof seam is refined by P3, not mistaken for a solid wall.
      roof:box(f.width/2+f.yanchu+f.puzuoOut+f.shengchu,f.eaveHalf+f.yanchu+f.shengchu,m.at[0],m.at[2]).map(world)};
  });
  if(c.gallery) {
    const g=c.gallery,margin=g.frame.m.depthHalf+g.frame.m.yanchu;
    const xs=g.points.map(p=>p[0]),zs=g.points.map(p=>p[1]);
    const x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2;
    const outer=box((Math.max(...xs)-Math.min(...xs))/2+margin,(Math.max(...zs)-Math.min(...zs))/2+margin,x,z).map(world);
    footprints.push({id:'gallery-reservation',body:[],roof:outer,columns:[],columnRadius:0});
  }
  return footprints;
}
