/**
 * Comfort — the player's "camera shake" preference.
 *
 * B1 (2026-09-13 走查):「晕 3d 跟行动的时候镜头有关，左右摇晃不平稳」。三个
 * 嫌疑（视角侧滚、横向摆动、速度 FOV 泵动）都活在 `PlayerController`，且都是
 * "站定观景时是对的，问题只在行走中"——所以不删，给一个可调系数。
 *
 * 默认档是体感，量不出来，没有在代码里替用户拍板：三档机制先落地，用户实机
 * 走查后选定默认 off（见下方 `DEFAULT_LEVEL`）。仍可在 `engine/ui/Menu.ts`
 * 的暂停卡片随时切换、持久化到 localStorage。
 */

export type ComfortLevel = 'full' | 'half' | 'off';

const STORAGE_KEY = 'dgy:comfort';

/** 侧滚 / 横向摆动 / FOV 泵动共用同一个系数——三项病因相同（行走时的周期性视觉变化）。 */
const SCALE: Record<ComfortLevel, number> = { full: 1, half: 0.5, off: 0 };

export const COMFORT_LEVELS: readonly ComfortLevel[] = ['full', 'half', 'off'];

export const COMFORT_LABELS: Record<ComfortLevel, string> = {
  full: '原样',
  half: '减半',
  off: '关闭摇晃',
};

function isComfortLevel(v: unknown): v is ComfortLevel {
  return v === 'full' || v === 'half' || v === 'off';
}

/**
 * 2026-09-13 用户实机走查后拍板:新玩家默认 off（关闭摇晃）。侧滚/横摆/FOV
 * 泵动是"体感判断，量不出来"的选项之三，选完就不再是留白——已过用户决策。
 */
const DEFAULT_LEVEL: ComfortLevel = 'off';

function readStored(): ComfortLevel {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isComfortLevel(v)) return v;
  } catch {
    // Private browsing / storage disabled — fall through to the default.
  }
  return DEFAULT_LEVEL;
}

let level: ComfortLevel = readStored();
const listeners = new Set<(level: ComfortLevel) => void>();

export function getComfortLevel(): ComfortLevel {
  return level;
}

/** Multiplier applied to strafe roll, lateral head-bob and speed-FOV pump. */
export function getComfortScale(): number {
  return SCALE[level];
}

export function setComfortLevel(next: ComfortLevel): void {
  if (next === level) return;
  level = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Nothing to persist to; the in-memory value still applies this session.
  }
  for (const fn of listeners) fn(level);
}

/** Notifies on every change, including ones made from elsewhere (e.g. devtools). */
export function onComfortChange(fn: (level: ComfortLevel) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
