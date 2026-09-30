import { WebGPURenderer } from 'three/webgpu';

/** Backend identity is meaningful only after init(), including automatic fallback. */
export function backendName(renderer: WebGPURenderer): 'webgpu' | 'webgl2' | 'uninitialized' {
  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
  return backend.isWebGPUBackend ? 'webgpu' : backend.isWebGLBackend ? 'webgl2' : 'uninitialized';
}

export function rendererOptions(): { forceWebGL: boolean; trackTimestamp: boolean } {
  const params = new URLSearchParams(location.search);
  return { forceWebGL: params.get('backend') === 'webgl2', trackTimestamp: params.has('profile') };
}
