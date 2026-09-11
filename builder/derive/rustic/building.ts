import type {Provenance} from '../provenance';

/** C-r is an authored timber/thatch frame, not a fabricated historical modulus.
 * Arithmetic here only lays out the supplied metres and constant roof slope.
 */
export interface RusticSpec {
  paramSet:'rustic';tier:'C-r';bayWidthsM:number[];depthM:number;
  columnHeightM:number;columnDiameterM:number;columnBaseWidthM:number;
  beamHeightM:number;beamThicknessM:number;eaveM:number;roofSlope:number;thatchThicknessM:number;
  cover:'rice-straw'|'reed';window:'paper'|'bamboo';wall:'earth';
  design:{note:string;source:string};
}
export function deriveRusticBuilding(spec:RusticSpec) {
  if(spec.paramSet!=='rustic'||spec.tier!=='C-r'||!spec.design?.note?.trim()||!spec.design.source?.trim())
    throw new Error('乡野规格须为C-r，注明艺术尺寸及原文来源');
  if(!['rice-straw','reed'].includes(spec.cover)||!['paper','bamboo'].includes(spec.window)||spec.wall!=='earth')
    throw new Error('乡野只接茅苫、纸/竹牖和土壁，不接瓦作');
  const positive=(n:unknown)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<=0)throw new Error('乡野尺寸须为有限正数');};
  if(!spec.bayWidthsM?.length)throw new Error('乡野须显式给开间');
  for(const n of [...spec.bayWidthsM,spec.depthM,spec.columnHeightM,spec.columnDiameterM,spec.columnBaseWidthM,
    spec.beamHeightM,spec.beamThicknessM,spec.eaveM,spec.roofSlope,spec.thatchThicknessM])positive(n);
  if(spec.columnBaseWidthM<=spec.columnDiameterM||spec.columnDiameterM>=Math.min(...spec.bayWidthsM)||spec.beamHeightM>=spec.columnHeightM)
    throw new Error('乡野柱础、开间及梁下净空不成立');
  const width=spec.bayWidthsM.reduce((a,b)=>a+b,0),columnX=[-width/2];
  for(const w of spec.bayWidthsM)columnX.push(columnX.at(-1)!+w);
  const depthHalf=spec.depthM/2,eaveY=spec.columnHeightM+spec.beamHeightM+spec.thatchThicknessM;
  const ridgeY=eaveY+depthHalf*spec.roofSlope;
  const provenance:Provenance={evidence:[{id:'project:rustic-form',name:'乡野茅檐土壁形制',location:spec.design.source}],
    inference:[],art:[{id:'project:rustic-dimensions',name:'无模数乡野施工尺寸',method:'artistic_choice',note:`${spec.design.note}；输入=${JSON.stringify(spec)}`}]};
  return {paramSet:'rustic' as const,provenance,roofType:'悬山' as const,
    m:{width,depth:spec.depthM,depthHalf,columnX,columnH:spec.columnHeightM,columnD:spec.columnDiameterM,
      base:spec.columnBaseWidthM,eaveHalf:depthHalf,yanchu:spec.eaveM,eaveY,ridgeY,puzuoH:0,puzuoOut:0,
      qiqiao:0,shengchu:0,lan:{w:spec.beamHeightM,t:spec.beamThicknessM}},
    roofSection:[{s:0,y:eaveY-spec.eaveM*spec.roofSlope},{s:spec.eaveM,y:eaveY},{s:spec.eaveM+depthHalf,y:ridgeY}]};
}
