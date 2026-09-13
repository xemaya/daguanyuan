/**
 * fashi.ts — 《营造法式》图解页。
 *
 * 这一页的价值不在几何,在出处:点一件构件,要能回答这个数出自哪卷哪条、
 * 谁核验通过、存疑处我们裁了哪一档、史料没有的地方我们为观感取了什么。
 *
 * 三条铁律(见 docs/superpowers/plans/2026-09-11-frontdoor-and-fashi-gallery.md):
 *   1. 不许伪造出处——页面上的数必须能点回 knowledge/rules/*.json 的规则 id;
 *      RuleBook / buildPart 抛错就把错误显示出来,不吞掉填默认值。
 *   2. 不新发明颜色——三支出处与五种规则状态的配色都在 tokens.css。
 *   3. 原文引句衬线繁体,我们的说明无衬线简体。
 *
 * 格子图从 partNames() 自动长:registry 里新登记的构件会以 default 变体
 * 自动进柜,不在这里维护构件清单(变体清单是各构件文件自己约定的,登记表
 * 没有枚举 API,只能按族列出已知变体)。
 */
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { pass } from 'three/tsl';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { rendererOptions, backendName } from '@engine/core/renderer';
import { buildPart, partNames, type PartBuild } from '@builder/parts/registry';
import '@builder/parts/index';
import { setPlan, type GardenPlan } from '@builder/compose/terrain';
import planFile from './plan.json' with { type: 'json' };
import type { BuildingResult } from '@builder/parts/damu/building';
import type { Provenance, ProvenanceEntry } from '@builder/derive/provenance';
import fashiFile from '@knowledge/rules/fashi.rules.json' with { type: 'json' };
import qingFile from '@knowledge/rules/qing.rules.json' with { type: 'json' };
import fayuanFile from '@knowledge/rules/fayuan.rules.json' with { type: 'json' };
import missingFile from '@knowledge/rules/missing.rules.json' with { type: 'json' };
import componentsFile from '@knowledge/rules/components.rules.json' with { type: 'json' };
import '@engine/ui/tokens.css';
import './fashi.css';

// 构件的匾额文字从 plan.json 读(99-26),图解页渲染构件前同样注入真源。
setPlan(planFile as unknown as GardenPlan);

/* ------------------------------------------------------------------ */
/* 规则表与构件本体的只读索引                                            */
/* ------------------------------------------------------------------ */

type RuleStatus = 'ok' | 'contested' | 'refuted' | 'underdetermined' | 'missing';

interface RuleRec {
  id: string;
  name: string;
  status: RuleStatus;
  set: string;
  statement?: string;
  quote?: string;
  location?: string;
  correction?: string;
  urls?: string[];
  whereToLook?: { books?: string[]; keywords?: string[] };
}

interface ComponentRec {
  id: string;
  name: string;
  category: string;
  status: RuleStatus;
  paramSet: string;
  statement?: string;
  parts?: { ref: string; name: string; count: number }[];
  attachTo?: { parent?: string; position?: string };
  dimensions?: string[];
  source?: { book?: string; location?: string; quote?: string };
  urls?: string[];
  note?: string;
}

const RULE_FILES: [string, unknown][] = [
  ['fashi', fashiFile],
  ['qing', qingFile],
  ['fayuan', fayuanFile],
  ['missing', missingFile],
];

const ALL_RULES: RuleRec[] = [];
for (const [set, file] of RULE_FILES) {
  for (const r of (file as { rules: Omit<RuleRec, 'set'>[] }).rules) {
    ALL_RULES.push({ ...r, set });
  }
}

const COMPONENTS = (componentsFile as unknown as { components: ComponentRec[] }).components;

const RULE_INDEX = new Map<string, RuleRec[]>();
for (const r of ALL_RULES) {
  const list = RULE_INDEX.get(r.id) ?? [];
  list.push(r);
  RULE_INDEX.set(r.id, list);
}

/**
 * id 只在规则集内唯一(115 个跨集重号,PITFALLS P-16)。按调用语境给偏好集:
 * 大木推导走 fashi 参数集,斗拱数据卡按自己的 paramSet。偏好集查不到且
 * 裸 id 有歧义时,不猜——把歧义显示出来。
 */
