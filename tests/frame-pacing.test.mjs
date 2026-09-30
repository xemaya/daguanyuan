import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFrameLimit } from '@engine/core/frame-pacing.ts';

/* 单子 BG2:按状态给渲染节奏。工具(throttle 假)恒为上限——这一条是硬约束。 */
const base = { throttle: true, state: 'active', focused: true, pausedDrawn: false, wake: false, frameLimit: 30, idleFps: 15, blurFps: 2 };

test('工具下(throttle 假)任何状态都是上限,暂停也照画', () => {
  for (const state of ['active', 'idle', 'paused'])
    for (const focused of [true, false])
      assert.equal(pickFrameLimit({ ...base, throttle: false, frameLimit: 60, state, focused, pausedDrawn: true }).limit, 60);
});

test('走动 30、静止 15、失焦 2', () => {
  assert.equal(pickFrameLimit(base).limit, 30);
  assert.equal(pickFrameLimit({ ...base, state: 'idle' }).limit, 15);
  assert.equal(pickFrameLimit({ ...base, focused: false }).limit, 2);
  assert.equal(pickFrameLimit({ ...base, state: 'idle', focused: false }).limit, 2);
});

test('暂停:画一帧就停,补画请求再画一帧', () => {
  const first = pickFrameLimit({ ...base, state: 'paused' });
  assert.equal(first.limit, 30); assert.equal(first.pausedDrawn, true);
  assert.equal(pickFrameLimit({ ...base, state: 'paused', pausedDrawn: true }).limit, 0);
  const woke = pickFrameLimit({ ...base, state: 'paused', pausedDrawn: true, wake: true });
  assert.equal(woke.limit, 30); assert.equal(woke.wakeConsumed, true);
  // 离开暂停:已画标记清掉,下次再进暂停还会先画一帧。
  assert.equal(pickFrameLimit({ ...base, pausedDrawn: true }).pausedDrawn, false);
});
