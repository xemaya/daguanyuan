import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { mergeByMaterial } from '../merge';
import { bambooMaterial } from '../materials';
import { plaqueFromPlan } from '@builder/plan/objects';
import { Simplex } from '@engine/core/Noise';
import { planItem } from './plan-data';

/**
 * 酒幌(杏帘)——单子 BB4。07-12「還少一個酒幌……不必華麗,就依外面村莊的式樣作來,用竹竿挑在樹梢」。
 *
 * 一根斜挑的青竹竿,竿梢系一根短竹横挑,挂一面青布酒帘:布上白字竖写(字从 plan 读,不写字面量),
 * 犬牙边,下缘三条燕尾——布是垂下来的、有褶,下缘不是一条直线。**不用 transmission**(P-05)。
 * 局部坐标:原点在竿脚,竿向 −X 斜挑;布面朝 +Z。variant = plan 里酒幌的 id。
 */
const JH = { poleLen: 9.2, poleR: 0.045, lean: 22 * Math.PI / 180, clothW: 0.85, clothH: 2.0, batten: 1.25, out: 0.6, twist: 0.35 };
const PROVENANCE = [{ id: 'project:wine-banner', name: '酒幌(杏帘)', method: 'artistic_choice',
  note: '07-12「用竹竿挑在樹梢」「不必華麗,就依外面村莊的式樣」:青竹竿长 9.2 m、斜挑 22°(竿梢离地约 7.6 m;BB 收尾按合回后的实际杏树量:最近三株冠顶世界高 4.96/6.75/6.58 m,竿梢须明显高过);青布帘 0.85×2.0 m,挂在竿梢伸出的横挑上、离竿 0.6 m,白字竖写、犬牙边、下缘燕尾;布有纵褶、下半截鼓出、整面斜转 20° 不与竿共面。尺寸与式样为艺术取值,字从 plan 读。' }];

const FONT = '"AR PL UKai","STKaiti","KaiTi","Kaiti SC","Noto Serif SC",serif';

function clothTexture(text: string): THREE.CanvasTexture {
  const W = 256, H = Math.round(W * JH.clothH / JH.clothW);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paint = () => {
    g.clearRect(0, 0, W, H);
    // 帘身:青布(靛青偏灰),下缘三条燕尾。
    const tailH = H * 0.1, body = H - tailH, tooth = 12;
    g.fillStyle = '#35556b';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, body);
    for (let k = 3; k >= 0; k--) {
      const x0 = (W * k) / 3;
      if (k < 3) g.lineTo(x0 + W / 6, body + tailH); // 燕尾尖
      g.lineTo(x0, body);
    }
    g.closePath(); g.fill();
    // 布纹:细横纹。
    for (let y = 0; y < H; y += 3) { g.fillStyle = `rgba(20,30,40,${0.05 + ((y * 7) % 5) * 0.012})`; g.fillRect(0, y, W, 1); }
    // 犬牙边:两侧与上沿一排白色三角。
    g.fillStyle = '#e8e2d2';
    for (let y = 0; y < body - tooth; y += tooth) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(tooth * 0.8, y + tooth / 2); g.lineTo(0, y + tooth); g.fill();
      g.beginPath(); g.moveTo(W, y); g.lineTo(W - tooth * 0.8, y + tooth / 2); g.lineTo(W, y + tooth); g.fill();
    }
    for (let x = 0; x < W - tooth; x += tooth) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + tooth / 2, tooth * 0.8); g.lineTo(x + tooth, 0); g.fill(); }
    // 字:白字竖写,自上而下。
    const n = Math.max(1, text.length), size = Math.min(W * 0.62, (body - tooth * 2) / n * 0.86);
    g.font = `${size}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f1ece0';
    for (let i = 0; i < n; i++) g.fillText(text[i], W / 2, tooth + (body - tooth * 2) * ((i + 0.5) / n));
  };
  paint();
  const fonts = (typeof document !== 'undefined' ? document.fonts : undefined) as FontFaceSet | undefined;
  if (fonts?.load) fonts.load(`${W}px "AR PL UKai"`, text).then(() => { paint(); tex.needsUpdate = true; }).catch(() => {});
  return tex;
}

let CLOTH: Map<string, THREE.MeshStandardMaterial> | undefined;
function clothMaterial(text: string): THREE.MeshStandardMaterial {
  CLOTH ??= new Map();
  let m = CLOTH.get(text);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: clothTexture(text), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    CLOTH.set(text, m);
  }
  return m;
}

export function buildJiuhuang(variant: string): PartBuild {
  const id = variant === 'default' ? 'daoxiangcun.wine-banner' : variant;
  const item = planItem(id);
  if (item.kind !== 'prop') throw new Error(`[jiuhuang] ${id} 不是摆件`);
  const text = plaqueFromPlan(id);
  if (!text) throw new Error(`[jiuhuang] ${id} plan 里没有帘上的字`);
  const group = new THREE.Group(), bamboo = bambooMaterial();
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; group.add(o); };
  // 竹竿:插地 0.4 m,向 −X 斜挑;竿梢略弯下。
  const base = new THREE.Vector3(0, -0.4, 0);
  const dir = new THREE.Vector3(-Math.sin(JH.lean), Math.cos(JH.lean), 0);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, p = base.clone().addScaledVector(dir, JH.poleLen * t);
    p.y -= 0.45 * t * t * t; // 梢头受帘重下弯
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  add(new THREE.TubeGeometry(curve, 24, JH.poleR, 7, false), bamboo);
  const tip = pts[pts.length - 1].clone().addScaledVector(dir, -0.25);
  // 横挑:一根短竹,系在竿梢下。
  // 横挑自竿梢向外(−X)伸出,帘挂在横挑外段,离开竿身——不然竿从帘面中间穿过去。
  const hang = new THREE.Vector3(tip.x - JH.out, tip.y - 0.06, tip.z);
  const bat = new THREE.CylinderGeometry(0.02, 0.02, JH.batten, 6);
  bat.rotateZ(Math.PI / 2); bat.translate(tip.x - JH.batten / 2 + 0.1, hang.y, tip.z);
  add(bat, bamboo);
  // 布:网格,顶边钉在横挑上,往下垂;褶是纵向的几道起伏,下半截向外飘一点,下缘两角各垂下一点。
  const cols = 8, rows = 18, s = new Simplex(4242), pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const top = hang.y - 0.02;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols, v = j / rows;
    const lx = (u - 0.5) * JH.clothW;
    const fold = 0.05 * Math.sin(u * Math.PI * 4 + 0.6) * (0.3 + v) + 0.015 * s.noise2D(u * 3, v * 4);
    const belly = 0.16 * v * v * Math.sin(u * Math.PI);
    const droop = 0.06 * Math.pow(Math.abs(u - 0.5) * 2, 2) * v;
    // 整面绕竖轴斜转 twist(越往下转得越多一点),读成挂着的布,不读成一块招牌板。
    const a = JH.twist * (0.6 + 0.4 * v), dz = fold + belly;
    pos.push(hang.x + lx * Math.cos(a) + dz * Math.sin(a), top - v * JH.clothH - droop, hang.z - lx * Math.sin(a) + dz * Math.cos(a));
    uv.push(u, 1 - v);
    if (i < cols && j < rows) { const a = j * (cols + 1) + i; idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2); }
  }
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cloth.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  cloth.setIndex(idx); cloth.computeVertexNormals();
  add(cloth, clothMaterial(text));
  const root = mergeByMaterial(group);
  root.name = id;
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PROVENANCE } };
  root.userData.planObject = { id };
  return { root, groundRadius: 3 };
}
