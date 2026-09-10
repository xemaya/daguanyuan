import * as THREE from 'three';
import type { Bounds2 } from '@engine/scatter/cluster';

interface TerrainChunkOptions {
  segX?: number;
  segZ?: number;
  cellSize?: number;
  material?: THREE.Material;
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
    meshes.push(mesh);
  }
  return meshes;
}