function resolveRule(id: string, prefer: string[]): { rule?: RuleRec; ambiguous?: string[] } {
  const list = RULE_INDEX.get(id);
  if (!list) return {};
  for (const s of prefer) {
    const hit = list.find((r) => r.set === s);
    if (hit) return { rule: hit };
  }
  if (list.length === 1) return { rule: list[0] };
  return { ambiguous: list.map((r) => `${r.set}:${r.id}`) };
}

const STATUS_LABEL: Record<RuleStatus, string> = {
  ok: '通过',
  contested: '存疑',
  refuted: '驳倒',
  underdetermined: '欠定',
  missing: '缺失',
};

/* ------------------------------------------------------------------ */
/* 格子目录:构件从登记表自动长                                          */
/* ------------------------------------------------------------------ */

interface GalleryItem {
  /** 'building:tang' */
  key: string;
  part: string;
  variant: string;
  title: string;
  sub: string;
  /** building = 大木作,provenance 走 deriveBuilding;procedural = 程序化造型。 */
  kind: 'building' | 'procedural';
}

const FAMILY_LABEL: Record<string, string> = {
  bamboo: '竹',
  bridge: '桥',
  building: '大木作',
  taihu: '太湖石',
  wall: '墙',
};

/**
 * 各族在册的展示变体。登记表只登记族、不管变体(变体语法写死在各构件
 * 文件里),所以变体清单只能按族列出;新族进柜时回退到 default。
 */
const FAMILY_VARIANTS: Record<string, string[]> = {
  bamboo: ['default', 'single', 'grove'],
  bridge: ['default', 'bank', 'railing'],
  building: ['tang', 'ting', 'lang', 'men'],
  taihu: ['peak', 'mound', 'edge'],
  wall: ['plain', 'moon', 'lattice', 'cloud'],
};

const VARIANT_LABEL: Record<string, Record<string, string>> = {
  bamboo: { default: '竹丛', single: '单竿', grove: '竹林' },
  bridge: { default: '曲桥', bank: '驳岸', railing: '栏杆' },
  building: { tang: '堂 · 三间歇山', ting: '亭 · 四角攒尖', lang: '廊 · 硬山', men: '门 · 五间硬山' },
  taihu: { peak: '独峰', mound: '假山组', edge: '驳岸石' },
  wall: { plain: '直墙', moon: '月洞门墙', lattice: '漏窗墙', cloud: '云墙' },
};

function buildCatalog(): GalleryItem[] {
  const items: GalleryItem[] = [];
  for (const part of partNames()) {
    const family = FAMILY_LABEL[part] ?? part;
    for (const variant of FAMILY_VARIANTS[part] ?? ['default']) {
      items.push({
        key: `${part}:${variant}`,
        part,
        variant,
        title: VARIANT_LABEL[part]?.[variant] ?? `${family} · ${variant}`,
        sub: family,
        kind: part === 'building' ? 'building' : 'procedural',
      });
    }
  }
  return items;
}

const CATALOG = buildCatalog();

/** 预烘焙缩略图(tools/shoot-gallery.mjs 的产物,入库)。 */
const THUMBS = import.meta.glob('./gallery/thumbs/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function thumbUrl(item: GalleryItem): string | undefined {
  return THUMBS[`./gallery/thumbs/${item.part}_${item.variant}.png`];
}

/* ------------------------------------------------------------------ */
/* DOM 小件                                                             */
/* ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function statusBadge(status: RuleStatus): HTMLElement {
  return el('span', `badge st-${status}`, STATUS_LABEL[status]);
}

function quoteBlock(text: string): HTMLElement {
  return el('div', 'quote', text);
}

/* ------------------------------------------------------------------ */
/* 格子页                                                               */
/* ------------------------------------------------------------------ */

const app = document.getElementById('app')!;
const detailRoot = document.getElementById('detail')!;

