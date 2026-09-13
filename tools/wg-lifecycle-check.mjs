import {chromium} from 'playwright';import{mkdirSync,writeFileSync}from'node:fs';
const headed=process.argv.includes('--headed');const out=headed?'shots/wg-lifecycle-native':'shots/wg-lifecycle';mkdirSync(out,{recursive:true});
const b=await chromium.launch({headless:!headed,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:1280,height:720}});const errors=[],checks=[],badResources=[],consoleLocations=[];p.on('response',r=>{if(r.status()>=400)badResources.push({url:r.url(),status:r.status()})});let injectingLoss=false;let pointerLockMode='native';
p.on('console',m=>{if(m.type()==='error'&&!(injectingLoss&&(m.text().includes('[renderer] device lost')||(m.text().includes('Device Lost:')&&m.text().includes('test injection'))))){errors.push(m.text());consoleLocations.push({text:m.text(),location:m.location()})}});p.on('pageerror',e=>errors.push(e.message));
const assert=(condition,name)=>{checks.push({name,pass:!!condition});console.log(name,!!condition);if(!condition)throw Error(name)};
const settled=()=>p.waitForTimeout(600);
try{
 await p.goto('http://127.0.0.1:4801/garden.html?fixed=1&ui=title');await p.waitForFunction(()=>window.__GAME__,null,{timeout:180000});
 checks.push({name:'boot timings',timings:await p.evaluate(()=>window.__GAME__.bootTimings)});
 assert(await p.evaluate(()=>window.__GAME__.hud.auto===false),'real title/pause UI path');
 await p.evaluate(()=>{window.__WG_NATIVE_ERRORS__=[];const e=window.__GAME__.engine;const native=e.renderer.domElement.requestPointerLock.bind(e.renderer.domElement);e.renderer.domElement.requestPointerLock=(...args)=>{const result=native(...args);window.__WG_NATIVE_ERRORS__.push({attempt:true,focus:document.hasFocus(),active:navigator.userActivation.isActive});result?.catch?.(error=>window.__WG_NATIVE_ERRORS__.push({name:error.name,message:error.message}));return result};document.addEventListener('pointerlockerror',()=>window.__WG_NATIVE_ERRORS__.push({event:'pointerlockerror',focus:document.hasFocus()}));const i=e.input;const old=i.requestLock.bind(i);window.__WG_LOCK_COUNT__=0;i.requestLock=()=>{window.__WG_LOCK_COUNT__++;return old()}});
 await p.bringToFront();await p.locator('.dgy-cta').click();await settled();
 await p.waitForFunction(()=>document.pointerLockElement||window.__GAME__.engine.input.lockFailures>0,null,{timeout:3000}).catch(()=>{});
 const native=await p.evaluate(()=>({locked:!!document.pointerLockElement,focus:document.hasFocus(),failures:window.__GAME__.engine.input.lockFailures,requests:window.__WG_LOCK_COUNT__,pending:window.__GAME__.engine.input.lockPending,lastUnlock:window.__GAME__.engine.input.unlockedAt,activation:{active:navigator.userActivation.isActive,hasBeenActive:navigator.userActivation.hasBeenActive},events:window.__WG_NATIVE_ERRORS__}));checks.push({name:'native pointer-lock capability',...native});console.log('native diagnostic',JSON.stringify(native));
 if(!native.locked&&!headed){
  pointerLockMode='DOM platform adapter (native headless lock unavailable)';
  await p.waitForTimeout(1300);
  await p.evaluate(()=>{const e=window.__GAME__.engine;let locked=false;Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>locked?e.renderer.domElement:null});e.renderer.domElement.requestPointerLock=()=>Promise.resolve().then(()=>{locked=true;document.dispatchEvent(new Event('pointerlockchange'))});document.exitPointerLock=()=>{locked=false;document.dispatchEvent(new Event('pointerlockchange'))}});
  await p.locator('.dgy-cta').click();await settled();
 }
 assert(await p.evaluate(()=>!!document.pointerLockElement),'start click enters locked state');
 const calls=await p.evaluate(()=>window.__WG_LOCK_COUNT__);
 await p.keyboard.press('m');await p.waitForSelector('.dgy-map:not(.is-hidden)');await settled();
 assert(await p.evaluate(()=>!document.pointerLockElement&&document.querySelector('.dgy-start').classList.contains('is-hidden')),'map unlock does not open pause card');
 await p.locator('.dgy-map__head').click();await settled();
 assert(await p.evaluate(n=>window.__WG_LOCK_COUNT__===n,calls),'open map click does not request lock');
 await p.locator('.dgy-map__place:not(.is-locked) polygon').first().click();await settled();
 assert(await p.evaluate(n=>window.__WG_LOCK_COUNT__===n&&!document.pointerLockElement&&!window.__GAME__.engine.input.suspended,calls),'map destination closes without stealing lock');
 await p.keyboard.press('m');await p.waitForSelector('.dgy-map:not(.is-hidden)');await p.locator('.dgy-map').click({position:{x:5,y:5}});await settled();
 assert(await p.evaluate(n=>window.__WG_LOCK_COUNT__===n&&!window.__GAME__.engine.input.suspended&&document.querySelector('.dgy-map').classList.contains('is-hidden'),calls),'map backdrop closes and restores input');
 await p.keyboard.press('m');await p.waitForSelector('.dgy-map:not(.is-hidden)');await p.keyboard.press('Escape');await settled();
 assert(await p.evaluate(()=>!document.pointerLockElement&&!window.__GAME__.engine.input.suspended&&document.querySelector('.dgy-start').classList.contains('is-hidden')),'map Esc closes without pause card');
 await p.screenshot({path:`${out}/after-map.png`});
 await p.setViewportSize({width:960,height:600});await settled();
 assert(await p.evaluate(()=>{const e=window.__GAME__.engine,s=e.postfx.resources.find(n=>n.isPassNode);return e.renderer.domElement.width===960&&s.renderTarget.width===960&&s.renderTarget.height===600&&Math.abs(e.camera.aspect-1.6)<1e-8}),'garden resize updates canvas camera and MRT');
 await p.setViewportSize({width:1280,height:720});await settled();
 const cap=await p.evaluate(()=>({limit:window.__GAME__.engine.frameLimit,fps:window.__GAME__.engine.fps}));checks.push({name:'frame-cap measurement',...cap});assert(cap.limit===60&&cap.fps<=61,'default frame loop is capped at 60');
 const cdp=await p.context().newCDPSession(p);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await p.waitForTimeout(700);await cdp.send('Page.setWebLifecycleState',{state:'active'});await settled();
 assert(await p.evaluate(()=>window.__GAME__.engine.running&&Number.isFinite(window.__GAME__.player.state.position.x)),'tab lifecycle freeze/resume');
 await p.waitForTimeout(1200);await p.locator('canvas').click({position:{x:640,y:360}});await settled();
 assert(await p.evaluate(()=>!!document.pointerLockElement),'canvas relocks after closing map');
 // Browser/driver loss cannot be safely induced portably. Exercise the exact
 // public callback used by Three's GPUDevice.lost handler, and label injection.
 injectingLoss=true;await p.evaluate(()=>window.__GAME__.engine.renderer.onDeviceLost({api:'WebGPU',reason:'test injection',message:'recovery path acceptance'}));await settled();
 assert(await p.evaluate(()=>!document.pointerLockElement&&window.__GAME__.engine.input.suspended&&!window.__GAME__.engine.running&&window.__GAME__.engine.renderer._isDeviceLost),'device-loss callback releases input and stops rendering');
 const recovery=p.getByRole('button',{name:'图形设备已重置，点击重新载入'});assert(await recovery.isVisible(),'device-loss recovery control is visible');await p.screenshot({path:`${out}/device-recovery.png`});
 await Promise.all([p.waitForNavigation(),recovery.click()]);await p.waitForFunction(()=>window.__GAME__,null,{timeout:180000});assert(await p.evaluate(()=>window.__GAME__.engine.backend==='webgpu'&&window.__GAME__.engine.running),'recovery reload renders WebGPU again');injectingLoss=false;
 await p.goto('http://127.0.0.1:4801/fashi.html');await p.locator('.fashi-card').first().click();await p.waitForSelector('.detail-stage[data-renderer-ready="true"] canvas');await p.waitForTimeout(1000);assert(await p.locator('.detail-stage canvas').evaluate(c=>c.width>2&&c.height>2&&c.parentElement.dataset.rendererBackend==='webgpu'),'fashi actual WebGPU turntable');await p.screenshot({path:`${out}/fashi.png`});await p.locator('.detail-close').click();assert(await p.locator('.detail-stage canvas').count()===0,'fashi turntable disposes on close');
 assert(errors.length===0,'no unexpected console/page errors');
}finally{writeFileSync(`${out}/manifest.json`,JSON.stringify({pointerLockMode,checks,errors,badResources,consoleLocations,deviceLoss:'callback injection, not a forced hardware fault'},null,2));await b.close()}
