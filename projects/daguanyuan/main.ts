import * as THREE from 'three';
import { Engine } from '@engine/core/Engine';
import { EVENTS } from '@engine/core/Context';
import { World } from '@builder/compose/world';
import { setPlan, type GardenPlan } from '@builder/compose/terrain';
import { setScenes, validateScenes } from '@builder/compose/scenes';
import { SCENES, BUILT_REGIONS } from './scenes';
import { PlayerController } from '@engine/player/PlayerController';
import { HUD } from '@engine/ui/HUD';
import { AudioDirector } from '@engine/audio/Audio';
import { MapOverlay } from '@engine/ui/MapOverlay';
import { buildMapPlaces } from './map-places';
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

/**
 * 单子 BH2(`D-44`):两段就绪。A 段只建出生集合 + 全局件,就绪即可玩;其余建成区进园后在后台建完。
 *
 * **出生集合 S0 = 正门 + 翠嶂**:BH0 设计稿表 2——出生点北 / 东 / 西三个朝向,把 S0 以外的区整区藏掉,
 * 变化 > 16 色阶的像素最多 0.10%;藏翠嶂 1.0–21.5%、藏正门 53–57%。
 * **B 段出队**:可见关系优先(`STREAM_FIRST_SEEN`:表 2 里从 S0 看得见的区——`mound_block` 藏沁芳变 5.5%),
 * 其余按出生点到区多边形的距离。
 *
 * URL 开关(都是给工具与对照用的):
 *   `?stream=off`   BH2 之前的行为,全园一次建完(对照、回退);
 *   `?phaseA`       自动化下也在 A 段就发 `__GAME__`(默认自动化要等全部建完——工具不读半成品,设计稿 §5);
 *   `?streamHold`   B 段不自己出队,只建游园图 / `__GAME__.gotoRegion` 点名的区(测「传送到未建区」);
 *   `?streamOrder=forward|reverse|shuffle:<种子>`  改 B 段出队顺序(确定性对照:顺序不同,结果必须逐位相同)。
 */
const SPAWN_SET = ['zhengmen', 'cuizhang'];
const STREAM_FIRST_SEEN = ['qinfang_ting_qiao'];
const PARAMS = new URLSearchParams(location.search);
const STREAM = PARAMS.get('stream') !== 'off';

/** 点到多边形的最短距离(在里面为 0)。 */
function polygonDistance(poly: readonly (readonly [number, number])[], x: number, z: number): number {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi, dz = zj - zi, L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(x - xi - t * dx, z - zi - t * dz));
  }
  return inside ? 0 : best;
}

