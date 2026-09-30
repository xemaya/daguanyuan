import { exportBakedTextures } from '@engine/core/TextureLab';
import { bakeTextureJob, type TextureJob } from './texture-jobs';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<TextureJob>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = ({ data: job }) => {
  try {
    const start = performance.now();
    bakeTextureJob(job);
    const textures = exportBakedTextures();
    scope.postMessage({ job, textures, ms: performance.now() - start }, textures.map(t => t.data.buffer as ArrayBuffer));
  } catch (error) {
    scope.postMessage({ job, error: error instanceof Error ? error.message : String(error) });
  }
};
