/** Spatial buckets preserve insertion order: layered terrain operations are not commutative. */
export interface Bounds2 {
  minX: number; maxX: number; minZ: number; maxZ: number;
}

/** Distance to segments, rather than only authored waypoints, keeps long routes dense. */
export function distanceToPolyline(x:number,z:number,points:readonly (readonly [number,number])[]): number {
  let best=Infinity;
  for(let i=1;i<points.length;i++){
    const [ax,az]=points[i-1],[bx,bz]=points[i];
    const vx=bx-ax,vz=bz-az,length=vx*vx+vz*vz;
    const t=length>0?Math.max(0,Math.min(1,((x-ax)*vx+(z-az)*vz)/length)):0;
    best=Math.min(best,Math.hypot(x-ax-vx*t,z-az-vz*t));
  }
  return best;
}

export class BoundsIndex<T> {
  private readonly rows = new Map<number, Map<number, T[]>>();
  private readonly empty: readonly T[] = [];
  readonly cellSize: number;

  constructor(cellSize = 32) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('cellSize must be positive');
    this.cellSize = cellSize;
  }

  add(b: Bounds2, item: T, margin = 0): void {
    if (![b.minX,b.maxX,b.minZ,b.maxZ,margin].every(Number.isFinite) || margin < 0 || b.minX > b.maxX || b.minZ > b.maxZ) {
      throw new Error('Invalid spatial bounds');
    }
    const s = this.cellSize;
    for (let x = Math.floor((b.minX-margin)/s); x <= Math.floor((b.maxX+margin)/s); x++) {
      let row = this.rows.get(x);
      if (!row) { row = new Map(); this.rows.set(x,row); }
      for (let z = Math.floor((b.minZ-margin)/s); z <= Math.floor((b.maxZ+margin)/s); z++) {
        let items = row.get(z);
        if (!items) { items = []; row.set(z,items); }
        items.push(item);
      }
    }
  }

  query(x: number,z: number): readonly T[] {
    return this.rows.get(Math.floor(x/this.cellSize))?.get(Math.floor(z/this.cellSize)) ?? this.empty;
  }
}

/**
 * 单子 AX2:「这一点附近有没有多边形」的格子预筛。包围盒外扩 `margin` 进 `BoundsIndex`,
 * 查到的是**超集**(格子粒度、包围盒比多边形大),所以只可能多放行、不可能漏。
 * 用它把「远离所有多边形时结果恒定」的场函数短路掉,短路后的结果与不短路逐位相同。
 */
export function polygonNearIndex(polygons: readonly (readonly (readonly [number,number])[])[], margin: number, cellSize = 16): (x:number,z:number)=>boolean {
  const index=new BoundsIndex<true>(cellSize);
  for(const poly of polygons){
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const [x,z] of poly){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
    index.add({minX,maxX,minZ,maxZ},true,margin);
  }
  return (x,z)=>index.query(x,z).length>0;
}

export interface Cluster<T> {
  key: string;
  center: {x:number;y:number;z:number};
  radius: number;
  items: T[];
}

export class ClusterGrid<T> {
  readonly cellSize: number;
  private readonly buckets = new Map<string, {x:number;y:number;z:number;r:number;item:T}[]>();
  constructor(cellSize = 64) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('cellSize must be positive');
    this.cellSize = cellSize;
  }
  add(x:number,z:number,item:T,y=0,r=0): void {
    if (![x,z,y,r].every(Number.isFinite) || r<0) throw new Error('Invalid cluster member');
    const key=`${Math.floor(x/this.cellSize)},${Math.floor(z/this.cellSize)}`;
    let bucket=this.buckets.get(key);
    if (!bucket) { bucket=[];this.buckets.set(key,bucket); }
    bucket.push({x,y,z,r,item});
  }
  cells(): Cluster<T>[] {
    return [...this.buckets].map(([key,members])=>{
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
      for(const p of members){
        minX=Math.min(minX,p.x-p.r);maxX=Math.max(maxX,p.x+p.r);
        minY=Math.min(minY,p.y-p.r);maxY=Math.max(maxY,p.y+p.r);
        minZ=Math.min(minZ,p.z-p.r);maxZ=Math.max(maxZ,p.z+p.r);
      }
      const center={x:(minX+maxX)/2,y:(minY+maxY)/2,z:(minZ+maxZ)/2};
      let radius=0;
      for(const p of members) radius=Math.max(radius,Math.hypot(p.x-center.x,p.y-center.y,p.z-center.z)+p.r);
      return {key,center,radius,items:members.map(p=>p.item)};
    });
  }
}
