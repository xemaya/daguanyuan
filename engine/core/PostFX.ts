import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalViewGeometry, frontFacing, negateOnBackSide, vec4, vec3, vec2, mix, convertToTexture, uniform, Fn, float, If, uv, smoothstep, screenSize, exp, cos, sin, pow, clamp, dot, normalize, max, texture } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import type Node from 'three/src/nodes/core/Node.js';
import { gradeNode, encodeOutputNode } from '../render/nodes/grade';
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

/**
 * SkyHook — the atmosphere system's slot in the post chain (单子 W).
 *
 * Two effects share one world-position reconstruction:
 *
 *  W1 cloud shadows — a baked low-frequency occlusion map (Clouds.ts) sampled
 *    in world XZ, counter-rotated by the cloud shell's yaw so shade patches
 *    stay glued to their clouds. Multiplicative, capped low: a slow change in
 *    daylight, never a cast shadow.
 *  W2 aerial perspective — FogExp2 already mixed flat `fog.color` into the
 *    scene per material. Adding `(directionalSky - fogColor) * fogFactor`
 *    *replaces* that flat colour with the sky gradient evaluated along the
 *    view ray, exactly: mix(scene, fog, f) + (dir − fog)·f ≡ mix(scene, dir, f).
 *    The P-17 fog numbers (density, fog.color) stay untouched; only the
 *    colour the fog fades *toward* becomes direction-aware.
 *
 * Both gate on real geometry depth so the sky dome and the clouds themselves
 * (no depth write) are never tinted by their own shadow.
 */
export interface SkyHook {
  /** R = occlusion 0..1 over a world XZ square centred on the origin. */
  shadowTex: THREE.Texture;
  /** Half-size (m) of that square. */
  shadowExtent: number;
  /** Peak darkening under a cloud core. */
  shadowStrength: number;
  /** Cloud shell yaw rate (rad/s); must equal Clouds.CLOUD_DRIFT_RATE. */
  shadowRate: number;
  /** Shared environment clock; drives the shadow map's counter-rotation. */
  windTime: { value: number };
  /** 0 keeps the flat P-17 fog colour; 1 fades fully toward the directional sky. */
  aerialStrength: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  haze: THREE.Color;
  sunColor: THREE.Color;
  /** Direction from the origin *toward* the sun. */
  sunDir: THREE.Vector3;
  skyIntensity: number;
}