function partCard(item: GalleryItem): HTMLElement {
  const card = el('button', 'fashi-card');
  card.type = 'button';
  const thumb = thumbUrl(item);
  if (thumb) {
    const img = el('img', 'thumb');
    img.src = thumb;
    img.alt = item.title;
    img.loading = 'lazy';
    card.appendChild(img);
  } else {
    card.appendChild(el('div', 'no-thumb', '缩略图未烘焙\nnode tools/shoot-gallery.mjs'));
  }
  const meta = el('div', 'meta');
  meta.appendChild(el('div', 'name', item.title));
  meta.appendChild(el('div', 'sub2', item.sub));
  const badges = el('div', 'badges');
  if (item.kind === 'building') badges.appendChild(el('span', 'badge pv-evidence', '有营造出处'));
  else badges.appendChild(el('span', 'badge pv-art', '程序化造型'));
  meta.appendChild(badges);
  card.appendChild(meta);
  card.addEventListener('click', () => openDetail(item.key));
  return card;
}

function componentCard(c: ComponentRec): HTMLElement {
  const card = el('button', 'fashi-card');
  card.type = 'button';
  const ph = el('div', 'no-thumb');
  ph.appendChild(el('span', '', `${c.category}\n尚无几何`));
  ph.style.whiteSpace = 'pre-line';
  card.appendChild(ph);
  const meta = el('div', 'meta');
  meta.appendChild(el('div', 'name', c.name));
  meta.appendChild(el('div', 'sub2', `${c.id} · ${c.paramSet === 'qing' ? '清式' : '宋式'}`));
  const badges = el('div', 'badges');
  badges.appendChild(statusBadge(c.status));
  badges.appendChild(el('span', 'badge', '尚无几何'));
  meta.appendChild(badges);
  card.appendChild(meta);
  card.addEventListener('click', () => openDetail(c.id));
  return card;
}

function ruleCard(r: RuleRec): HTMLElement {
  const card = el('button', 'fashi-card');
  card.type = 'button';
  const meta = el('div', 'meta');
  meta.style.padding = '12px';
  meta.appendChild(el('div', 'name', r.name));
  meta.appendChild(el('div', 'sub2', `${r.set}:${r.id}`));
  const badges = el('div', 'badges');
  badges.appendChild(statusBadge(r.status));
  meta.appendChild(badges);
  card.appendChild(meta);
  card.addEventListener('click', () => openDetail(`${r.set}:${r.id}`));
  return card;
}

function renderGallery(): void {
  const head = el('header', 'fashi-head');
  head.appendChild(el('h1', '', '营造法式图解'));
  head.appendChild(el('span', 'sub', '每个数字都要能点回它的出处——证据、裁断、艺术偏离分三支列明'));
  const home = el('a', 'home', '← 返回门厅');
  home.href = '/';
  head.appendChild(home);
  app.appendChild(head);

  const buildings = CATALOG.filter((i) => i.kind === 'building');
  const procedural = CATALOG.filter((i) => i.kind === 'procedural');
  const gapRules = ALL_RULES.filter((r) => r.status === 'refuted' || r.status === 'missing')
    .sort((a, b) => (a.status === b.status ? `${a.set}:${a.id}`.localeCompare(`${b.set}:${b.id}`) : a.status === 'refuted' ? -1 : 1));

  const s1 = el('section', 'fashi-section');
  s1.appendChild(el('h2', '', '大木作'));
  s1.appendChild(el('p', 'note', '每个数由 deriveBuilding 从规则表推得,出处分证据 / 裁断 / 艺术三支'));
  const g1 = el('div', 'fashi-grid');
  for (const i of buildings) g1.appendChild(partCard(i));
  s1.appendChild(g1);
  app.appendChild(s1);

  const s2 = el('section', 'fashi-section');
  s2.appendChild(el('h2', '', '斗拱本体 · 数据卡'));
  s2.appendChild(el('p', 'note', '只存"由什么组成、怎么装",尺寸一律引规则 id;几何 P3 才做,故标注"尚无几何"'));
  const g2 = el('div', 'fashi-grid');
  for (const c of COMPONENTS) g2.appendChild(componentCard(c));
  s2.appendChild(g2);
  app.appendChild(s2);

  const s3 = el('section', 'fashi-section');
  s3.appendChild(el('h2', '', '程序化造型'));
  s3.appendChild(el('p', 'note', '墙、石、竹、桥没有营造规则出处,不给它们编一个;造型依据见 ART_DIRECTION.md'));
  const g3 = el('div', 'fashi-grid');
  for (const i of procedural) g3.appendChild(partCard(i));
  s3.appendChild(g3);
  app.appendChild(s3);

  const s4 = el('section', 'fashi-section');
  s4.appendChild(el('h2', '', '驳倒与缺失'));
  s4.appendChild(el('p', 'note', '被两名核验者推翻的,与书里就是没有的——"我们不知道"也是可展示的内容'));
  const g4 = el('div', 'fashi-grid');
  for (const r of gapRules) g4.appendChild(ruleCard(r));
  s4.appendChild(g4);
  app.appendChild(s4);
}

