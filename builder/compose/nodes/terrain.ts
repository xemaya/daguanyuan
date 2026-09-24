// @ts-nocheck — generated TSL expression AST, validated by both backend shader compilers.
// Offline translation of frozen WG0 expressions; no GLSL/runtime transpiler retained.
import { texture, uniform, dot, sub, max, sqrt, vec3, Fn, vec2, smoothstep, clamp, mix, add, floor, mod, fract, fwidth, min, sin, vec4, mul, float, mat3, normalize } from 'three/tsl';
export function terrainNodes(bindings): Record<string, (...args: any[]) => any> {



const uSplat = bindings.uSplat;
const uSplat2 = bindings.uSplat2;
const uWarp = bindings.uWarp;
const uTurfMap = bindings.uTurfMap;
const uDirtMap = bindings.uDirtMap;
const uCobMap = bindings.uCobMap;
const uSandMap = bindings.uSandMap;
const uNrmTD = bindings.uNrmTD;
const uNrmCS = bindings.uNrmCS;
const uRough4 = bindings.uRough4;
const uExtent = bindings.uExtent;
const uNormalStrength = bindings.uNormalStrength;

// Packed normals keep XY only; Z comes back from the unit-length constraint.

const decodeN = /*@__PURE__*/ Fn( ( [ xy, k ] ) => {

	const n = xy.mul( 2.0 ).sub( 1.0 );
	const z = sqrt( max( sub( 1.0, dot( n, n ) ), 0.0 ) );

	return vec3( n.mul( k ), z );

} );

const terrainSurface = /*@__PURE__*/ Fn( ( [ vTerXZ, vTerH, vTerN ] ) => {

	const tXZ = vTerXZ;
	const LUM = vec3( 0.2126, 0.7152, 0.0722 );

	// ---- world-scale variation --------------------------------------------
	// One 256px noise sampled at four scales. Each macro term averages two
	// *different* channels at two *different* periods: a single repeating
	// texture driving a visible brightness field prints its own tiling grid
	// across the whole map, which is exactly the failure this system exists to
	// prevent. Averaging two incommensurate periods pushes the beat far beyond
	// the size of the island.

	const w0 = uWarp.sample( tXZ.mul( 0.014170 ) );

	// ~70.6 m

	const wM = uWarp.sample( tXZ.mul( 0.031300 ).add( vec2( 0.71, 0.19 ) ) );

	// ~31.9 m

	const w1 = uWarp.sample( tXZ.mul( 0.073700 ).add( vec2( 0.37, 0.61 ) ) );

	// ~13.6 m

	const w2 = uWarp.sample( tXZ.mul( 0.830000 ).add( vec2( 0.13, 0.77 ) ) );

	// ~1.2 m

	const w3 = uWarp.sample( tXZ.mul( 3.970000 ).add( vec2( 0.53, 0.29 ) ) );

	// ~0.25 m
	// The baked noise is now authored to fill the byte range (see
	// terrainWarpTexture), so these remaps are near pass-throughs that only clip
	// the tails. They used to squeeze a 6%-wide field, which is why 60 m of lawn
	// came out one flat tone.

	const macroA = smoothstep( 0.12, 0.88, w0.b );
	const macroM = smoothstep( 0.14, 0.86, wM.b.mul( 0.55 ).add( w1.a.mul( 0.45 ) ) );
	const macroB = smoothstep( 0.14, 0.86, w1.b.mul( 0.55 ).add( wM.a.mul( 0.45 ) ) );
	const cloud = smoothstep( 0.16, 0.84, w0.a.mul( 0.50 ).add( w1.a.mul( 0.50 ) ) );

	// The high-frequency terms are what turn the splat's bilinear ramps into a
	// ragged, finger-y boundary. Without them the path edge reads as a contour
	// line no matter how much noise went into the bake. The 25 cm term matters
	// most: without a sub-decimetre jitter the boundary snaps to the texel grid
	// and walks as a visible staircase of blocks. It mips away with distance,
	// which is exactly right — there is nothing to break up once a texel is
	// subpixel.

	const warpOff = w0.rg.sub( 0.5 ).mul( 1.35 ).add( wM.rg.sub( 0.5 ).mul( 0.72 ) ).add( w1.rg.sub( 0.5 ).mul( 0.58 ) ).add( w2.rg.sub( 0.5 ).mul( 0.44 ) ).add( w3.rg.sub( 0.5 ).mul( 0.14 ) );

	// ---- splat lookup ------------------------------------------------------

	const sUv = tXZ.add( warpOff ).sub( uExtent.xy ).div( uExtent.zw );

	// 单子 AL-c c2:铺装及其外缘不 warp。路牙(luya)沿样条不带 warp 挤出,地形场里石边
	// 已贴住路牙内沿(AL-b b1);这层 warpOff(五层合计 ±0.5 m 以上)把画面上的石边再推一次,
	// 一侧留草缝、一侧石越过牙。先不 warp、在 mip 1.5(约 0.7 m 模糊)上采一次铺装通道,
	// G>0 就是「铺装或它 0.3 m 左右的外缘」,那里把 warp 收到 0。只动决定「是不是石面」
	// 的这一次采样(sp);sp2(露土/湿痕)与各层细节 UV 照旧 warp,草地的碎边不变。
	const sUv0 = tXZ.sub( uExtent.xy ).div( uExtent.zw );
	const paveNear = smoothstep( 0.01, 0.08, uSplat.sample( clamp( sUv0, vec2( 0.0015 ), vec2( 0.9985 ) ) ).level( 1.5 ).g );
	const sUvP = tXZ.add( warpOff.mul( sub( 1.0, paveNear ) ) ).sub( uExtent.xy ).div( uExtent.zw );
	const sp = uSplat.sample( clamp( sUvP, vec2( 0.0015 ), vec2( 0.9985 ) ) );

	// 扩展 splat(单子 T):R=soil 露土、G=wet 湿痕,无分档,同一副 warp 后的 UV。

	const sp2 = uSplat2.sample( clamp( sUv, vec2( 0.0015 ), vec2( 0.9985 ) ) );

	// 通道打包解码(见 bakeSplat 注释):G 0.5 以下石子漫、以上石板;B 0.5 以下沙、以上苔。
	// 分档线两侧用一小段 smoothstep 软过渡——mip 平均出的中间值落在过渡带里,
	// 读成边缘羽化,不会在两种铺装之间闪变。

	const slabSel = smoothstep( 0.46, 0.54, sp.g );
	const paveW = mix( sp.g, sp.g.sub( 0.5 ), slabSel ).mul( 2.0 );
	const mossSel = smoothstep( 0.46, 0.54, sp.b );
	const sandW = sub( 1.0, mossSel ).mul( sp.b ).mul( 2.0 );
	const mossW = mossSel.mul( max( sp.b.sub( 0.5 ), 0.0 ) ).mul( 2.0 );

	// How far into the middle of the track we are. 1 along the centreline,
	// falling away through the shoulders — the profile of where feet actually go.

	const centre = smoothstep( 0.42, 0.95, sp.r );

	// ---- detail UVs. Two turf scales + per-layer warp kills the tile grid --

	const uvTa = tXZ.add( warpOff.mul( 0.30 ) ).mul( 0.6300 );
	const uvTb = vec2( tXZ.x.mul( 0.8660 ).sub( tXZ.y.mul( 0.5000 ) ), tXZ.x.mul( 0.5000 ).add( tXZ.y.mul( 0.8660 ) ) ).mul( 0.2070 ).add( vec2( 2.7, 5.1 ) );

	// The dirt is the one layer that runs as a long thin ribbon through the
	// frame, so its tile period is on screen at every distance at once. Scaling
	// its UVs by a 32m noise means the grain size itself drifts along the track:
	// there is no single period left for the eye to lock onto.

	const dScale = add( 0.7900, macroM.mul( 0.4400 ) );
	const uvD = tXZ.add( warpOff.mul( 0.62 ) ).mul( dScale );

	// 石子漫的拼花周期(P-07:先算屏幕上几个像素再调强度):cobble 贴图一砖 9×11 窝,
	// 0.80 的缩放让一块石子在世界里约 0.14m——游线视角 3m 外 ≈ 30px,20m 外 ≈ 5px,
	// 始终在一像素之上,不会被 mipmap 平均成灰板。原 0.515 的石子 0.22m,读成大卵石。

	const uvC = tXZ.add( warpOff.mul( 0.14 ) ).mul( 0.8000 ).add( vec2( 0.15, 0.42 ) );
	const uvS = tXZ.add( warpOff.mul( 0.34 ) ).mul( 0.6400 );
	const turfMix = clamp( add( 0.22, cloud.mul( 0.58 ) ), 0.0, 1.0 );
	const aT = (mix( uTurfMap.sample( uvTa ).rgb, uTurfMap.sample( uvTb ).rgb, turfMix )).toVar();
	const uvD2 = vec2( tXZ.x.mul( 0.9397 ).add( tXZ.y.mul( 0.3420 ) ), tXZ.x.negate().mul( 0.3420 ).add( tXZ.y.mul( 0.9397 ) ) ).mul( 0.3170 ).add( vec2( 4.1, 8.7 ) );
	const aD = (mix( uDirtMap.sample( uvD ).rgb, uDirtMap.sample( uvD2 ).rgb, turfMix )).toVar();
	const aC = (uCobMap.sample( uvC ).rgb).toVar();

	// Sand gets the same two-scale treatment as turf: a beach is a large,
	// uninterrupted expanse and a single tile shows its wavelength instantly.

	const uvS2 = vec2( tXZ.x.mul( 0.6428 ).add( tXZ.y.mul( 0.7660 ) ), tXZ.x.negate().mul( 0.7660 ).add( tXZ.y.mul( 0.6428 ) ) ).mul( 0.2110 ).add( vec2( 6.3, 1.9 ) );
	const aS = (mix( uSandMap.sample( uvS ).rgb, uSandMap.sample( uvS2 ).rgb, turfMix )).toVar();

	// The shared dirt and cobble maps are authored for props seen at arm's
	// length, where high grit contrast reads well. Spread over a whole path
	// they turn to confetti, so roll the highlights off and warm them before
	// they enter the blend. Turf loses a little saturation for the same reason:
	// a whole field of it at full chroma reads as astroturf.
	// Feet wear a track smooth up the middle and sweep the loose grit out to the
	// shoulders, so the gravel contrast is pulled down by the centre weight. The
	// flat term is the same texture read 12x magnified — its own low-frequency
	// content, i.e. a smooth compacted-soil colour, for one fetch and no constants.

	const aDflat = uDirtMap.sample( uvD.mul( 0.0820 ).add( vec2( 0.31, 0.67 ) ) ).rgb;
	aD.assign( mix( aD, aDflat, centre.mul( 0.40 ) ) );
	const dl = dot( aD, LUM );
	aD.mulAssign( mix( 1.0, 0.80, smoothstep( 0.20, 0.55, dl ) ) );

	// Chroma, not just value. Half the track is in tree shade, lit only by a blue
	// sky, and a low-chroma brown under a blue fill is grey — the south approach
	// was reading as tarmac. Bare earth has to carry enough saturation to still be
	// earth-coloured when the sun is off it.

	aD.assign( mix( vec3( dot( aD, LUM ) ), aD, 0.90 ) );
	aD.assign( aD.mul( 0.90 ).add( 0.050 ).mul( vec3( 1.26, 0.99, 0.68 ) ) );

	// Cobble ships a cool quarried grey; the bible's stone is warm (#b8b3a8),
	// and a cold forecourt in a warm town reads as a puddle from 20 m away.
	// Cobble: neutralise, then lift the mortar and compress the range before
	// tinting warm. Deep mortar joints under a blue sky fill turn a forecourt
	// into a slate roof lying on the ground; sun-bleached stone needs its
	// blacks raised, not its highlights lowered.

	aC.assign( mix( vec3( dot( aC, LUM ) ), aC, 0.50 ) );
	aC.assign( aC.mul( 0.78 ).add( 0.115 ) );
	aC.mulAssign( vec3( 1.32, 1.12, 0.74 ) );

	// Per-stone warm/cool jitter so the forecourt is laid, not printed.

	aC.mulAssign( mix( vec3( 0.93, 0.96, 1.00 ), vec3( 1.09, 1.02, 0.88 ), macroB ) );

	// ---- 石板甬道(近门大路,17 回「宽阔大路」)-----------------------------
	// P-07 自查:石板 0.85×0.55m,游线视角(眼高 1.6m)看 3m 外的地面一块板 ≈ 400px、
	// 30m 外 ≈ 30px——永远在像素之上。板缝约 2.5cm 在 ~25m 外落进亚像素,
	// 所以缝的对比度随 fwidth 收,远处让 mipmap 平均成浅缝,而不是闪成硬线。

	const slabUv = (tXZ.div( vec2( 0.85, 0.55 ) )).toVar();
	slabUv.x.addAssign( mod( floor( slabUv.y ), 2.0 ).mul( 0.5 ) );

	// 逐趟错缝

	const sCell = fract( slabUv );
	const sId = floor( slabUv );
	const sFw = fwidth( slabUv ).add( 1e-5 );
	const sEdge = min( sCell, sub( 1.0, sCell ) );

	// 距板缝(板内坐标 0..0.5)

	const jointFade = clamp( sub( 1.2, max( sFw.x, sFw.y ).mul( 28.0 ) ), 0.0, 1.0 );
	const joint = max( smoothstep( add( 0.030, sFw.x.mul( 0.6 ) ), sub( 0.030, sFw.x.mul( 0.6 ) ), sEdge.x ), smoothstep( add( 0.030, sFw.y.mul( 0.6 ) ), sub( 0.030, sFw.y.mul( 0.6 ) ), sEdge.y ) ).mul( jointFade );
	const sHash = fract( sin( dot( sId, vec2( 127.1, 311.7 ) ) ).mul( 43758.5453 ) );

	// 板面底色只能取贴图的低频:正常尺度的卵石贴图带着 Worley 浆缝,直接拿来当
	// 板面会把石板读成碎拼冰裂纹。22m 一期的放大读法是它自身的低频(平滑石色),
	// 再掺一点 0.6m 尺度的细颗粒。矩形板缝与逐板明度抖动承担「铺的」的读感。

	const aSlab = (uCobMap.sample( tXZ.mul( 0.0450 ).add( vec2( 0.53, 0.71 ) ) ).rgb).toVar();
	aSlab.assign( mix( aSlab, uCobMap.sample( tXZ.mul( 1.6000 ).add( vec2( 0.21, 0.83 ) ) ).rgb, 0.16 ) );
	aSlab.assign( mix( vec3( dot( aSlab, LUM ) ), aSlab, 0.35 ) );
	aSlab.assign( aSlab.mul( 0.62 ).add( 0.16 ) );
	aSlab.mulAssign( vec3( 1.16, 1.09, 0.95 ) );

	// 青石暖化(ART_DIRECTION §3 青石 #8c8f8a)

	aSlab.mulAssign( add( 0.86, sHash.mul( 0.22 ) ) );
	aSlab.mulAssign( sub( 1.0, joint.mul( 0.48 ) ) );
	const aPav = mix( aC, aSlab, slabSel );
	aT.assign( mix( vec3( dot( aT, LUM ) ), aT, 0.84 ).mul( vec3( 1.07, 1.00, 0.84 ) ) );
	aS.assign( mix( vec3( dot( aS, LUM ) ), aS, 0.94 ).mul( vec3( 1.22, 1.05, 0.72 ) ) );

	// ---- height-aware blend ----------------------------------------------
	// Linear lerping four surfaces gives a soapy dissolve. Biasing each weight
	// by the layer's own luminance (a good proxy for surface height in all four
	// of these maps) makes pebbles poke through grass and grass fill the mortar
	// joints, which is what sells the transition.

	const wgt = vec4( clamp( sub( 1.0, sp.r ).sub( paveW ).sub( sandW ), 0.0, 1.0 ), sp.r, paveW, sandW );
	const hgt = vec4( dot( aT, LUM ), dot( aD, LUM ), dot( aPav, LUM ), dot( aS, LUM ) );
	const bias = wgt.add( hgt.mul( 0.52 ) );
	const peak = max( max( bias.x, bias.y ), max( bias.z, bias.w ) ).sub( 0.21 );

	// The gate was 0.035 wide. On a splat that is metres-per-texel-ish that is a
	// hard contour, and a hard contour on a bilinear ramp is a staircase: the
	// grass/dirt boundary showed as a row of dark texel-sized blocks close up.
	// 0.10 keeps the height blend crisp enough for pebbles to poke through turf
	// while giving the ramp somewhere to live.

	const bl = (max( bias.sub( peak ), 0.0 ).mul( smoothstep( 0.0, 0.10, wgt ) )).toVar();
	bl.divAssign( max( bl.x.add( bl.y ).add( bl.z ).add( bl.w ), 1e-4 ) );
	const albedo = (aT.mul( bl.x ).add( aD.mul( bl.y ) ).add( aPav.mul( bl.z ) ).add( aS.mul( bl.w ) )).toVar();
	const nrm = decodeN( uNrmTD.sample( uvTa ).rg, 1.32 ).mul( bl.x ).add( decodeN( uNrmTD.sample( uvD ).ba, mul( 0.62, sub( 1.0, centre.mul( 0.38 ) ) ) ).mul( bl.y ) ).add( decodeN( uNrmCS.sample( uvC ).rg, mix( 1.00, 0.45, slabSel ) ).mul( bl.z ) ).add( decodeN( uNrmCS.sample( uvS ).ba, 0.58 ).mul( bl.w ) );
	const rgh = (uRough4.sample( uvTa ).r.mul( bl.x ).add( uRough4.sample( uvD ).g.mul( bl.y ) ).add( mix( uRough4.sample( uvC ).b, 0.72, slabSel ).mul( bl.z ) ).add( uRough4.sample( uvS ).a.mul( bl.w ) )).toVar();

	// ---- macro colour ------------------------------------------------------
	// Four independent scales of hue and value drift. This is the single most
	// important thing keeping a broad field of one texture from reading as one
	// texture: the eye finds the repeat in the *colour* long before the detail.

	const band = macroA.mul( 0.50 ).add( macroM.mul( 0.34 ) ).add( macroB.mul( 0.16 ) );
	const sunTint = vec3( 1.215, 1.100, 0.700 );

	// sun-bleached, yellow-green

	const lushTint = vec3( 0.735, 0.955, 0.800 );

	// shaded, blue-green

	const tint = mix( lushTint, sunTint, smoothstep( 0.16, 0.84, band ) );
	albedo.mulAssign( mix( vec3( 1.0 ), tint, bl.x.mul( 0.94 ).add( 0.06 ) ) );

	// P1 Task 6: the old "different green under the treeline" term keyed off
	// absolute |x|/z distance from the map centre (tuned to the old 64m town's
	// fixed treeline at x≈±30). At this window's scale (280×226m, MVP-region
	// centred rather than origin-centred) that constant would tint nearly the
	// whole map as "shaded", so it is disabled rather than reworked — there is
	// no equivalent fixed treeline geometry to key off yet.

	const edge = float( 0.0 );
	albedo.mulAssign( mix( vec3( 1.0 ), vec3( 0.855, 0.965, 0.895 ), edge.mul( bl.x ).mul( 0.8 ) ) );

	// Patchy mown-lawn value break-up, three scales stacked. Sun-bleached crowns
	// against damp hollows; the macro channels behind these now carry real
	// variance, so the swing here is visible from the far end of the town.

	albedo.mulAssign( add( 0.875, macroB.mul( 0.265 ) ) );
	albedo.mulAssign( add( 0.895, macroM.mul( 0.215 ) ) );
	albedo.mulAssign( add( 0.855, sp.a.mul( 0.275 ) ) );

	// Banks and cut slopes wear through to bare earth at the top of the fall.

	const slope = clamp( sub( 1.0, vTerN.y ).mul( 5.2 ), 0.0, 1.0 );
	albedo.assign( mix( albedo, albedo.mul( vec3( 1.06, 0.90, 0.72 ) ), slope.mul( bl.x ).mul( 0.55 ) ) );

	// Hollows hold water: the turf goes deeper and cooler where the ground dips.

	const damp = smoothstep( 0.40, 0.05, vTerH ).mul( bl.x ).mul( add( 0.30, macroM.mul( 0.95 ) ) );
	albedo.mulAssign( mix( vec3( 1.0 ), vec3( 0.745, 0.885, 0.785 ), clamp( damp, 0.0, 1.0 ).mul( 0.62 ) ) );

	// ---- 露土(单子 T) ---------------------------------------------------
	// soil 权重与草散布的 gap 场同源(builder/compose/grass-cover.ts):
	// 草稀处地表同步透土。土色比园路 dirt 更暗更饱和——园路是走熟的浮土,
	// 露土是草皮啃出的生土。过渡带用 w2/w3 高频把边界咬成颗粒,
	// 一条 smoothstep 渐变带会读成画上去的污渍。

	const soilGrain = smoothstep( 0.28, 0.74, w2.b.mul( 0.55 ).add( w3.b.mul( 0.45 ) ) );
	const soilAmt = (clamp( sp2.r.mul( add( 0.55, soilGrain.mul( 0.85 ) ) ), 0.0, 1.0 ).mul( bl.x )).toVar();
	const aSoil = (uDirtMap.sample( uvD2.mul( 2.30 ).add( vec2( 1.7, 3.9 ) ) ).rgb).toVar();

	// 提饱和、压暗、暖化。在宏观染色之后混入,绿色 tint 不会污染土色。

	aSoil.assign( mix( vec3( dot( aSoil, LUM ) ), aSoil, 1.30 ) );
	aSoil.assign( aSoil.mul( 0.50 ).mul( vec3( 1.34, 0.92, 0.60 ) ) );
	albedo.assign( mix( albedo, aSoil, soilAmt.mul( 0.92 ) ) );
	rgh.assign( mix( rgh, 0.96, soilAmt.mul( 0.85 ) ) );

	// ---- 湿痕(单子 T) ----------------------------------------------------
	// masks.wet:水线 ±1.2m 且高程贴水面的地带。湿处 turf/sand/soil 变暗、
	// roughness 明显降低;w2.a 让湿边斑驳,不是一圈均匀的灰带。与下面按
	// 高度的旧岸线 damp 带互补:那个管雨水洼地,这个管池岸。

	const wetM = (clamp( sp2.g.mul( add( 0.70, w2.a.mul( 0.55 ) ) ), 0.0, 1.0 )).toVar();
	const wetTargets = clamp( bl.x.add( bl.w ).add( soilAmt ), 0.0, 1.0 );
	albedo.mulAssign( mix( vec3( 1.0 ), vec3( 0.56, 0.55, 0.57 ), wetM.mul( wetTargets ).mul( 0.85 ) ) );
	rgh.assign( mix( rgh, 0.15, wetM.mul( wetTargets ).mul( 0.85 ) ) );

	// ---- shoreline damp band ---------------------------------------------
	// Tight around the waterline: a wide gradient turns the whole beach grey.

	const wet = smoothstep( 0.13, - 0.09, vTerH );
	const sandy = bl.w.add( bl.y.mul( 0.22 ) );
	albedo.mulAssign( mix( vec3( 1.0 ), vec3( 0.50, 0.49, 0.53 ), wet.mul( sandy ) ) );
	rgh.assign( mix( rgh, 0.13, wet.mul( sandy ).mul( 0.92 ) ) );

	// ---- 苍苔(07-41「土地下蒼苔布滿」)--------------------------------------
	// 苔是地表混合,不是新几何:苔权重(mossW)把草与浮土压成湿暗的苔绿,
	// 两级高频噪声让苔成斑而不是整片染色。路面与铺装在 masks() 里已扣掉苔。

	const mossPatch = add( 0.45, mul( 0.55, smoothstep( 0.30, 0.72, w2.g.mul( 0.55 ).add( w3.g.mul( 0.45 ) ) ) ) );
	const mossAmt = clamp( mossW.mul( bl.x.add( bl.y.mul( 0.6 ) ) ).mul( mossPatch ), 0.0, 1.0 );
	const mossCol = vec3( 0.115, 0.175, 0.075 ).mul( add( 0.85, macroB.mul( 0.35 ) ) );
	albedo.assign( mix( albedo, mossCol, mossAmt ) );
	rgh.assign( mix( rgh, 0.90, mossAmt.mul( 0.5 ) ) );

	return mat3( albedo, nrm, vec3( clamp( rgh, 0.06, 1.0 ) ) );

} );

const terrainNormal = /*@__PURE__*/ Fn( ( [ normal_immutable, gNrm, viewMatrix ] ) => {

	const normal = normal_immutable.toVar();

	// The detail UVs run along world +X and +Z, so the tangent frame is those
	// two axes brought into view space and re-orthogonalised against the
	// interpolated surface normal. No derivatives, no seams on the shore slope.

	const T = (viewMatrix.mul( vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz).toVar();
	const B = (viewMatrix.mul( vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz).toVar();
	T.assign( normalize( T.sub( normal.mul( dot( normal, T ) ) ) ) );
	B.assign( normalize( B.sub( normal.mul( dot( normal, B ) ) ).sub( T.mul( dot( T, B ) ) ) ) );
	const mn = (gNrm).toVar();
	mn.xy.mulAssign( uNormalStrength );
	normal.assign( normalize( T.mul( mn.x ).add( B.mul( mn.y ) ).add( normal.mul( max( mn.z, 0.15 ) ) ) ) );

	return normal;

} );

return {terrainSurface, terrainNormal};
}
