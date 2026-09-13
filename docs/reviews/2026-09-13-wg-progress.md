# WG migration evidence

## WG0 — frozen baseline

Source: `f448d25782dfeb2c007c5dff063fb4fcf67b6c0d`, editor. Three and types pinned to 0.185.1. Frozen independently runnable build: `artifacts/wg0-webgl/dist/` (local, ignored build output). Serve using `npx vite preview --outDir artifacts/wg0-webgl/dist --port 4801 --strictPort`; garden is `/garden.html`. Rebuild from the source commit if the local artifact is absent.

Historical visual reference remains `shots/opq`: 14 cameras, 2.55–3.61 M submitted triangles, 131–246 calls, 79–186 fps. Its recorded buildMs is **16285.7 ms**; task text's 13.4 s comes from another run and is not the manifest measurement. Historical captures did not freeze animation time or adaptive resolution; do not treat these FPS as controlled performance results. Source renderer actually uses PCFShadowMap; migration preserves PCF.

Controlled comparison contract: cameras from tools/capture.mjs, seed from World (unchanged), environment 9.4 h, animation time 10 s, viewport 1600×900, device scale 1, high quality, fixed renderer pixel ratio 1, adaptive resolution off. Part photos: 1000×1000, three_quarter, studio, same framing. Cold world build and warmed rendering reported separately.

Browser matrix: installed Chromium actual WebGPU required for primary acceptance, same node material renderer with forceWebGL for WebGL2 compatibility; Safari/Firefox manual device acceptance pending unless run. Backend is read after init from backend.isWebGPUBackend / isWebGLBackend. Never infer it from navigator.gpu or renderer class.

Baseline gates: six gates and 139/139 tests passed (parent independent run); npm run build passed, 1.23 s bundling. WG0 does not change geometry or visuals.
