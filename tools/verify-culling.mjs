#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const urlIndex = process.argv.indexOf('--url');
const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : 'http://127.0.0.1:4817/';
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const mode = option('--mode', 'frustum');
const out = option('--out', 'shots/p1f-culling');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME__ || document.querySelector('#app pre'), null, { timeout: 120000 });
  await page.evaluate(() => {
    const g=window.__GAME__;
    if (!g) throw new Error(document.querySelector('#app pre')?.textContent || 'No game');
    g.engine.running=false;g.engine.renderer.setAnimationLoop(null);
    g.engine.clock.elapsedTime=12;g.world.ctx.env.windTime.value=12;
    g.engine.renderer.setPixelRatio(1);g.engine.postfx.setSize(innerWidth,innerHeight);
    g.hud.dialogue.close();
  });
  const report = { mode, scope: 'vegetation+terrain+static', errors, shots: [] };
  for (const shot of [
    {id:'pond_reveal',x:-3.5,z:157.4,yaw:.15,pitch:-.04},
    {id:'treeline',x:-45,z:170,yaw:1.10,pitch:.14},
    {id:'xiaoxiang',x:-111.2,z:104,yaw:-.62,pitch:.05},
  ]) {
    await page.evaluate(s => {
      const g=window.__GAME__;
      const floor=g.world.collision.groundHeight(s.x,s.z);
      g.engine.camera.position.set(s.x,floor+1.65,s.z);
      g.engine.camera.rotation.set(s.pitch,s.yaw,0,'YXZ');
      g.engine.camera.updateMatrixWorld(true);
    }, shot);
    const frames=[];
    for (const on of [true,false]) {
      const stats=await page.evaluate(({on,mode}) => {
        const g=window.__GAME__;
        const debug=g.world.root.getObjectByName('Vegetation').userData.vegDebug;
        if(mode==='all')debug.setCulling(on);
        else debug.setFrustumCulling(on);
        for(const name of ['Terrain','GardenStatic'])g.world.root.getObjectByName(name)?.traverse(object=>{
          if(object.isMesh)object.frustumCulled=on;
        });
        // Re-render twice with the same clock and camera; no player or adaptive-resolution tick.
        g.world.update(0,12);g.engine.postfx.render(0);
        g.world.update(0,12);g.engine.postfx.render(0);
        return {scene:{...g.engine.postfx.sceneStats},frame:{...g.engine.postfx.frameStats}};
      },{on,mode});
      const image=await page.screenshot({type:'png'});
      writeFileSync(`${out}/${shot.id}-${on?'culled':'all'}.png`,image);
      frames.push({stats,png:image.toString('base64')});
    }
    const difference=await page.evaluate(async frames => {
      const pixels=[];
      for(const png of frames){
        const image=new Image();image.src=`data:image/png;base64,${png}`;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
        pixels.push(ctx.getImageData(0,0,canvas.width,canvas.height).data);
      }
      let total=0,changed=0,max=0;
      for(let i=0;i<pixels[0].length;i+=4){
        let delta=0;
        for(let c=0;c<3;c++){const d=Math.abs(pixels[0][i+c]-pixels[1][i+c]);total+=d;delta=Math.max(delta,d);}
        max=Math.max(max,delta);if(delta>12)changed++;
      }
      return {mean:total/(pixels[0].length/4*3),changedFraction:changed/(pixels[0].length/4),max};
    },frames.map(f=>f.png));
    report.shots.push({id:shot.id,culled:frames[0].stats,all:frames[1].stats,difference});
    console.log(JSON.stringify(report.shots.at(-1)));
  }
  report.passed=!errors.length && report.shots.every(s=>s.difference.mean<0.1&&s.difference.changedFraction<0.001);
  writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  if(!report.passed)process.exitCode=1;
} finally { await browser.close(); }
