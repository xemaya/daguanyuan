import { backendName, rendererOptions } from './renderer';
import * as THREE from 'three/webgpu';
import { PostFX } from './PostFX';
import { Input } from './Input';

/**
 * Engine — owns the renderer, the frame loop, and the render-quality budget.
 *
 * Systems register themselves via `add()` and receive `update(dt, elapsed)`
 * every frame in insertion order. Everything else in the game is a system.
 */

export interface System {
  readonly name: string;
  update?(dt: number, elapsed: number): void;
  dispose?(): void;
}

export interface QualityTier {
  name: 'low' | 'medium' | 'high' | 'ultra';
  pixelRatioCap: number;
  shadowMapSize: number;
  ssao: boolean;
  bloom: boolean;
  dof: boolean;
  msaaSamples: number;
}

export const QUALITY: Record<QualityTier['name'], QualityTier> = {
  low: { name: 'low', pixelRatioCap: 1, shadowMapSize: 1024, ssao: false, bloom: true, dof: false, msaaSamples: 0 },
  medium: { name: 'medium', pixelRatioCap: 1.25, shadowMapSize: 2048, ssao: true, bloom: true, dof: false, msaaSamples: 2 },
  high: { name: 'high', pixelRatioCap: 1.5, shadowMapSize: 4096, ssao: true, bloom: true, dof: true, msaaSamples: 4 },
  ultra: { name: 'ultra', pixelRatioCap: 2, shadowMapSize: 4096, ssao: true, bloom: true, dof: true, msaaSamples: 4 },
};

