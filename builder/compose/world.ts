import * as THREE from 'three';
import type { Engine } from '@engine/core/Engine';
import { EventBus, EVENTS, type GameContext, type EnvironmentState } from '@engine/core/Context';
import { CollisionWorld } from '@engine/player/Collision';
import { InteractionSystem } from '@engine/player/Interaction';

import { buildAtmosphere } from '@engine/render/Atmosphere';
import { buildTerrain } from './terrain';
import { buildWater } from '@engine/render/Water';
import { buildVegetation } from '@builder/parts/zhiwu/vegetation';
import { buildGarden } from './composer';

/**
 * World — orchestrates the build order for the garden.
 *
 * Order matters: terrain publishes the heightfield that everything else
 * samples to sit on the ground.
 *
 * The actual order is vegetation BEFORE buildings (植树 → 起屋叠石). Trees
 * don't grow through porches only because vegetation.ts keeps a hand-copied
 * FOOTPRINTS table duplicating the building footprints — two sources of
 * truth for the same fact. Known debt, tracked as missing rule 99-25: the
 * real fix is a single occupancy prepass derived from plan + scenes that
 * terrain, vegetation and buildings all read (lands with P4). Do not "fix"
 * this by reordering the steps now — that would leave the hand-copied copy
 * as the only source of truth and dig the debt deeper.
 */
export const SEED = 17910000; // 程高本刊行年(1791)——大观园第一次以印本示人。

export class World {
  readonly name = 'world';
  readonly ctx: GameContext;
  readonly collision = new CollisionWorld();
  readonly interaction: InteractionSystem;
  readonly root = new THREE.Group();

  private ticks: ((dt: number, elapsed: number) => void)[] = [];

  /** Per-step build durations in ms, populated by build(). */
  buildTimings: [string, number][] = [];

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
    const steps: [string, (ctx: GameContext) => void | Promise<void>][] = [
      ['开天', buildAtmosphere],
      ['理地', buildTerrain],
      ['引水', buildWater],
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
