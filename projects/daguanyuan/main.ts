import * as THREE from 'three';
import { Engine } from '@engine/core/Engine';
import { EVENTS } from '@engine/core/Context';
import { World } from '@builder/compose/world';
import { setPlan, type GardenPlan } from '@builder/compose/terrain';
import { PlayerController } from '@engine/player/PlayerController';
import { HUD } from '@engine/ui/HUD';
import { AudioDirector } from '@engine/audio/Audio';
import planFile from '@project/plan.json' with { type: 'json' };

/**
 * Player spawn: just outside the 正门 gate, facing north into the garden.
 * P1 Task 6: coordinates are plan.json's now — the gate itself sits at
 * (55,250) (`plan.gates`), zhengmen's own recorded entrance point is
 * (55,244); spawn a couple of metres south of that, still inside the wall.
 */
const SPAWN = new THREE.Vector3(55, 0, 248);
const SPAWN_YAW = 0;

async function boot(): Promise<void> {
  // P1 Task 6: `builder/` may not import `@project/plan.json` itself
  // (`check:layers`), so the project layer injects it once, before
  // `world.build()` walks its steps and reaches `buildTerrain`/`buildGarden`.
  setPlan(planFile as unknown as GardenPlan);

  const container = document.getElementById('app')!;
  const engine = new Engine(container);
  // Demand-built vegetation must warm the actual spawn before loading completes.
  engine.camera.position.copy(SPAWN);
  engine.initPost();

  const world = new World(engine);
  const hud = new HUD(world.ctx);
  const audio = new AudioDirector(world.ctx);

  await world.build((label, pct) => hud.setLoading(label, pct));

  const player = new PlayerController(world.ctx, SPAWN, SPAWN_YAW);
  player.teleport(SPAWN, SPAWN_YAW);

  // Update order: input -> player -> world -> hud.
  engine.add({ name: 'player-sys', update: (dt) => player.update(dt) });
  engine.add({ name: 'world-sys', update: (dt, t) => world.update(dt, t) });
  engine.add({ name: 'hud-sys', update: (dt) => hud.update(dt) });
  engine.add({ name: 'audio-sys', update: (dt) => audio.update(dt) });

  // Interact key.
  engine.add({
    name: 'interact-sys',
    update: () => {
      const dialogueConsumed = hud.dialogue.consumeConfirm();
      if (
        engine.input.wasPressed('KeyE') ||
        engine.input.wasPressed('Enter') ||
        engine.input.wasPressed('NumpadEnter')
      ) {
        // Dialogue gets first refusal because its capture-phase key handler
        // may have closed the panel before this frame runs. Without this
        // explicit consumption check, that closing press would immediately
        // reactivate a still-focused sign or doorway.
        if (!dialogueConsumed && !engine.input.suspended) {
          world.interaction.activate();
        }
        world.ctx.events.emit('input:confirm');
      }
    },
  });

  hud.hideLoading();
  engine.start();

  // Expose for the automated visual-QA harness.
  Object.assign(window, { __GAME__: { engine, world, player, hud, THREE } });
  window.dispatchEvent(new CustomEvent('game:ready'));
  world.ctx.events.emit(EVENTS.WORLD_READY);

  // Pointer lock on every click that reaches the container, not just the first:
  // a request can be refused (Chrome ignores one for about a second after Esc),
  // and the next click has to be able to try again.
  //
  // The lock is asked for first and synchronously. Browsers only honour a
  // request made directly inside the gesture that triggered it, so nothing may
  // be awaited ahead of it — `audio.unlock()` follows for that reason.
  container.addEventListener('click', () => {
    engine.input.requestLock();
    audio.unlock();
  });
}

boot().catch((err) => {
  console.error('[boot] failed', err);
  const el = document.getElementById('app');
  if (el) {
    el.innerHTML = `<pre style="color:#f88;padding:24px;font:13px ui-monospace,monospace;white-space:pre-wrap">${
      (err && err.stack) || err
    }</pre>`;
  }
  window.dispatchEvent(new CustomEvent('game:error', { detail: String(err) }));
});
