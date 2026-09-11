#!/usr/bin/env node
import {chromium} from 'playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const opt=(k,v)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:v;
const url=opt('--url','http://127.0.0.1:4826/'),out=opt('--out','shots/p2-access/after'),baseline=process.argv.includes('--baseline');
const plan=JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json',import.meta.url),'utf8'));
const b=plan.regions.flatMap(r=>r.buildings).find(b=>b.id==='xiaoxiangguan.main-house');
const expected=b.construction.options.backDoor;
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const report={baseline,errors:[],walk:[]};
try {
 const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(new URL(`viewer.html?subject=garden-building:${b.id}`,url).href);
 await page.waitForFunction(()=>window.__VIEWER__,null,{timeout:120000});
 report.part=await page.evaluate(expected=>{
  const v=window.__VIEWER__,T=v.THREE,p=v.part,m=p.frame.m,access=p.root.userData.construction.access;
  p.root.updateWorldMatrix(true,true);
  const ray=(x,y,z,dx,dy,dz,far)=>new T.Raycaster(new T.Vector3(x,y,z),new T.Vector3(dx,dy,dz),0,far).intersectObject(p.root,true);
  const blocked=(x,y)=>ray(x,y,-m.depthHalf+.45,0,0,-1,.9).length>0;
  const floor=p.platform.y;
  const samples=(p.walkSurfaces??[]).map(s=>({tag:s.tag,expected:s.y,actual:ray(s.cx,s.y+.5,s.cz,0,-1,0,.7)[0]?.point.y,
   solid:s.tag.includes('step')?ray(s.cx+s.hx+.2,s.y/2,s.cz,-1,0,0,.4).length>0:true}));
  let invalid=0;p.root.traverse(o=>{if(o.isMesh)for(const a of Object.values(o.geometry.attributes))for(const n of a.array)if(!Number.isFinite(n))invalid++;});
  return {invalid,access,doorRayBlocked:blocked(expected.centerXM,floor+1.2),centreWallBlocked:blocked(0,floor+1.2),
   lintelBlocked:blocked(expected.centerXM,floor+expected.sillM+expected.heightM+.05),samples,dimensions:m,stats:{calls:v.drawCalls(),triangles:v.triangles()}};
 },expected);
 await page.goto(url);await page.waitForFunction(()=>window.__GAME__,null,{timeout:150000});
 report.world=await page.evaluate(id=>{
  const g=window.__GAME__,T=g.THREE,c=g.world.collision,G=g.engine.scene.getObjectByName('Garden');
  const record=G.userData.constructions.find(r=>r.id===id),surfaces=record.access?.walkSurfaces??[];
  const yaw=record.yaw,cs=Math.cos(yaw),sn=Math.sin(yaw),[x,y,z]=record.position;
  const samples=surfaces.map(s=>{const wx=x+s.cx*cs+s.cz*sn,wz=z-s.cx*sn+s.cz*cs;return {tag:s.tag,expected:y+s.y,actual:c.groundHeight(wx,wz)};});
  const checks=[];
  for(let wz=96;wz>=92;wz-=.1) {
   const wx=-108.3,floor=c.groundHeight(wx,wz),hit=c.resolve(wx,wz,floor+.12,floor+1.68,.32,new T.Vector2());
   checks.push({z:wz,height:floor,clear:hit.distanceTo(new T.Vector2(wx,wz))<1e-6});
  }
  return {samples,checks,record,buildMs:g.world.buildDurationMs};
 },b.id);
 if(!baseline) {
  await page.evaluate(()=>{const g=window.__GAME__;g.hud?.dialogue?.close?.();g.engine.input.suspended=false;g.player.teleport(new g.THREE.Vector3(-105,0,106.5),0);});
  const points=[[-105,105.2],[-105,98],[-108.3,98],[-108.3,94.64],[-108.3,92.5],[-105,85],[-108.3,92.5],[-108.3,94.64],[-108.3,98],[-105,98],[-105,105.2],[-105,107]];
  for(const target of points) {
   let best=Infinity,progress=Date.now(),arrived=false,p;
   const start=Date.now();
   while(Date.now()-start<25000) {
    p=await page.evaluate(()=>{const p=window.__GAME__.player.state.position;return [p.x,p.y,p.z];});
    const d=Math.hypot(target[0]-p[0],target[1]-p[2]);
    if(d<.15){arrived=true;break;}
    if(d<best-.015){best=d;progress=Date.now();}
    if(Date.now()-progress>4500)break;
    const yaw=Math.atan2(-(target[0]-p[0]),-(target[1]-p[2]));
    await page.evaluate(yaw=>{window.__GAME__.player.state.yaw=yaw;},yaw);
    await page.keyboard.down('KeyW');await page.waitForTimeout(100);await page.keyboard.up('KeyW');
   }
   report.walk.push({target,position:p,arrived});console.log(`${arrived?'PASS':'FAIL'} walk ${target}`);
   if(!arrived)break;
  }
 }
 for(const shot of [{id:'rear',x:-108.3,z:91,yaw:Math.PI,pitch:-.08},{id:'inside',x:-108.3,z:96.5,yaw:0,pitch:-.12}]) {
  await page.evaluate(s=>{const g=window.__GAME__;g.player.teleport(new g.THREE.Vector3(s.x,0,s.z),s.yaw);g.player.state.pitch=s.pitch;},shot);
  await page.waitForTimeout(250);await page.screenshot({path:`${out}/${shot.id}.png`});
 }
 report.passed=!report.errors.length&&report.part.invalid===0&&(baseline?report.part.doorRayBlocked:
  !report.part.doorRayBlocked&&report.part.centreWallBlocked&&report.part.lintelBlocked&&report.part.samples.length===7&&
  report.part.samples.every(s=>Math.abs(s.expected-s.actual)<.02&&s.solid)&&
  report.world.samples.length===7&&report.world.samples.every(s=>Math.abs(s.expected-s.actual)<1e-6)&&
  report.world.checks.every(s=>s.clear)&&report.walk.length===12&&report.walk.every(s=>s.arrived));
}catch(e){report.errors.push(String(e));report.passed=false;}
finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,errors:report.errors,baseline,samples:report.part?.samples?.length,walk:report.walk.length}));if(!report.passed)process.exitCode=1;}
