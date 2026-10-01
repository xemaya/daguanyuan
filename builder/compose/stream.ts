import * as THREE from 'three';
import type { GameContext } from '@engine/core/Context';
import type { GardenComposer, StagedGardenUnit } from './composer';
import { unitTexturesReady } from './prewarm-textures';

/**
 * 单子 BH2:进园之后在后台把其余建成区建完(`D-44`:两段就绪,不设「走近才建」的半径)。
 *
 * **调度不挂在渲染上。** BG 的「闲着少画」会让引擎降频(静止 20 帧)、甚至停画(开场卡 / 暂停卡 / 游园图开着);
 * 建造要是挂在 `engine.systems` 或 `postfx.render` 上,开场卡一挂就停摆。所以这里自己用 `MessageChannel` 排宏任务:
 * 每一片在 `sliceMs` 内一件接一件地建(构件原型第一次建是整件做、不切半——`D-44` 甲,卡顿先量不修),片与片之间让出主线程,
 * 渲染照它自己的节奏走。建造**不碰**引擎的节奏状态(不 `requestFrame`、不动 `renderState`),新区挂上以后下一次该画时自然出现。
 *
 * **一个区建完才挂进场景**(`GardenComposer.commit`):先把它的管线按主场景 pass 编好(`PostFX.compileObjectAsync`),
 * 再并碰撞、挂网格——半个区不会出现在画面里,也不会有看不见的墙。
 */
export interface StreamJob {
  unit: string;
  /** 这个单位的建造片数、建造墙钟合计(不含片间让出)、最长的一片。 */
  slices: number;
  buildMs: number;
  longestSliceMs: number;
  compileMs: number;
  /** 挂进场景时管线还没编完(等满 `compileCapMs` 就先挂上,剩下的在后台接着编;编完之前那几样不画)。 */
  compilePendingAtCommit: boolean;
  /** 从开始建到挂进场景的墙钟。 */
  wallMs: number;
  placements: number;
  /** 挂进场景那一刻(页面 `performance.now()`)。 */
  committedAt: number;
}

export interface StreamStatus {
  mode: 'off' | 'stream';
  units: Record<string, 'built' | 'queued' | 'building'>;
  /** B 段实际的出队顺序(建完一个记一个)。 */
  order: string[];
  pending: number;
  held: boolean;
  jobs: StreamJob[];
  /** 全部建完的时刻(页面 `performance.now()`):全部挂进场景、而且后台编管线也都编完了。没到是 null。 */
  allLoadedAt: number | null;
  /** 全部挂进场景的时刻(管线可能还在编)。 */
  allCommittedAt: number | null;
}

/** 让出主线程一次(宏任务;不受 rAF 暂停、也不受 setTimeout 的 4 ms 夹紧)。 */
function makeYield(): () => Promise<void> {
  const ch = new MessageChannel();
  const waiters: (() => void)[] = [];
  ch.port1.onmessage = () => waiters.shift()?.();
  // Node(单元测试)里 MessagePort 会把进程吊着不退;浏览器没有 unref。
  (ch.port1 as unknown as { unref?: () => void }).unref?.();
  (ch.port2 as unknown as { unref?: () => void }).unref?.();
  return () => new Promise<void>((resolve) => { waiters.push(resolve); ch.port2.postMessage(0); });
}

export class BackgroundBuilder {
  readonly status: StreamStatus;
  private readonly queue: string[];
  private readonly waiters = new Map<string, (() => void)[]>();
  private allWaiters: (() => void)[] = [];
  private running = false;
  private readonly yieldTask = makeYield();
  /**
   * 编管线排成一条链:同一时刻只编一个区——编译期间渲染器停在场景 pass 的目标 / MRT 上(PostFX.compileObjectAsync),
   * 两段编译交叠会把对方的状态还错。建造不等这条链:下一个区照建,只有「挂进场景」等自己那一段(最多 `compileCapMs`)。
   */
  private compileChain: Promise<void> = Promise.resolve();
  /**
   * 挂上之前最多等编译多久。真浏览器里 BG 的暂停档(开场卡挂着)不出帧,GPU 进程那头管线编得极慢
   * (实测一个区 12–120 s,活跃出帧时 0.2–0.6 s);等满这么久就先挂上,没编完的那几样编完才画。
   */
  private readonly compileCapMs = 3000;

