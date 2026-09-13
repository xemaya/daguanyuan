# WG migration evidence

## WG0 — frozen baseline

Source: `f448d25782dfeb2c007c5dff063fb4fcf67b6c0d`, editor. Three and types pinned to 0.185.1. Frozen independently runnable build: `artifacts/wg0-webgl/dist/` (local, ignored build output). Serve using `npx vite preview --outDir artifacts/wg0-webgl/dist --port 4801 --strictPort`; garden is `/garden.html`. Rebuild from the source commit if the local artifact is absent.

Historical visual reference remains `shots/opq`: 14 cameras, 2.55–3.61 M submitted triangles, 131–246 calls, 79–186 fps. Its recorded buildMs is **16285.7 ms**; task text's 13.4 s comes from another run and is not the manifest measurement. Historical captures did not freeze animation time or adaptive resolution; do not treat these FPS as controlled performance results. Source renderer actually uses PCFShadowMap; migration preserves PCF.

Controlled comparison contract: cameras from tools/capture.mjs, seed from World (unchanged), environment 9.4 h, animation time 10 s, viewport 1600×900, device scale 1, high quality, fixed renderer pixel ratio 1, adaptive resolution off. Part photos: 1000×1000, three_quarter, studio, same framing. Cold world build and warmed rendering reported separately.

Browser matrix: installed Chromium actual WebGPU required for primary acceptance, same node material renderer with forceWebGL for WebGL2 compatibility; Safari/Firefox manual device acceptance pending unless run. Backend is read after init from backend.isWebGPUBackend / isWebGLBackend. Never infer it from navigator.gpu or renderer class.

Baseline gates: six gates and 139/139 tests passed (parent independent run); npm run build passed, 1.23 s bundling. WG0 does not change geometry or visuals.

## WG1 — part viewer

Viewer now initializes WebGPURenderer before PMREM, compiles the scene, renders a first frame before publishing readiness, and uses RenderPipeline + SMAA with exactly one output conversion. Standard wood/stone materials, neutral lighting, PCF and camera framing are unchanged. `?backend=webgl2` requests the same renderer's forceWebGL compatibility path.

Actual initialized backends verified: WebGPU and WebGL2, building:ting and taihu:peak. Both backends reported identical submitted geometry/size (55,198 / 26,152 triangles; 20 / 7 all-frame drawCalls including post), no console/page errors on load or resize. Images and manifest: `shots/wg1/`. Reproducer: `node tools/wg-viewer-check.mjs`. Typecheck and build passed. This phase migrates the viewer only, not the garden.

WG1 unchanged-world cold build measured 17089.29999998212 ms (shots/wg1-world; not a controlled FPS comparison).

## WG2 — node materials and garden initialization

Seven legacy GLSL injection sites have been replaced by node materials (post temporarily reduced to a single scene/output node). Terrain, sky, water and wind retain the original arithmetic in committed TSL expressions produced offline with the pinned r185 transpiler. Runtime contains neither GLSL strings nor the transpiler. Generated function layouts were removed after real WebGPU compilation exposed a closure-uniform binding problem in shadow contexts; mutable GLSL aliases were made explicit TSL variables. Geometry generators, plan and TERRAIN shape remain unchanged.

Wind coordinate contract: r185 applies instanceMatrix before positionNode. Common position helpers apply only model/world matrices, w=0 for displacement, cancelling root rotation for world wind. Rest coordinates are saved before deformation for triplanar maps. Position nodes are shared by beauty and shadow and will feed MRT in WG3. Foliage wrap/transmission remain shadow-attenuated direct lighting, with the original diffuseContribution; canopy shadows use castShadowNode to perforate only the shadow. PCF is preserved. First camera projection and culling are backend-aligned before the first frame.

Engine initialization is awaited before PMREM. The garden and turntable publish readiness after a rendered first frame. Rendering is capped at 60 fps; fixed captures disable adaptive resolution and hold both elapsed and wind time at 10 s. Map-origin clicks stop at the overlay (including a click that closes it); map-related unlock suppresses pause cards. Quality/post effects are restored in the next commit.

Independent samples: `viewer.html?sample=sky|terrain|water|foliage`, plus bamboo in normal viewer. All five groups rendered on actual WebGPU and forced WebGL2, 10/10 runs with no console/page errors. `shots/wg2-samples/manifest.json` includes backend and samples' build times. Both backends returned the same submitted geometry per sample. Foliage sample shows visible perforations in the ground shadow. Dynamic shadow/culling validation remains WG4 work.

Garden WebGPU: pond_reveal, xiaoxiang, backlit all rendered, no console errors, world build 16.344 s versus historical manifest 16.286 s. These screenshots use temporary simple post; do not judge final color/AO/AA yet. One first camera transition recorded 1 fps during shader warmup, so no stable performance claim is made. Full init/build/compile/first-frame/ready timing is now exposed; culling runs before precompilation. WG preview is isolated at `artifacts/wg-current/dist`, served on 4801, so concurrent R builds cannot overwrite it. Six gates and 139/139 tests passed.

WG2 forced WebGL2 garden pond_reveal/xiaoxiang also passed with no errors and the same submitted geometry as WebGPU. World build 16.855 s; measured total ready 58.307 s = 0.012 s renderer init + 16.855 s world + 29.126 s precompile + 12.310 s first frame. Shader startup is an explicit remaining performance concern for WG4, not hidden inside the world metric.
