export interface RearDoorSpec {
 centerXM:number;widthM:number;heightM:number;jambM:number;lintelM:number;sillM:number;leafThicknessM:number;note:string;
}
export interface StairSpec {widthM:number;treadM:number;maxRiserM:number}
export interface WalkSurface {cx:number;cz:number;hx:number;hz:number;y:number;tag:string}
const positive=(n:number)=>{if(!Number.isFinite(n)||n<=0)throw new Error('入口尺寸须为有限正数');};

/** Access dimensions are authored small-woodwork inputs. Main columns and their
 * bounds come from the structural frame; a doorway may not cut through one.
 */
export function compileRearDoor(frame:{columnX:number[];columnD:number;depthHalf:number},platformH:number,wallH:number,spec:RearDoorSpec) {
 for(const n of [platformH,wallH,spec.widthM,spec.heightM,spec.jambM,spec.lintelM,spec.leafThicknessM])positive(n);
 if(!Number.isFinite(spec.centerXM)||!Number.isFinite(spec.sillM)||spec.sillM<0||!spec.note?.trim())throw new Error('小门须明确位置、门槛与艺术输入依据');
 const left=spec.centerXM-spec.widthM/2,right=spec.centerXM+spec.widthM/2;
 if(!frame.columnX.slice(1).some((x,i)=>left-spec.jambM>=frame.columnX[i]+frame.columnD/2&&right+spec.jambM<=x-frame.columnD/2))
  throw new Error('小门及门框必须落在一间的柱间净空内，不能跨柱');
 const bottom=platformH+spec.sillM,top=bottom+spec.heightM;
 if(top+spec.lintelM>=platformH+wallH)throw new Error('小门净高与过梁超过后墙');
 if(spec.leafThicknessM>=spec.widthM)throw new Error('门扇厚度不能占满门洞');
 return {left,right,bottom,top,headerTop:top+spec.lintelM,z:-frame.depthHalf,
  hingeX:left-spec.leafThicknessM/2,leafWidth:spec.widthM+spec.leafThicknessM,
  width:spec.widthM,height:spec.heightM,surface:{cx:spec.centerXM,cz:-frame.depthHalf,hx:spec.widthM/2,hz:spec.leafThicknessM*3,y:bottom,tag:'door-sill'} as WalkSurface};
}

/** Solid steps share these exact rectangles with the collision system. */
export function compileExteriorSteps(platformH:number,hx:number,hz:number,side:'front'|'back',spec:StairSpec,centerX=0):WalkSurface[] {
 for(const n of [platformH,hx,hz,spec.widthM,spec.treadM,spec.maxRiserM])positive(n);
 if(!Number.isFinite(centerX)||Math.abs(centerX)+spec.widthM/2>hx)throw new Error('踏步宽度越出台基');
 const n=Math.max(1,Math.ceil(platformH/spec.maxRiserM-1e-10)),rise=platformH/n,sign=side==='front'?1:-1;
 return Array.from({length:n},(_,i)=>({cx:centerX,cz:sign*(hz+spec.treadM*(i+.5)),hx:spec.widthM/2,hz:spec.treadM/2,y:platformH-rise*i,tag:`${side}-step-${i+1}`}));
}
