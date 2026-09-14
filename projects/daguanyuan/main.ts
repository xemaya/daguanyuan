import * as THREE from 'three';
import { Engine } from '@engine/core/Engine';
import { EVENTS } from '@engine/core/Context';
import { World } from '@builder/compose/world';
import { setPlan, type GardenPlan } from '@builder/compose/terrain';
import { PlayerController } from '@engine/player/PlayerController';
import { HUD } from '@engine/ui/HUD';
import { AudioDirector } from '@engine/audio/Audio';
import { MapOverlay } from '@engine/ui/MapOverlay';
import { buildMapPlaces } from './map-places';
import { VisitedRegions } from './visited';
import planFile from '@project/plan.json' with { type: 'json' };
import './construction';

/**
 * Player spawn: just outside the 正门 gate, facing north into the garden.
 * P1 Task 6: coordinates are plan.json's now — the gate itself sits at
 * (55,250) (`plan.gates`), zhengmen's own recorded entrance point is
 * (55,244); spawn a couple of metres south of that, still inside the wall.
 */
const SPAWN = new THREE.Vector3(55, 0, 248);
const SPAWN_YAW = 0;

async function boot(): Promise<void> {
  const bootStarted = performance.now();
  const bootTimings: Record<string, number> = {};
  // P1 Task 6: `builder/` may not import `@project/plan.json` itself
  // (`check:layers`), so the project layer injects it once, before
  // `world.build()` walks its steps and reaches `buildTerrain`/`buildGarden`.
  setPlan(planFile as unknown as GardenPlan);

  const container = document.getElementById('app')!;
  const engine = new Engine(container);
  // Demand-built vegetation must warm the actual spawn before loading completes.
  engine.camera.position.copy(SPAWN);
  await engine.init();
  bootTimings.rendererInitMs = performance.now() - bootStarted;
  engine.initPost();

  const world = new World(engine);
  const hud = new HUD(world.ctx);
  const audio = new AudioDirector(world.ctx);

  await world.build((label, pct) => hud.setLoading(label, pct));

  const player = new PlayerController(world.ctx, SPAWN, SPAWN_YAW);
  player.teleport(SPAWN, SPAWN_YAW);

  // Update order: input -> player -> world -> hud.
  engine.add({ name: 'player-sys', update: (dt) => player.update(dt) });
  engine.add({ name: 'world-sys', update: (dt, t) => {
    if (engine.fixedTime !== null) world.ctx.env.windTime.value = engine.fixedTime - dt;
    world.update(dt, t);
  } });
  engine.add({ name: 'hud-sys', update: (dt) => hud.update(dt) });
  engine.add({ name: 'audio-sys', update: (dt) => audio.update(dt) });

  // ---- 游园图 --------------------------------------------------------
  // 按 M 开,点一处**走回去**。99-27 已收口:图是游历的记录——走到过的区才解锁,
  // 首次抵达只能靠腿(见 MapOverlay 与 visited.ts 的头注释)。
  const planRegions = (planFile as unknown as GardenPlan).regions;
  const visited = new VisitedRegions(planRegions as never);
  visited.update(SPAWN.x, SPAWN.z);
  const mapPlaces = buildMapPlaces(planRegions as never);
  const gardenMap = new MapOverlay(mapPlaces, (place) => {
    const y = world.ctx.collision.terrainHeight(place.target.x, place.target.z);
    player.teleport(new THREE.Vector3(place.target.x, y, place.target.z), place.yaw);
    // 收图之后把控制权还回去:指针锁要玩家自己点一下才能再拿(浏览器的手势要求)。
    engine.input.suspended = false;
  });
  for (const place of mapPlaces) {
    if (visited.has(place.id)) gardenMap.setUnlocked(place.id);
  }
  hud.root.appendChild(gardenMap.el);
  gardenMap.el.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!gardenMap.visible) engine.input.suspended = false;
  });
  hud.pauseSuppressed = () => gardenMap.visible;

  engine.add({
    name: 'map-sys',
    update: () => {
      // 图开着时 input.suspended 为真,wasPressed 会一律返回 false,所以开与关
      // 不能都走它——关图用 DOM 上的键盘监听(见下)。
      if (!gardenMap.visible && engine.input.wasPressed('KeyM')) {
        gardenMap.show();
        engine.input.suspended = true;
        if (document.pointerLockElement) document.exitPointerLock();
      }
      // 足迹:走到哪 unlock 哪——传送落地同样算到(位置是唯一真源)。
      const feet = player.state.position;
      for (const id of visited.update(feet.x, feet.z)) gardenMap.setUnlocked(id);
      if (gardenMap.visible) {
        gardenMap.setHere(feet.x, feet.z);
      }
    },
  });

  window.addEventListener('keydown', (e) => {
    if (!gardenMap.visible) return;
    if (e.code === 'KeyM' || e.code === 'Escape') {
      e.preventDefault();
      gardenMap.close();
      engine.input.suspended = false;
    }
  });

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

  // Cull before pipeline warmup using the backend-aligned projection. Future
  // cells compile on demand instead of blocking initial readiness for the whole map.
  if (engine.fixedTime !== null) world.ctx.env.windTime.value = engine.fixedTime;
  world.update(0, engine.fixedTime ?? 0);
  const compileStarted = performance.now();
  await engine.postfx.compileAsync();
  bootTimings.compileMs = performance.now() - compileStarted;
  const firstFrameStarted = performance.now();
  engine.postfx.render(0);
  bootTimings.firstFrameMs = performance.now() - firstFrameStarted;
  bootTimings.worldBuildMs = world.buildDurationMs;
  bootTimings.readyMs = performance.now() - bootStarted;
  console.info('[boot] timings', JSON.stringify(bootTimings));
  hud.hideLoading();
  engine.start();

  // Expose for the automated visual-QA harness.
  Object.assign(window, { __GAME__: { engine, world, player, hud, THREE, bootTimings } });
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
    if (gardenMap.visible || !engine.running) return;
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
