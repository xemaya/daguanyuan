// @ts-nocheck — generated TSL expression AST, validated by both backend shader compilers.
// Offline translation of frozen WG0 expressions; no GLSL/runtime transpiler retained.
import { texture, uniform, sign, Fn, uv, step, vec2, clamp, vec4, mix, max, smoothstep, distance, float, dot, sin, Discard, If, length, vec3, add, pow, sub, mul, abs, mat3, mat2, normalize } from 'three/tsl';
export function waterNodes(bindings): Record<string, (...args: any[]) => any> {



const uBed = bindings.uBed;
const uBedWindow = bindings.uBedWindow;

// minX, minZ, width, depth

const uTime = bindings.uTime;

// Signed sqrt decode — mirror of the CPU-side encoder.

const decSigned = /*@__PURE__*/ Fn( ( [ e, range ] ) => {

	const s = e.mul( 2.0 ).sub( 1.0 );

	return sign( s ).mul( s ).mul( s ).mul( range );

} );

const sampleBed = /*@__PURE__*/ Fn( ( [ p ] ) => {

	const uv = p.sub( uBedWindow.xy ).div( uBedWindow.zw );

	// Unsampled space is land, not an invented ocean around the garden.

	const inside = step( 0.0, uv.x ).mul( step( uv.x, 1.0 ) ).mul( step( 0.0, uv.y ) ).mul( step( uv.y, 1.0 ) );

	return uBed.sample( clamp( uv, vec2( 0.002 ), vec2( 0.998 ) ) );

} );

const bedInside = /*@__PURE__*/ Fn( ( [ p ] ) => {

	const u = p.sub( uBedWindow.xy ).div( uBedWindow.zw );

	return step( 0.0, u.x ).mul( step( u.x, 1.0 ) ).mul( step( 0.0, u.y ) ).mul( step( u.y, 1.0 ) );

} );

const uWaveAmp = bindings.uWaveAmp;
const uSwell = bindings.uSwell;
const uChop = bindings.uChop;
const uDetail = bindings.uDetail;
const uShallow = bindings.uShallow;
const uDeep = bindings.uDeep;
const uFoamColor = bindings.uFoamColor;
const uSkyTint = bindings.uSkyTint;
const uSunDir = bindings.uSunDir;

// world space, pointing toward the sun

const uSunColor = bindings.uSunColor;

const waveHeight = /*@__PURE__*/ Fn( ( [ worldPosition, cameraPosition ] ) => {

	const seaWp = vec4( worldPosition, 1.0 );
	const inside = bedInside( seaWp.xz );
	const bed = sampleBed( seaWp.xz );
	const bedH = mix( 4.0, decSigned( bed.r, 4.0 ), inside );
	const depth = max( bedH.negate(), 0.0 );

	// Waves die in the shallows (the bottom kills them) and are damped out with
	// distance so a 3 m quad never carries a 2 m wave and aliases into strobing.

	const amp = (smoothstep( 0.10, 1.7, depth )).toVar();
	amp.mulAssign( smoothstep( 300.0, 40.0, distance( cameraPosition, seaWp.xyz ) ) );
	const t = uTime;
	const w = (float( 0.0 )).toVar();
	w.addAssign( sin( dot( seaWp.xz, vec2( 0.62, 0.78 ) ).mul( 1.05 ).add( t.mul( 1.10 ) ) ).mul( 0.032 ) );
	w.addAssign( sin( dot( seaWp.xz, vec2( - 0.85, 0.53 ) ).mul( 1.71 ).add( t.mul( 1.55 ) ) ).mul( 0.020 ) );
	w.addAssign( sin( dot( seaWp.xz, vec2( 0.31, - 0.95 ) ).mul( 2.90 ).add( t.mul( 2.15 ) ) ).mul( 0.011 ) );

	// A slow whole-bay breathe so the waterline itself creeps in and out.

	const tide = sin( t.mul( 0.29 ) ).mul( 0.024 ).mul( smoothstep( 0.0, 0.6, depth ) );

	return w.mul( amp ).add( tide ).mul( uWaveAmp );

} );

const waterSurface = /*@__PURE__*/ Fn( ( [ vWXZ, vViewPosition ] ) => {

	const P = vWXZ;
	const t = uTime;
	const inside = bedInside( P );
	const bed = sampleBed( P );
	const bedH = mix( 4.0, decSigned( bed.r, 4.0 ), inside );
	const shoreD = mix( 8.0, decSigned( bed.g, 8.0 ), inside );
	const slope = mix( 0.55, bed.b, inside );
	const placeN = bed.a;

	If( inside.lessThan( 0.5 ).or( bedH.greaterThan( 0.0 ) ), () => {

		Discard();

	} );

	const depth = max( bedH.negate(), 0.0 );

	// Horizontal metres from the waterline, positive out to sea.

	const s = max( shoreD.negate(), 0.0 );

	// One distance term drives every anti-aliasing decision below. Ripple normal
	// maps minify catastrophically at grazing angles — the fix is not a sharper
	// filter but folding the lost detail into roughness, which is energy
	// conserving and, unlike a mip bias, cannot re-alias.

	const gFar = smoothstep( 5.0, 45.0, length( vViewPosition ) );

	// ---- body colour -------------------------------------------------------

	const dt = smoothstep( 0.05, 2.3, depth );
	const col = (mix( uShallow, uDeep, dt )).toVar();
	col.assign( mix( col, uDeep.mul( vec3( 0.88, 0.95, 1.02 ) ), smoothstep( 2.2, 12.0, depth ) ) );

	// The shallows pick up the sand they are lying on, which is what keeps the
	// turquoise from reading as a swimming pool.

	col.assign( mix( col.mul( vec3( 1.16, 1.09, 0.92 ) ), col, smoothstep( 0.0, 0.9, depth ) ) );

	// Very large-scale value drift. The far sea loses its ripple normals to the
	// anti-aliasing above, and without something at a 50 m wavelength to replace
	// them the horizon flattens into a single printed gradient.

	const macro = uDetail.sample( P.mul( 0.019 ).add( vec2( 0.0016, 0.0009 ).mul( t ) ) ).b;
	const macro2 = uDetail.sample( P.mul( 0.047 ).sub( vec2( 0.0031, 0.0022 ).mul( t ) ) ).r;
	col.mulAssign( add( 0.92, macro.mul( 0.13 ) ).add( macro2.mul( 0.06 ) ) );

	// ---- caustics ----------------------------------------------------------

	const ca1 = uDetail.sample( P.mul( 0.62 ).add( vec2( 0.013, 0.008 ).mul( t ) ) ).a;
	const ca2 = uDetail.sample( P.mul( 0.39 ).sub( vec2( 0.010, 0.016 ).mul( t ) ) ).a;
	const caustic = pow( clamp( ca1.mul( ca2 ).mul( 2.3 ), 0.0, 1.0 ), 1.7 );
	col.addAssign( caustic.mul( vec3( 0.26, 0.40, 0.33 ) ).mul( sub( 1.0, dt ) ).mul( 0.35 ) );

	// ---- shoreline foam ----------------------------------------------------
	// Two out-of-phase swells plus a per-place offset: the wash arrives at
	// different points of the beach at different times, which is the difference
	// between surf and a pulsing outline.

	const tide = sin( t.mul( 0.55 ).add( placeN.mul( 6.3 ) ) ).mul( 0.55 ).add( sin( t.mul( 0.31 ).add( placeN.mul( 2.1 ) ).add( 2.4 ) ).mul( 0.45 ) );
	const reach = (mix( 2.10, 0.75, clamp( slope.mul( 1.4 ), 0.0, 1.0 ) ).mul( add( 0.58, mul( 0.42, tide ) ) )).toVar();
	reach.assign( max( reach, 0.22 ) );
	const wash = smoothstep( reach, reach.mul( 0.15 ), s );
	const fnA = uDetail.sample( P.mul( 0.50 ).add( vec2( 0.004, 0.052 ).mul( t ) ) ).r;
	const fnB = uDetail.sample( P.mul( 1.55 ).sub( vec2( 0.031, 0.088 ).mul( t ) ) ).r;
	const fn = fnA.mul( 0.6 ).add( fnB.mul( 0.4 ) );
	const body = smoothstep( sub( 0.50, wash.mul( 0.70 ) ), sub( 0.86, wash.mul( 0.70 ) ), fn ).mul( wash );

	// A permanent lace of bubbles clinging to the waterline itself.

	const lace = smoothstep( 0.40, 0.0, s ).mul( smoothstep( 0.26, 0.70, fnB ) );

	// The bright leading edge of the wash.

	const crest = smoothstep( 0.20, 0.0, abs( s.sub( reach.mul( 0.72 ) ) ) ).mul( smoothstep( 0.24, 0.58, fnA ) );

	// Sets of breakers marching shoreward. Lines of constant shore-distance are
	// parallel to the waterline whatever shape the bay is, so this costs one sine
	// and reads as real surf rather than as a scrolling texture.

	const march = sin( s.mul( 1.75 ).sub( t.mul( 1.15 ) ).add( placeN.mul( 5.4 ) ) );
	const breaker = smoothstep( 0.62, 0.99, march ).mul( smoothstep( 7.0, 1.2, s ) ).mul( smoothstep( 0.30, 0.75, fnB ) ).mul( 0.55 );

	// Torn-off patches drifting back out over the shallows.

	const streak = uDetail.sample( P.mul( vec2( 0.9, 0.22 ) ).add( vec2( 0.0, 0.10 ).mul( t ) ) ).b;
	const drift = smoothstep( 3.6, 0.4, s ).mul( smoothstep( 0.70, 0.96, fnA.mul( 0.5 ).add( streak.mul( 0.6 ) ) ) ).mul( 0.40 );

	// 园池无浪:只留贴岸的细沫与零星浮渣,浪体/浪峰/涌浪全部关掉。

	const foam = (clamp( max( lace.mul( 0.55 ), drift.mul( 0.35 ) ), 0.0, 1.0 ).mul( sub( 1.0, mul( 0.5, body ).mul( 0.0 ) ) )).toVar();
	foam.mulAssign( step( 0.001, depth ) );
	col.assign( mix( col, uFoamColor, foam ) );

	// ---- transparency ------------------------------------------------------
	// Shallow water is a wash of colour over wet sand; deep water is opaque. The
	// low alpha at the very edge is also what hides the geometric intersection
	// line between the surface and the beach.

	const alphaW = mix( 0.52, 0.96, smoothstep( 0.02, 0.85, depth ) );
	const alpha = max( alphaW, foam.mul( 0.97 ) );

	return mat3( col, vec3( alpha, foam, depth ), vec3( gFar ) );

} );

const waterNormal = /*@__PURE__*/ Fn( ( [ vWXZ, vViewPosition, normal_immutable, viewMatrix, gFar, gDepth, gFoam ] ) => {

	const normal = normal_immutable.toVar();

	// ---- domain warp -------------------------------------------------------
	// Two normal layers on an unrotated world-space grid put their baked
	// directional crests on the same two axes, and the tile boundaries line up
	// into the diagonal corduroy lattice that was showing across the whole
	// midground. The cure is threefold: warp the sample position by a very
	// large-scale noise so no tile edge is ever straight, rotate each layer by a
	// different irrational angle so no two crest directions can beat, and put the
	// layer scales at non-harmonic ratios.

	const dist = length( vViewPosition );
	const wA = uDetail.sample( vWXZ.mul( 0.0072 ).add( vec2( 0.00090, 0.00061 ).mul( uTime ) ) ).bg.sub( 0.5 );
	const wB = uDetail.sample( vWXZ.mul( 0.0231 ).sub( vec2( 0.00135, 0.00194 ).mul( uTime ) ) ).br.sub( 0.5 );
	const Pw = vWXZ.add( wA.mul( 11.0 ) ).add( wB.mul( 2.6 ) );

	// 21.8 deg, 104.8 deg, -52.0 deg.

	const r1 = mat2( 0.9285, 0.3714, - 0.3714, 0.9285 );
	const r2 = mat2( - 0.2554, 0.9668, - 0.9668, - 0.2554 );
	const r3 = mat2( 0.6157, - 0.7880, 0.7880, 0.6157 );
	const nA = uSwell.sample( r1.mul( Pw ).mul( 0.0417 ).add( vec2( 0.0193, 0.0108 ).mul( uTime ) ) ).xyz.mul( 2.0 ).sub( 1.0 );
	const nB = uChop.sample( r2.mul( Pw ).mul( 0.1123 ).sub( vec2( 0.0131, 0.0246 ).mul( uTime ) ) ).xyz.mul( 2.0 ).sub( 1.0 );
	const nC = uChop.sample( r3.mul( Pw ).mul( 0.2971 ).add( vec2( - 0.0287, 0.0165 ).mul( uTime ) ) ).xyz.mul( 2.0 ).sub( 1.0 );

	// Each layer's xy is expressed in its own rotated frame; multiplying the
	// vector from the left applies the transpose, i.e. the inverse rotation, and
	// brings it back onto world X/Z where the tangent frame below expects it.

	const aXY = nA.xy.mul( r1 );
	const bXY = nB.xy.mul( r2 );
	const cXY = nC.xy.mul( r3 );

	// ---- distance fade -----------------------------------------------------
	// Finer layers minify first, so they are retired first. Past ~35 m only the
	// long swell survives and the horizon settles into calm haze instead of
	// aliasing into a grid.

	const fadeBroad = sub( 1.0, smoothstep( 8.0, 60.0, dist ).mul( 0.90 ) );
	const fadeMid = sub( 1.0, smoothstep( 5.0, 30.0, dist ).mul( 0.97 ) );
	const fadeFine = sub( 1.0, smoothstep( 2.5, 14.0, dist ) );
	const damp = sub( 1.0, gFar.mul( 0.55 ) );
	const shelter = mix( 0.30, 1.0, smoothstep( 0.04, 0.75, gDepth ) );
	const nxy = aXY.mul( 0.18 ).mul( fadeBroad ).add( bXY.mul( 0.10 ).mul( fadeMid ) ).add( cXY.mul( 0.05 ).mul( fadeFine ) ).mul( damp ).mul( shelter ).mul( sub( 1.0, gFoam.mul( 0.5 ) ) );
	const mn = normalize( vec3( nxy, 1.0 ) );

	// The ripple UVs run along world +X / +Z, so the tangent frame is those two
	// axes brought into view space and orthogonalised against the interpolated
	// normal — no tangent attribute, no seam.

	const T = (viewMatrix.mul( vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz).toVar();
	const B = (viewMatrix.mul( vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz).toVar();
	T.assign( normalize( T.sub( normal.mul( dot( normal, T ) ) ) ) );
	B.assign( normalize( B.sub( normal.mul( dot( normal, B ) ) ).sub( T.mul( dot( T, B ) ) ) ) );
	normal.assign( normalize( T.mul( mn.x ).add( B.mul( mn.y ) ).add( normal.mul( mn.z ) ) ) );

	return normal;

} );

const waterGlitter = /*@__PURE__*/ Fn( ( [ vWXZ, vViewPosition, normal, viewMatrix, gFar, gFoam ] ) => {

	const totalEmissiveRadiance = (vec3( 0.0 )).toVar();
	const L = normalize( viewMatrix.mul( vec4( uSunDir, 0.0 ) ).xyz );
	const V = normalize( vViewPosition );
	const H = normalize( L.add( V ) );
	const ndh = max( dot( normal, H ), 0.0 );

	// The lobe widens with distance for the same reason roughness rises: a
	// 240-power highlight on a sub-pixel ripple is a strobe, not a sparkle.

	const lobe = pow( ndh, mix( 230.0, 34.0, gFar ) );

	// The sparkle field is sampled at a distance-compensated world scale, so each
	// glint keeps covering a few pixels instead of mipping away exactly where
	// real sun glitter is strongest.

	const sc = mix( 1.40, 0.045, gFar );
	const sp1 = uDetail.sample( vWXZ.mul( sc ).add( vec2( 0.031, 0.019 ).mul( uTime ) ) ).g;
	const sp2 = uDetail.sample( vWXZ.mul( sc ).mul( 2.4 ).sub( vec2( 0.022, 0.048 ).mul( uTime ) ) ).g;
	const sparkle = smoothstep( 0.52, 0.95, sp1.mul( 0.6 ).add( sp2.mul( 0.55 ) ) );
	totalEmissiveRadiance.addAssign( uSunColor.mul( lobe ).mul( add( 0.22, sparkle.mul( 1.15 ) ) ).mul( 0.95 ).mul( sub( 1.0, gFoam.mul( 0.75 ) ) ) );

	// Foam is a diffuse white solid, but wet foam still catches a broad sheen.

	totalEmissiveRadiance.addAssign( uSunColor.mul( gFoam ).mul( pow( ndh, 12.0 ) ).mul( 0.10 ) );

	// Stylised Fresnel sky lift. Real water gets most of its brightness toward
	// the horizon from the sky it reflects; the PMREM alone is too dim at this
	// environment intensity to carry it, and without it the bay reads as ink.

	const F = pow( clamp( sub( 1.0, max( dot( normal, V ), 0.0 ) ), 0.0, 1.0 ), 4.0 );
	totalEmissiveRadiance.addAssign( uSkyTint.mul( F ).mul( sub( 1.0, gFoam ) ).mul( 0.55 ) );

	return totalEmissiveRadiance;

} );

const waterRoughness = /*@__PURE__*/ Fn( ( [ roughness, gFar, gDepth, gFoam ] ) => {

	const roughnessFactor = (mix( roughness, 0.80, gFoam )).toVar();

	// Glassy right at the shore where the water is a thin film, choppier offshore.

	roughnessFactor.assign( mix( roughnessFactor.mul( 0.55 ), roughnessFactor, smoothstep( 0.0, 0.5, gDepth ) ) );

	// Distance detail traded for roughness — see gFar.

	roughnessFactor.assign( mix( roughnessFactor, 0.46, gFar.mul( 0.96 ) ) );

	return roughnessFactor;

} );

return {waveHeight, waterSurface, waterNormal, waterGlitter, waterRoughness};
}
