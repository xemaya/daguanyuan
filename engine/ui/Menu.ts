/**
 * Menu — the two full-screen overlays: the loading curtain and the start card.
 *
 * Both are plain DOM. They own their own animation (the loading bar runs a
 * private rAF because the engine loop has not started yet while the world is
 * still baking) and expose a tiny imperative API to the HUD.
 */

/** Small DOM helper — keeps the builders below readable. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function keycap(label: string, wide = false): HTMLElement {
  return el('span', wide ? 'dgy-key dgy-key--wide' : 'dgy-key', label);
}

/* ------------------------------------------------------------------------ */

export class LoadingScreen {
  readonly el: HTMLElement;

  private fill: HTMLElement;
  private stepEl: HTMLElement;
  private pctEl: HTMLElement;

  /** 0..1 target set by the world builder. */
  private target = 0;
  /** 0..1 eased value actually painted. */
  private shown = 0;
  private raf = 0;
  private lastT = 0;
  private done = false;
  private finishing = false;
  private onGone: (() => void) | null = null;

  constructor() {
    this.el = el('div', 'dgy-overlay dgy-loading');

    const inner = el('div', 'dgy-loading__inner');
    inner.appendChild(el('div', 'dgy-mark'));

    const h1 = el('h1', 'dgy-title', '大观园');
    inner.appendChild(h1);
    inner.appendChild(el('p', 'dgy-subtitle', '红楼梦 · 程序化重建'));

    const bar = el('div', 'dgy-bar');
    this.fill = el('div', 'dgy-bar__fill');
    bar.appendChild(this.fill);
    inner.appendChild(bar);

    const row = el('div', 'dgy-loading__row');
    this.stepEl = el('div', 'dgy-loading__step', '正在造园…');
    this.pctEl = el('div', 'dgy-loading__pct', '0%');
    row.appendChild(this.stepEl);
    row.appendChild(this.pctEl);
    inner.appendChild(row);

    this.el.appendChild(inner);
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  set(label: string, pct: number): void {
    this.target = Math.max(this.target, Math.min(1, Math.max(0, pct)));
    this.stepEl.textContent = prettyStep(label);
  }

  private tick(t: number): void {
    if (this.done) return;
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0.016;
    this.lastT = t;
    // Critically-damped chase: the bar never snaps, never stalls.
    const rate = this.finishing ? 8.5 : 5.2;
    this.shown += (this.target - this.shown) * Math.min(1, dt * rate);
    if (this.target - this.shown < 0.0015) this.shown = this.target;
    this.paint();

    if (this.finishing && this.shown >= 0.999) {
      this.shown = 1;
      this.paint();
      this.finishing = false;
      // A beat at a genuine 100% before the curtain lifts reads far better
      // than a bar that vanishes at 94%.
      window.setTimeout(() => this.dissolve(), 300);
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  private paint(): void {
    this.fill.style.width = `${(this.shown * 100).toFixed(2)}%`;
    this.pctEl.textContent = `${Math.round(this.shown * 100)}%`;
  }

  /** Runs the bar out to a true 100%, fades, then leaves the layout. */
  hide(onGone?: () => void, instant = false): void {
    if (this.done || this.finishing) return;
    this.target = 1;
    this.stepEl.textContent = '园成';
    this.onGone = onGone ?? null;

    if (instant) {
      this.shown = 1;
      this.paint();
      this.done = true;
      cancelAnimationFrame(this.raf);
      this.el.classList.add('is-hidden', 'is-gone');
      this.flush();
      return;
    }
    this.finishing = true;
  }

  private dissolve(): void {
    this.done = true;
    cancelAnimationFrame(this.raf);
    this.el.classList.add('is-hidden');
    window.setTimeout(() => {
      this.el.classList.add('is-gone');
      this.flush();
    }, 640);
  }

  private flush(): void {
    const fn = this.onGone;
    this.onGone = null;
    fn?.();
  }
}

/** Turns "vegetation" / "Baking terrain" into sentence-cased prose. */
function prettyStep(label: string): string {
  if (!label) return '正在造园…';
  const s = label.trim();
  const cased = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.…!?]$/.test(cased) ? cased : `${cased}…`;
}

/* ------------------------------------------------------------------------ */

export interface LegendEntry {
  keys: string[];
  text: string;
  wide?: boolean;
}

const LEGEND: LegendEntry[] = [
  { keys: ['W', 'A', 'S', 'D'], text: '移动' },
  { keys: ['Shift'], text: '跑', wide: true },
  { keys: ['Space'], text: '跳', wide: true },
  { keys: ['鼠标'], text: '环顾', wide: true },
  { keys: ['E'], text: '互动' },
  { keys: ['Esc'], text: '放开光标', wide: true },
];

/** Which face the start card is wearing. */
export type StartMode = 'title' | 'paused' | 'retry';

const COPY: Record<StartMode, { eyebrow: string; title: string; cta: string; foot: string }> = {
  title: {
    eyebrow: '红楼梦 · 第十七回',
    title: '大观园',
    cta: '点击入园',
    foot: '鼠标会被锁定,按 Esc 放开。WASD 走,Shift 跑,空格跳。',
  },
  paused: {
    eyebrow: '暂停',
    title: '歇一歇',
    cta: '点击继续',
    foot: '园子还在你离开的地方。',
  },
  retry: {
    eyebrow: '差一步',
    title: '再点一下',
    cta: '点击环顾',
    foot: '浏览器还攥着光标,再点一次就交出来。',
  },
};

/**
 * The click-to-play card. Doubles as the pause screen: when pointer lock is
 * lost mid-game it comes back with a different title so the player is never
 * left staring at a frozen world with no explanation.
 */
export class StartCard {
  readonly el: HTMLElement;
  onStart: (() => void) | null = null;

  private eyebrow: HTMLElement;
  private title: HTMLElement;
  private cta: HTMLButtonElement;
  private foot: HTMLElement;
  private shown = false;
  private armed = false;

  constructor() {
    this.el = el('div', 'dgy-overlay dgy-start is-hidden is-gone');

    const card = el('div', 'dgy-card');
    this.eyebrow = el('div', 'dgy-card__eyebrow', '红楼梦 · 第十七回');
    this.title = el('h2', 'dgy-card__title', '大观园');
    card.appendChild(this.eyebrow);
    card.appendChild(this.title);
    card.appendChild(el('div', 'dgy-card__rule'));

    const legend = el('div', 'dgy-legend');
    for (const entry of LEGEND) {
      const row = el('div', 'dgy-legend__row');
      const keys = el('div', 'dgy-legend__keys');
      for (const k of entry.keys) keys.appendChild(keycap(k, entry.wide));
      row.appendChild(keys);
      row.appendChild(el('div', 'dgy-legend__text', entry.text));
      legend.appendChild(row);
    }
    card.appendChild(legend);

    this.cta = el('button', 'dgy-cta') as HTMLButtonElement;
    this.cta.type = 'button';
    this.cta.textContent = '点击入园';
    card.appendChild(this.cta);

    this.foot = el('p', 'dgy-card__foot', '鼠标会被锁定,按 Esc 放开。WASD 走,Shift 跑,空格跳。');
    card.appendChild(this.foot);

    this.el.appendChild(card);

    // Deliberately *not* stopping propagation: the click must reach the app
    // container so the engine's own gesture handler can unlock audio and take
    // pointer lock in the same user gesture.
    const fire = (e: Event): void => {
      e.preventDefault();
      if (!this.shown || !this.armed) return;
      // The button sits inside the overlay, so one click reaches both handlers.
      this.armed = false;
      this.onStart?.();
    };
    this.cta.addEventListener('click', fire);
    this.el.addEventListener('click', fire);
  }

  get visible(): boolean {
    return this.shown;
  }

  /**
   * @param armDelayMs How long before the card accepts a click. The default
   *   only has to swallow the click that dismissed pointer lock; the caller
   *   raises it to sit out Chrome's post-Escape relock cooldown, because a card
   *   that can be dismissed during the cooldown sends the player back into the
   *   world with a request that is guaranteed to be refused.
   */
  show(mode: StartMode = 'title', armDelayMs = 120): void {
    if (this.shown) return;
    this.shown = true;
    this.armed = false;
    const copy = COPY[mode];
    this.eyebrow.textContent = copy.eyebrow;
    this.title.textContent = copy.title;
    this.cta.textContent = copy.cta;
    this.foot.textContent = copy.foot;
    this.el.classList.remove('is-gone');
    // Next frame, so the transition actually runs from the hidden state.
    requestAnimationFrame(() => {
      this.el.classList.remove('is-hidden');
      window.setTimeout(() => (this.armed = true), Math.max(0, armDelayMs));
    });
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.armed = false;
    this.el.classList.add('is-hidden');
    window.setTimeout(() => {
      if (!this.shown) this.el.classList.add('is-gone');
    }, 480);
  }
}
