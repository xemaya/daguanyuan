import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync,statSync} from 'node:fs';
const backend=process.argv[2]??'webgpu';const out=`shots/wg3-${backend}`;mkdirSync(out,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});const p=await b.newPage({viewport:{width:1600,height:900}});const errors=[];
p.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text().slice(0,500));}});p.on('pageerror',e=>errors.push(e.message));const rows=[];const entry='artifacts/wg-current/dist/garden.html';const source={gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),buildEntrySha256:createHash('sha256').update(readFileSync(entry)).digest('hex'),buildMtime:statSync(entry).mtime.toISOString()};
try {
 await p.goto(`http://127.0.0.1:4801/garden.html?fixed=1&backend=${backend}`);
 await p.waitForFunction(()=>window.__GAME__,null,{timeout:180000});
 const actual=await p.evaluate(()=>window.__GAME__.engine.backend);if(actual!==backend)throw Error(`Unexpected backend ${actual}`);
 await p.evaluate(()=>{const g=window.__GAME__;g.player.teleport(new g.THREE.Vector3(-3.5,0,157.4),0.15);g.player.state.pitch=-0.04;g.player.update(0);g.world.update(0,10)});
 await p.waitForTimeout(2200);
 for(const quality of ['low','medium','high','ultra']){
  await p.evaluate(q=>window.__GAME__.engine.setQuality(q),quality);await p.waitForTimeout(1500);
  await p.screenshot({path:`${out}/${quality}.png`});
  const row=await p.evaluate(()=>{const e=window.__GAME__.engine;return{quality:e.quality.name,effects:e.postfx.activeEffects,ratio:e.renderer.getPixelRatio(),scene:e.postfx.sceneStats,frame:e.postfx.frameStats,boot:window.__GAME__.bootTimings}});rows.push(row);console.log(JSON.stringify(row));
 }
 await p.evaluate(()=>window.__GAME__.engine.setQuality('high'));await p.waitForTimeout(700);
 await p.evaluate(()=>{const e=window.__GAME__.engine;e.running=false;e.renderer.setAnimationLoop(null)});
 for(const mode of ['normal','depth']){
  await p.evaluate(m=>{const e=window.__GAME__.engine;e.postfx.inspectBuffer(m);e.postfx.render(0)},mode);await p.waitForTimeout(500);
  const visible=await p.screenshot({path:`${out}/${mode}-water.png`});
  await p.evaluate(()=>{const e=window.__GAME__.engine;e.scene.getObjectByName('Sea').visible=false;e.postfx.render(0)});await p.waitForTimeout(500);
  const hidden=await p.screenshot({path:`${out}/${mode}-no-water.png`});
  const identical=visible.equals(hidden);rows.push({buffer:mode,waterDoesNotOverwriteOpaque:identical});console.log(mode,'water identical',identical);
  if(!identical)throw Error(`Water changes opaque ${mode} buffer`);
  await p.evaluate(()=>{const e=window.__GAME__.engine;e.scene.getObjectByName('Sea').visible=true;e.postfx.render(0)});
 }
 await p.evaluate(()=>{const e=window.__GAME__.engine;e.postfx.inspectBuffer(null);e.start()});
 for(const [name,far,strength] of [['legacy',220,1],['comfort',400,0.35],['off',400,0]]){
  await p.evaluate(([far,strength])=>{const e=window.__GAME__.engine;e.postfx.settings.dofFar=far;e.postfx.settings.dofStrength=strength;e.postfx.applyQuality(e.quality)},[far,strength]);await p.waitForTimeout(800);await p.screenshot({path:`${out}/dof-${name}.png`});
 }
 if(errors.length)throw Error(`${errors.length} console errors`);
} finally {writeFileSync(`${out}/manifest.json`,JSON.stringify({source,backend,rows,errors},null,2));await b.close()}
