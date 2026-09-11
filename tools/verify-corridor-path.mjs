#!/usr/bin/env node
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const option=(n,f)=>process.argv.includes(n)?process.argv[process.argv.indexOf(n)+1]:f;
const url=option('--url','http://127.0.0.1:4825/'),out=option('--out','shots/p2-corridor/verify');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const report={errors:[]};
try {
 const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(new URL('viewer.html?subject=garden-corridor:xiaoxiangguan.west-corridor-path',url).href);
 await page.waitForFunction(()=>window.__VIEWER__,null,{timeout:120000});
 await page.evaluate(()=>new Promise(r=>{let n=0;const tick=()=>++n>=12?r():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
 report.part=await page.evaluate(()=>{
  const v=window.__VIEWER__,T=v.THREE,part=v.part,path=part.path;
  part.root.updateWorldMatrix(true,true);
  let invalid=0,renderedColumns=0;
  part.root.traverse(m=>{if(!m.isMesh)return;for(const a of Object.values(m.geometry.attributes))for(const x of a.array)if(!Number.isFinite(x))invalid++;
    if(m.geometry.type==='CylinderGeometry')renderedColumns+=m.isInstancedMesh?m.count:1;});
  const down=(p,y)=>new T.Raycaster(new T.Vector3(p[0],y,p[1]),new T.Vector3(0,-1,0),0,20).intersectObject(part.root,true)[0]?.point.y;
  const samples=[];
  for(let i=1;i<path.stations.length;i++)for(let k=0;k<=4;k++) {
    const a=path.stations[i-1].point,b=path.stations[i].point,t=k/4,p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    samples.push({point:p,roof:down(p,10),floor:down(p,.7),expectedRoof:path.frames[i-1].m.ridgeY+part.spec.platformH_m});
  }
  return {invalid,renderedColumns,expectedColumns:path.columns.length,samples,stats:{calls:v.drawCalls(),triangles:v.triangles()},linear:part.root.userData.linear};
 });
 await page.screenshot({path:`${out}/part.png`});
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__GAME__,null,{timeout:150000});
 report.world=await page.evaluate(()=>{
  const g=window.__GAME__,T=g.THREE,c=g.world.collision,garden=g.engine.scene.getObjectByName('Garden');
  const linears=garden.userData.linears,corridor=linears.find(l=>l.kind==='corridor'),bridge=linears.find(l=>l.id==='cuizhang.creek-crossing');
  const floor=c.platforms.find(p=>p.tag===corridor.id),checks=[];
  for(let i=1;i<corridor.spec.points.length;i++)for(let k=0;k<=8;k++) {
    const a=corridor.spec.points[i-1],b=corridor.spec.points[i],x=a[0]+(b[0]-a[0])*k/8,z=a[1]+(b[1]-a[1])*k/8;
    const hit=c.resolve(x,z,1.37,2.87,.32,new T.Vector2());
    checks.push({x,z,height:c.groundHeight(x,z),clear:hit.distanceTo(new T.Vector2(x,z))<1e-6});
  }
  const missingColors=[];g.engine.scene.getObjectByName('GardenStatic').traverse(m=>{if(m.isMesh&&!Array.isArray(m.material)&&m.material.vertexColors&&!m.geometry.attributes.color)missingColors.push(m.name);});
  const piers=bridge.piers.map(p=>({actualBottom:p.bottom+bridge.position[1],expectedBottom:c.terrainHeight(p.point[0]+bridge.origin[0],p.point[1]+bridge.origin[1])-bridge.spec.pierEmbed_m}));
  const structures=g.engine.scene.getObjectByName('GardenStatic');structures.updateWorldMatrix(true,true);
  const pierHit=new T.Raycaster(new T.Vector3(-35,-1.15,202),new T.Vector3(-1,0,0),0,4).intersectObject(structures,true).length>0;
  return {checks,polygonVertices:floor?.polygon?.length,missingColors,piers,
    pierFootVisibleToRay:pierHit,
    bridgeBed:c.terrainHeight(-37,202),bridgeFloor:c.groundHeight(-37,202),
    outsideCorridor:c.groundHeight(-120,101),buildMs:g.world.buildDurationMs};
 });
 for(const shot of [{id:'corridor_entry',x:-116,z:116,yaw:0,pitch:.02},{id:'corridor_turn',x:-126,z:106,yaw:0,pitch:.04},{id:'creek_crossing',x:-34,z:205.8,yaw:.6435,pitch:-.15}]) {
  await page.evaluate(s=>{const g=window.__GAME__;g.player.teleport(new g.THREE.Vector3(s.x,0,s.z),s.yaw);g.player.state.pitch=s.pitch;g.player.update(1/60);},shot);
  await page.evaluate(()=>new Promise(r=>{let n=0;const tick=()=>++n>=12?r():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
  await page.screenshot({path:`${out}/${shot.id}.png`});
 }
 report.passed=!report.errors.length&&report.part.invalid===0&&report.part.renderedColumns===42&&report.part.stats.calls>0&&report.part.stats.calls<=260&&
   report.part.samples.every(s=>Math.abs(s.roof-s.expectedRoof)<.025&&Math.abs(s.floor-.25)<.025)&&
   report.world.polygonVertices>4&&report.world.checks.every(s=>Math.abs(s.height-1.25)<1e-6&&s.clear)&&
   report.world.missingColors.length===0&&report.world.piers.every(p=>Math.abs(p.actualBottom-p.expectedBottom)<1e-6)&&report.world.pierFootVisibleToRay&&
   report.world.bridgeBed<0&&report.world.bridgeFloor===2.6&&report.world.outsideCorridor<1.1;
} catch(e){report.errors.push(String(e));report.passed=false;}
finally {writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,errors:report.errors,columns:report.part?.renderedColumns,calls:report.part?.stats?.calls,worldSamples:report.world?.checks?.length,bridgeBed:report.world?.bridgeBed,bridgeFloor:report.world?.bridgeFloor,buildMs:report.world?.buildMs}));if(!report.passed)process.exitCode=1;}