/* ------------------------------------------------------------------ */
/* 三维转盘:渲染设置抄自 projects/daguanyuan/viewer.ts(棚拍灯光已调好)  */
/* ------------------------------------------------------------------ */

function startTurntable(stage: HTMLElement, part: PartBuild): () => void {
  const renderer = new THREE.WebGPURenderer({ ...rendererOptions(), antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  stage.appendChild(renderer.domElement);
  let disposed = false;
  let cleanup: (() => void) | undefined;
  void renderer.init().then(() => {
    if (disposed) { renderer.dispose(); return; }
    stage.dataset.rendererBackend = backendName(renderer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3038);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 500);

  const key = new THREE.DirectionalLight(0xfff2dd, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.012;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd4f0, 0.85);
  scene.add(fill);
  const rimLight = new THREE.DirectionalLight(0xffe9c8, 2.1);
  scene.add(rimLight);
  scene.add(new THREE.HemisphereLight(0x9fc4e8, 0x4a4238, 0.5));

  const root = new THREE.Group();
  scene.add(root);
  root.add(part.root);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z) || 1;

  const groundR = part.groundRadius ?? extent * 1.6;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(groundR, 64),
    new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, box.min.y - 0.002, center.z);
  ground.receiveShadow = true;
  scene.add(ground);

  const L = extent;
  key.position.set(center.x - 1.4 * L, center.y + 2.2 * L, center.z + 1.9 * L);
  key.target.position.copy(center);
  scene.add(key.target);
  const sc = key.shadow.camera;
  sc.near = 0.1 * L;
  sc.far = 8 * L;
  sc.left = -1.2 * L;
  sc.right = 1.2 * L;
  sc.top = 1.2 * L;
  sc.bottom = -1.2 * L;
  sc.updateProjectionMatrix();
  fill.position.set(center.x + 2.2 * L, center.y + 0.7 * L, center.z + 1.2 * L);
  rimLight.position.set(center.x + 0.6 * L, center.y + 1.1 * L, center.z - 2.4 * L);

  function frame(): void {
    const b = new THREE.Box3().setFromObject(root);
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    const radius = s.length() * 0.5 || 1;
    const dist = (radius * 1.35) / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(
      c.x + Math.sin(0.62) * Math.cos(0.2) * dist,
      c.y + Math.sin(0.2) * dist + s.y * 0.06,
      c.z + Math.cos(0.62) * Math.cos(0.2) * dist,
    );
    camera.lookAt(c);
    camera.updateProjectionMatrix();
  }
  frame();

  const composer = new THREE.RenderPipeline(renderer, smaa(pass(scene,camera)));

  function resize(): void {
    const w = stage.clientWidth || 2;
    const h = stage.clientHeight || 2;
    renderer.setSize(w, h);

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(stage);

  const clock = new THREE.Clock();
  let rendered = false;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const t = clock.elapsedTime;
    part.update?.(dt, t);
    root.rotation.y = t * 0.4;
    composer.render();
    if (!rendered) { stage.dataset.rendererReady = 'true'; rendered = true; }
  });

  cleanup = () => {
    observer.disconnect();
    renderer.setAnimationLoop(null);
    composer.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  }).catch((error) => { if (!disposed) { console.error('[turntable]',error); stage.textContent = String(error); } });
  return () => { disposed = true; cleanup?.(); renderer.domElement.remove(); };
}

/* ------------------------------------------------------------------ */
/* 详情:出处栏                                                          */
/* ------------------------------------------------------------------ */

let disposeStage: (() => void) | null = null;

