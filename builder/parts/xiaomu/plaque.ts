import * as THREE from 'three';
import { lacquerMaterial, goldMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';

/**
 * 匾额:黑漆底、金字、金边。字从 plan.json 的 plaque 来(见
 * builder/plan/objects.ts 的 plaqueFromPlan 与 missing 99-26),构件不写文字面量。
 * 大木作(building.ts)的檐下匾与墙垣(wall.ts)的月洞门门额共用这一件。
 */

function plaqueTexture(text: string, w = 512, h = 192): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c1a18';
  g.fillRect(0, 0, w, h);
  // 金字:楷体优先,系统缺字体时退到衬线。
  g.fillStyle = '#c9a84c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = Math.max(1, text.length);
  const size = Math.min(h * 0.7, (w * 0.86) / n);
  g.font = `bold ${size}px "STKaiti","KaiTi","Kaiti SC","Noto Serif SC","Songti SC",serif`;
  const gap = size * 1.06;
  const x0 = w / 2 - ((n - 1) * gap) / 2;
  // 古代横额从右到左读——第 i 个字画在从右数第 i 个位置上。
  for (let i = 0; i < n; i++) g.fillText(text[i], x0 + (n - 1 - i) * gap, h / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 摩崖题字的**竖排**字面(单子 AM3 的题字石用)。
 *
 * 与 `plaqueTexture` 是两条路,不是一个函数加开关——两者除了「都用楷体画字」
 * 以外没有一处相同,而匾额那一份是既有产出的真源(正门「大觀園」、院门门额),
 * 它多一个参数就多一次改坏的机会。这里另起一份,匾额那份一个字节不动。
 *
 * 三处刻意的不同:
 *   ① **底透明**。匾是黑漆板上贴金字,题字石是**直接刻在石皮上**,底下必须
 *      露出石头本身的顶点色与皱;铺任何一块板都会在白石上多出一个矩形。
 *   ② **字色深**(石青偏墨),不描金——07-01「並無朱粉塗飾」是这座山与门的调子。
 *   ③ **从上往下一列**。匾是横额右起,摩崖是竖读。
 */
export function inscriptionTexture(text: string, cell = 256): THREE.CanvasTexture {
  const n = Math.max(1, text.length);
  const c = document.createElement('canvas');
  c.width = cell;
  c.height = cell * n;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = cell * 0.8;
  g.font = `bold ${size}px "STKaiti","KaiTi","Kaiti SC","Noto Serif SC","Songti SC",serif`;
  for (let i = 0; i < n; i++) {
    const y = cell * (i + 0.5);
    // 凿口的受光边:阴刻的字是一道槽,槽的下缘朝天、吃光,比石面还亮一点。
    // 先画这一层、再把深色字压在上面错开半个笔画,就有了「刻进去」而不是「画上去」。
    g.fillStyle = 'rgba(247,248,244,0.42)';
    g.fillText(text[i], cell / 2 + cell * 0.01, y + cell * 0.012);
    g.fillStyle = '#16202a';
    g.fillText(text[i], cell / 2, y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function makePlaque(text: string, width: number): THREE.Group {
  const g = new THREE.Group();
  const h = width * 0.36;
  const board = new THREE.Mesh(roundedBox(width, h, 0.06, 0.012, 3), lacquerMaterial());
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.94, h * 0.84),
    new THREE.MeshStandardMaterial({ map: plaqueTexture(text), roughness: 0.4, metalness: 0.2 }),
  );
  face.position.z = 0.032;
  board.castShadow = true;
  g.add(board, face);
  // 金边:四条细条。
  const edge = goldMaterial();
  const t = 0.02;
  for (const [x, y, sx, sy] of [
    [0, h / 2 - t / 2, width, t],
    [0, -h / 2 + t / 2, width, t],
    [-width / 2 + t / 2, 0, t, h],
    [width / 2 - t / 2, 0, t, h],
  ]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.012), edge);
    e.position.set(x, y, 0.036);
    g.add(e);
  }
  return g;
}
