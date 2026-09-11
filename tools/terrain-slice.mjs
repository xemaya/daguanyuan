/** Engineering-only heightfield context for component checks. No new game
 * terrain material or final-art claim is implied by this simplified shading. */
export async function addTerrainSlice(page,field,origin,polygon,pad=8) {
 const xs=polygon.map(p=>p[0]),zs=polygon.map(p=>p[1]);
 const b={x0:Math.min(...xs)-pad,x1:Math.max(...xs)+pad,z0:Math.min(...zs)-pad,z1:Math.max(...zs)+pad};
 const nx=Math.ceil((b.x1-b.x0)/.35),nz=Math.ceil((b.z1-b.z0)/.35),positions=[],colors=[],indices=[];
 for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++) {
  const x=b.x0+(b.x1-b.x0)*i/nx,z=b.z0+(b.z1-b.z0)*j/nz,y=field.height(x,z),m=field.masks(x,z);
  positions.push(x-origin[0],y-origin[1],z-origin[2]);const c=y<0?[.24,.34,.30]:m.grass>.5?[.38,.45,.30]:[.52,.43,.31];colors.push(...c.map(x=>x*(.85+m.wear*.15)));
  if(i<nx&&j<nz){const a=j*(nx+1)+i;indices.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}
 }
 await page.evaluate(({positions,colors,indices,b,origin})=>{
  const v=window.__VIEWER__,T=v.THREE;for(const o of v.scene.children)if(o.isMesh&&o.geometry.type==='CircleGeometry')o.visible=false;
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  const ground=new T.Mesh(g,new T.MeshStandardMaterial({vertexColors:true,roughness:1}));ground.receiveShadow=true;v.scene.add(ground);
  const water=new T.Mesh(new T.PlaneGeometry(b.x1-b.x0,b.z1-b.z0),new T.MeshStandardMaterial({color:0x4f8c7e,transparent:true,opacity:.62,roughness:.3,depthWrite:false}));water.rotation.x=-Math.PI/2;water.position.set((b.x0+b.x1)/2-origin[0],-origin[1],(b.z0+b.z1)/2-origin[2]);v.scene.add(water);
 },{positions,colors,indices,b,origin});
 return {bounds:b,spacing:.35,waterLevel:0,style:'engineering context only'};
}
