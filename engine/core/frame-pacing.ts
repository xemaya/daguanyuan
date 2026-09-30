/**
 * 单子 BG2(D-43):按状态给渲染节奏——纯函数,引擎每个 rAF tick 调一次。
 *
 * | 状态 | 节奏 |
 * |---|---|
 * | 走动 / 转视角(`active`) | 上限 |
 * | 站着不动、视角不动 ≥ 1 s(`idle`) | `idleFps`(20;BG3 由 15 改,见 Engine.idleFps) |
 * | 暂停卡 / 游园图 / 标题卡(`paused`) | 画完当前帧就停;`wake`(窗口大小变了)补画一帧 |
 * | 窗口失焦 | `blurFps`(2) |
 *
 * `throttle` 为假(工具,见 Engine 的注释)时恒为上限——工具靠引擎一直在画。
 */
export type RenderState = 'active' | 'idle' | 'paused';

export interface PacingInput {
  throttle: boolean;
  state: RenderState;
  focused: boolean;
  /** 这一段暂停里是否已经画过一帧。 */
  pausedDrawn: boolean;
  /** 暂停里要求补画一帧。 */
  wake: boolean;
  frameLimit: number;
  idleFps: number;
  blurFps: number;
}

export interface PacingOutput {
  /** 这一 tick 的帧率上限;0 = 不画。 */
  limit: number;
  pausedDrawn: boolean;
  /** 补画请求是否已被这一 tick 用掉。 */
  wakeConsumed: boolean;
}

export function pickFrameLimit(i: PacingInput): PacingOutput {
  if (!i.throttle) return { limit: i.frameLimit, pausedDrawn: false, wakeConsumed: false };
  if (i.state === 'paused') {
    if (i.pausedDrawn && !i.wake) return { limit: 0, pausedDrawn: true, wakeConsumed: false };
    return { limit: i.frameLimit, pausedDrawn: true, wakeConsumed: true };
  }
  const limit = !i.focused ? Math.min(i.frameLimit, i.blurFps)
    : i.state === 'idle' ? Math.min(i.frameLimit, i.idleFps) : i.frameLimit;
  return { limit, pausedDrawn: false, wakeConsumed: true };
}
