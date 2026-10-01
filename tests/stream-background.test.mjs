// 单子 BH2:后台建造队列(stream.ts)的调度规矩——出队顺序、插队首、held、全部建完的事件。
// 用假装配器:每个单位 3 件落位(生成器 yield 3 次),commit 记顺序;引擎没有 compileObjectAsync,编译那步直接跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundBuilder } from '../builder/compose/stream.ts';
import { EventBus } from '../engine/core/Context.ts';
import * as THREE from 'three';

// stream.ts 的 MessagePort 在 Node 里 unref 了(否则进程不退);测试期间自己挂一个定时器把事件循环吊住。
const alive = (fn) => async () => { const t = setInterval(() => {}, 50); try { await fn(); } finally { clearInterval(t); } };

function fake() {
  const committed = [];
  const garden = {
    *unitSteps(unit) { for (let i = 0; i < 3; i++) yield; return { unit, root: new THREE.Group(), dyn: [], calls: 3, work: {} }; },
    commit(staged) { committed.push(staged.unit); },
    placementsIn() { return 3; },
  };
  const events = new EventBus();
  const ctx = { events, engine: { postfx: {} }, camera: new THREE.PerspectiveCamera() };
  return { garden, ctx, committed, events };
}

test('按给定顺序全部建完,发 world:all-loaded,状态逐区记账', alive(async () => {
  const f = fake();
  let fired = 0;
  f.events.on('world:all-loaded', () => fired++);
  const bg = new BackgroundBuilder(f.ctx, f.garden, ['全局', 'a'], ['b', 'c', 'd']);
  assert.equal(bg.busy, true);
  bg.start();
  await bg.loadAll();
  assert.deepEqual(f.committed, ['b', 'c', 'd']);
  assert.deepEqual(bg.status.order, ['b', 'c', 'd']);
  assert.equal(fired, 1);
  assert.equal(bg.status.pending, 0);
  assert.ok(bg.status.allLoadedAt !== null && bg.status.allCommittedAt !== null);
  assert.equal(bg.busy, false);
  assert.ok(['a', 'b', 'c', 'd'].every((u) => bg.isBuilt(u)));
}));

test('prioritize 把没建的区插到队首;已建的立即 resolve', alive(async () => {
  const f = fake();
  const bg = new BackgroundBuilder(f.ctx, f.garden, ['a'], ['b', 'c', 'd']);
  const p = bg.prioritize('d');
  await p;
  assert.equal(f.committed[0], 'd');
  await bg.prioritize('a');
  await bg.loadAll();
  assert.deepEqual([...f.committed].sort(), ['b', 'c', 'd']);
}));

test('held:不自己出队,只建点名的;loadAll 放开以后建完', alive(async () => {
  const f = fake();
  const bg = new BackgroundBuilder(f.ctx, f.garden, [], ['b', 'c', 'd'], true);
  bg.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(f.committed, []);
  assert.equal(bg.busy, false, 'held 且没在建时不算 busy(governor 照常)');
  await bg.prioritize('c');
  assert.deepEqual(f.committed, ['c']);
  assert.equal(bg.status.units.b, 'queued');
  assert.equal(bg.status.allLoadedAt, null);
  await bg.loadAll();
  assert.deepEqual(f.committed, ['c', 'b', 'd']);
}));
