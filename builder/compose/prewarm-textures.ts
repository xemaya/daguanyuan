import { adoptBakedTextures, type BakedTexture } from '@engine/core/TextureLab';
import { TEXTURE_JOBS, type TextureJob } from './texture-jobs';

export interface TextureWarmupResult {
  workers: number;
  jobs: { job: TextureJob; ms: number; textures: number }[];
  fallback?: string;
}

/**
 * 一次正在跑的贴图预热(单子 BH1)。
 *
 * 以前是 `world.build` 第一步整段 `await prewarmTextures()`——worker 在烤,主线程干等 5–8 s。
 * 现在开页就发起,`world.ts` 在**真要用某几张图之前**才 `ready(那几个 job)`,中间主线程去做不要预热贴图的活
 * (splat 烘焙、地形网格、引水的海床与流场)。等的时间仍记在建时里(「调色·地面」「调色」两步),
 * **挪走不许让它从加载预算里消失**。
 */
export interface TextureWarmup {
  /** 这几个 job 的贴图都已 adopt 进缓存才 resolve。预热失败也 resolve——回落主线程按原路同步烤,结果逐位相同。 */
  ready(jobs: readonly TextureJob[]): Promise<void>;
  /** 全部 job 结束(或失败回落)。 */
  done: Promise<TextureWarmupResult>;
}

/**
 * 发起预热。`first` 里的 job 先派(理地要的四张地面图排最前,见 `world.ts`),其余按 `TEXTURE_JOBS` 原序。
 *
 * **逐个 adopt,不再全部做完才一起 adopt**(BH1 前的写法):分段等才有意义。adopt 只往缓存里填、已有的 key 跳过,
 * 所以某个 job 失败时,已 adopt 的那几张与主线程同步烤的逐位相同(`tools/verify-texture-workers.mjs` 比的就是这个),
 * 没 adopt 的照旧走主线程——与「全部失败就一张不 adopt」的结果没有区别,只是少烤了几张。
 */
export function startTextureWarmup(first: readonly TextureJob[] = []): TextureWarmup {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    const result: TextureWarmupResult = { workers: 0, jobs: [], fallback: 'Worker/OffscreenCanvas unavailable; synchronous recipes remain enabled' };
    return { ready: async () => {}, done: Promise.resolve(result) };
  }
  const jobs: TextureJob[] = [...first.filter((j) => TEXTURE_JOBS.includes(j)), ...TEXTURE_JOBS.filter((j) => !first.includes(j))];
  const workers = Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
  const running = new Map<Worker, () => void>();
  const results: { job: TextureJob; ms: number; textures: number }[] = [];
  const adopted = new Set<TextureJob>();
  let finished = false;
  const waiters: { jobs: readonly TextureJob[]; resolve: () => void }[] = [];
  const wake = (): void => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (finished || waiters[i].jobs.every((j) => adopted.has(j) || !TEXTURE_JOBS.includes(j))) waiters.splice(i, 1)[0].resolve();
    }
  };
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const result = await new Promise<{ job: TextureJob; ms: number; textures: BakedTexture[] }>((resolve, reject) => {
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
      adoptBakedTextures(result.textures);
      adopted.add(result.job);
      results.push({ job: result.job, ms: result.ms, textures: result.textures.length });
      wake();
    }
  };
  const done = (async (): Promise<TextureWarmupResult> => {
    try {
      await Promise.all(Array.from({ length: workers }, run));
      return { workers, jobs: results };
    } catch (error) {
      next = jobs.length;
      for (const cancel of running.values()) cancel();
      return { workers: 0, jobs: [], fallback: error instanceof Error ? error.message : String(error) };
    } finally {
      finished = true;
      wake();
    }
  })();
  return {
    ready: (want) => new Promise<void>((resolve) => { waiters.push({ jobs: want, resolve }); wake(); }),
    done,
  };
}

/** 一次等全部(旧入口,`tools/verify-texture-workers.mjs` 与不分段的调用方用)。 */
export function prewarmTextures(): Promise<TextureWarmupResult> {
  return startTextureWarmup().done;
}