  /**
   * @param built A 段已经挂进场景的单位。
   * @param queue B 段的默认出队顺序(调用方排:可见关系优先、再按距离;或 `?streamOrder=` 指定)。
   * @param held 真:不自己出队,只建被 `prioritize` 点名的(测试「传送到未建区」用)。
   */
  private readonly ctx: GameContext;
  private readonly garden: GardenComposer;
  /** 一片建造的时间预算(毫秒):片内一件接一件,超了就让出主线程。原型第一次建是整件做,一片可能远超它。 */
  private readonly sliceMs: number;

  constructor(ctx: GameContext, garden: GardenComposer, built: readonly string[], queue: readonly string[], held = false, sliceMs = 8) {
    this.ctx = ctx;
    this.garden = garden;
    this.sliceMs = sliceMs;
    this.queue = [...queue];
    const units: StreamStatus['units'] = {};
    for (const u of built) units[u] = 'built';
    for (const u of queue) units[u] = 'queued';
    const now = queue.length ? null : performance.now();
    this.status = { mode: 'stream', units, order: [], pending: queue.length, held, jobs: [], allLoadedAt: now, allCommittedAt: now };
  }

  get busy(): boolean { return this.status.pending > 0 && (!this.status.held || this.running); }

  isBuilt(unit: string): boolean { return this.status.units[unit] === 'built' || !(unit in this.status.units); }

  /** 开始(或继续)在后台出队。 */
  start(): void {
    if (!this.running) void this.run();
  }

  /** 把一个单位插到队首,建完 resolve(已建完立即 resolve)。游园图点到未建区时用。 */
  prioritize(unit: string): Promise<void> {
    if (this.isBuilt(unit)) return Promise.resolve();
    const i = this.queue.indexOf(unit);
    if (i > 0) { this.queue.splice(i, 1); this.queue.unshift(unit); }
    const p = new Promise<void>((resolve) => { const l = this.waiters.get(unit) ?? []; l.push(resolve); this.waiters.set(unit, l); });
    this.start();
    return p;
  }

