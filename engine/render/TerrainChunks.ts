import * as THREE from 'three';
import type { Bounds2 } from '@engine/scatter/cluster';

interface TerrainChunkOptions {
  segX?: number;
  segZ?: number;
  cellSize?: number;
  material?: THREE.Material;
  /** 单子 AX1:粗档步长(以 L0 格为单位)。不给就只建 L0,行为与以前一字不差。 */
  lodSteps?: readonly number[];
  /** 每档的误差预算(米),按步长给;超预算的粗格留在 L0。不给 = 不设预算。 */
  lodBudget?: (step: number) => number;
}

/** 一块地形的一档:与 L0 共用同一份顶点缓冲,只有索引不同。 */
export interface TerrainLodLevel {
  /** 步长,以 L0 格为单位(1 = L0 本身)。 */
  step: number;
  mesh: THREE.Mesh;
  /** 这一档相对 L0 格点的最大垂直误差(米),建网格时逐格点量出来。 */
  maxError: number;
  triangles: number;
}

/** One global lattice with a one-sample halo; neighbouring chunks never resample their seam. */
export function buildTerrainChunks(
  field: {height(x:number,z:number):number},
  bounds: Bounds2,
  chunkSize = 64,
  options: TerrainChunkOptions = {},
): THREE.Mesh[] {
  const width=bounds.maxX-bounds.minX,depth=bounds.maxZ-bounds.minZ;
  const segX=options.segX??Math.round(width/(options.cellSize??.5));
  const segZ=options.segZ??Math.round(depth/(options.cellSize??.5));
  if (!(width>0 && depth>0 && chunkSize>0) || !Number.isFinite(chunkSize) || !Number.isInteger(segX) || !Number.isInteger(segZ) || segX<1 || segZ<1) {
    throw new Error('Invalid terrain lattice');
  }
  const dx=width/segX,dz=depth/segZ,stride=segX+3;
  const xs=new Float64Array(segX+3),zs=new Float64Array(segZ+3);
  // Quantize the coordinates once, exactly as the rendered Float32 vertices are stored.
  for(let i=-1;i<=segX+1;i++)xs[i+1]=Math.fround(bounds.minX+i*dx);
  for(let j=-1;j<=segZ+1;j++)zs[j+1]=Math.fround(bounds.minZ+j*dz);
  // Keep field precision through differentiation; quantizing heights early amplifies normal error.
  const heights=new Float64Array((segX+3)*(segZ+3));
  for(let j=0;j<zs.length;j++)for(let i=0;i<xs.length;i++)heights[j*stride+i]=field.height(xs[i],zs[j]);
  const stepX=Math.max(1,Math.floor(chunkSize/dx)),stepZ=Math.max(1,Math.floor(chunkSize/dz));
  const material=options.material??new THREE.MeshStandardMaterial();
  const meshes:THREE.Mesh[]=[];
  for(let j0=0;j0<segZ;j0+=stepZ)for(let i0=0;i0<segX;i0+=stepX){
    const nx=Math.min(stepX,segX-i0),nz=Math.min(stepZ,segZ-j0),count=(nx+1)*(nz+1);
    const positions=new Float32Array(count*3),normals=new Float32Array(count*3),uvs=new Float32Array(count*2);
    let v=0;
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++,v++){
      const gx=i0+i+1,gz=j0+j+1,h=gz*stride+gx;
      positions.set([xs[gx],heights[h],zs[gz]],v*3);
      const dhx=(heights[h+1]-heights[h-1])/(xs[gx+1]-xs[gx-1]);
      const dhz=(heights[h+stride]-heights[h-stride])/(zs[gz+1]-zs[gz-1]);
      const length=Math.hypot(dhx,1,dhz);
      normals.set([-dhx/length,1/length,-dhz/length],v*3);
      uvs.set([(i0+i)/segX,1-(j0+j)/segZ],v*2);
    }
    const indices=count>65535?new Uint32Array(nx*nz*6):new Uint16Array(nx*nz*6);
    let k=0;
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
      const a=j*(nx+1)+i,b=a+nx+1,c=a+1,d=b+1;
      indices.set([a,b,d,a,d,c],k);k+=6;
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
    geometry.setIndex(new THREE.BufferAttribute(indices,1));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=`Terrain_${i0}_${j0}`;mesh.receiveShadow=true;
    mesh.matrixAutoUpdate=false;mesh.updateMatrix();
    mesh.userData.lattice={i0,j0,nx,nz};
    if(options.lodSteps?.length){
      const levels:TerrainLodLevel[]=[{step:1,mesh,maxError:0,triangles:nx*nz*2}];
      for(const step of options.lodSteps){
        const tris=lodTriangles(positions,nx,nz,step,(options.lodBudget??(()=>Infinity))(step));
        // 块太窄(粗格不足两列/两行),或者预算下整块都留在 L0、并不比细一档省,这一档就不建,
        // 选档自然停在细一档。
        if(!tris||tris.length>=levels[levels.length-1].triangles*3)continue;
        const lodIndex=count>65535?new Uint32Array(tris):new Uint16Array(tris);
        const lodGeometry=new THREE.BufferGeometry();
        // 同一批 BufferAttribute 对象:粗档的顶点就是 L0 的顶点,连拷贝都没有。
        lodGeometry.setAttribute('position',geometry.attributes.position);
        lodGeometry.setAttribute('normal',geometry.attributes.normal);
        lodGeometry.setAttribute('uv',geometry.attributes.uv);
        lodGeometry.setIndex(new THREE.BufferAttribute(lodIndex,1));
        lodGeometry.boundingBox=geometry.boundingBox!.clone();
        lodGeometry.boundingSphere=geometry.boundingSphere!.clone();
        const lodMesh=new THREE.Mesh(lodGeometry,material);
        lodMesh.name=`${mesh.name}_L${levels.length}`;lodMesh.receiveShadow=true;
        lodMesh.matrixAutoUpdate=false;lodMesh.updateMatrix();
        lodMesh.visible=false;
        levels.push({step,mesh:lodMesh,maxError:lodMaxError(positions,nx,tris),triangles:tris.length/3});
      }
      mesh.userData.lod=levels;
    }
    meshes.push(mesh);
  }
  return meshes;
}

