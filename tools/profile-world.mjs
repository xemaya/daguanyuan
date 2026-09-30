#!/usr/bin/env node
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const out=option('--out','shots/p1f-profile');
const url=option('--url','http://127.0.0.1:4817/');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1}),errors=[];
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.text().startsWith('[world]'))console.log(m.text());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__GAME__||document.querySelector('#app pre'),null,{timeout:120000});
 const bootError=await page.locator('#app pre').count();if(bootError)throw new Error(await page.locator('#app pre').textContent());
 const report={errors,initial:await page.evaluate(()=>{const g=window.__GAME__;return {buildMs:g.world.buildDurationMs,textureWarmup:g.world.root.userData.textureWarmup,timings:g.world.buildTimings,vegetation:g.world.root.getObjectByName('Vegetation').userData.vegDebug.stats(),terrainChunks:g.world.root.getObjectByName('Terrain').userData.chunkCount,terrainTimings:g.world.root.getObjectByName('Terrain').userData.buildTimings};}),shots:[]};
 console.log(JSON.stringify(report.initial));
 for(const shot of (process.argv.includes('--no-shots') ? [] : [{id:'pond_reveal',pos:[-3.5,0,157.4],yaw:.15,pitch:-.04},{id:'treeline',pos:[-45,0,170],yaw:1.1,pitch:.14},{id:'xiaoxiang',pos:[-111.2,0,104],yaw:-.62,pitch:.05}])){
  await page.evaluate(s=>{const g=window.__GAME__;g.player.teleport(new g.THREE.Vector3(...s.pos),s.yaw);g.player.state.pitch=s.pitch;g.player.update(1/60);g.player.update(1/60);g.hud.dialogue.close();},shot);
  await page.evaluate(()=>new Promise(r=>{let n=0;const tick=()=>++n>=4?r():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
  await page.screenshot({path:`${out}/${shot.id}.png`});
  report.shots.push({id:shot.id,...await page.evaluate(()=>{const g=window.__GAME__;return{scene:g.engine.postfx.sceneStats,frame:g.engine.postfx.frameStats,ratio:g.engine.renderer.getPixelRatio(),vegetation:g.world.root.getObjectByName('Vegetation').userData.vegDebug.stats()};})});
 }
 writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
