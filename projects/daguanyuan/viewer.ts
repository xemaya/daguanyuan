import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildPart, partNames } from '@builder/parts/registry';
import '@builder/parts/index';
import './construction';

/**
 * 构件棚拍台。
 *
 * 中性三点光 + 灰底,把构件从园子的调色和杂物里拎出来单看,建模和材质的毛病
 * 在这里藏不住。所有构件先过棚拍再进园。
 *
 * Query:
 *   ?subject=<registry name>[:variant]      (default: 第一个登记的构件)
 *   ?angle=front|three_quarter|side|back|top|low   (default: three_quarter)
 *   ?bg=studio|dark|white                   (default: studio)
 */

const params = new URLSearchParams(location.search);
const selection = params.get('subject') ?? partNames()[0] ?? 'probe';
const separator = selection.indexOf(':');
const subject = separator < 0 ? selection : selection.slice(0, separator);
const variant = separator < 0 ? 'default' : selection.slice(separator + 1);
const angleName = params.get('angle') ?? 'three_quarter';
const bg = params.get('bg') ?? 'studio';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = { studio: 0x2a3038, dark: 0x0d0f12, white: 0xe8e4dd }[bg] ?? 0x2a3038;
scene.background = new THREE.Color(BG);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.85;

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 500);

const key = new THREE.DirectionalLight(0xfff2dd, 3.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0008;
key.shadow.normalBias = 0.012;
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd4f0, 0.85);
scene.add(fill);
const rimLight = new THREE.DirectionalLight(0xffe9c8, 2.1);
scene.add(rimLight);
scene.add(new THREE.HemisphereLight(0x9fc4e8, 0x4a4238, 0.5));

/* ---- Subject ---------------------------------------------------------- */
const root = new THREE.Group();
scene.add(root);
const part = buildPart(subject, variant);
if (!part) {
  container.innerHTML = `<pre style="color:#f88;padding:24px">未登记的构件: ${subject}\n可用: ${partNames().join(', ')}</pre>`;
  throw new Error(`unknown part ${subject}`);
}
root.add(part.root);

const box = new THREE.Box3().setFromObject(root);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
const extent = Math.max(size.x, size.y, size.z) || 1;

/* ---- Ground scaled to the subject ------------------------------------ */
const groundR = part.groundRadius ?? extent * 1.6;
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(groundR, 64),
  new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.92, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(center.x, box.min.y - 0.002, center.z);
ground.receiveShadow = true;
scene.add(ground);

/* ---- Lights scaled to the subject ------------------------------------ */
const L = extent;
key.position.set(center.x - 1.4 * L, center.y + 2.2 * L, center.z + 1.9 * L);
key.target.position.copy(center);
scene.add(key.target);
const sc = key.shadow.camera;
sc.near = 0.1 * L;
sc.far = 8 * L;
sc.left = -1.2 * L;
sc.right = 1.2 * L;
sc.top = 1.2 * L;
sc.bottom = -1.2 * L;
sc.updateProjectionMatrix();
fill.position.set(center.x + 2.2 * L, center.y + 0.7 * L, center.z + 1.2 * L);
rimLight.position.set(center.x + 0.6 * L, center.y + 1.1 * L, center.z - 2.4 * L);

/* ---- Camera framing -------------------------------------------------- */
const ANGLES: Record<string, [number, number]> = {
  front: [0, 0.12],
  three_quarter: [0.62, 0.2],
  side: [Math.PI / 2, 0.12],
  back: [Math.PI, 0.18],
  top: [0.6, 0.85],
  low: [0.5, -0.02],
};

function frameFrom(a: number, e: number): void {
  const b = new THREE.Box3().setFromObject(root);
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  // 半对角线做半径,再留 35% 边:构件是米级的箱体,比角色更容易顶到画框。
  const radius = s.length() * 0.5 || 1;
  const dist = (radius * 1.35) / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(
    c.x + Math.sin(a) * Math.cos(e) * dist,
    c.y + Math.sin(e) * dist + s.y * 0.06,
    c.z + Math.cos(a) * Math.cos(e) * dist,
  );
  camera.lookAt(c);
  camera.updateProjectionMatrix();
}
const [az, el] = ANGLES[angleName] ?? ANGLES.three_quarter;
frameFrom(az, el);

/* ---- Post ------------------------------------------------------------ */
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass());

const clock = new THREE.Clock();
let spin = false;
const stats = { triangles: 0, calls: 0 };

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const t = clock.elapsedTime;
  part.update?.(dt, t);
  if (spin) root.rotation.y = t * 0.4;
  renderer.info.reset();
  renderer.info.autoReset = false;
  composer.render();
  stats.triangles = renderer.info.render.triangles;
  stats.calls = renderer.info.render.calls;
  renderer.info.autoReset = true;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  frameFrom(az, el);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') spin = !spin;
});

Object.assign(window, {
  __VIEWER__: {
    scene, camera, renderer, root, part, THREE,
    setAngle(a: string) { const v = ANGLES[a]; if (v) frameFrom(v[0], v[1]); },
    triangles: () => stats.triangles,
    drawCalls: () => stats.calls,
    extent: () => extent,
    size: () => [size.x, size.y, size.z],
  },
});
window.dispatchEvent(new CustomEvent('viewer:ready'));
requestAnimationFrame(() =>
  console.info(`[viewer] ${subject}:${variant} ${angleName} — ${(stats.triangles / 1000).toFixed(1)}k tris, ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}m`),
);
