// @ts-nocheck — generated TSL expression AST, validated by both backend shader compilers.
// Offline translation of frozen WG0 expressions; no GLSL/runtime transpiler retained.
import { uniform, vec2, dot, fract, mul, Fn, normalize, clamp, sub, pow, mix, smoothstep, max, acos, min, sqrt, add, vec3, vec4 } from 'three/tsl';
export function skyNodes(bindings): Record<string, (...args: any[]) => any> {



const uZenith = bindings.uZenith;
const uHorizon = bindings.uHorizon;
const uHaze = bindings.uHaze;
const uNadir = bindings.uNadir;
const uSunDir = bindings.uSunDir;
const uSunColor = bindings.uSunColor;
const uIntensity = bindings.uIntensity;
const uSunDiscSize = bindings.uSunDiscSize;
const uSunDiscGain = bindings.uSunDiscGain;
const uHaloGain = bindings.uHaloGain;
const uDither = bindings.uDither;

// Interleaved gradient noise — the cheapest dither that stays visually
// uncorrelated frame to frame and does not produce a visible grid.

const ign = /*@__PURE__*/ Fn( ( [ p ] ) => {

	return fract( mul( 52.9829189, fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ) );

} );

const skyColor = /*@__PURE__*/ Fn( ( [ vWorldDir, fragCoord ] ) => {

	const d = normalize( vWorldDir );
	const h = d.y;

	// ---- Vertical gradient ------------------------------------------------
	// Two stacked falloffs: a broad zenith->horizon ramp, plus a tight band of
	// bright haze that only occupies the bottom few degrees.

	const up = clamp( h, 0.0, 1.0 );
	const broad = pow( sub( 1.0, up ), 3.9 );
	const band = pow( sub( 1.0, up ), 19.0 );
	const col = (mix( uZenith, uHorizon, broad )).toVar();
	col.assign( mix( col, uHaze, band.mul( 0.28 ) ) );

	// Below the horizon the dome falls to a muted sea haze so the join with
	// distant water reads as atmosphere rather than a cut.

	const below = smoothstep( 0.0, - 0.10, h );
	col.assign( mix( col, uNadir, below.mul( 0.85 ) ) );

	// ---- Sun-side warming --------------------------------------------------
	// Air near the sun's azimuth scatters warm; this is subtle but it is what
	// makes the sky feel directional instead of radially symmetric.

	const dAz = normalize( d.xz.add( 1e-5 ) );
	const sAz = normalize( uSunDir.xz.add( 1e-5 ) );
	const az = max( dot( dAz, sAz ), 0.0 );
	col.addAssign( uSunColor.mul( mul( 0.085, pow( az, 2.6 ) ).mul( pow( sub( 1.0, up ), 1.6 ) ) ) );
	const cosT = dot( d, uSunDir );
	const mu = max( cosT, 0.0 );

	// ---- Mie halo ----------------------------------------------------------
	// Wide, faint aureole + a tight bright core. Both fade below the horizon.

	const horizonMask = smoothstep( - 0.06, 0.02, h );
	const halo = pow( mu, 6.0 ).mul( 0.09 ).add( pow( mu, 44.0 ).mul( 0.34 ) ).add( pow( mu, 340.0 ).mul( 1.15 ) );
	col.addAssign( uSunColor.mul( halo ).mul( uHaloGain ).mul( horizonMask ) );

	// ---- Sun disc ----------------------------------------------------------
	// Limb softening: the disc is not a hard circle. Radiance stays flat across
	// the middle and rolls off over the outer ~20% of the radius, which is what
	// a real solar limb plus a little atmospheric smear looks like.

	const ang = acos( clamp( cosT, - 1.0, 1.0 ) );
	const r = ang.div( uSunDiscSize );
	const limb = sub( 1.0, smoothstep( 0.72, 1.0, r ) );
	const rim = sqrt( max( 0.0, sub( 1.0, min( r, 1.0 ).mul( min( r, 1.0 ) ) ) ) );
	col.addAssign( uSunColor.mul( limb ).mul( uSunDiscGain.mul( add( 0.35, mul( 0.65, rim ) ) ) ).mul( horizonMask ) );
	col.mulAssign( uIntensity );

	// ---- Dither ------------------------------------------------------------
	// Applied in HDR, scaled to the local value so the ramp never quantises
	// into bands after the grade pass' 8-bit write.

	const px = fragCoord;
	const n = ign( px ).sub( 0.5 );

	// Amplitude raised: the previous level was under one 8-bit step once ACES
	// had compressed the sky's value range, so the zenith ramp still quantised
	// into visible contour bands after the grade pass wrote to 8 bits.

	col.addAssign( n.mul( add( 0.010, mul( 0.012, max( col.r, max( col.g, col.b ) ) ) ) ).mul( uDither ) );

	return vec4( max( col, vec3( 0.0 ) ), 1.0 );

} );

return {skyColor};
}
