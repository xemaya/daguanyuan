import { chromium } from 'playwright';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
let device=process.platform;try{device=JSON.parse(execFileSync('system_profiler',['SPDisplaysDataType','-json'],{encoding:'utf8'})).SPDisplaysDataType.map(x=>x.sppci_model).join(', ')}catch{}
const readback=process.argv.includes('--readback'),sampleCount=readback?30:120;
const out=readback?'shots/wg-readback-diagnostic':'shots/wg-performance';mkdirSync(out,{recursive:true});
// Frozen WG0 camera heights after deterministic physics settling (eye height 1.62).
const cases=[['gate',[57.4,0,245.1],[57.4,2.38,245.1],0.08,-0.02],['pond',[-3.5,0,157.4],[-3.5,0.32,157.4],0.15,-0.04],['bamboo',[-111.2,0,104],[-111.2,2.62,104],-0.62,0.05]];
const builds=Object.fromEntries(['wg0-webgl','wg-current'].map(x=>[x,createHash('sha256').update(readFileSync(`artifacts/${x}/dist/garden.html`)).digest('hex')]));
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--disable-frame-rate-limit','--force-device-scale-factor=1']});
const rows=[],errors=[];
try{for(const [label,path] of [['legacy','baseline/garden.html'],['webgpu','garden.html?fixed=1&profile=1&dof=legacy'],['webgl2','garden.html?fixed=1&profile=1&dof=legacy&backend=webgl2']]){
 const p=await b.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});p.on('pageerror',e=>errors.push({label,message:e.message}));p.on('console',m=>{if(m.type()==='error')errors.push({label,message:m.text()})});
 const began=Date.now();await p.goto(`http://127.0.0.1:4801/${path}`);await p.waitForFunction(()=>window.__GAME__,null,{timeout:180000});const readyWallMs=Date.now()-began;if(errors.length)throw Error(errors[0].message);
 await p.evaluate(({readback})=>{
  const g=window.__GAME__,e=g.engine;e.adaptiveResolution=false;e.governResolution=()=>{};e.fixedTime=10;e.frameLimit=1000;e.renderer.setPixelRatio(1);e.postfx.setSize(innerWidth,innerHeight);
  const updateWorld=g.world.update.bind(g.world);g.world.update=dt=>{g.world.ctx.env.windTime.value=10-dt;updateWorld(dt,10)};
  const s=window.__WG_PERF__={active:false,busy:false,hold:false,samples:[],warm:0,stable:0,signature:'',cpu:0,render:0,pose:null};
  const playerUpdate=g.player.update.bind(g.player);g.player.update=dt=>{playerUpdate(dt);if(s.pose){e.camera.position.fromArray(s.pose.position);e.camera.rotation.set(s.pose.pitch,s.pose.yaw,0,'YXZ');e.camera.updateMatrixWorld()}};
  for(const sys of e.systems){if(!sys.update)continue;const old=sys.update.bind(sys);sys.update=(...args)=>{const t=performance.now();old(...args);s.cpu+=performance.now()-t}}
  const render=e.postfx.render.bind(e.postfx);e.postfx.render=(...args)=>{const t=performance.now();render(...args);s.render=performance.now()-t};
  const sceneRender=e.renderer.render.bind(e.renderer);e.renderer.render=(scene,camera,...args)=>{if(scene===e.scene&&camera===e.camera)s.sceneRenders++;return sceneRender(scene,camera,...args)};
  const frame=e.frame.bind(e),backend=e.renderer.backend;
  const gl=backend?.isWebGPUBackend?null:(backend?.gl??e.renderer.getContext());
  const ext=!backend?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;
  s.gpuScope=backend?'sum of renderer render-pass timestamp intervals':ext?'whole-frame EXT_disjoint_timer_query elapsed interval':'not available';
  e.renderer.setAnimationLoop(async timestamp=>{
   if(s.busy||s.hold)return;s.busy=true;s.cpu=0;s.sceneRenders=0;
   const started=performance.now();let query=null;
   if(ext){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}
   frame(timestamp);const submitMs=performance.now()-started;
   if(query)gl.endQuery(ext.TIME_ELAPSED_EXT);
   if(backend?.isWebGPUBackend)await backend.device.queue.onSubmittedWorkDone();else {gl.finish();if(readback){const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel)}};
   const completedMs=performance.now()-started;let gpuMs=null;
   if(backend?.trackTimestamp)gpuMs=await e.renderer.resolveTimestampsAsync();
   else if(query){for(let i=0;i<100&&!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE);i++)await new Promise(r=>setTimeout(r,1));if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(ext.GPU_DISJOINT_EXT))gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(query)}
   if(s.sceneRenders===0){s.busy=false;return;}
   if(s.active)s.samples.push({completedMs,submitMs,cpuMs:s.cpu,renderMs:s.render,sceneRenders:s.sceneRenders,gpuMs:Number.isFinite(gpuMs)&&gpuMs>0?gpuMs:null});
   s.warm++;const signature=[e.renderer.info.memory.geometries,e.renderer.info.memory.programs??e.renderer.info.programs?.length].join('/');s.stable=signature===s.signature?s.stable+1:0;s.signature=signature;s.busy=false;
  });
 },{readback});
 for(const [shot,pos,position,yaw,pitch] of (readback?cases.filter(x=>x[0]==='pond'):cases)){
  await p.evaluate(()=>window.__WG_PERF__.hold=true);await p.waitForFunction(()=>!window.__WG_PERF__.busy,null,{timeout:120000});const start=Date.now();
  await p.evaluate(({pos,position,yaw,pitch})=>{const g=window.__GAME__,s=window.__WG_PERF__;s.active=false;s.pose=null;g.player.teleport(new g.THREE.Vector3(...pos),yaw);g.player.state.pitch=pitch;for(let i=0;i<240;i++)g.player.update(1/60);s.pose={position,yaw,pitch};g.player.update(0);g.world.update(0);s.warm=0;s.stable=0;s.hold=false},{pos,position,yaw,pitch});
  await p.waitForFunction(()=>window.__WG_PERF__.warm>=60&&window.__WG_PERF__.stable>=30,null,{timeout:120000});const warmupMs=Date.now()-start;if(errors.length)throw Error(errors[0].message);
  await p.evaluate(()=>{window.__WG_PERF__.samples=[];window.__WG_PERF__.active=true});await p.waitForFunction(n=>window.__WG_PERF__.samples.length>=n,sampleCount,{timeout:120000});
  const row=await p.evaluate(()=>{const g=window.__GAME__,s=window.__WG_PERF__;s.active=false;const summary=key=>{const a=s.samples.map(x=>x[key]).filter(x=>typeof x==='number'&&Number.isFinite(x)).sort((a,b)=>a-b);return{n:a.length,p50:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null}};return{backend:g.engine.backend??'webgl-legacy',statisticsVersion:g.engine.statisticsVersion??1,completedFrameMs:summary('completedMs'),cpuSubmissionMs:summary('submitMs'),cpuUpdateMs:summary('cpuMs'),cpuRenderMs:summary('renderMs'),gpuMs:summary('gpuMs'),sceneRenders:summary('sceneRenders'),gpuScope:s.gpuScope,worldBuildMs:g.world.buildDurationMs,boot:g.bootTimings??null,ratio:g.engine.renderer.getPixelRatio(),quality:g.engine.quality.name,frameStats:g.engine.postfx.frameStats,sceneStats:g.engine.postfx.sceneStats}});
  if(label!=='legacy'&&row.backend!==label)throw Error(`Expected ${label}, got ${row.backend}`);if(row.gpuMs.n>0&&row.gpuMs.n<sampleCount)throw Error('Insufficient GPU samples for p95');rows.push({label,shot,camera:{position,yaw,pitch},readyWallMs,warmupMs,...row});console.log(JSON.stringify(rows.at(-1)));
 }
 await p.close();
}}finally{writeFileSync(`${out}/manifest.json`,JSON.stringify({conditions:{device,browser:b.version(),builds,viewport:[1600,900],pixelRatio:1,quality:'high',dof:'legacy 220/1 on all renderers',windTime:10,adaptiveResolution:false,frameCap:'disabled in benchmark only',sampleCount,readback,nominalInFlightFrames:1,interpretation:'API barriers and GPU timer scopes are not verified equivalent to physical completion or presentation; do not derive comparative FPS',completion:'WebGPU queue.onSubmittedWorkDone / WebGL gl.finish (plus 1-pixel readPixels in --readback mode); diagnostic render completion latency, not display presentation FPS',gpuTiming:'API-specific intervals; scope recorded per row'},rows,errors},null,2));await b.close()}
if(errors.length)process.exitCode=1;
