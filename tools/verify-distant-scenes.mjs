#!/usr/bin/env node
import '../tests/ts-resolver.mjs';import {chromium} from 'playwright';import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {addTerrainSlice} from './terrain-slice.mjs';
const {compileDistantScene}=await import('../builder/plan/distant-scene.ts');
const {locatePoint}=await import('../builder/plan/geometry.ts');
const {makeTerrainField}=await import('../builder/compose/terrain-from-plan.ts');const {SEED}=await import('../builder/compose/config.ts');
const opt=(k,v)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:v;
const url=opt('--url','http://127.0.0.1:4828/viewer.html'),out=opt('--out','shots/p2-distant/rendered');mkdirSync(out,{recursive:true});
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8')),field=makeTerrainField(plan,{seed:SEED});
const report={errors:[],scenes:[]};const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 for(const scene of plan.distantScenes) {
  const compiled=compileDistantScene(scene,plan);let onError;
  try {
   const failed=new Promise((_,reject)=>{onError=e=>reject(e);page.once('pageerror',onError);});
   failed.catch(()=>{});
   await page.goto(`${url}?subject=${encodeURIComponent('garden-distant:'+scene.id)}&angle=three_quarter`);
   await Promise.race([page.waitForFunction(()=>window.__VIEWER__,null,{timeout:90000}),failed]);
   await page.evaluate(()=>new Promise(r=>{let n=0;const tick=()=>++n>=12?r():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
   const result=await page.evaluate(()=>{
    const v=window.__VIEWER__,p=v.part;let invalid=0,vertices=0;p.root.updateWorldMatrix(true,true);
    p.root.traverse(m=>{if(!m.isMesh)return;vertices+=m.geometry.attributes.position.count;for(const a of Object.values(m.geometry.attributes))for(const x of a.array)if(!Number.isFinite(x))invalid++;});
    return {kind:p.kind,invalid,vertices,calls:v.drawCalls(),triangles:v.triangles(),metadata:p.root.userData.distant};
   });
   result.boundsPass=await page.evaluate(({polygon,origin})=>{
    const v=window.__VIEWER__,T=v.THREE,p=new T.Vector3(),matrix=new T.Matrix4(),instance=new T.Matrix4();let ok=true;
    const inside=(x,z)=>{let hit=false;for(let i=0;i<polygon.length-1;i++){const a=polygon[i],b=polygon[i+1],cross=(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);
      if(Math.abs(cross)<1e-5&&x>=Math.min(a[0],b[0])-1e-6&&x<=Math.max(a[0],b[0])+1e-6&&z>=Math.min(a[1],b[1])-1e-6&&z<=Math.max(a[1],b[1])+1e-6)return true;
      if((a[1]>z)!==(b[1]>z)&&x<a[0]+(b[0]-a[0])*(z-a[1])/(b[1]-a[1]))hit=!hit;}return hit;};
    v.part.root.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let j=0;j<(o.isInstancedMesh?o.count:1);j++){
      if(o.isInstancedMesh){o.getMatrixAt(j,instance);matrix.multiplyMatrices(o.matrixWorld,instance);}else matrix.copy(o.matrixWorld);
      for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(matrix);if(!inside(p.x+origin[0],p.z+origin[2]))ok=false;}
    }});return ok;
   },{polygon:scene.polygon,origin:compiled.origin});
   const round=compiled.items.find(i=>i.kind==='round');
   if(round)result.roundChecks=await page.evaluate(data=>{
    const v=window.__VIEWER__,T=v.THREE,root=v.part.root,m=data.compiled.m,base=data.elevation-data.origin[1]+data.source.spec.design.platformH;
    const cx=data.at[0]-data.origin[0],cz=data.at[1]-data.origin[2];
    return data.compiled.columns.map(([x,z])=>{const r=Math.hypot(x,z),nx=x/r,nz=z/r;return new T.Raycaster(new T.Vector3(cx+x+nx*.35,base+m.columnH/2,cz+z+nz*.35),new T.Vector3(-nx,0,-nz),0,.6).intersectObject(root,true).length>0;});
   },{...round,origin:compiled.origin});
   await page.screenshot({path:`${out}/${scene.id}-model.png`});
   result.terrainContext=await addTerrainSlice(page,field,compiled.origin,scene.polygon);
   const observation=plan.narrativeRoutes[0].observations.find(o=>o.scene===scene.id).at;
   await page.evaluate(data=>{
    const v=window.__VIEWER__,T=v.THREE,b=new T.Box3().setFromObject(v.root),target=b.getCenter(new T.Vector3());
    v.camera.fov=62;v.camera.position.set(data.eye[0]-data.origin[0],data.eye[1]-data.origin[1],data.eye[2]-data.origin[2]);v.camera.lookAt(target);v.camera.updateProjectionMatrix();
   },{origin:compiled.origin,eye:[observation[0],field.height(...observation)+1.62,observation[1]]});
   result.observer={at:observation,eyeHeightM:1.62,fovDegrees:62,otherWorldGeometryIncluded:false};
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.screenshot({path:`${out}/${scene.id}-observer.png`});
   result.passed=result.kind==='distant-scene'&&result.invalid===0&&result.vertices>0&&result.metadata.records.length===scene.contents.length&&result.boundsPass&&result.calls<260&&result.triangles<500000&&(!round||result.roundChecks.every(Boolean));
   report.scenes.push({id:scene.id,...result});console.log(`${result.passed?'PASS':'FAIL'} ${scene.id}: ${result.calls} calls, ${result.triangles} tris, bounds=${result.boundsPass}`);
  }catch(e){report.scenes.push({id:scene.id,passed:false,error:String(e)});console.log(`FAIL ${scene.id}: ${e}`);}finally{page.off('pageerror',onError);}
 }
}finally{report.passed=!report.errors.length&&report.scenes.length===5&&report.scenes.every(s=>s.passed);writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,errors:report.errors}));if(!report.passed)process.exitCode=1;}