  /** 全部建完 resolve。held 下会先放开再出队(工具「全部加载完再量」)。 */
  loadAll(): Promise<void> {
    if (this.status.allLoadedAt !== null) return Promise.resolve();
    this.status.held = false;
    const p = new Promise<void>((resolve) => this.allWaiters.push(resolve));
    this.start();
    return p;
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length) {
        // held:队首不是被点名的就停下,等下一次 prioritize / loadAll。
        if (this.status.held && !this.waiters.has(this.queue[0])) break;
        const unit = this.queue.shift()!;
        this.status.units[unit] = 'building';
        const job = await this.buildOne(unit);
        this.status.units[unit] = 'built';
        this.status.order.push(unit);
        this.status.jobs.push(job);
        this.status.pending = this.queue.length;
        this.ctx.events.emit('world:unit-built', unit);
        for (const w of this.waiters.get(unit) ?? []) w();
        this.waiters.delete(unit);
      }
      if (!this.queue.length && this.status.allLoadedAt === null) {
        this.status.allCommittedAt = performance.now();
        await this.compileChain;
        this.status.allLoadedAt = performance.now();
        this.ctx.events.emit('world:all-loaded', this.status);
        for (const w of this.allWaiters) w();
        this.allWaiters = [];
      }
    } finally {
      this.running = false;
    }
  }

  private async buildOne(unit: string): Promise<StreamJob> {
    // 单子 BI3:先等这个区要的 B 批贴图(`UNIT_TEXTURE_JOBS`)在 worker 里烤完并 adopt——没赶上就在这里等,
    // 而不是开建后在主线程同步烤(那是 BI 之前 2.5 s 的长帧)。等的时间算进这个区的墙钟(t0 在等之前)。
    const t0 = performance.now();
    await unitTexturesReady(unit);
    const gen = this.garden.unitSteps(unit);
    let staged: StagedGardenUnit | undefined;
    let slices = 0, buildMs = 0, longest = 0;
    for (;;) {
      await this.yieldTask();
      const s0 = performance.now();
      let r = gen.next();
      while (!r.done && performance.now() - s0 < this.sliceMs) r = gen.next();
      const ms = performance.now() - s0;
      slices++; buildMs += ms; longest = Math.max(longest, ms);
      if (r.done) { staged = r.value; break; }
    }
    await this.yieldTask();
    const c0 = performance.now();
    let compileMs = -1;
    const mine = this.compileChain.then(() => this.compile(staged)).catch((e) => console.error('[stream] 编管线失败', unit, e)).then(() => { compileMs = performance.now() - c0; });
    this.compileChain = mine;
    let timer = 0;
    await Promise.race([mine, new Promise<void>((r) => { timer = setTimeout(r, this.compileCapMs) as unknown as number; })]);
    clearTimeout(timer);
    const compilePendingAtCommit = compileMs < 0;
    this.garden.commit(staged);
    const committedAt = performance.now();
    const job: StreamJob = { unit, slices, buildMs, longestSliceMs: longest, compileMs, compilePendingAtCommit, wallMs: committedAt - t0, placements: this.garden.placementsIn(unit), committedAt };
    if (compilePendingAtCommit) void mine.then(() => { job.compileMs = compileMs; });
    return job;
  }

  /**
   * 挂进场景之前把这个区的管线按主场景 pass 编好。
   * 用一台从区的正上方俯看、把整个区框进视锥的相机(投影参数与主相机相同),并临时关掉区里的 isLOD(小件剔除、远近档)、
   * 把全部网格设为可见——否则编的只是「从某个角度此刻看得见的那几样」,其余的仍在第一次看见时同步编(`P-27` 的停顿)。
   * 阴影 pass 的管线不在这里编(第一次投影时编)。
   */
  private async compile(staged: StagedGardenUnit): Promise<void> {
    const postfx = this.ctx.engine.postfx as unknown as { compileObjectAsync?: (o: THREE.Object3D, c: THREE.Camera) => Promise<void> };
    if (!postfx.compileObjectAsync) return;
    const roots: THREE.Object3D[] = [staged.root, ...staged.dyn];
    const box = new THREE.Box3();
    for (const r of roots) { r.updateMatrixWorld(true); box.expandByObject(r); }
    if (box.isEmpty()) return;
    const cam = (this.ctx.camera as THREE.PerspectiveCamera).clone();
    const center = box.getCenter(new THREE.Vector3()), radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    const dist = Math.min(cam.far * 0.8, radius / Math.sin(THREE.MathUtils.degToRad(Math.min(cam.fov, cam.fov * cam.aspect) / 2)) + 1);
    cam.position.set(center.x, center.y + dist, center.z + 0.001);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    const restore: (() => void)[] = [];
    for (const r of roots) r.traverse((o) => {
      const lod = o as THREE.Object3D & { isLOD?: boolean; autoUpdate?: boolean };
      if (lod.isLOD && lod.autoUpdate) { lod.autoUpdate = false; restore.push(() => { lod.autoUpdate = true; }); }
      if (!o.visible) { o.visible = true; restore.push(() => { o.visible = false; }); }
    });
    try {
      for (const r of roots) await postfx.compileObjectAsync(r, cam);
    } finally {
      for (const f of restore) f();
    }
  }
}
