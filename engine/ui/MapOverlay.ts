/**
 * MapOverlay — 游园图。按 M 打开，点一处走过去。
 *
 * 这一层**不认识大观园**：它收一组 `MapPlace`(名字、轮廓、落点、能不能去)与一个
 * 回调，自己只管画图与命中。园子的知识由 `projects/` 组装后传进来——`engine/`
 * 不许 import `builder/`(分层门)。
 *
 * **这是临时的调试便利,发布前必须收口**(`missing` 的 `99-27`,加入时用户即声明
 * 「debug 完之后去掉」)。二选一:整个摘掉,或收口成"只开放已经走到过的地方"。
 *
 * **与「移步换景」的张力要认**：园林的精髓是走过去，传送是反的。所以这里的定位是
 * **迭代与回访的便利**，不是首次游园的替代：
 *   - 只列**已建成**的地方，没建的灰着并注明原因,不许假装能去;
 *   - 将来真要给玩家用，应当只开放**已经走到过**的地方(去过才上图),
 *     首次抵达仍然只能靠腿。见 ART_DIRECTION §5.5 与 docs/ROADMAP.md §PE。
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
    hint.textContent = 'M 或 Esc 收起 · 点一处走过去';
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
    const g = svgEl('g', { class: `dgy-map__place${p.reachable ? '' : ' is-locked'}` });

    const poly = svgEl('polygon', { points: pts });
    g.appendChild(poly);

    const [lx, ly] = this.project(p.target.x, p.target.z);
    const label = svgEl('text', { x: lx, y: ly + 4, class: 'dgy-map__label' });
    label.textContent = p.name;
    g.appendChild(label);

    if (p.reachable) {
      g.addEventListener('click', () => {
        this.close();
        this.onGo(p);
      });
    }
    g.addEventListener('mouseenter', () => {
      this.caption.textContent = p.note ?? p.name;
    });
    g.addEventListener('mouseleave', () => {
      this.caption.textContent = '';
    });

    this.svg.appendChild(g);
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
