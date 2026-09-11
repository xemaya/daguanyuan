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
  for (let i = 0; i < n; i++) g.fillText(text[i], x0 + i * gap, h / 2 + size * 0.04);
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