/* ------------------------------------------------------------------ */
/* 单子 AX1 · 按距离分档                                               */
/* ------------------------------------------------------------------ */

/**
 * 一档的三角(局部顶点号,顶点号 = j*(nx+1)+i,与 L0 同一套)。
 *
 * **标称步长 + 误差预算。** 按 `step` 把块切成粗格;某个粗格按当前格距三角化以后,
 * 它覆盖到的 L0 格点里最大垂直误差若超过 `budget`,这一格的格距就减半(8 → 4 → 2 → 1),
 * 只这一格,不是整块。驳岸、台基边这种陡坎只有几米宽,却能让整块的最大误差到 1~2 m——
 * 不这样做,园里但凡带一段驳岸的块永远切不下去。所以这一档**量出来的**最大误差 ≤ budget;
 * 切档距离仍按量出来的误差算(见 TerrainLod),预算只决定「粗档多早能接管」。
 *
 * **接缝用缝合,不用裙边。** 块边,以及两个格距不同的格之间的边,两侧都取 L0 的全部格点,
 * 贴边的小格向内扇形收到自己的角上。于是块边与格间边都是 L0 的同一条折线,相邻两块
 * 无论各在哪一档都逐位相同——不靠误差上界,构造上就不会裂。不用裙边的两条理由:裙边要往
 * 顶点缓冲里追加顶点(粗档就不能与 L0 共用一份缓冲,L0 本身也得变);窗口外沿一圈的
 * 裙边会露在海面上方。扇心取两条邻边都不缝的角;找不到(对边都要缝)的格也减半格距。
 *
 * 格内的对角线与 L0 同向(a→d),绕向与 L0 一致(xz 叉积为负)。块宽不足两个粗格时返回 null。
 */
