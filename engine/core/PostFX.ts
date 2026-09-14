import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalViewGeometry, frontFacing, negateOnBackSide, vec4, vec3, vec2, mix, convertToTexture, uniform, Fn, float, If, uv, smoothstep, screenSize } from 'three/tsl';
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
    this.applyQuality(engine.quality);
  }
  applyQuality(q: QualityTier): void {
    for(const node of this.resources)node.dispose();
    this.resources=[];
    const scenePass=this.scenePass=pass(this.engine.scene,this.engine.camera,{samples:q.msaaSamples>0?4:0});
    this.resources.push(scenePass);
    const aoNormal=Fn((builder: NodeBuilder)=>(builder as NodeBuilder & {isFlatShading(): boolean}).isFlatShading()?normalViewGeometry:negateOnBackSide(normalViewGeometry))();
    // The old FrontSide normal override did not shade DoubleSide back faces.
    // Keep their actual depth for DOF/occlusion, but do not turn thin leaf backs black.
    const opaqueCoverage=Fn((builder: NodeBuilder)=>builder.material.side===THREE.DoubleSide?float(frontFacing):float(1))();
    const targets=mrt(q.ssao||q.dof ? {output,normal:vec4(aoNormal,1),aoMask:vec4(vec3(opaqueCoverage),1)} : {output});
    if(q.ssao||q.dof){
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
    this.views={color,depth:vec4(vec3(scenePass.getViewZNode().negate().div(600)),1)};
    if(q.ssao||q.dof){
      this.views.normal=vec4(scenePass.getTextureNode('normal').xyz.mul(0.5).add(0.5),1);
      this.views.aoMask=vec4(vec3(scenePass.getTextureNode('aoMask').r),1);
    }
    let hdr: Node<'vec4'>=color;
    this.activeEffects=['scene'];
    if(q.ssao){
      const gtao=ao(scenePass.getTextureNode('depth'),scenePass.getTextureNode('normal'),this.engine.camera);
      gtao.resolutionScale=0.5;gtao.radius.value=2.4;gtao.thickness.value=1.4;
      gtao.distanceExponent.value=1.2;gtao.distanceFallOff.value=1;gtao.scale.value=1.15;
      this.resources.push(gtao);this.activeEffects.push('ao');
      const smoothAO=denoise(gtao.getTextureNode(),scenePass.getTextureNode('depth'),scenePass.getTextureNode('normal'),this.engine.camera);
      smoothAO.lumaPhi.value=10;smoothAO.depthPhi.value=2;smoothAO.normalPhi.value=3;
      // Old PD radius 8 ran at half resolution; this node resolves at full resolution.
      smoothAO.radius.value=16;
      this.resources.push(smoothAO);
      hdr=hdr.mul(vec4(vec3(mix(1,(smoothAO as unknown as Node<'vec4'>).r,scenePass.getTextureNode('aoMask').r.mul(0.9))),1));
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
    const viewDistance=scenePass.getViewZNode().negate();
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
  inspectBuffer(name: string | null): void {
    this.composer.outputNode=name ? this.views[name]??this.beauty : this.beauty;
    this.composer.needsUpdate=true;
  }
  syncSettings(): void {}
  setSize(_w:number,_h:number): void {} // Pass nodes derive physical size from renderer on every frame.
  render(dt:number): void {
    this.time.value=this.engine.fixedTime??(this.time.value+dt);
    const info=this.engine.renderer.info;info.autoReset=false;info.reset();
    this.composer.render();
    this.frameStats.calls=info.render.drawCalls;this.frameStats.triangles=info.render.triangles;
  }
  dispose(): void {this.composer.dispose();for(const node of this.resources)node.dispose();}
}
