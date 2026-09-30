import * as THREE from 'three';
import type { Engine } from '@engine/core/Engine';
import { EventBus, EVENTS, type GameContext, type EnvironmentState } from '@engine/core/Context';
import { CollisionWorld } from '@engine/player/Collision';
import { InteractionSystem } from '@engine/player/Interaction';

import { buildAtmosphere } from '@engine/render/Atmosphere';
import { buildTerrain, getPlan, builtRegions } from './terrain';
import { buildOccupancy, setOccupancy } from './occupancy';
import { resetRoster } from './roster';
import { getScenes } from './scenes';
import { buildWater, setWaterFlows } from '@engine/render/Water';
import { buildVegetation } from '@builder/parts/zhiwu/vegetation';
import { buildGarden } from './composer';
import { startTextureWarmup } from './prewarm-textures';
import { TERRAIN_TEXTURE_JOBS } from './texture-jobs';
import {SEED} from './config';

/**
 * World — orchestrates the build order for the garden.
 *
 * Order matters: terrain publishes the heightfield that everything else
 * samples to sit on the ground.
 *
 * The actual order is still vegetation BEFORE buildings (植树 → 起屋叠石),
 * and that is fine now: 单子 Z 在两者之前插了一步「圈地」(occupancy prepass,
 * `occupancy.ts`)。占位不再来自建出来的几何，而是从 `plan.json` 的
 * `construction.spec` 编译出檐口外包络、加上 `scenes/*.json` 的 `clearances[]`
 * ——**一份真源，房子一挪占位跟着挪**。`vegetation.ts` 那份手抄的 `FOOTPRINTS`
 * 副本已经删掉（missing 99-25 就此销账）。
 *
 * 原来那条警告仍然成立、也仍然重要：**不要靠调换建筑与植被的顺序来修**，
 * 那会让手抄的那份变成唯一真源。正解是把占位从「建出来的几何」里解耦出来，
 * 也就是现在这一步。
 * P2 的墙/廊/桥路径本来就从 plan 供给种植净空，那部分不变。
 */
export {SEED} from './config';

export class World {
  readonly name = 'world';
  readonly ctx: GameContext;
  readonly collision = new CollisionWorld();
  readonly interaction: InteractionSystem;
  readonly root = new THREE.Group();

  private ticks: ((dt: number, elapsed: number) => void)[] = [];

  /** Per-step build durations in ms, populated by build(). */
  buildTimings: [string, number][] = [];
  /** Includes asynchronous preparation and inter-step paint yields. */
  buildDurationMs = 0;

  constructor(engine: Engine) {
    this.root.name = 'World';
    engine.scene.add(this.root);

    this.interaction = new InteractionSystem(engine.camera);

    const env: EnvironmentState = {
      timeOfDay: 9.4,
      sunDirection: new THREE.Vector3(-0.42, -0.62, -0.66).normalize(),
      sunColor: new THREE.Color(1.0, 0.94, 0.82),
      skyColor: new THREE.Color(0.42, 0.66, 0.95),
      groundColor: new THREE.Color(0.36, 0.42, 0.3),
      windStrength: 0.42,
      windDirection: new THREE.Vector2(0.86, 0.51).normalize(),
      windTime: { value: 0 },
    };

    this.ctx = {
      engine,
      scene: this.root,
      stage: engine.scene,
      camera: engine.camera,
      collision: this.collision,
      interaction: this.interaction,
      seed: SEED,
      tick: (fn) => this.ticks.push(fn),
      events: new EventBus(),
      env,
    };
  }

  async build(onProgress?: (label: string, pct: number) => void): Promise<void> {
    // 单子 BH1:贴图预热开页就发起,不再是第一步整段 await(以前主线程在「调色」里干等 5–8 s)。
    // 只在真要用预热贴图之前等:「理地」要四张地面图(排在队列最前),「植树」「起屋叠石」要其余全部。
    // 夹在中间的开天、圈地、引水,以及理地里的 splat 与网格,都不读预热贴图,于是和 worker 同时跑。
    // 等的时间仍是建时里的两步(「调色·地面」「调色」),不从加载预算里消失(prewarm-textures.ts 头注)。
    // 派单顺序:地面四张最先(理地在等它们),植被的树皮 / 叶片(`foliage`,主线程上原要 3.7 s)紧随其后,赶在植树之前烤完。
    const warmup = startTextureWarmup([...TERRAIN_TEXTURE_JOBS, 'foliage']);
    const steps: [string, (ctx: GameContext) => void | Promise<void>][] = [
      ['开天', buildAtmosphere],
      ['调色·地面', () => warmup.ready(TERRAIN_TEXTURE_JOBS)],
      // 清单每次重建清空一次,免得热重载时越攒越多(它是模块级的共享数组)。
      ['理地', (ctx) => { resetRoster(); buildTerrain(ctx); }],
      // 单子 Z · 接缝 ③:占位预计算。必须排在「植树」之前——植被读它来避让。
      // 它从 plan 的 construction.spec 编译檐口外包络,加上 scenes 的 clearances,
      // 是占位的**唯一真源**;vegetation.ts 那份手抄的 FOOTPRINTS 副本已经删掉
      // (missing 99-25)。注意 world.ts 原来的警告仍然成立:修法**不是**调换
      // 建筑与植被的顺序,而是把占位从「建出来的几何」里解耦成一次预计算。
      ['圈地', () => setOccupancy(buildOccupancy(getPlan(), builtRegions(), getScenes()))],
      ['引水', (ctx) => { setWaterFlows(getPlan().water); buildWater(ctx); }],
      ['调色', async () => { this.root.userData.textureWarmup = await warmup.done; }],
      ['植树', buildVegetation],
      ['起屋叠石', buildGarden],
    ];

    // Per-step timings. Load time is on the player's critical path and every
    // subsystem's texture bakes are synchronous, so it is worth knowing which
    // step is expensive rather than guessing.
    const timings: [string, number][] = [];
    const t0 = performance.now();

    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      onProgress?.(label, i / steps.length);
      // Yield to the event loop so the loading screen can actually paint
      // between heavy synchronous bakes.
      await new Promise((r) => requestAnimationFrame(r));
      const start = performance.now();
      await fn(this.ctx);
      timings.push([label, performance.now() - start]);
    }

    const total = performance.now() - t0;
    console.info(
      `[world] built in ${(total / 1000).toFixed(1)}s — ` +
        timings
          .slice()
          .sort((a, b) => b[1] - a[1])
          .map(([l, ms]) => `${l} ${(ms / 1000).toFixed(1)}s`)
          .join(', '),
    );
    this.buildTimings = timings;
    this.buildDurationMs = total;

    onProgress?.('请入园', 1);
    this.ctx.events.emit(EVENTS.WORLD_READY);
  }

  update(dt: number, elapsed: number): void {
    this.ctx.env.windTime.value += dt;
    this.interaction.update(dt);
    for (const fn of this.ticks) fn(dt, elapsed);
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
  }
}
