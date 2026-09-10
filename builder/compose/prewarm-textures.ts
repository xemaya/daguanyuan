import { adoptBakedTextures, type BakedTexture } from '@engine/core/TextureLab';
import { TEXTURE_JOBS, type TextureJob } from './texture-jobs';

export interface TextureWarmupResult {
  workers: number;
  jobs: { job: TextureJob; ms: number; textures: number }[];
  fallback?: string;
}

/** Preparation is awaited inside world.build; moving work must not hide it from the load budget. */
export async function prewarmTextures(): Promise<TextureWarmupResult> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return { workers: 0, jobs: [], fallback: 'Worker/OffscreenCanvas unavailable; synchronous recipes remain enabled' };
  }
  const jobs = TEXTURE_JOBS;
  const workers = Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
  const running = new Map<Worker, () => void>();
  const results: { job: TextureJob; ms: number; textures: BakedTexture[] }[] = [];
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const result = await new Promise<typeof results[number]>((resolve, reject) => {
        const worker = new Worker(new URL('./texture-bake.worker.ts', import.meta.url), { type: 'module' });
        const finish = () => { clearTimeout(timeout); running.delete(worker); worker.terminate(); };
        const timeout = setTimeout(() => { finish(); reject(new Error(`Texture job timeout: ${job}`)); }, 45000);
        running.set(worker, () => { finish(); reject(new Error('Texture preparation cancelled')); });
        worker.onmessage = ({ data }) => {
          finish();
          if (data.error) reject(new Error(data.error));
          else resolve(data);
        };
        worker.onerror = event => {
          event.preventDefault(); finish(); reject(new Error(event.message || `Texture worker failed: ${job}`));
        };
        worker.postMessage(job);
      });
      results.push(result);
    }
  };
  try {
    await Promise.all(Array.from({ length: workers }, run));
    // Publish only after all jobs succeed. A failed preparation leaves the normal cache path intact.
    for (const result of results) adoptBakedTextures(result.textures);
    return { workers, jobs: results.map(r => ({ job: r.job, ms: r.ms, textures: r.textures.length })) };
  } catch (error) {
    next = jobs.length;
    for (const cancel of running.values()) cancel();
    return { workers: 0, jobs: [], fallback: error instanceof Error ? error.message : String(error) };
  }
}
