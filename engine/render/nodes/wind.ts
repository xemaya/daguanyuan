// @ts-nocheck — generated TSL expression AST, validated by both backend shader compilers.
// Offline translation of frozen WG0 expressions; no GLSL/runtime transpiler retained.
import { uniform, dot, sin, vec3, abs, Fn } from 'three/tsl';
export function windNodes(bindings): Record<string, (...args: any[]) => any> {



const uWindTime = bindings.uWindTime;
const uWindDir = bindings.uWindDir;
const uWindStrength = bindings.uWindStrength;
const uWindScale = bindings.uWindScale;

/**
 * World-space sway. Two incommensurate gust waves travelling along the wind
 * direction (so a gust visibly crosses the treeline instead of every tree
 * pulsing together), plus a fast lateral flutter for leaf chatter. The vertical
 * term is negative-biased: a swinging branch traces an arc, it does not stretch.
 */

const foliageWind = /*@__PURE__*/ Fn( ( [ wp, flex, phase, mul ] ) => {

	const t = uWindTime.mul( 0.9 ).add( phase );
	const travel = dot( wp.xz, uWindDir ).mul( 0.24 );
	const g = sin( t.mul( 1.00 ).sub( travel ) ).mul( 0.62 ).add( sin( t.mul( 1.73 ).sub( travel.mul( 1.63 ) ).add( 2.1 ) ).mul( 0.38 ) );
	const f = sin( t.mul( 5.9 ).add( phase.mul( 2.7 ) ).add( wp.y.mul( 3.4 ) ) ).mul( 0.55 ).add( sin( t.mul( 9.3 ).add( phase.mul( 4.1 ) ).add( wp.x.mul( 2.2 ) ) ).mul( 0.45 ) );
	const amp = uWindStrength.mul( uWindScale ).mul( mul ).mul( flex );
	const dir = vec3( uWindDir.x, 0.0, uWindDir.y );
	const side = vec3( uWindDir.y.negate(), 0.0, uWindDir.x );
	const off = (dir.mul( g.mul( amp ) ).add( side.mul( f.mul( amp ).mul( 0.26 ) ) )).toVar();
	off.y.subAssign( abs( g ).mul( amp ).mul( 0.17 ) );
	off.y.addAssign( f.mul( amp ).mul( 0.09 ) );

	return off;

} );

return {foliageWind};
}