/** 一条规则记录的引用块:状态徽记 + 我们的转述 + 原文引句(衬线繁体)。 */
function ruleRefBlock(rule: RuleRec, opts: { bare?: boolean } = {}): HTMLElement {
  const wrap = el('div');
  const head = el('div', 'head');
  head.appendChild(statusBadge(rule.status));
  // bare: 出处条目已带过规则名,引用块只补状态与出处,不重复一遍。
  if (!opts.bare) head.appendChild(el('span', 'rname', rule.name));
  if (rule.location) head.appendChild(el('span', 'loc', rule.location));
  wrap.appendChild(head);
  if (rule.statement) wrap.appendChild(el('div', 'pnote', rule.statement));
  if (rule.quote) wrap.appendChild(quoteBlock(rule.quote));
  return wrap;
}

function provenanceEntryBlock(e: ProvenanceEntry, prefer: string[]): HTMLElement {
  const box = el('div', 'prov-entry');
  const head = el('div', 'head');
  head.appendChild(el('span', 'rule-id', e.id));
  head.appendChild(el('span', 'rname', e.name));
  if (e.location) head.appendChild(el('span', 'loc', e.location));
  box.appendChild(head);
  if (e.note) box.appendChild(el('div', 'pnote', e.note));
  // 项目自留痕的条目(如 project:building-access)不在规则表,不查。
  if (!e.id.includes(':')) {
    const { rule, ambiguous } = resolveRule(e.id, prefer);
    if (rule) box.appendChild(ruleRefBlock(rule, { bare: true }));
    else if (ambiguous) box.appendChild(el('div', 'rule-missing-ref', `规则号在多个规则集里重号,未能限定:${ambiguous.join('、')}`));
    else box.appendChild(el('div', 'rule-missing-ref', `规则表中查不到 id ${e.id}——出处链断在这里,不补默认值`));
  }
  return box;
}

function provenancePanel(side: HTMLElement, p: Provenance): void {
  side.appendChild(
    el('div', 'prov-summary', `证据 ${p.evidence.length} · 裁断 ${p.inference.length} · 艺术 ${p.art.length}`),
  );
  const branches: [keyof Provenance, string, string][] = [
    ['evidence', 'evidence', '证据 · 史料有出处'],
    ['inference', 'inference', '裁断 · 多口径里我们选了一条'],
    ['art', 'art', '艺术 · 为观感主动偏离'],
  ];
  for (const [key, cls, label] of branches) {
    if (!p[key].length) continue;
    const sec = el('div', `prov-branch ${cls}`);
    sec.appendChild(el('h3', '', label));
    for (const e of p[key]) sec.appendChild(provenanceEntryBlock(e, ['fashi', 'missing']));
    side.appendChild(sec);
  }
}

function detailShell(title: string): { side: HTMLElement; stage: HTMLElement; close: () => void } {
  detailRoot.innerHTML = '';
  detailRoot.hidden = false;

  const head = el('div', 'detail-head');
  head.appendChild(el('h2', '', title));
  const badgeSlot = el('div', 'badges');
  head.appendChild(badgeSlot);
  const back = el('button', 'detail-close', '返回格子');
  back.type = 'button';
  head.appendChild(back);

  const body = el('div', 'detail-body');
  const stage = el('div', 'detail-stage');
  const side = el('div', 'detail-side');
  body.appendChild(stage);
  body.appendChild(side);
  detailRoot.appendChild(head);
  detailRoot.appendChild(body);

  const close = () => closeDetail();
  back.addEventListener('click', close);
  return { side, stage, close };
}

function closeDetail(): void {
  disposeStage?.();
  disposeStage = null;
  detailRoot.hidden = true;
  detailRoot.innerHTML = '';
  if (location.hash) history.replaceState(null, '', location.pathname);
}

