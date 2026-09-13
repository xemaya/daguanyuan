import { Fn, vec3, vec4, mat3, uniform, uv, screenCoordinate, mix, smoothstep, max, pow, step, fract, acesFilmicToneMapping, float } from 'three/tsl';
import type { GradeSettings } from '../../core/PostFX';
import type Node from 'three/src/nodes/core/Node.js';

/** Original fitted ACES (no Three exposure /0.6), applied once before LDR grade. */
// Built-in TSL matrices use JS row order, unlike GLSL scalar matrix constructors.
// Exposure 0.6 cancels the built-in /0.6 pre-scale, matching the original fit.
const aces = (input: Node<'vec3'>) => acesFilmicToneMapping(input, float(0.6)) as Node<'vec3'>;
const hash = Fn(([p]: [Node<'vec2'>]) => {
  const v=fract(p.xyx.mul(0.1031)).toVar();
  v.addAssign(v.dot(v.yzx.add(33.33)));
  return fract(v.x.add(v.y).mul(v.z));
});
export function gradeNode(input: Node<'vec3'>, settings: GradeSettings, clock: Node<'float'>) {
  const exposure=uniform(settings.exposure).onFrameUpdate(()=>settings.exposure);
  const lift=uniform(settings.liftShadow).rgb;
  const gain=uniform(settings.gainHighlight).rgb;
  const contrast=uniform(settings.contrast).onFrameUpdate(()=>settings.contrast);
  const saturation=uniform(settings.saturation).onFrameUpdate(()=>settings.saturation);
  const vignette=uniform(settings.vignette).onFrameUpdate(()=>settings.vignette);
  const grain=uniform(settings.grain).onFrameUpdate(()=>settings.grain);
  return Fn(()=>{
    const col=aces(input.mul(exposure)).toVar();
    const luma=vec3(0.2126,0.7152,0.0722);
    const luminance=col.dot(luma).toVar();
    col.addAssign(lift.mul(smoothstep(0,0.55,luminance).oneMinus()));
    col.mulAssign(mix(vec3(1),gain,smoothstep(0.25,1,luminance)));
    col.assign(col.sub(0.5).mul(contrast).add(0.5));
    col.assign(mix(vec3(col.dot(luma)),col,saturation));
    col.assign(col.div(max(vec3(0),col.sub(1)).mul(0.6).add(1)));
    const centred=uv().sub(0.5);
    col.mulAssign(smoothstep(0.15,0.78,centred.dot(centred)).mul(vignette).oneMinus());
    col.addAssign(hash(screenCoordinate.xy.add(clock.mul(137))).sub(0.5).mul(grain));
    col.assign(col.clamp(0,1));
    return vec4(col,1);
  })();
}

/** SMAANode expects linear input; transfer and final 8-bit dither come after it. */
export function encodeOutputNode(input: Node<'vec4'>) {
  return Fn(()=>{
    const col=input.rgb;
    const mask=step(vec3(0.0031308),col);
    const encoded=col.mul(12.92).mul(mask.oneMinus()).add(pow(col.max(0),vec3(1/2.4)).mul(1.055).sub(0.055).mul(mask));
    return vec4(encoded.add(hash(screenCoordinate.xy.mul(1.7)).sub(0.5).div(255)).clamp(0,1),1);
  })();
}
