import{stripTypeScriptTypes}from'node:module';
import{chromium}from'playwright';import{mkdirSync,writeFileSync,readFileSync}from'node:fs';
const out='shots/wg-shadows';mkdirSync(out,{recursive:true});const rows=[];
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});const p=await b.newPage({viewport:{width:1000,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
try{
 await p.goto('http://127.0.0.1:4801/viewer.html?sample=foliage&fixed=1');await p.waitForFunction(()=>window.__WG_SAMPLE__,null,{timeout:90000});
 const pose=await p.evaluate(()=>{const{engine:e,world:w}=window.__WG_SAMPLE__;e.running=false;e.renderer.setAnimationLoop(()=>e.postfx.render(0));const tree=w.root.children.find(o=>o.isInstancedMesh);window.__WG_TREE__=tree;
  e.camera.fov=26;e.camera.position.set(-4.3,3,8);e.camera.lookAt(-4.3,0,0);e.camera.updateProjectionMatrix();e.camera.updateMatrixWorld();tree.computeBoundingSphere();w.update(0,10);e.postfx.render(0);return{camera:e.camera.position.toArray(),sphere:tree.boundingSphere.center.toArray()}});rows.push({offscreenPose:pose});await p.waitForTimeout(300);
 const frameWith=await p.evaluate(()=>window.__WG_SAMPLE__.engine.renderer.info.frame);
 const withShadow=await p.screenshot({path:`${out}/offscreen-shadow.png`});
 // main-screen visibility is checked with the same initialized coordinate system.
 const minClipX=await p.evaluate(()=>{const e=window.__WG_SAMPLE__.engine,tree=window.__WG_TREE__;const Matrix=tree.matrixWorld.constructor;const m=new Matrix().fromArray(tree.instanceMatrix.array).premultiply(tree.matrixWorld).premultiply(e.camera.matrixWorldInverse).premultiply(e.camera.projectionMatrix).elements;const a=tree.geometry.attributes.position;let min=Infinity;for(let i=0;i<a.count;i++){const x=a.getX(i),y=a.getY(i),z=a.getZ(i);const cx=m[0]*x+m[4]*y+m[8]*z+m[12],cw=m[3]*x+m[7]*y+m[11]*z+m[15];min=Math.min(min,cx/cw)}return min});
 rows.push({casterOutsideMainFrustum:minClipX>1,minClipX});if(minClipX<=1)throw Error('Caster is still in main view');
 await p.evaluate(()=>{window.__WG_TREE__.castShadow=false;window.__WG_SAMPLE__.engine.postfx.render(0)});await p.waitForTimeout(300);const without=await p.screenshot({path:`${out}/offscreen-no-shadow.png`});
 const frameWithout=await p.evaluate(()=>window.__WG_SAMPLE__.engine.renderer.info.frame);if(frameWithout<=frameWith)throw Error('Offscreen test did not advance NodeFrame');
 if(withShadow){writeFileSync(`${out}/offscreen-shadow.png`,withShadow);rows.push({offscreenShadowChangesImage:!withShadow.equals(without),frameWith,frameWithout});if(withShadow.equals(without))throw Error('Offscreen caster has no visible shadow')}
 // A separate near view checks that both beauty and shadow change with wind.
 await p.evaluate(()=>{const{engine:e,world:w}=window.__WG_SAMPLE__;window.__WG_TREE__.castShadow=true;e.camera.fov=62;e.camera.position.set(0,2,8);e.camera.lookAt(0,1.5,0);e.camera.updateProjectionMatrix();e.postfx.settings.grain=0;e.postfx.applyQuality({...e.quality,ssao:false,dof:false});e.fixedTime=0;w.ctx.env.windTime.value=0;w.update(0,0);e.postfx.render(0)});await p.waitForTimeout(250);const wind0=await p.screenshot({path:`${out}/wind-0.png`});const shadow0=await p.screenshot({clip:{x:100,y:630,width:600,height:140}});
 await p.evaluate(()=>{const{engine:e,world:w}=window.__WG_SAMPLE__;e.fixedTime=4;w.ctx.env.windTime.value=4;w.update(0,4);e.postfx.render(0)});await p.waitForTimeout(250);const wind4=await p.screenshot({path:`${out}/wind-4.png`});const shadow4=await p.screenshot({clip:{x:100,y:630,width:600,height:140}});rows.push({windChangesImage:!wind0.equals(wind4),windChangesGroundShadow:!shadow0.equals(shadow4)});if(shadow0.equals(shadow4))throw Error('Wind ground shadow did not change');if(wind0.equals(wind4))throw Error('Wind produced identical image');
 await p.goto('http://127.0.0.1:4801/garden.html?fixed=1');await p.waitForFunction(()=>window.__GAME__,null,{timeout:180000});
 const stripped=stripTypeScriptTypes(readFileSync('engine/scatter/instancing.ts','utf8'));
 const classSource=stripped.slice(stripped.indexOf('export class InstanceCuller')).replace('export class','class');
 const prefix=await p.evaluate(async source=>{
  const g=window.__GAME__,e=g.engine,T=g.THREE;e.running=false;e.renderer.setAnimationLoop(()=>e.postfx.render(0));
  e.camera.position.set(0,2,8);e.camera.lookAt(0,1,0);e.camera.updateProjectionMatrix();e.camera.updateMatrixWorld();g.world.update(0,10);
  // Exercise the actual retained class without adding test-only exports to production bundles.
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const baselineTriangles=e.postfx.sceneStats.triangles,baselineFrame=e.renderer.info.frame;
  const Culler=Function('THREE',`return (${source})`)(T);
  const mesh=new T.InstancedMesh(new T.BoxGeometry(0.5,0.5,0.5),new T.MeshStandardMaterial({color:0x888888}),2);
  mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(0,1,0));mesh.setMatrixAt(1,new T.Matrix4().makeTranslation(0,1,14));mesh.castShadow=true;mesh.name='WG-prefix-fixture';e.scene.add(mesh);
  const culler=new Culler();culler.add([mesh],{});culler.update(e.camera);const visible=mesh.count;const events=[];
  const before=mesh.onBeforeShadow.bind(mesh),after=mesh.onAfterShadow.bind(mesh);let entry;
  mesh.onBeforeShadow=(...args)=>{entry={visible:mesh.count};before(...args);entry.shadow=mesh.count};
  mesh.onAfterShadow=(...args)=>{after(...args);entry.restored=mesh.count;events.push(entry)};
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return{visible,events,baselineFrame,renderedFrame:e.renderer.info.frame,submittedTriangleDelta:e.postfx.sceneStats.triangles-baselineTriangles,coordinateSystem:e.camera.coordinateSystem,rendererCoordinateSystem:e.renderer.coordinateSystem};
 },classSource);rows.push({prefixFixture:prefix,gardenCulling:'ClusteredInstancePool; retained InstanceCuller tested in an actual renderer fixture'});
 if(prefix.visible!==1||prefix.submittedTriangleDelta!==36||!prefix.events.length||prefix.events.some(e=>e.shadow!==2||e.restored!==1))throw Error('Shadow instance prefix restore failed');
 await p.evaluate(()=>{const e=window.__GAME__.engine;const m=e.scene.getObjectByName('WG-prefix-fixture');m.removeFromParent();m.geometry.dispose();m.material.dispose();e.start()});
 for(const [x,z,yaw] of [[-45,170,1.1],[-45,170,4.24],[-111.2,104,-0.62],[-80,128,2.5]]){await p.evaluate(([x,z,yaw])=>{const g=window.__GAME__;g.player.teleport(new g.THREE.Vector3(x,0,z),yaw)},[x,z,yaw]);await p.waitForTimeout(900)}
 rows.push({rapidTurnAndBoundaryCrossing:await p.evaluate(()=>({backend:window.__GAME__.engine.backend,stats:window.__GAME__.engine.scene.getObjectByName('Vegetation').userData.vegDebug.stats()}))});
 if(errors.length)throw Error(`${errors.length} errors`);
}finally{writeFileSync(`${out}/manifest.json`,JSON.stringify({rows,errors},null,2));await b.close()}