export function lodTriangles(positions:ArrayLike<number>,nx:number,nz:number,step:number,budget=Infinity): number[]|null {
  const lines=(a:number,b:number,r:number)=>{const out:number[]=[];for(let i=a;i<b;i+=r)out.push(i);out.push(b);return out;};
  const xs=lines(0,nx,step),zs=lines(0,nz,step),ncx=xs.length-1,ncz=zs.length-1;
  if(ncx<2||ncz<2)return null;
  const W=nx+1,v=(i:number,j:number)=>j*W+i;
  const res=new Int32Array(ncx*ncz).fill(step);
  const push=(out:number[],p:[number,number],q:[number,number],r:[number,number])=>{
    const cross=(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    if(cross===0)return;
    if(cross>0)[q,r]=[r,q];
    out.push(v(p[0],p[1]),v(q[0],q[1]),v(r[0],r[1]));
  };
  /** 一个小格:要缝的那几侧取 L0 全部格点,向内扇到两条邻边都不缝的角。对边都要缝时返回 false。 */
  const quad=(out:number[],x0:number,x1:number,z0:number,z1:number,fS:boolean,fN:boolean,fW:boolean,fE:boolean):boolean=>{
    // 一格长的边上没有中间格点,缝不缝都一样。
    if(x1-x0===1)fS=fN=false;
    if(z1-z0===1)fW=fE=false;
    if(!fS&&!fN&&!fW&&!fE){push(out,[x0,z0],[x0,z1],[x1,z1]);push(out,[x0,z0],[x1,z1],[x1,z0]);return true;}
    const corners:[number,number,boolean][]=[[x1,z1,!fN&&!fE],[x0,z1,!fN&&!fW],[x1,z0,!fS&&!fE],[x0,z0,!fS&&!fW]];
    const center=corners.find(c=>c[2]);
    if(!center)return false;
    // 绕一圈:南边 → 东边 → 北边 → 西边。
    const ring:[number,number][]=[];
    if(fS)for(let i=x0;i<x1;i++)ring.push([i,z0]);else ring.push([x0,z0]);
    if(fE)for(let j=z0;j<z1;j++)ring.push([x1,j]);else ring.push([x1,z0]);
    if(fN)for(let i=x1;i>x0;i--)ring.push([i,z1]);else ring.push([x1,z1]);
    if(fW)for(let j=z1;j>z0;j--)ring.push([x0,j]);else ring.push([x0,z1]);
    const at=ring.findIndex(p=>p[0]===center[0]&&p[1]===center[1]);
    for(let k=1;k<ring.length-1;k++)push(out,ring[at],ring[(at+k)%ring.length],ring[(at+k+1)%ring.length]);
    return true;
  };
  /** 与邻格格距不同(或贴块边)的那一侧要缝。 */
  const seam=(ci:number,cj:number,r:number)=>ci<0||cj<0||ci>=ncx||cj>=ncz||res[cj*ncx+ci]!==r;
  /** 一个粗格按它当前的格距切成小格再三角化;有小格缝不上时返回 false。 */
  const cell=(ci:number,cj:number,out:number[]):boolean=>{
    const r=res[cj*ncx+ci];
    const sx=lines(xs[ci],xs[ci+1],r),sz=lines(zs[cj],zs[cj+1],r);
    const fS=seam(ci,cj-1,r),fN=seam(ci,cj+1,r),fW=seam(ci-1,cj,r),fE=seam(ci+1,cj,r);
    for(let b=0;b<sz.length-1;b++)for(let a=0;a<sx.length-1;a++){
      if(!quad(out,sx[a],sx[a+1],sz[b],sz[b+1],fS&&b===0,fN&&b===sz.length-2,fW&&a===0,fE&&a===sx.length-2))return false;
    }
    return true;
  };
  // 一格减半格距,邻格多出要缝的边(或少了),三角与误差都跟着变——用工作表传播到不动为止。
  // 格距只减不增,所以一定收敛;格距到 1 就是 L0,误差为 0,一定过。
  const work:number[]=[];
  for(let c=ncx*ncz-1;c>=0;c--)work.push(c);
  const scratch:number[]=[];
  while(work.length){
    const c=work.pop()!;
    const ci=c%ncx,cj=(c-ci)/ncx;
    if(res[c]===1)continue;
    scratch.length=0;
    if(cell(ci,cj,scratch)&&(budget===Infinity||lodMaxError(positions,nx,scratch)<=budget))continue;
    res[c]=Math.max(1,res[c]>>1);
    work.push(c);
    for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const ni=ci+di,nj=cj+dj;
      if(ni>=0&&nj>=0&&ni<ncx&&nj<ncz&&res[nj*ncx+ni]>1)work.push(nj*ncx+ni);
    }
  }
  const tris:number[]=[];
  for(let cj=0;cj<ncz;cj++)for(let ci=0;ci<ncx;ci++)cell(ci,cj,tris);
  return tris;
}