export class PostFX {
  readonly composer: THREE.RenderPipeline;
  readonly sceneStats = { calls: 0, triangles: 0 };
  readonly frameStats = { calls: 0, triangles: 0 };
  activeEffects: string[] = [];
  private views: Record<string, Node<'vec4'>> = {};
  private beauty!: Node<'vec4'>;
  private scenePass!: ReturnType<typeof pass>;
  private engine: Engine;
  private time = uniform(0);
  private resources: {dispose(): void}[] = [];
  private skyHook: SkyHook | null = null;
  /** ?skyfx=off builds the pre-W graph exactly, for same-server A/B captures. */
  private skyFxOn = new URLSearchParams(location.search).get('skyfx') !== 'off';
  // 单子 AN1 — read-only review switches, same style as ?dof=. Each is `null`
  // unless the URL explicitly asks for it, so the compiled default (q.ssao /
  // gtao.scale.value 1.15 / settings.grain 0.016) never moves on its own.
  /** ?ao=off|on forces GTAO regardless of the quality tier's `ssao` flag. */
  private aoOverride = ((v: string | null) => v === 'off' ? false : v === 'on' ? true : null)(new URLSearchParams(location.search).get('ao'));
  /** ?aoscale=<x> replaces the GTAO node's fixed `scale.value` (default 1.15). */
  private aoScaleOverride = ((v: string | null) => { const n = v !== null ? Number(v) : NaN; return Number.isFinite(n) ? n : null; })(new URLSearchParams(location.search).get('aoscale'));
  /** ?aoradius=<m> replaces the GTAO node's sample radius (default 2.4 m). 验收 AN1 定档时加,同 aoscale 一样只读。 */
  private aoRadiusOverride = ((v: string | null) => { const n = v !== null ? Number(v) : NaN; return Number.isFinite(n) && n > 0 ? n : null; })(new URLSearchParams(location.search).get('aoradius'));
  private fogCells = { density: { value: 0 }, color: { value: new THREE.Vector3(1, 1, 1) } };
  // Camera state frozen into cells every frame: live camera accessor nodes
  // (cameraWorldMatrix & co.) follow whichever camera the renderer is
  // currently drawing with — inside a composer quad pass that is the quad's
  // own camera, not the scene camera, so the world-ray reconstruction must
  // not read them.
  private camCells = {
    pos: { value: new THREE.Vector3() },
    world: { value: new THREE.Matrix4() },
    projInv: { value: new THREE.Matrix4() },
  };
  settings: GradeSettings = {
    exposure: 1.0,
    contrast: 1.06,
    saturation: 1.14,
    liftShadow: new THREE.Color(0.018, 0.032, 0.066),
    gainHighlight: new THREE.Color(1.035, 1.005, 0.955),
    vignette: 0.32,
    // 2026-09-15 D-26:0.016 → 0.008。颗粒加在线性域、sRGB 之前,gamma 把暗部放大;
    // 实测三镜暗部高频 σ 降约 1.1~1.3 色阶,肉眼几乎不觉。全关不取——它是 look 的一部分(D-02)。
    grain: 0.008,
    // Cut from 0.0014. At the old strength the fringing was plainly visible as
    // magenta and cyan doubled edges on high-contrast boundaries — roof eaves
    // against sky, leaves against sky — which reads as a rendering fault rather
    // than as a lens. Aberration should be findable only if you look for it.
    chromatic: 0.0005,
    // First-person comfort: far-only blur begins at 180 m instead of 99 m.
    // ?dof=legacy restores 220/1 for review; ?dof=off removes DOF from graph;
    // ?dof=<far>[,<strength>] pins explicit values (comparison captures).
    dofFar: 400,
    dofStrength: 0.35,
  };  constructor(engine: Engine) {
    this.engine=engine;
    this.composer=new THREE.RenderPipeline(engine.renderer);
    // The grade node owns the original fitted ACES and sRGB transfer, exactly once.
    engine.renderer.toneMapping=THREE.NoToneMapping;
    this.composer.outputColorTransform=false;
    const dofMode=new URLSearchParams(location.search).get('dof');
    if(dofMode==='legacy'){this.settings.dofFar=220;this.settings.dofStrength=1;}
    else if(dofMode==='off')this.settings.dofStrength=0;
    // ?dof=<far>[,<strength>] pins explicit values for comparison captures.
    else if(dofMode){const[far,strength]=dofMode.split(',').map(Number);if(far>0)this.settings.dofFar=far;if(strength>0)this.settings.dofStrength=strength;}
    // ?grain=<0..0.03> pins the grade node's grain uniform for comparison captures (单子 AN1).
    const grainMode=new URLSearchParams(location.search).get('grain');
    if(grainMode!==null){const g=Number(grainMode);if(Number.isFinite(g))this.settings.grain=Math.min(0.03,Math.max(0,g));}
    this.applyQuality(engine.quality);
  }
  applyQuality(q: QualityTier): void {
    for(const node of this.resources)node.dispose();
    this.resources=[];
    const scenePass=this.scenePass=pass(this.engine.scene,this.engine.camera,{samples:q.msaaSamples>0?4:0});
    this.resources.push(scenePass);
    // ?ao=off|on overrides the tier's ssao flag; null (no param) leaves q.ssao untouched.
    const ssaoOn=this.aoOverride??q.ssao;
    const aoNormal=Fn((builder: NodeBuilder)=>(builder as NodeBuilder & {isFlatShading(): boolean}).isFlatShading()?normalViewGeometry:negateOnBackSide(normalViewGeometry))();
    // The old FrontSide normal override did not shade DoubleSide back faces.
    // Keep their actual depth for DOF/occlusion, but do not turn thin leaf backs black.
    const opaqueCoverage=Fn((builder: NodeBuilder)=>builder.material.side===THREE.DoubleSide?float(frontFacing):float(1))();
    const targets=mrt(ssaoOn||q.dof ? {output,normal:vec4(aoNormal,1),aoMask:vec4(vec3(opaqueCoverage),1)} : {output});
    if(ssaoOn||q.dof){
      targets.setBlendMode('normal',new THREE.BlendMode(THREE.MaterialBlending));
      targets.setBlendMode('aoMask',new THREE.BlendMode(THREE.MaterialBlending));
    }
    scenePass.setMRT(targets);
    const original=scenePass.updateBefore.bind(scenePass);
    scenePass.updateBefore=(frame)=>{
      const info=this.engine.renderer.info.render;
      const calls=info.drawCalls,tris=info.triangles;
      const result=original(frame);
      this.sceneStats.calls=info.drawCalls-calls;
      this.sceneStats.triangles=info.triangles-tris;
      return result;
    };
    const color=scenePass.getTextureNode('output');
    const viewDistance=scenePass.getViewZNode().negate();
    this.views={color,depth:vec4(vec3(viewDistance.div(600)),1)};
    if(ssaoOn||q.dof){
      this.views.normal=vec4(scenePass.getTextureNode('normal').xyz.mul(0.5).add(0.5),1);
      this.views.aoMask=vec4(vec3(scenePass.getTextureNode('aoMask').r),1);
    }
    let hdr: Node<'vec4'>=color;
    this.activeEffects=['scene'];
    if(ssaoOn){
      const gtao=ao(scenePass.getTextureNode('depth'),scenePass.getTextureNode('normal'),this.engine.camera);
      // 2026-09-15 D-26:radius 2.4 → 1.0、scale 1.15 → 0.7。2.4 m 对檐下 5 cm 级的分件太粗,整片檐下压成一团;
      // 实测(HEAD 同机位)cu_gate_eave 均亮 68.9 → 72.0、暗部占比 59% → 57%;r0.6 与 r1.0 无可测差别,取 1.0。
      gtao.resolutionScale=0.5;gtao.radius.value=this.aoRadiusOverride??1.0;gtao.thickness.value=1.4;
      gtao.distanceExponent.value=1.2;gtao.distanceFallOff.value=1;gtao.scale.value=this.aoScaleOverride??0.7;
      this.resources.push(gtao);this.activeEffects.push('ao');
      const smoothAO=denoise(gtao.getTextureNode(),scenePass.getTextureNode('depth'),scenePass.getTextureNode('normal'),this.engine.camera);
      smoothAO.lumaPhi.value=10;smoothAO.depthPhi.value=2;smoothAO.normalPhi.value=3;
      // Old PD radius 8 ran at half resolution; this node resolves at full resolution.
      smoothAO.radius.value=16;
      this.resources.push(smoothAO);
      hdr=hdr.mul(vec4(vec3(mix(1,(smoothAO as unknown as Node<'vec4'>).r,scenePass.getTextureNode('aoMask').r.mul(0.9))),1));
    }
    const hook=this.skyHook;
    if(hook&&this.skyFxOn){
      // Live cells: fog is owned by Atmosphere and set after this graph is built.
      const fogDensity=uniform(0).onFrameUpdate(()=>this.fogCells.density.value);
      const fogColor=uniform(this.fogCells.color.value).onFrameUpdate(()=>this.fogCells.color.value);
      const wind=uniform(0).onFrameUpdate(()=>hook.windTime.value);
      // Static palette, bound once as vec3 uniforms so TSL nodes (not THREE
      // objects) carry the math.
      const asVec3=(c: THREE.Color)=>uniform(new THREE.Vector3(c.r,c.g,c.b));
      const zenithU=asVec3(hook.zenith);
      const horizonU=asVec3(hook.horizon);
      const hazeU=asVec3(hook.haze);
      const sunColorU=asVec3(hook.sunColor);
      const sunDirU=uniform(hook.sunDir);
      const camPosU=uniform(this.camCells.pos.value).onFrameUpdate(()=>this.camCells.pos.value);
      const camWorldU=uniform(this.camCells.world.value).onFrameUpdate(()=>this.camCells.world.value);
      const projInvU=uniform(this.camCells.projInv.value).onFrameUpdate(()=>this.camCells.projInv.value);
      const adjust=Fn(([colIn]:[Node<'vec3'>])=>{
        // World position from depth: unproject a far-plane ray, scale by radial distance.
        const clip=vec4(uv().mul(2).sub(1),1,1);
        const v4=projInvU.mul(clip);
        const vDir=v4.xyz.div(v4.w).normalize();
        const radial=viewDistance.div(vDir.z.negate().max(0.0001));
        const worldDir=camWorldU.mul(vec4(vDir,0)).xyz;
        const worldPos=camPosU.add(worldDir.mul(radial));
        // Sky dome and cloud billboards write no depth; only shade real geometry.
        const sceneGate=smoothstep(585,598,viewDistance).oneMinus();

        // ---- W2 aerial perspective ----------------------------------------
        // Same FogExp2 factor the materials used; see SkyHook for why adding
        // (dir − fogColor)·f is an exact swap of the flat fog colour.
        const fogF=exp(fogDensity.mul(fogDensity).mul(radial).mul(radial).negate()).oneMinus();
        const up=clamp(worldDir.y,0,1);
        const aer=mix(zenithU,horizonU,pow(up.oneMinus(),3.9)).toVar();
        aer.assign(mix(aer,hazeU,pow(up.oneMinus(),19).mul(0.28)));
        // Sun-azimuth warming, same term as nodes/sky.ts.
        const az=max(dot(normalize(worldDir.xz.add(1e-5)),normalize(sunDirU.xz.add(1e-5))),0);
        aer.addAssign(sunColorU.mul(pow(az,2.6).mul(0.085).mul(pow(up.oneMinus(),1.6))));
        aer.mulAssign(hook.skyIntensity*0.68);
        const delta=aer.sub(fogColor).mul(fogF).mul(hook.aerialStrength).mul(sceneGate);

        // ---- W1 cloud shadow ----------------------------------------------
        // Counter-rotate world XZ by the shell yaw so patches track the clouds.
        const th=wind.mul(hook.shadowRate);
        const cth=cos(th),sth=sin(th);
        const rx=worldPos.x.mul(cth).sub(worldPos.z.mul(sth));
        const rz=worldPos.x.mul(sth).add(worldPos.z.mul(cth));
        const occ=texture(hook.shadowTex,vec2(rx,rz).div(hook.shadowExtent*2).add(0.5)).r;
        // Fogged distance already carries the light loss; taper the shadow
        // there instead of darkening the haze twice.
        const occEff=occ.mul(fogF.oneMinus().mul(0.75).add(0.25));
        const shadowMul=occEff.mul(hook.shadowStrength).mul(sceneGate).oneMinus();

        return colIn.mul(shadowMul).add(delta);
      })(hdr.rgb);
      hdr=vec4(adjust,hdr.a);
      this.activeEffects.push('skyfx');
    }
    if(q.bloom){
      const lit=convertToTexture(hdr);if(lit!==color)this.resources.push(lit);hdr=lit;
      const glow=bloom(lit,0.24,0.85,1.35);this.resources.push(glow);
      hdr=hdr.add(glow);this.activeEffects.push('bloom');
    }
    this.views.hdr=hdr;
    const source=convertToTexture(hdr);
    if(source!==color)this.resources.push(source);
    const far=uniform(this.settings.dofFar).onFrameUpdate(()=>this.settings.dofFar);
    const strength=uniform(this.settings.dofStrength).onFrameUpdate(()=>this.settings.dofStrength);
    const chromatic=uniform(this.settings.chromatic).onFrameUpdate(()=>this.settings.chromatic);
    if(q.dof&&this.settings.dofStrength>0)this.activeEffects.push('dof');
    const useDof=q.dof&&this.settings.dofStrength>0;
    const lens=Fn(()=>{
      const coord=uv();
      const col=source.sample(coord).rgb.toVar();
      if(useDof){
        const coc=smoothstep(far.mul(0.45),far,viewDistance).mul(strength);
        If(coc.greaterThan(0.01),()=>{
          const sum=vec3(0).toVar(), total=float(0).toVar();
          for(let i=0;i<12;i++){
            const angle=i*2.39996323;
            const offset=vec2(Math.cos(angle),Math.sin(angle)).mul(Math.sqrt(i/12)).mul(coc).mul(0.012).mul(vec2(screenSize.y.div(screenSize.x),1));
            const sample=source.sample(coord.add(offset)).rgb;
            const weight=sample.dot(vec3(0.2126,0.7152,0.0722)).mul(0.6).add(1);
            sum.addAssign(sample.mul(weight));total.addAssign(weight);
          }
          col.assign(sum.div(total.max(0.0001)));
        });
      }
      const centered=coord.sub(0.5);
      const shift=centered.add(0.000001).normalize().mul(chromatic).mul(centered.dot(centered)).mul(4);
      col.r.assign(mix(col.r,source.sample(coord.sub(shift)).r,0.85));
      col.b.assign(mix(col.b,source.sample(coord.add(shift)).b,0.85));
      return col;
    })();
    this.views.lens=vec4(lens,1);
    const graded=gradeNode(lens,this.settings,this.time);
    this.views.grade=graded;
    if(q.msaaSamples<4){const aa=smaa(graded);this.resources.push(aa);this.composer.outputNode=encodeOutputNode(aa as unknown as Node<'vec4'>);this.activeEffects.push('smaa');}
    else this.composer.outputNode=encodeOutputNode(graded);
    this.beauty=this.composer.outputNode as Node<'vec4'>;
    this.activeEffects.push('grade');
    this.composer.needsUpdate=true;
  }
  async compileAsync(): Promise<void> { await this.scenePass.compileAsync(this.engine.renderer); }
  /** Installs the atmosphere hook and rebuilds the graph once (pre-first-render). */
  setSkyHook(hook: SkyHook): void { this.skyHook=hook; this.applyQuality(this.engine.quality); }
  inspectBuffer(name: string | null): void {
    this.composer.outputNode=name ? this.views[name]??this.beauty : this.beauty;
    this.composer.needsUpdate=true;
  }
  syncSettings(): void {}
  setSize(_w:number,_h:number): void {} // Pass nodes derive physical size from renderer on every frame.
  render(dt:number): void {
    this.time.value=this.engine.fixedTime??(this.time.value+dt);
    const fog=this.engine.scene.fog as THREE.FogExp2 | null;
    if(fog){this.fogCells.density.value=fog.density;this.fogCells.color.value.set(fog.color.r,fog.color.g,fog.color.b);}
    const cam=this.engine.camera;
    cam.updateMatrixWorld();
    this.camCells.pos.value.setFromMatrixPosition(cam.matrixWorld);
    this.camCells.world.value.copy(cam.matrixWorld);
    this.camCells.projInv.value.copy(cam.projectionMatrixInverse);
    const info=this.engine.renderer.info;info.autoReset=false;info.reset();
    this.composer.render();
    this.frameStats.calls=info.render.drawCalls;this.frameStats.triangles=info.render.triangles;
  }
  dispose(): void {this.composer.dispose();for(const node of this.resources)node.dispose();}
}
