import {deriveFayuanBuilding,type FayuanBuildingSpec} from './building';

export interface FayuanAssemblySpec {
  paramSet:'fayuan-assembly';form:'lianxia'|'baoxia'|'storeyed'|'boat-shed';
  primary:FayuanBuildingSpec;
  secondary?:{spec:FayuanBuildingSpec;floorHeightM?:number;roofMode:'full';};
  gallery?:{section:FayuanBuildingSpec;clearWidthM:number};
  boat?:{entry:'south';clearWidthM:number;clearHeightM:number;berthLengthM:number;berthWidthM:number;draftM:number;sideWalkWidthM:number;waterRef:string};
  passage?:{axisXM:number;widthM:number;heightM:number;entry:'annex.south';exit:'main.north';note:string};
  design:{note:string;source:string};
}

/** Resolve compound volumes from their actual frames. Shared faces are explicit
 * cut/join contracts for P3, never overlapping whole-house prefabs in P4.
 */
export function deriveFayuanAssembly(spec:FayuanAssemblySpec) {
  if(spec.paramSet!=='fayuan-assembly'||!spec.design?.note?.trim()||!spec.design.source?.trim())throw new Error('复合建筑须声明身份和依据');
  if(!['lianxia','baoxia','storeyed','boat-shed'].includes(spec.form))throw new Error('未知复合建筑形制');
  const main=deriveFayuanBuilding(spec.primary),other=spec.secondary?deriveFayuanBuilding(spec.secondary.spec):null;
  if(spec.form!=='boat-shed'&&!other)throw new Error('连厦、抱厦及楼阁须声明第二组骨架');
  if(spec.form==='boat-shed'&&other)throw new Error('当前舡坞不支持附加房屋');
  const modules:{id:string;frame:ReturnType<typeof deriveFayuanBuilding>;at:[number,number,number];roofMode:'full'|'join-required'|'none'}[]=[
    {id:'main',frame:main,at:[0,0,0],roofMode:spec.form==='storeyed'?'none':other?'join-required':'full'}];
  const pendingGeometry=['compound-frame-geometry'];
  if(other) {
    if(spec.secondary!.roofMode!=='full')throw new Error('上层/附厦须声明完整屋面，接缝由共同裁切处理');
    if(spec.form==='storeyed') {
      const y=spec.secondary!.floorHeightM;
      if(y===undefined||!Number.isFinite(y)||y<=main.m.columnH)throw new Error('楼阁上层楼面须高于下层净柱高');
      if(other.m.width>=main.m.width||other.m.depth>=main.m.depth)throw new Error('楼阁上层须缩进，悬挑须另行设计');
      modules.push({id:'upper',frame:other,at:[0,y,0],roofMode:'full'});
      pendingGeometry.push('storey-connections','stairs');
    } else {
      if(spec.secondary!.floorHeightM!==undefined)throw new Error('连厦/抱厦须同层接合');
      if(spec.form==='lianxia'&&Math.abs(other.m.width-main.m.width)>1e-6)throw new Error('当前连厦须等面阔，变宽须另立接缝');
      if(spec.form==='baoxia'&&other.m.width>=main.m.width)throw new Error('抱厦须窄于主屋形成凸出平面');
      const sign=spec.form==='lianxia'?-1:1;
      modules.push({id:'annex',frame:other,at:[0,0,sign*(main.m.depthHalf+other.m.depthHalf)],roofMode:'join-required'});
      pendingGeometry.push('shared-wall-opening','shared-eave-cut','roof-junction');
    }
  }
  let gallery:null|{frame:ReturnType<typeof deriveFayuanBuilding>;points:[number,number][];clearWidthM:number}=null;
  if(spec.form==='lianxia') {
    if(!spec.gallery)throw new Error('蘅芜苑连厦须声明四面廊');
    const frame=deriveFayuanBuilding(spec.gallery.section),clear=frame.m.depth-frame.m.columnD;
    if(!Number.isFinite(spec.gallery.clearWidthM)||spec.gallery.clearWidthM<=0||clear<spec.gallery.clearWidthM)
      throw new Error('四面廊柱间净宽不足');
    const hx=main.m.width/2+frame.m.depthHalf,north=-main.m.depthHalf-other!.m.depth-frame.m.depthHalf,south=main.m.depthHalf+frame.m.depthHalf;
    gallery={frame,clearWidthM:spec.gallery.clearWidthM,points:[[-hx,north],[hx,north],[hx,south],[-hx,south],[-hx,north]]};
    pendingGeometry.push('perimeter-gallery-corners');
  } else if(spec.gallery)throw new Error('仅连厦契约声明四面廊，其他游廊走线性构件');
  let boat=spec.boat??null;
  if(spec.form==='boat-shed') {
    if(!boat||boat.entry!=='south'||!boat.waterRef)throw new Error('舡坞须声明水域引用和敞开南口');
    for(const n of [boat.clearWidthM,boat.clearHeightM,boat.berthLengthM,boat.berthWidthM,boat.draftM,boat.sideWalkWidthM])
      if(!Number.isFinite(n)||n<=0)throw new Error('舡坞净空/侧步道须为有限正数');
    if(main.m.columnX.length!==2||boat.berthWidthM>boat.clearWidthM||boat.clearWidthM>main.m.width-main.m.columnD||boat.clearHeightM>main.m.columnH-main.m.lan.w||boat.berthLengthM>main.m.depth)
      throw new Error('舡坞泊位与通舟口净空不足，内部不得有挡船柱');
    pendingGeometry.push('side-walks-no-central-slab','water-footings');
  } else if(boat)throw new Error('通舟口只属于舡坞');
  let passage:null|{width:number;height:number;ports:{id:string;at:[number,number];side:'south'|'north'|'shared'}[]}=null;
  if(spec.passage) {
    const p=spec.passage;
    if(spec.form!=='baoxia'||!other||p.entry!=='annex.south'||p.exit!=='main.north'||!p.note?.trim())throw new Error('当前穿堂契约仅接抱厦前入、主屋后出');
    if(!Number.isFinite(p.axisXM)||!Number.isFinite(p.widthM)||!Number.isFinite(p.heightM)||p.widthM<=0||p.heightM<=0)throw new Error('穿堂净口须为有限正数');
    for(const frame of [main,other]) {
      const m=frame.m,left=p.axisXM-p.widthM/2,right=p.axisXM+p.widthM/2;
      if(p.heightM>m.columnH-m.lan.w||!m.columnX.slice(1).some((x,i)=>left>=m.columnX[i]+m.columnD/2&&right<=x-m.columnD/2))
        throw new Error('穿堂净口碰柱或穿梁');
    }
    passage={width:p.widthM,height:p.heightM,ports:[
      {id:'entry',at:[p.axisXM,main.m.depthHalf+other.m.depth],side:'south'},
      {id:'shared-wall',at:[p.axisXM,main.m.depthHalf],side:'shared'},
      {id:'exit',at:[p.axisXM,-main.m.depthHalf],side:'north'}]};
    pendingGeometry.push('through-house-openings');
  }
  main.provenance.art.push({id:'project:compound-layout',name:'复合平面及接缝选择',method:'artistic_choice',
    note:`${spec.design.note}；出处=${spec.design.source}；输入=${JSON.stringify(spec)}`});
  return {paramSet:'fayuan-assembly' as const,modules,gallery,boat,passage,pendingGeometry,geometryReady:false as const};
}
