#!/usr/bin/env node
import '../tests/ts-resolver.mjs';
import {chromium} from 'playwright';import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const {makeTerrainField}=await import('../builder/compose/terrain-from-plan.ts');
const {SEED}=await import('../builder/compose/config.ts');
const opt=(k,v)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:v;
const url=opt('--url','http://127.0.0.1:4827/viewer.html'),out=opt('--out','shots/p2-bridges/parts');
const plan=JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json',import.meta.url),'utf8')),field=makeTerrainField(plan,{seed:SEED});
mkdirSync(out,{recursive:true});const report={errors:[],parts:[],scope:'component geometry, not installed world route'};
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 for(const spec of plan.connections) {
  await page.goto(`${url}?subject=${encodeURIComponent('garden-bridge:'+spec.id)}&angle=three_quarter`);
  await page.waitForFunction(()=>window.__VIEWER__,null,{timeout:120000});
  await page.evaluate(()=>new Promise(r=>{let n=0;const tick=()=>++n>=12?r():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
  const p=await page.evaluate(()=>{
   const v=window.__VIEWER__,p=v.part,T=v.THREE;let invalid=0;const materials=new Set();p.root.updateWorldMatrix(true,true);
   p.root.traverse(m=>{if(!m.isMesh)return;for(const mat of Array.isArray(m.material)?m.material:[m.material])materials.add(mat.uuid);
    for(const attr of Object.values(m.geometry.attributes))for(const x of attr.array)if(!Number.isFinite(x))invalid++;});
   const rays=[];
   for(let i=1;i<p.path.stations.length;i++)for(let k=0;k<=6;k++){
    const a=p.path.stations[i-1].point,b=p.path.stations[i].point,l=Math.hypot(b[0]-a[0],b[1]-a[1]);
    // Float32's outermost bevel edge has zero area. Move 0.1mm inward only at
    // the two endpoints; internal joins retain their exact station samples.
    const inset=(i===1&&k===0)?.0001:(i===p.path.stations.length-1&&k===6)?-.0001:0;
    const t=k/6+inset/l,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
    const hit=new T.Raycaster(new T.Vector3(x,.4,z),new T.Vector3(0,-1,0),0,1).intersectObject(p.root,true)[0];rays.push({x,z,endpointInsetM:inset,y:hit?.point.y});
   }
   return {kind:p.kind,id:p.spec.id,spec:p.spec,origin:p.path.origin,linear:p.root.userData.linear,invalid,rays,
    materials:materials.size,calls:v.drawCalls(),triangles:v.triangles()};
  });
  p.pierChecks=p.linear.piers.map(q=>({expected:field.height(q.point[0]+p.origin[0],q.point[1]+p.origin[1])-spec.pierEmbed_m,actual:q.bottom+spec.elevation_m}));
  p.passed=p.kind==='bridge-path'&&p.id===spec.id&&p.invalid===0&&p.calls>0&&p.calls<80&&p.rays.every(r=>Number.isFinite(r.y)&&Math.abs(r.y)<.025)&&
   p.pierChecks.every(q=>Math.abs(q.expected-q.actual)<1e-8)&&p.materials===(spec.railingMaterial==='vermilion'?3:spec.deckMaterial==='wood'?2:1);
  await page.screenshot({path:`${out}/${spec.id}.png`});
  const xs=spec.points.map(p=>p[0]),zs=spec.points.map(p=>p[1]);
  const bounds={x0:Math.min(...xs)-5,x1:Math.max(...xs)+5,z0:Math.min(...zs)-5,z1:Math.max(...zs)+5};
  const nx=Math.ceil((bounds.x1-bounds.x0)/.25),nz=Math.ceil((bounds.z1-bounds.z0)/.25),positions=[],colors=[],indices=[];
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++) {
   const x=bounds.x0+(bounds.x1-bounds.x0)*i/nx,z=bounds.z0+(bounds.z1-bounds.z0)*j/nz,y=field.height(x,z),m=field.masks(x,z);
   positions.push(x-p.origin[0],y-spec.elevation_m,z-p.origin[1]);
   const k=.85+m.wear*.15,c=y<0?[.24,.34,.30]:m.grass>.5?[.38,.45,.30]:[.52,.43,.31];colors.push(...c.map(x=>x*k));
   if(i<nx&&j<nz){const a=j*(nx+1)+i;indices.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}
  }
  await page.evaluate(data=>{
   const v=window.__VIEWER__,T=v.THREE;
   for(const o of v.scene.children)if(o.isMesh&&o.geometry.type==='CircleGeometry')o.visible=false;
   const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(data.positions,3));geo.setAttribute('color',new T.Float32BufferAttribute(data.colors,3));geo.setIndex(data.indices);geo.computeVertexNormals();
   const terrain=new T.Mesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:1}));terrain.receiveShadow=true;v.scene.add(terrain);
   const b=data.bounds,water=new T.Mesh(new T.PlaneGeometry(b.x1-b.x0,b.z1-b.z0),new T.MeshStandardMaterial({color:0x4f8c7e,transparent:true,opacity:.62,roughness:.3,metalness:.1,depthWrite:false}));
   water.rotation.x=-Math.PI/2;water.position.set((b.x0+b.x1)/2-data.origin[0],-data.elevation,(b.z0+b.z1)/2-data.origin[1]);v.scene.add(water);
   const box=new T.Box3().setFromObject(v.root),center=box.getCenter(new T.Vector3()),radius=box.getSize(new T.Vector3()).length()/2;
   const first=data.points[0],last=data.points.at(-1),dx=last[0]-first[0],dz=last[1]-first[1],a=Math.atan2(-dz+.25*dx,dx+.25*dz),e=.62;
   const distance=radius*1.08/Math.tan(v.camera.fov*Math.PI/360);
   v.camera.position.set(center.x+Math.sin(a)*Math.cos(e)*distance,center.y+Math.sin(e)*distance,center.z+Math.cos(a)*Math.cos(e)*distance);v.camera.lookAt(center);v.camera.updateProjectionMatrix();
  },{positions,colors,indices,bounds,origin:p.origin,elevation:spec.elevation_m,points:spec.points});
  await page.evaluate(()=>new Promise(r=>{let n=0;const tick=()=>++n>=12?r():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
  await page.screenshot({path:`${out}/${spec.id}-terrain.png`});
  p.terrainContext={bounds,cellM:.25,waterLevelM:0,style:'engineering heightfield slice, not final environment art'};report.parts.push(p);
  console.log(`${p.passed?'PASS':'FAIL'} ${spec.id}: ${p.rays.length} rays, ${p.calls} calls, ${p.triangles} tris`);
 }
}catch(e){report.errors.push(String(e));}
finally{report.passed=!report.errors.length&&report.parts.length===plan.connections.length&&report.parts.every(p=>p.passed);writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,errors:report.errors}));if(!report.passed)process.exitCode=1;}