function openPartDetail(item: GalleryItem): void {
  let part: PartBuild | null = null;
  let thrown: unknown = null;
  try {
    part = buildPart(item.part, item.variant);
  } catch (err) {
    thrown = err;
  }
  const { side, stage } = detailShell(item.title);

  if (thrown || !part) {
    // 铁律一:RuleBook 取不到会抛——把错误显示出来,不吞掉填默认值。
    const msg = thrown instanceof Error ? thrown.message : String(thrown ?? '构件未登记');
    side.appendChild(el('div', 'detail-error', `构件推导失败,原样显示:\n\n${msg}`));
    stage.appendChild(el('div', 'stage-empty', ''));
    return;
  }

  disposeStage = startTurntable(stage, part);
  stage.appendChild(el('div', 'stage-note', '自动转盘 · 换角度与定格请用棚拍台 /viewer.html'));

  if (item.kind === 'building' && part.kind === 'building') {
    const frame = (part as BuildingResult).frame;
    const dims = frame.m;
    side.appendChild(el('h3', 'block', '本例骨架(推导结果,米)'));
    side.appendChild(
      el('div', 'kv', `面阔 ${dims.width.toFixed(2)} × 进深 ${dims.depth.toFixed(2)} · 檐柱高 ${dims.columnH.toFixed(2)} · 脊高 ${dims.ridgeY.toFixed(2)}`),
    );
    side.appendChild(el('h3', 'block', '出处'));
    provenancePanel(side, frame.provenance);
  } else {
    side.appendChild(el('h3', 'block', '出处'));
    side.appendChild(el('p', 'statement', '此件为程序化造型,无营造规则来源——不给它编一个。'));
    side.appendChild(
      el('p', 'pnote', '造型参数由生成器内部种子驱动,取向见 ART_DIRECTION.md(园子的色板与"看不出程序痕迹"的验收标准)。'),
    );
  }
}

function openComponentDetail(c: ComponentRec): void {
  const { side, stage } = detailShell(c.name);
  const empty = el('div', 'stage-empty');
  empty.appendChild(el('div', 'zh', '斗拱'));
  empty.appendChild(el('div', '', '尚无几何——本体先存构成与尺寸出处,几何 P3 再做'));
  stage.appendChild(empty);

  const head = el('div', 'badges');
  head.appendChild(statusBadge(c.status));
  head.appendChild(el('span', 'badge', c.paramSet === 'qing' ? '清式 ·《工程做法》' : '宋式 ·《营造法式》'));
  head.appendChild(el('span', 'badge st-missing', '尚无几何'));
  side.appendChild(head);
  side.appendChild(el('div', 'kv', `${c.id} · ${c.category}`));

  if (c.statement) {
    side.appendChild(el('h3', 'block', '构成'));
    side.appendChild(el('p', 'statement', c.statement));
  }
  if (c.source?.quote) {
    side.appendChild(el('h3', 'block', '原文'));
    side.appendChild(quoteBlock(c.source.quote));
    side.appendChild(el('div', 'loc', [c.source.book, c.source.location].filter(Boolean).join(' · ')));
  }
  if (c.parts?.length) {
    side.appendChild(el('h3', 'block', `分件(${c.parts.length} 种)`));
    const table = el('table', 'parts');
    for (const p of c.parts) {
      const tr = el('tr');
      tr.appendChild(el('td', '', `${p.name}`));
      const ref = el('td');
      ref.appendChild(el('span', 'rule-id', p.ref));
      tr.appendChild(ref);
      tr.appendChild(el('td', 'n', `×${p.count}`));
      table.appendChild(tr);
    }
    side.appendChild(table);
  }
  if (c.dimensions?.length) {
    side.appendChild(el('h3', 'block', '尺寸出处(尺寸一律引规则 id,本卡不重复数值)'));
    for (const id of c.dimensions) {
      const wrap = el('div', 'dim-rule');
      const { rule, ambiguous } = resolveRule(id, [c.paramSet]);
      const head2 = el('div', 'head');
      head2.appendChild(el('span', 'rule-id', id));
      wrap.appendChild(head2);
      if (rule) wrap.appendChild(ruleRefBlock(rule));
      else if (ambiguous) wrap.appendChild(el('div', 'rule-missing-ref', `规则号在多个规则集里重号,未能限定:${ambiguous.join('、')}`));
      else wrap.appendChild(el('div', 'rule-missing-ref', `规则表中查不到 id ${id}——出处链断在这里,不补默认值`));
      side.appendChild(wrap);
    }
  }
  if (c.attachTo) {
    side.appendChild(el('h3', 'block', '装配'));
    side.appendChild(el('p', 'pnote', [c.attachTo.parent, c.attachTo.position].filter(Boolean).join(' · ')));
  }
  if (c.note) {
    side.appendChild(el('h3', 'block', '注'));
    side.appendChild(el('p', 'pnote', c.note));
  }
  if (c.urls?.length) {
    side.appendChild(el('h3', 'block', '来源链接'));
    for (const u of c.urls) {
      const a = el('a', '', u);
      a.href = u;
      a.target = '_blank';
      a.rel = 'noreferrer';
      const div = el('div', 'kv');
      div.appendChild(a);
      side.appendChild(div);
    }
  }
}

