import {RuleBook} from '../rules';
import {qingOptions} from './profiles';
import {deriveQing,type QingSpec} from './index';

/** P2 executable structural specification. Detailed bracket and storey meshes
 * remain P3 work; a valid frame must not silently select a Song-style model.
 */
export interface QingBuildingSpec extends QingSpec {
  paramSet:'qing';
  tier:'A';
  doukouMm:number;
  columnHeightM:number;
  columnDiameterM:number;
  bayWidthsM:number[];
  stepsM:number[];
  puzuo:{cai:number;heightM:number;pingbanM:number};
  design:{note:string;columnBaseWidthM:number;hipSetbackM?:number};
}

export function deriveQingBuilding(spec:QingBuildingSpec) {
  if(spec.paramSet!=='qing'||spec.tier!=='A')throw new Error('清式施工spec须为qing / Tier A');
  if(!spec.design?.note?.trim())throw new Error('清式施工spec须说明显式尺寸的design.note');
  const positive=(n:unknown,label:string)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<=0)throw new Error(`${label}须为有限正数`);};
  for(const k of ['doukouMm','columnHeightM','columnDiameterM'] as const)positive(spec[k],k);
  positive(spec.design.columnBaseWidthM,'columnBaseWidthM');
  if(!Array.isArray(spec.bayWidthsM)||!Array.isArray(spec.stepsM))throw new Error('须声明实际面阔及逐步进深');
  for(const n of [...spec.bayWidthsM,...spec.stepsM])positive(n,'开间/步架');
  if(!spec.puzuo)throw new Error('Tier A须显式声明斗科');
  positive(spec.puzuo.heightM,'斗科heightM');positive(spec.puzuo.pingbanM,'斗科pingbanM');
  if(!['硬山','歇山'].includes(spec.roofType))throw new Error('P2清式施工侧样当前只接硬山/歇山');
  const frame=deriveQing(RuleBook.create('qing',qingOptions()),spec),m=frame.m;
  m.base=spec.design.columnBaseWidthM;
  if(m.base<=m.columnD||m.columnD>=Math.min(...spec.bayWidthsM)||m.depthHalf<=m.columnD)
    throw new Error('柱础、柱径、柱网净空不成立');
  if(!m.purlins.length||m.ridgeY<=m.eaveY)throw new Error('清式屋面缺有效举架侧样');
  const tip=m.eaveHalf+m.yanchu;
  if(spec.roofType==='歇山') {
    positive(spec.design.hipSetbackM,'hipSetbackM');
    if(spec.design.hipSetbackM!<=m.yanchu||spec.design.hipSetbackM!>=Math.min(tip,m.width/2+m.yanchu))
      throw new Error('歇山收山须在檐桁内侧且未到脊线');
  }
  frame.provenance.art.push({id:'project:qing-dimensions',name:'清式施工侧样显式尺寸',method:'artistic_choice',
    note:`${spec.design.note}；输入=${JSON.stringify(spec)}`});
  return {...frame,paramSet:'qing' as const,roofType:spec.roofType,
    hipSetbackM:spec.design.hipSetbackM??0,
    roofSection:[{s:0,y:m.eaveY-m.eaveTip.drop},...m.purlins.slice().reverse().map(p=>({s:tip-p.x,y:m.eaveY+p.y}))]};
}

export interface QingConstruction {
  status:'frame-ready';spec:QingBuildingSpec;
  options:{platformH:number};
  upperStorey?:{floorHeightM:number;spec:QingBuildingSpec;lowerRoof:'apron'|'none';connection:string;note:string};
}

/** P2 volume/column-grid assembly only. This is deliberately not a mesh factory:
 * an apron roof needs a real opening and storeys need connections in P3.
 */
export function deriveQingConstruction(construction:QingConstruction) {
  if(construction.status!=='frame-ready')throw new Error('清式施工契约状态非法');
  if(!Number.isFinite(construction.options?.platformH)||construction.options.platformH<=0)throw new Error('须声明台基高度');
  const lower=deriveQingBuilding(construction.spec),upperSpec=construction.upperStorey;
  const upper=upperSpec?deriveQingBuilding(upperSpec.spec):null;
  if(upperSpec&&upper) {
    if(!Number.isFinite(upperSpec.floorHeightM)||upperSpec.floorHeightM<=lower.m.columnH)
      throw new Error('上层楼面须高于下层净柱高');
    if(upper.m.width>=lower.m.width||upper.m.depth>=lower.m.depth)
      throw new Error('当前楼阁侧样要求上层柱网缩入下层，悬挑须另立契约');
    if(!['apron','none'].includes(upperSpec.lowerRoof)||!upperSpec.note?.trim()||upperSpec.connection!=='P3-explicit-storey-structure')
      throw new Error('楼阁必须声明下檐开口/无屋面与P3层间构造，不能叠两座完整房屋');
  }
  const platform=construction.options.platformH;
  return {lower,upper,floors:[platform,...(upperSpec?[platform+upperSpec.floorHeightM]:[])],
    totalHeight:platform+(upperSpec&&upper?upperSpec.floorHeightM+upper.m.ridgeY:lower.m.ridgeY),
    geometryReady:false as const,
    pendingGeometry:upper?['qing-bracket-parts','storey-connections','stairs',...(upperSpec!.lowerRoof==='apron'?['lower-roof-opening']:[])]:['qing-bracket-parts']};
}