/**
 * 这一档相对 L0 的最大垂直误差:把每个粗三角覆盖到的 L0 格点逐个插值,与格点本身的高度比。
 * 量的是格点处(L0 自己在格点之间也是线性插值,口径与 L0 相同)。
 */
export function lodMaxError(positions:ArrayLike<number>,nx:number,tris:readonly number[]): number {
  const W=nx+1;let worst=0;
  for(let t=0;t<tris.length;t+=3){
    const a=tris[t],b=tris[t+1],c=tris[t+2];
    const ax=a%W,az=(a-ax)/W,bx=b%W,bz=(b-bx)/W,cx=c%W,cz=(c-cx)/W;
    const ha=positions[a*3+1],hb=positions[b*3+1],hc=positions[c*3+1];
    const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    for(let j=Math.min(az,bz,cz);j<=Math.max(az,bz,cz);j++)for(let i=Math.min(ax,bx,cx);i<=Math.max(ax,bx,cx);i++){
      const wa=((bz-cz)*(i-cx)+(cx-bx)*(j-cz))/den,wb=((cz-az)*(i-cx)+(ax-cx)*(j-cz))/den,wc=1-wa-wb;
      if(wa<-1e-9||wb<-1e-9||wc<-1e-9)continue;
      const err=Math.abs(wa*ha+wb*hb+wc*hc-positions[(j*W+i)*3+1]);
      if(err>worst)worst=err;
    }
  }
  return worst;
}

/**
 * 滞回比例:往粗切要越过阈值 10%,往细切一到阈值就切。
 * 所以任何时刻用着的那一档投影误差都 < 1 px(往细切不打折),
 * 而往粗切多出来的这 10% 是防来回跳的带宽:最近的切档距离约几十米,
 * 带宽就是几米;走路每帧只挪 v·dt ≈ 0.1 m,头部起伏更小,一帧跨不过去。
 */
export const TERRAIN_LOD_HYSTERESIS = 0.1;

/**
 * 每帧选档:按相机到每块 AABB 的距离,取投影误差 < `maxPixels` 的最粗一档。
 * 切档距离不是常数,是 `maxError × (视口高/2) × 投影矩阵[5] / maxPixels` 现算——
 * 换 FOV、换分辨率都跟着走。每帧不分配。阴影 pass 看的是同一个 `visible`,
 * 所以天然跟主相机同一档(地形本来也不投影,只接影)。
 */
export class TerrainLod {
  readonly chunks: {levels:TerrainLodLevel[];box:THREE.Box3;current:number}[] = [];
  private readonly camPos = new THREE.Vector3();
  private readonly maxPixels: number;
  constructor(meshes: readonly THREE.Mesh[], maxPixels = 1) {
    this.maxPixels = maxPixels;
    for(const mesh of meshes){
      const levels=mesh.userData.lod as TerrainLodLevel[]|undefined;
      if(!levels||levels.length<2)continue;
      this.chunks.push({levels,box:mesh.geometry.boundingBox!.clone(),current:0});
    }
  }
  /** 误差 1 px 时这一档的切档距离(米)。 */
  switchDistance(maxError:number, viewportHeight:number, projection11:number): number {
    return maxError*(viewportHeight/2)*projection11/this.maxPixels;
  }
  update(camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    camera.getWorldPosition(this.camPos);
    const k=(viewportHeight/2)*camera.projectionMatrix.elements[5]/this.maxPixels;
    const px=this.camPos.x,py=this.camPos.y,pz=this.camPos.z;
    for(const chunk of this.chunks){
      const b=chunk.box;
      const dx=Math.max(b.min.x-px,0,px-b.max.x),dy=Math.max(b.min.y-py,0,py-b.max.y),dz=Math.max(b.min.z-pz,0,pz-b.max.z);
      const d=Math.sqrt(dx*dx+dy*dy+dz*dz);
      let pick=0;
      for(let i=chunk.levels.length-1;i>0;i--){
        const threshold=chunk.levels[i].maxError*k*(i>chunk.current?1+TERRAIN_LOD_HYSTERESIS:1);
        if(d>=threshold){pick=i;break;}
      }
      if(pick===chunk.current)continue;
      chunk.levels[chunk.current].mesh.visible=false;
      chunk.levels[pick].mesh.visible=true;
      chunk.current=pick;
    }
  }
}