function openRuleDetail(r: RuleRec): void {
  const { side, stage } = detailShell(r.name);
  const empty = el('div', 'stage-empty');
  empty.appendChild(el('div', 'zh', r.status === 'refuted' ? '驳倒' : '缺失'));
  empty.appendChild(
    el('div', '', r.status === 'refuted' ? '这条被两名核验者推翻,照抄会错' : '书里没有这条,我们不编'),
  );
  stage.appendChild(empty);

  const head = el('div', 'badges');
  head.appendChild(statusBadge(r.status));
  side.appendChild(head);
  side.appendChild(el('div', 'kv', `${r.set}:${r.id}${r.location ? ` · ${r.location}` : ''}`));

  if (r.statement) {
    side.appendChild(el('h3', 'block', '条文'));
    side.appendChild(el('p', 'statement', r.statement));
  }
  if (r.quote) {
    side.appendChild(el('h3', 'block', '原文'));
    side.appendChild(quoteBlock(r.quote));
  }
  if (r.correction) {
    side.appendChild(el('h3', 'block', '更正'));
    side.appendChild(el('p', 'statement', r.correction));
  }
  if (r.whereToLook) {
    side.appendChild(el('h3', 'block', '该去哪查'));
    if (r.whereToLook.books?.length) side.appendChild(el('p', 'pnote', `书:${r.whereToLook.books.join('、')}`));
    if (r.whereToLook.keywords?.length) side.appendChild(el('p', 'pnote', `关键词:${r.whereToLook.keywords.join('、')}`));
  }
  if (r.urls?.length) {
    side.appendChild(el('h3', 'block', '来源链接'));
    for (const u of r.urls) {
      const a = el('a', '', u);
      a.href = u;
      a.target = '_blank';
      a.rel = 'noreferrer';
      const div = el('div', 'kv');
      div.appendChild(a);
      side.appendChild(div);
    }
  }
}

function openDetail(key: string): void {
  disposeStage?.();
  disposeStage = null;
  const item = CATALOG.find((i) => i.key === key);
  if (item) {
    openPartDetail(item);
  } else {
    const comp = COMPONENTS.find((c) => c.id === key);
    if (comp) {
      openComponentDetail(comp);
    } else {
      const sep = key.indexOf(':');
      const rule = RULE_INDEX.get(key.slice(sep + 1))?.find((r) => `${r.set}:${r.id}` === key);
      if (rule) openRuleDetail(rule);
      else return;
    }
  }
  history.replaceState(null, '', `#${encodeURIComponent(key)}`);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !detailRoot.hidden) closeDetail();
});

/* ------------------------------------------------------------------ */

renderGallery();
const initial = decodeURIComponent(location.hash.slice(1));
if (initial) openDetail(initial);

/* 给 tools/shoot-gallery.mjs:要烘哪些缩略图、落在哪个文件名,以此页为准。 */
Object.assign(window, {
  __FASHI__: {
    thumbs: CATALOG.map((i) => ({ subject: i.key, file: `${i.part}_${i.variant}.png` })),
    counts: {
      parts: CATALOG.length,
      withRules: CATALOG.filter((i) => i.kind === 'building').length,
      procedural: CATALOG.filter((i) => i.kind === 'procedural').length,
      components: COMPONENTS.length,
      gapRules: ALL_RULES.filter((r) => r.status === 'refuted' || r.status === 'missing').length,
    },
  },
});
window.dispatchEvent(new CustomEvent('fashi:ready'));