export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly clock = new THREE.Clock();
  readonly input: Input;
  readonly systems: System[] = [];

  postfx!: PostFX;
  quality: QualityTier = QUALITY.high;

  /** Set true once the world is built; gates the frame loop. */
  running = false;

  readonly statisticsVersion = 2;
  adaptiveResolution = !new URLSearchParams(location.search).has('fixed');
  fixedTime: number | null = new URLSearchParams(location.search).has('fixed') ? 10 : null;
  /**
   * 工具判据 = `navigator.webdriver`:所有 headless 工具(capture、playtest、visibility-probe、frustum-census、
   * tree-census、record……)都经 Playwright 启动,浏览器自己把它置真。与 `HUD` 判断「自动化 → 不挂开场卡」同一个判据。
   * 单子 BG2 的「闲着少画」也用它关掉。
   */
  readonly throttle = navigator.webdriver !== true;
  /**
   * 单子 BG1(D-43):帧率上限 60 → 30。用户「一打开这个网站,风扇就狂转」;游戏逻辑 0.2 ms/帧,
   * 渲染提交 4 ms/帧,一直满速画是风扇的主因。`?fps=60` 临时回 60(对比用)。
   * **工具下(`navigator.webdriver`)仍是 60**:playtest 按帧积分走路,上限一变脚下序列的采样就变,
   * 单子要求工具一个都不受影响;工具量性能看的是抬开上限的 frameCostMs(D-40)。
   */
  frameLimit = Number(new URLSearchParams(location.search).get('fps')) > 0
    ? Number(new URLSearchParams(location.search).get('fps')) : (this.throttle ? 30 : 60);
  readonly timings: { frameMs: number[]; cpuMs: number[] } = { frameMs: [], cpuMs: [] };
  private lastFrame = 0;
  private disposed = false;
  private container: HTMLElement;
  private accum = 0;
  private frames = 0;
  private fpsWindow = 0;
  private measuredFps = 60;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGPURenderer({
      ...rendererOptions(),
      antialias: false, // handled by the composer's multisampled target + SMAA
      powerPreference: 'high-performance',

    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Tone mapping deliberately stays OFF here. The composer runs in HDR so
    // bloom sees true over-range values; PostFX's grade pass owns the single
    // ACES conversion at the end of the chain. Tone mapping in both places
    // would crush the highlights twice.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.renderer.shadowMap.enabled = true;
    // The local shadow window exposes VSM moment acne on thin walls and also
    // renders every receiver into the map. PCF keeps contact shadows without
    // replaying the whole grass layer as casters (see the P1 environment review).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.06, 600);
    this.camera.position.set(0, 1.65, 0);
    this.scene.add(this.camera);

    this.input = new Input(this.renderer.domElement);

    window.addEventListener('resize', this.onResize);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.camera.coordinateSystem = this.renderer.coordinateSystem;
    this.camera.updateProjectionMatrix();
    if (!this.adaptiveResolution) this.renderer.setPixelRatio(1);
    const markDeviceLost = this.renderer.onDeviceLost.bind(this.renderer);
    this.renderer.onDeviceLost = (info) => {
      if (this.disposed) return;
      markDeviceLost(info);
      this.running = false;
      this.input.suspended = true;
      if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
      const recovery = document.createElement('button');
      recovery.textContent = '图形设备已重置，点击重新载入';
      Object.assign(recovery.style, {position:'fixed',zIndex:'10000',top:'50%',left:'50%',transform:'translate(-50%,-50%)',padding:'16px 24px',cursor:'pointer'});
      recovery.onclick = () => location.reload();
      this.container.appendChild(recovery);
      console.error('[renderer] device lost', info);
    };
  }

  get backend(): string { return backendName(this.renderer); }

  initPost(): void {
    this.postfx = new PostFX(this);
  }

  add<T extends System>(system: T): T {
    this.systems.push(system);
    return system;
  }

  get<T extends System>(name: string): T | undefined {
    return this.systems.find((s) => s.name === name) as T | undefined;
  }

  setQuality(tier: QualityTier['name']): void {
    this.quality = QUALITY[tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.postfx?.applyQuality(this.quality);
    this.onResize();
  }

  /** Rolling FPS used by the adaptive-resolution governor. */
  get fps(): number {
    return this.measuredFps;
  }

  start(): void {
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.frame);
  }

  private frame = (timestamp = performance.now()): void => {
    if (!this.running || document.hidden) { this.lastFrame = 0; return; }
    const interval = 1000 / this.frameLimit;
    if (this.lastFrame && timestamp - this.lastFrame < interval - 0.5) return;
    const frameMs = this.lastFrame ? timestamp - this.lastFrame : interval;
    this.lastFrame = timestamp;
    const cpuStart = performance.now();
    // Clamp dt so a background tab or a GC pause cannot teleport the player
    // through a collider on the frame it resumes.
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    const elapsed = this.fixedTime ?? this.clock.elapsedTime;

    this.fpsWindow += raw;
    this.frames++;
    if (this.fpsWindow >= 0.5) {
      this.measuredFps = this.frames / this.fpsWindow;
      this.frames = 0;
      this.fpsWindow = 0;
      this.governResolution();
    }

    for (const s of this.systems) s.update?.(dt, elapsed);

    this.timings.cpuMs.push(performance.now() - cpuStart);
    this.timings.frameMs.push(frameMs);
    if (this.timings.frameMs.length > 600) { this.timings.frameMs.shift(); this.timings.cpuMs.shift(); }
    this.input.endFrame();
    this.postfx.render(dt);
  };

  /**
   * Adaptive resolution. Keeps the frame time inside budget on weaker GPUs by
   * trimming the pixel ratio before touching any visual feature, so the art
   * direction survives even when the hardware does not.
   */
  private governResolution(): void {
    if (!this.adaptiveResolution) return;
    const cap = this.quality.pixelRatioCap;
    const current = this.renderer.getPixelRatio();
    const target = Math.min(window.devicePixelRatio, cap);
    // 阈值按上限折算(原来是 60 帧上限下的 45 / 58);上限 30 时就是 22.5 / 29——
    // 不折算的话 30 帧上限下 fps 永远 < 45,像素比会被一路降到 0.75。
    const low = this.frameLimit * 0.75, high = this.frameLimit * (58 / 60);
    if (this.measuredFps < low && current > 0.75) {
      this.renderer.setPixelRatio(Math.max(0.75, current - 0.15));
      this.postfx?.setSize(window.innerWidth, window.innerHeight);
    } else if (this.measuredFps > high && current < target) {
      this.renderer.setPixelRatio(Math.min(target, current + 0.1));
      this.postfx?.setSize(window.innerWidth, window.innerHeight);
    }
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx?.setSize(w, h);
  };

  dispose(): void {
    this.disposed = true;
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    for (const s of this.systems) s.dispose?.();
    this.postfx?.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
