/**
 * MapOverlay — 游园图。按 M 打开，点一处走过去。
 *
 * 这一层**不认识大观园**：它收一组 `MapPlace`(名字、轮廓、落点、能不能去)与一个
 * 回调，自己只管画图与命中。园子的知识由 `projects/` 组装后传进来——`engine/`
 * 不许 import `builder/`(分层门)。
 *
 * **已收口(99-27 销案)**：不再是全开传送台。图是**游历的记录**——走到过的地方
 * 才解锁(`setUnlocked`),没走到的画灰、不可点,首次抵达只能靠腿。
 * 与「移步换景」的张力由此化解:传送只做**回访**,不做首游的替代。
 *   - 只列**已建成**的地方，没建的灰着并注明原因,不许假装能去;
 *   - 已建成的也要**走到过**才亮——见 ART_DIRECTION §5.5。
 */

export interface MapPlace {
  id: string;
  /** 图上显示的名字。 */
  name: string;
  /** 世界坐标的区域轮廓，用来画形。 */
  polygon: readonly (readonly [number, number])[];
  /** 走过去的落点（世界坐标，米）。 */
  target: { x: number; z: number };
  /** 落地后的朝向（弧度，与 PlayerController.yaw 同约定）。 */
  yaw: number;
  /** false = 尚未建成，图上灰着且不可点。 */
  reachable: boolean;
  /** 不可去时显示的原因；可去时作为副标题。 */
  note?: string;
  /** 已建成但还没走到过时显示的原因(解锁靠 `setUnlocked`)。 */
  lockedNote?: string;
}

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(SVG, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
  return n;
};

export class MapOverlay {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private here: SVGCircleElement;
  private caption: HTMLElement;
  private open = false;
  private toWorld: { minX: number; minZ: number; span: number };
  /** 走到过才解锁的区(99-27 收口)。集合外的已建成区画灰、不可点。 */
  private readonly unlocked = new Set<string>();
  private readonly groups = new Map<string, SVGGElement>();

  constructor(
    private readonly places: readonly MapPlace[],
    private readonly onGo: (p: MapPlace) => void,
  ) {
    // 画布取全部轮廓的包围盒，留一成边。正方形，免得不同区的形被拉伸。
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of places) {
      for (const [x, z] of p.polygon) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    const span = Math.max(maxX - minX, maxZ - minZ) * 1.1;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    this.toWorld = { minX: cx - span / 2, minZ: cz - span / 2, span };

    this.el = document.createElement('div');
    this.el.className = 'dgy-overlay dgy-map is-hidden';

    const card = document.createElement('div');
    card.className = 'dgy-map__card';
    this.el.appendChild(card);

    const head = document.createElement('div');
    head.className = 'dgy-map__head';
    const h = document.createElement('h2');
    h.textContent = '游园图';
    head.appendChild(h);
    const hint = document.createElement('span');
    hint.className = 'dgy-map__hint';
    hint.textContent = 'M 或 Esc 收起 · 点一处走回去(去过才解锁)';
    head.appendChild(hint);
    card.appendChild(head);

    this.svg = svgEl('svg', { viewBox: `0 0 1000 1000`, class: 'dgy-map__svg' });
    card.appendChild(this.svg);

    this.caption = document.createElement('div');
    this.caption.className = 'dgy-map__caption';
    card.appendChild(this.caption);

    for (const p of places) this.drawPlace(p);

    // 玩家所在，画在最上层。
    this.here = svgEl('circle', { r: 7, class: 'dgy-map__here' });
    this.svg.appendChild(this.here);

    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  /** 世界坐标 → 图上坐标。+x 东、+z 南，图上 z 向下，所以 y 与 z 同向。 */
  private project(x: number, z: number): [number, number] {
    const { minX, minZ, span } = this.toWorld;
    return [((x - minX) / span) * 1000, ((z - minZ) / span) * 1000];
  }

  private drawPlace(p: MapPlace): void {
    const pts = p.polygon.map(([x, z]) => this.project(x, z).join(',')).join(' ');
    const g = svgEl('g', { class: `dgy-map__place${p.reachable && this.unlocked.has(p.id) ? '' : ' is-locked'}` });
    this.groups.set(p.id, g);

    const poly = svgEl('polygon', { points: pts });
    g.appendChild(poly);

    const [lx, ly] = this.project(p.target.x, p.target.z);
    const label = svgEl('text', { x: lx, y: ly + 4, class: 'dgy-map__label' });
    label.textContent = p.name;
    g.appendChild(label);

    // 点击始终挂着,内部查解锁集合——锁定的地方点了不动作,而不是"没挂监听"。
    g.addEventListener('click', () => {
      if (!p.reachable || !this.unlocked.has(p.id)) return;
      this.close();
      this.onGo(p);
    });
    g.addEventListener('mouseenter', () => {
      this.caption.textContent = p.reachable && !this.unlocked.has(p.id)
        ? p.lockedNote ?? p.note ?? p.name
        : p.note ?? p.name;
    });
    g.addEventListener('mouseleave', () => {
      this.caption.textContent = '';
    });

    this.svg.appendChild(g);
  }

  /** 解锁一处已建成的地方(走到过才调用)。重复调用无害。 */
  setUnlocked(id: string): void {
    if (this.unlocked.has(id)) return;
    this.unlocked.add(id);
    const p = this.places.find((pl) => pl.id === id);
    const g = this.groups.get(id);
    if (p?.reachable && g) g.classList.remove('is-locked');
  }

  setHere(x: number, z: number): void {
    const [px, py] = this.project(x, z);
    this.here.setAttribute('cx', String(px));
    this.here.setAttribute('cy', String(py));
  }

  get visible(): boolean {
    return this.open;
  }

  toggle(): boolean {
    this.open ? this.close() : this.show();
    return this.open;
  }

  show(): void {
    this.open = true;
    this.el.classList.remove('is-hidden');
  }

  close(): void {
    this.open = false;
    this.el.classList.add('is-hidden');
    this.caption.textContent = '';
  }
}
