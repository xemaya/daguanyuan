import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import type { Engine, QualityTier } from './Engine';
export interface GradeSettings {
  exposure: number;
  contrast: number;
  saturation: number;
  /** Warm/cool push on highlights and shadows respectively. */
  liftShadow: THREE.Color;
  gainHighlight: THREE.Color;
  vignette: number;
  grain: number;
  chromatic: number;
  /** Distance in metres where the far blur reaches full strength. */
  dofFar: number;
  dofStrength: number;
}

export class PostFX {
  readonly composer: THREE.RenderPipeline;
  readonly sceneStats = { calls: 0, triangles: 0 };
  readonly frameStats = { calls: 0, triangles: 0 };
  private engine: Engine;
  settings: GradeSettings = {
    exposure: 1.0,
    contrast: 1.06,
    saturation: 1.14,
    liftShadow: new THREE.Color(0.018, 0.032, 0.066),
    gainHighlight: new THREE.Color(1.035, 1.005, 0.955),
    vignette: 0.32,
    grain: 0.016,
    // Cut from 0.0014. At the old strength the fringing was plainly visible as
    // magenta and cyan doubled edges on high-contrast boundaries — roof eaves
    // against sky, leaves against sky — which reads as a rendering fault rather
    // than as a lens. Aberration should be findable only if you look for it.
    chromatic: 0.0005,
    // 58 m 是按老园子(64×72 m,最远视距约 80 m)调的:那时它的意思是"最远那一点点
    // 发虚"。世界切到 280×226 m 之后视距 200–300 m,smoothstep(26, 58, d) 让
    // **整个远景都落在满档虚化**里,而 12 个采样点的螺旋核在满半径下会散成一片,
    // 亮处还因 luma 加权糊出色边——用户 2026-09-11 报的"远处模糊很诡异、很散、
    // 有奇怪的色边"就是它。PQ-0 修雾把远景从白墙里放出来之后,这个毛病才露出来。
    //
    // 220 m 把满档推到园墙那一档,恢复"只有最远一线发虚"的原意。
    // 这是第三处"按 64 米园子调的米制参数没跟着世界变大"(前两处是雾密度与 AO 半径),
    // 见 PITFALLS P-17。
    dofFar: 220,
    dofStrength: 1.0,
  };
  constructor(engine: Engine) {
    this.engine = engine;
    this.composer = new THREE.RenderPipeline(engine.renderer, pass(engine.scene,engine.camera));
  }
  applyQuality(_q: QualityTier): void {}
  syncSettings(): void {}
  setSize(_w: number,_h: number): void {}
  render(_dt: number): void {
    const info = this.engine.renderer.info;
    info.autoReset = false;
    info.reset();
    this.composer.render();
    this.frameStats.calls = info.render.drawCalls;
    this.frameStats.triangles = info.render.triangles;
    Object.assign(this.sceneStats,this.frameStats);
  }
  dispose(): void { this.composer.dispose(); }
}
