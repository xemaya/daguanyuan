import { adoptBakedTextures, type BakedTexture } from '@engine/core/TextureLab';
import { TEXTURE_JOBS, DEFERRED_TEXTURE_JOBS, ALL_TEXTURE_JOBS, UNIT_TEXTURE_JOBS, type TextureJob } from './texture-jobs';

export interface TextureWarmupResult {
  workers: number;
  /** A 批(`done` 时已齐)。 */
  jobs: { job: TextureJob; ms: number; textures: number }[];
  /**
   * 单子 BI2:B 批——`done` 之后才派,adopt 一个往这里追加一个(同一个对象,`root.userData.textureWarmup` 读得到后来的)。
   * `at` = adopt 时刻(performance.now),好与 B 段各区开建时刻对账。
   */
  deferred: { job: TextureJob; ms: number; textures: number; at: number }[];
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
  /** A 批全部结束(或失败回落)。「调色」等的就是它;B 批不在里面(单子 BI2)。 */
  done: Promise<TextureWarmupResult>;
  /** A、B 两批都结束。 */
  all: Promise<TextureWarmupResult>;
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
    const result: TextureWarmupResult = { workers: 0, jobs: [], deferred: [], fallback: 'Worker/OffscreenCanvas unavailable; synchronous recipes remain enabled' };
    const w: TextureWarmup = { ready: async () => {}, done: Promise.resolve(result), all: Promise.resolve(result) };
    active = w;
    return w;
  }
  // A 批:first 里的先派,其余按 TEXTURE_JOBS 原序。B 批(单子 BI2):A 批全部 adopt 后才派,按 DEFERRED_TEXTURE_JOBS 原序。
  const jobsA: TextureJob[] = [...first.filter((j) => TEXTURE_JOBS.includes(j as never)), ...TEXTURE_JOBS.filter((j) => !first.includes(j))];
  const jobsB: TextureJob[] = [...DEFERRED_TEXTURE_JOBS];
  const workers = Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
  const running = new Map<Worker, () => void>();
  const result: TextureWarmupResult = { workers, jobs: [], deferred: [] };
  const adopted = new Set<TextureJob>();
  /** 不再会有 adopt 的 job(批次失败 / 取消):等它的人直接放行,回落主线程同步烤。 */
  const abandoned = new Set<TextureJob>();
  const waiters: { jobs: readonly TextureJob[]; resolve: () => void }[] = [];
  const wake = (): void => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].jobs.every((j) => adopted.has(j) || abandoned.has(j) || !ALL_TEXTURE_JOBS.includes(j as never))) waiters.splice(i, 1)[0].resolve();
    }
  };
  const bake = (job: TextureJob) => new Promise<{ job: TextureJob; ms: number; textures: BakedTexture[] }>((resolve, reject) => {
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
  /** 一批:`workers` 条并行的拉取线,各自从队列取下一个 job,烤完逐个 adopt(分段等才有意义)。 */
  const runBatch = async (jobs: TextureJob[], record: (r: { job: TextureJob; ms: number; textures: BakedTexture[] }) => void): Promise<void> => {
    let next = 0;
    const lane = async (): Promise<void> => {
      while (next < jobs.length) {
        const r = await bake(jobs[next++]);
        adoptBakedTextures(r.textures);
        adopted.add(r.job);
        record(r);
        wake();
      }
    };
    try {
      await Promise.all(Array.from({ length: workers }, lane));
    } catch (error) {
      next = jobs.length;
      for (const cancel of running.values()) cancel();
      throw error;
    }
  };
  const done = (async (): Promise<TextureWarmupResult> => {
    try {
      await runBatch(jobsA, (r) => result.jobs.push({ job: r.job, ms: r.ms, textures: r.textures.length }));
      return result;
    } catch (error) {
      result.workers = 0; result.jobs = [];
      result.fallback = error instanceof Error ? error.message : String(error);
      return result;
    } finally {
      for (const j of jobsA) if (!adopted.has(j)) abandoned.add(j);
      wake();
    }
  })();
  const all = (async (): Promise<TextureWarmupResult> => {
    const a = await done;
    if (a.fallback) { for (const j of jobsB) abandoned.add(j); wake(); return a; }
    try {
      await runBatch(jobsB, (r) => result.deferred.push({ job: r.job, ms: r.ms, textures: r.textures.length, at: performance.now() }));
    } catch (error) {
      result.fallback = `B 批:${error instanceof Error ? error.message : String(error)}`;
    } finally {
      for (const j of jobsB) if (!adopted.has(j)) abandoned.add(j);
      wake();
    }
    return result;
  })();
  const w: TextureWarmup = {
    ready: (want) => new Promise<void>((resolve) => { waiters.push({ jobs: want, resolve }); wake(); }),
    done,
    all,
  };
  active = w;
  return w;
}

/** 最近一次发起的预热(B 段的区建造前按区等,见 `unitTexturesReady`)。 */
let active: TextureWarmup | null = null;

/**
 * 单子 BI2:B 段建某区之前只等该区要的那几个 B 批 job(`UNIT_TEXTURE_JOBS`);表里没有的区、没有发起过预热、
 * 或预热已失败回落,都立刻放行(主线程照旧同步烤,结果逐位相同)。
 */
export function unitTexturesReady(unit: string): Promise<void> {
  const want = UNIT_TEXTURE_JOBS[unit];
  if (!active || !want?.length) return Promise.resolve();
  return active.ready(want);
}

/** 一次等全部——A 批 + B 批(旧入口,`tools/verify-texture-workers.mjs` 与不分段的调用方用)。 */
export function prewarmTextures(): Promise<TextureWarmupResult> {
  return startTextureWarmup().all;
}
