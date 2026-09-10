#!/usr/bin/env node
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const option=(n,f)=>process.argv.includes(n)?process.argv[process.argv.indexOf(n)+1]:f;
const url=option('--url','http://127.0.0.1:4824/'),out=option('--out','shots/p2-wall/verify');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const report={errors:[]};
try {
 const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(new URL('viewer.html?subject=garden-wall:xiaoxiangguan.courtyard-wall',url).href);
 await page.waitForFunction(()=>window.__VIEWER__,null,{timeout:120000});
 await page.evaluate(()=>new Promise(resolve=>{let n=0;const tick=()=>++n>=12?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
 report.part=await page.evaluate(()=>{
  const v=window.__VIEWER__,T=v.THREE,part=v.part,path=part.path;
  part.root.updateWorldMatrix(true,true);
  let invalid=0,meshes=0;part.root.traverse(m=>{if(!m.isMesh)return;meshes++;for(const a of Object.values(m.geometry.attributes))for(const n of a.array)if(!Number.isFinite(n))invalid++;});
  const gate=path.panels.find(p=>p.variant==='moon');
  function across(x,y,z,dx,dz) {
   const ray=new T.Raycaster(new T.Vector3(x+dx*2,y,z+dz*2),new T.Vector3(-dx,0,-dz),0,4);
   return ray.intersectObject(part.root,true).length>0;
  }
  const gateClear=[.55,1.15,1.75].map(y=>!across(gate.center[0],y,gate.center[1],0,1));
  const gateStone=[-1.2,1.2].map(x=>across(gate.center[0]+x,1.15,gate.center[1],0,1));
  const joins=[];
  for(let i=0;i<path.panels.length;i++) {
   const p=path.panels[i];if(!p.endMiter)continue;
   const b=path.panels[(i+1)%path.panels.length];
   const x=p.center[0]+Math.cos(p.yaw)*p.length/2,z=p.center[1]-Math.sin(p.yaw)*p.length/2;
   const nx=Math.sin(p.yaw)+Math.sin(b.yaw),nz=Math.cos(p.yaw)+Math.cos(b.yaw),len=Math.hypot(nx,nz);
   joins.push(across(x,1.5,z,nx/len,nz/len)&&across(x,1.5,z,-nx/len,-nz/len));
  }
  return {invalid,meshes,gateClear,gateStone,joins,stats:{calls:v.drawCalls(),triangles:v.triangles()},linear:part.root.userData.linear};
 });
 await page.screenshot({path:`${out}/wall.png`});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__GAME__,null,{timeout:150000});
 report.world=await page.evaluate(()=>{
  const g=window.__GAME__,c=g.world.collision,T=g.THREE;
  const at=c.resolve(-105,120,1.37,2.87,.32,new T.Vector2());
  const old=c.resolve(-105.8,105.1,1.12,2.62,.32,new T.Vector2());
  const linears=g.engine.scene.getObjectByName('Garden').userData.linears;
  const wall=linears.find(l=>l.id==='xiaoxiangguan.courtyard-wall');
  const structures=g.engine.scene.getObjectByName('GardenStatic');structures.updateWorldMatrix(true,true);
  const flow=new T.Vector3(4,0,1.5).normalize();
  const drainHits=y=>new T.Raycaster(new T.Vector3(-134,y,69.5),flow,0,Math.hypot(4,1.5)).intersectObject(structures,true).length;
  return {linears,gateCenterClear:at.distanceTo(new T.Vector2(-105,120))<1e-6,
   oldGateRemoved:old.distanceTo(new T.Vector2(-105.8,105.1))<1e-6,
   drainClear:drainHits(.2)===0,drainLintel:drainHits(.8)>0,
   sill:c.groundHeight(-105,120),wallColliders:c.colliders.filter(b=>b.tag===wall.id).length,
   buildMs:g.world.buildDurationMs};
 });
 report.passed=!report.errors.length&&report.part.invalid===0&&report.part.gateClear.every(Boolean)&&
  report.part.gateStone.every(Boolean)&&report.part.joins.length===6&&report.part.joins.every(Boolean)&&
  report.part.stats.calls>0&&report.part.stats.calls<=260&&report.world.gateCenterClear&&report.world.oldGateRemoved&&report.world.sill===1.25&&report.world.wallColliders>0&&report.world.drainClear&&report.world.drainLintel;
} catch(error) {report.errors.push(String(error));report.passed=false;}
finally {writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;}
