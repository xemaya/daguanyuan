#!/usr/bin/env node
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const url=option('--url','http://127.0.0.1:4820/'),out=option('--out','shots/p1-environment');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__GAME__||document.querySelector('#app pre'),null,{timeout:120000});
 const report={errors,initial:await page.evaluate(()=>{
  const g=window.__GAME__;if(!g)throw new Error(document.querySelector('#app pre')?.textContent);
  const transmissionMaterials=[];
  g.world.root.traverse(o=>{if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.transmission>0)transmissionMaterials.push(o.name);});
  const veg=g.world.root.getObjectByName('Vegetation'),trees=veg.userData.treePlacements;
  const treeColliders=g.world.collision.colliders.filter(c=>c.tag==='tree');
  const d=g.world.ctx.terrain;
  const staticBatches=g.world.root.getObjectByName('GardenStatic').userData.staticBatches;
  const boundsViolations=trees.filter(t=>t.x<d.bounds.minX||t.x>d.bounds.maxX||t.z<d.bounds.minZ||t.z>d.bounds.maxZ).length;
  const unregistered=trees.filter(t=>t.x>=d.bounds.minX+2&&t.x<=d.bounds.maxX-2&&t.z>=d.bounds.minZ+2&&t.z<=d.bounds.maxZ-2)
    .filter(t=>!treeColliders.some(c=>c.cx===t.x&&c.cz===t.z)).length;
  const water=g.world.root.getObjectByName('Sea').userData.water,w=water.window;
  const points=[[0,148],[55,236],[-105,98]].map(([x,z])=>{
    const i=Math.min(w.resX-1,Math.max(0,Math.floor((x-w.minX)/w.width*w.resX)));
    const j=Math.min(w.resZ-1,Math.max(0,Math.floor((z-w.minZ)/w.depth*w.resZ)));
    const sx=w.minX+(i+.5)*w.width/w.resX,sz=w.minZ+(j+.5)*w.depth/w.resZ;
    const value=water.bed.image.data[(j*w.resX+i)*4]/255,s=(value-.5)*2;
    const decoded=Math.sign(s)*s*s*4,expected=g.world.collision.terrainHeight(sx,sz)-water.waterLevel;
    return {x,z,decoded,expected:Math.max(-4,Math.min(4,expected))};
  });
  return {buildMs:g.world.buildDurationMs,timings:g.world.buildTimings,staticBatches,transmissionMaterials,naturalTrees:veg.userData.naturalTreeCount,trees:trees.length,treeColliders:treeColliders.length,boundsViolations,unregistered,waterWindow:w,waterSamples:points};
 }),shots:[]};
 console.log(JSON.stringify(report.initial));
 for(const s of [{id:'gate',x:57.4,z:245.1,yaw:.08,pitch:-.02},{id:'mound',x:3.6,z:201,yaw:-.9,pitch:.02},{id:'pond',x:-.3,z:148.8,yaw:-.4,pitch:-.08},{id:'court',x:-105.8,z:107.4,yaw:0,pitch:.02}]){
  await page.evaluate(s=>{const g=window.__GAME__;g.player.teleport(new g.THREE.Vector3(s.x,0,s.z),s.yaw);g.player.state.pitch=s.pitch;g.player.update(1/60);g.player.update(1/60);},s);
  await page.evaluate(()=>new Promise(r=>{let n=0;const tick=()=>++n>=8?r():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
  await page.screenshot({path:`${out}/${s.id}.png`});
  report.shots.push({id:s.id,...await page.evaluate(()=>{
    const g=window.__GAME__,sun=g.engine.scene.getObjectByName('SunKey'),p=g.player.state.position;
    const coverage=[[0,0,0],[10,3,10],[-10,5,-10]].map(([x,y,z])=>{
      const q=new g.THREE.Vector3(p.x+x,p.y+y,p.z+z).project(sun.shadow.camera);
      return {ndc:q.toArray(),inside:Math.abs(q.x)<1&&Math.abs(q.y)<1&&Math.abs(q.z)<1};
    });
    return {coverage,scene:{...g.engine.postfx.sceneStats},fps:g.engine.fps};
  })});
 }
 report.shadowPasses=await page.evaluate(()=>{
  const g=window.__GAME__,renderer=g.engine.renderer;
  g.engine.running=false;renderer.setAnimationLoop(null);
  const original=renderer.shadowMap.render;let passes=0;
  renderer.shadowMap.render=function(...args){
    if(this.enabled&&(this.autoUpdate||this.needsUpdate)&&args[0].length)passes++;
    return original.apply(this,args);
  };
  try{g.world.update(0,12);g.engine.postfx.render(0);}finally{renderer.shadowMap.render=original;}
  return passes;
 });
 report.passed=!errors.length&&report.shadowPasses===1&&report.initial.buildMs<=15000&&report.initial.staticBatches?.instances>=8&&report.initial.naturalTrees>0&&!report.initial.boundsViolations&&!report.initial.unregistered&&!report.initial.transmissionMaterials.length
  &&report.initial.waterSamples.every(s=>Math.abs(s.expected-s.decoded)<.07)
  &&report.shots.every(s=>s.coverage.every(p=>p.inside)&&s.scene.calls<=260&&s.scene.triangles<=7900000);
 writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(!report.passed)process.exitCode=1;
}finally{await browser.close();}
