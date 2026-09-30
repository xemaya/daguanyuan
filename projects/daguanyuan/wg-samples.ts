import * as THREE from 'three/webgpu';
import { Engine } from '@engine/core/Engine';
import { World } from '@builder/compose/world';
import { buildAtmosphere } from '@engine/render/Atmosphere';
import { buildTerrain } from '@builder/compose/terrain';
import { buildWater } from '@engine/render/Water';
import { createFoliageMaterial, setFlex, leafMaps, applyCanopyShadow } from '@builder/parts/zhiwu/foliage-materials';

/** Isolated material compiler/review scenes. Never runs the garden build steps
 * beyond the requested material group. Access through viewer.html?sample=... . */
export async function runSample(container: HTMLElement, sample: string): Promise<void> {
  const engine = new Engine(container);
  await engine.init();
  engine.adaptiveResolution = false;
  engine.renderer.setPixelRatio(1);
  engine.fixedTime = 10;
  engine.initPost();
  const world = new World(engine);
  const start = performance.now();
  engine.camera.position.set(-3.5, 2, 157.4);
  engine.camera.lookAt(-4, 1, 145);
  buildAtmosphere(world.ctx);
  if (sample === 'terrain' || sample === 'water') buildTerrain(world.ctx);
  if (sample === 'water') buildWater(world.ctx);
  if (sample === 'foliage') {
    engine.camera.position.set(0,2,8); engine.camera.lookAt(0,1.5,0);
    const maps = leafMaps('warm',0x4e8c3c,0xaadd6c,128);
    const mat = createFoliageMaterial(world.ctx.env,{color:0xffffff,map:maps.map,normalMap:maps.normalMap,triplanar:0.55,windScale:1});
    applyCanopyShadow(mat);
    const geo=setFlex(new THREE.SphereGeometry(1.5,32,24),(_x,y)=>[Math.max(0,(y+1.5)/3),0.8]);
    geo.setAttribute('aWind',new THREE.InstancedBufferAttribute(new Float32Array([0,1]),2));
    const tree=new THREE.InstancedMesh(geo,mat,1);tree.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,2,0));tree.castShadow=true;tree.receiveShadow=true;world.root.add(tree);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(15,15),new THREE.MeshStandardNodeMaterial({color:0x888888}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;world.root.add(floor);
  }
  engine.add({name:'sample',update:(dt,t)=>{ if(engine.fixedTime!==null)world.ctx.env.windTime.value=engine.fixedTime-dt; world.update(dt,t); }});
  world.update(0,10);
  await engine.renderer.compileAsync(engine.scene,engine.camera);
  engine.postfx.render(0);
  engine.start();
  Object.assign(window,{__WG_SAMPLE__:{engine,world,sample,buildMs:performance.now()-start}});
}