/** B 段出队顺序(只排区;哪些已在 A 段建了由 world 过滤)。 */
function streamOrder(regions: readonly { id: string; polygon: [number, number][] }[]): string[] {
  const built = regions.filter((r) => BUILT_REGIONS.includes(r.id));
  const ids = built.map((r) => r.id);
  const mode = PARAMS.get('streamOrder');
  if (mode === 'forward') return [...BUILT_REGIONS];
  if (mode === 'reverse') return [...BUILT_REGIONS].reverse();
  if (mode?.startsWith('shuffle:')) {
    let h = Number(mode.slice(8)) >>> 0 || 1;
    const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    const a = [...BUILT_REGIONS];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const dist = new Map(built.map((r) => [r.id, polygonDistance(r.polygon, SPAWN.x, SPAWN.z)]));
  const seen = STREAM_FIRST_SEEN.filter((id) => ids.includes(id));
  return [...seen, ...ids.filter((id) => !seen.includes(id)).sort((a, b) => dist.get(a)! - dist.get(b)!)];
}

async function boot(): Promise<void> {
  const bootStarted = performance.now();
  const bootTimings: Record<string, number> = {};
  // P1 Task 6: `builder/` may not import `@project/plan.json` itself
  // (`check:layers`), so the project layer injects it once, before
  // `world.build()` walks its steps and reaches `buildTerrain`/`buildGarden`.
  setPlan(planFile as unknown as GardenPlan, BUILT_REGIONS);
  // 契约错误要在建园之前当场炸,别等到构件静默丢失才发现(check:scenes 跑的是
  // 同一个 validateScenes,所以命令行与运行时判据只有一份)。
  const sceneFails = validateScenes(SCENES, planFile);
  if (sceneFails.length) throw new Error(`[scenes] 落位清单不合契约:\n${sceneFails.join('\n')}`);
  setScenes(SCENES);

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

  await world.build((label, pct) => hud.setLoading(label, pct),
    STREAM ? { first: SPAWN_SET.filter((id) => BUILT_REGIONS.includes(id)) } : undefined);

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
  // 按 M 开,点任一处已建成的区直接过去(D-41)。
  const planRegions = (planFile as unknown as GardenPlan).regions;
  const mapPlaces = buildMapPlaces(planRegions as never);
  /**
   * 单子 BH2(设计稿 §2.6):目标区已建好就直接过去;还在后台队列里就插到队首、挡上「正在造」的幕,建好再落地——
   * 碰撞是随区一起挂上的,没建好就落地会掉进没有碰撞的地方。
   */
  const gotoRegion = async (place: (typeof mapPlaces)[number]): Promise<void> => {
    const bg = world.background;
    if (bg && !bg.isBuilt(place.id)) {
      const name = place.name ?? place.id;
      hud.veil.show(`正在造 ${name}…`);
      try { await bg.prioritize(place.id); } finally { hud.veil.hide(); }
    }
    const y = world.ctx.collision.terrainHeight(place.target.x, place.target.z);
    player.teleport(new THREE.Vector3(place.target.x, y, place.target.z), place.yaw);
  };
  const gardenMap = new MapOverlay(mapPlaces, (place) => {
    void gotoRegion(place).then(() => {
      // 收图之后把控制权还回去:指针锁要玩家自己点一下才能再拿(浏览器的手势要求)。
      engine.input.suspended = false;
    });
  });
  hud.root.appendChild(gardenMap.el);
  gardenMap.el.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!gardenMap.visible) engine.input.suspended = false;
  });
  hud.pauseSuppressed = () => gardenMap.visible;

  // ---- 单子 BG2:闲着少画(D-43) ---------------------------------------
  // 暂停卡 / 标题卡 / 游园图开着 → 画完当前帧就停;玩家位置、yaw、pitch 1 s 没变 → 静止档。
  // 「不动」按状态量判,不按输入事件——传送、落地、被推开都算动。工具下(navigator.webdriver)引擎不看这个。
  {
    const last = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN };
    let movedAt = performance.now();
    engine.renderState = () => {
      if (hud.menuOpen || gardenMap.visible || hud.veil.visible) return 'paused';
      const s = player.state, p = s.position;
      if (p.x !== last.x || p.y !== last.y || p.z !== last.z || s.yaw !== last.yaw || s.pitch !== last.pitch) {
        last.x = p.x; last.y = p.y; last.z = p.z; last.yaw = s.yaw; last.pitch = s.pitch;
        movedAt = performance.now();
      }
      return performance.now() - movedAt >= 1000 ? 'idle' : 'active';
    };
  }

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
      const feet = player.state.position;
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

  // ---- 单子 BH2:B 段——其余建成区进园后后台建完 ------------------------
  // 调度自己排宏任务,不挂在渲染上:开场卡 / 暂停卡挂着(BG 停画)时照样在建。建造期间 governor 不许降像素比。
  const allLoaded = new Promise<void>((resolve) => {
    if (!STREAM) { resolve(); return; }
    world.ctx.events.on('world:all-loaded', () => resolve());
    const bg = world.startBackground(streamOrder(planRegions as never), PARAMS.has('streamHold'));
    engine.governHold = () => bg.busy;
    if (bg.status.allLoadedAt !== null) resolve();
  });
  void allLoaded.then(() => {
    bootTimings.allLoadedMs = performance.now() - bootStarted;
    console.info('[boot] all-loaded', JSON.stringify({ allLoadedMs: bootTimings.allLoadedMs, jobs: world.streaming.jobs.map((j) => [j.unit, Math.round(j.wallMs)]) }));
    window.dispatchEvent(new CustomEvent('world:all-loaded'));
  });

  // Expose for the automated visual-QA harness.
  // 单子 BH2:自动化(navigator.webdriver,与 BG 的工具开关同一个判据)下默认**全部建完**才发——capture / playtest /
  // census 这些工具一个不用改就不会读到半成品;要量 A 段就加 `?phaseA`。真浏览器里 A 段就绪即发。
  const handle = { engine, world, player, hud, THREE, bootTimings,
    /** 与游园图点地点同一条路(未建区插队首 + 幕)。 */
    gotoRegion: (id: string) => { const p = mapPlaces.find((m) => m.id === id); if (!p) throw new Error(`没有地点 ${id}`); return gotoRegion(p); },
    /** 全部建完 resolve(`?streamHold` 下会先放开队列)。 */
    loadAll: () => world.background?.loadAll() ?? Promise.resolve(),
  };
  const publish = () => {
    Object.assign(window, { __GAME__: handle });
    window.dispatchEvent(new CustomEvent('game:ready'));
  };
  if (navigator.webdriver === true && !PARAMS.has('phaseA')) void allLoaded.then(publish);
  else publish();
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
