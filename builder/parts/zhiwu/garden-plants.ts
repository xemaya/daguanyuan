/**
 * 点名种植的几何构件——PQ-5c 几何半。
 *
 * 游线四区原文点了名、而 `vegetation.ts` 的乔木骨架（脊线+分枝+冠球）装不下的
 * 三种植物，各配一个生成器：
 *
 *  - **芭蕉**：无枝干，大叶从假茎顶端斜出、先挺后垂，丛生。素描关系与任何
 *    一种树都不同，进 SPECIES 参数表里没有对应自由度，故单独成件。
 *  - **垂蔓（藤萝/薜荔）**：不从地面往上长，从石缝崖顶往下垂。「上則蘿薜
 *    倒垂」「藤蘿掩映」读的都是这个方向。
 *  - **苔斑**：贴地的低伏斑，不是往高处长的东西。「上面苔蘚成斑」
 *    「土地下蒼苔布滿」。
 *
 * 本文件只出几何：纯函数、零副作用（`builder/parts/index.ts` 的 glob 会
 * eager 引入本目录所有文件，这里不注册 part、不改任何全局状态）。
 * 材质与散布位置都在 `vegetation.ts`。
 */
import * as THREE from 'three';
import { makeRng, rangeOf, clamp, lerp } from '@engine/core/Noise';
import { taperedTube, curvedCard, mergeGeos, setFlex } from './foliage-materials';

/** 合并前给单件几何逐顶点上色。mergeGeos 要求颜色属性全有或全无（P-06）。 */
function paint(
  geo: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, t: number) => [number, number, number],
  maxY: number,
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = fn(pos.getX(i), pos.getY(i), pos.getZ(i), clamp(pos.getY(i) / maxY, 0, 1));
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * 一丛芭蕉：三四个假茎，六到九张大叶。
 *
 * 叶是一张强弯的曲卡——先向上挺，过中点后向外向下垂，蕉叶「卷心—展开—
 * 垂边」的读法全在这条弧线上。叶比树叶片大一到两个数量级，风顺性也给得
 * 足（蕉叶是大芭蕉扇，风一吹整丛在动）。
 */
export function bananaClusterGeometry(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];

  // 假茎：叶柄层层包出来的假干，微斜。
  const stems = 3 + Math.floor(rng() * 2);
  for (let s = 0; s < stems; s++) {
    const az = (s / stems) * Math.PI * 2 + rng() * 0.8;
    const h = rangeOf(rng, 0.5, 0.95);
    const lean = rangeOf(rng, 0.04, 0.16);
    const spine: THREE.Vector3[] = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      spine.push(new THREE.Vector3(Math.cos(az) * lean * h * t * t, h * t, Math.sin(az) * lean * h * t * t));
    }
    parts.push(
      taperedTube({
        spine,
        rings: 3,
        radial: 6,
        vScale: 1,
        radius: (t) => 0.052 * (1 - t * 0.42) + 0.008,
      }),
    );
  }

  // 大叶。
  const leaves = 6 + Math.floor(rng() * 3);
  for (let i = 0; i < leaves; i++) {
    const h = rangeOf(rng, 1.1, 1.85);
    const w = h * rangeOf(rng, 0.30, 0.40);
    // bend 给足：垂边是芭蕉剪影的灵魂。
    const leaf = curvedCard(w, h, rangeOf(rng, 0.30, 0.55) * h, rangeOf(rng, -0.08, 0.08) * h, 3);
    leaf.rotateX(rangeOf(rng, 0.45, 0.95));
    leaf.rotateY((i / leaves) * Math.PI * 2 + rangeOf(rng, -0.3, 0.3));
    leaf.translate(rangeOf(rng, -0.08, 0.08), rangeOf(rng, 0.25, 0.55), rangeOf(rng, -0.08, 0.08));
    parts.push(leaf);
  }

  const geo = mergeGeos(parts);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const maxY = geo.boundingBox!.max.y || 1;
  // 基部黄绿、叶尖沉一档；叶比茎色深。
  paint(geo, (_x, y, _z, t) => {
    const k = lerp(1.0, 0.62, t);
    return [0.62 * k, 0.78 * k, 0.38 * k];
  }, maxY);
  setFlex(geo, (_x, y) => {
    const t = clamp(y / maxY, 0, 1);
    return [Math.pow(t, 1.3) * 1.25, 0.4 + t * 0.6];
  });
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 一挂垂蔓：顶端锚在原点，五到七条蔓向下垂，长度不一，微弯。
 *
 * 蔓的下段染紫——紫藤的花串垂在蔓尖。几何上没有单独的花件，这一抹紫色
 * 靠顶点色带出来（材质色为白，顶点色即实色）。
 */
export function wisteriaDrapeGeometry(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const strands = 5 + Math.floor(rng() * 3);
  let maxDrop = 0;
  for (let i = 0; i < strands; i++) {
    const h = rangeOf(rng, 0.8, 1.7);
    maxDrop = Math.max(maxDrop, h);
    const w = rangeOf(rng, 0.13, 0.2);
    const strand = curvedCard(w, h, rangeOf(rng, 0.06, 0.2) * h, rangeOf(rng, -0.12, 0.12) * h, 3);
    // 从向上长翻成向下垂。
    strand.rotateX(Math.PI);
    const az = (i / strands) * Math.PI * 2 + rng() * 0.7;
    strand.rotateY(az);
    const r = rangeOf(rng, 0.05, 0.3);
    strand.translate(Math.cos(az) * r, 0, Math.sin(az) * r);
    // 下段染紫当花串。翻转后 uv.y≈1 的一端是蔓尖（最低点）。
    const pos = strand.attributes.position as THREE.BufferAttribute;
    const uv = strand.attributes.uv as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const t = uv.getY(k);
      const bloom = smooth01((t - 0.68) / 0.32);
      colors[k * 3] = lerp(0.52, 0.66, bloom);
      colors[k * 3 + 1] = lerp(0.64, 0.50, bloom);
      colors[k * 3 + 2] = lerp(0.34, 0.78, bloom);
    }
    strand.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(strand);
  }
  const geo = mergeGeos(parts);
  geo.computeVertexNormals();
  setFlex(geo, (_x, y) => {
    // 垂得越低的梢越活。
    const t = clamp(-y / maxDrop, 0, 1);
    return [0.15 + t * 1.1, 0.75];
  });
  geo.computeBoundingSphere();
  return geo;
}

function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * 一摊苔斑：贴地的低伏圆丘，半径蠕动出破碎轮廓。
 *
 * 与落叶丘（vegetation.ts 的 litterPatchGeometry）同一个「铺而不是贴」的
 * 道理：外圈下沉，让地形沿弧线咬断它，而不是以一条直边结束在半空。
 * 高度压到半径的 6% 以下——苔是地被，不是土丘。
 */
export function mossPatchGeometry(seed: number, size: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const R = size * 0.5;
  const RAD = 8;
  const RING = 2;
  const wob: number[] = [];
  for (let a = 0; a < RAD; a++) wob.push(rangeOf(rng, 0.62, 1.25));

  const positions: number[] = [];
  const indices: number[] = [];
  const rr = [0, 0.55, 1.0];
  const hh = [0.055, 0.04, -0.03];
  for (let k = 0; k <= RING; k++) {
    for (let a = 0; a <= RAD; a++) {
      const ai = a % RAD;
      const th = (a / RAD) * Math.PI * 2;
      const r = R * rr[k] * lerp(1, wob[ai], rr[k]);
      positions.push(Math.cos(th) * r, R * hh[k], Math.sin(th) * r);
    }
  }
  const stride = RAD + 1;
  for (let k = 0; k < RING; k++) {
    for (let a = 0; a < RAD; a++) {
      const i0 = k * stride + a;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      if (k === 0) indices.push(i0, i2, i3);
      else indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // 苔和地同一片天：法线大部压平向上，免得丘沿读成黑边。
  {
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const n = new THREE.Vector3();
    for (let i = 0; i < nor.count; i++) {
      n.fromBufferAttribute(nor, i);
      n.y += 0.85 * (1 - n.y);
      n.normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    nor.needsUpdate = true;
  }
  // 一摊苔内部有浓有淡：顶心与外圈各给一档明度抖动。
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = rangeOf(rng, 0.72, 1.08);
    colors[i * 3] = v;
    colors[i * 3 + 1] = v * rangeOf(rng, 0.96, 1.06);
    colors[i * 3 + 2] = v * rangeOf(rng, 0.82, 0.98);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  setFlex(geo, () => [0, 0.2]);
  geo.computeBoundingSphere();
  return geo;
}

/* ------------------------------------------------------------------ */
/* 花型——PQ-5d：花不止一种                                                */
/* ------------------------------------------------------------------ */

/**
 * 一枝梨花：短莛顶端一簇伞房小百花。
 *
 * 与通用花（vegetation.ts 的 flowerGeometry，单茎单朵五瓣）的区别在花序：
 * 梨花是「一簇」，四五朵小花各自带短柄聚在莛顶，瓣小、色白、心带一点
 * 黄绿。「白」是梨花的全部签名，花瓣不染一丝别的色。
 */
export function pearBlossomGeometry(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const height = rangeOf(rng, 0.16, 0.26);
  const tiltAz = rng() * Math.PI * 2;
  const tilt = rangeOf(rng, 0.05, 0.22);
  const spine: THREE.Vector3[] = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    spine.push(new THREE.Vector3(Math.cos(tiltAz) * tilt * height * t * t, height * t, Math.sin(tiltAz) * tilt * height * t * t));
  }
  const stem = taperedTube({ spine, rings: 3, radial: 4, vScale: 1, radius: (t) => 0.006 * (1 - t * 0.3) });
  paint(stem, () => [0.34, 0.5, 0.22], height);
  parts.push(stem);
  const head = spine[3];

  // 莛顶一簇 4-6 朵，每朵五瓣，各自外展。
  const blooms = 4 + Math.floor(rng() * 2);
  for (let b = 0; b < blooms; b++) {
    const baz = (b / blooms) * Math.PI * 2 + rng() * 0.8;
    const br = b === 0 ? 0 : rangeOf(rng, 0.02, 0.045);
    const bx = head.x + Math.cos(baz) * br;
    const by = head.y + rangeOf(rng, 0, 0.03);
    const bz = head.z + Math.sin(baz) * br;
    const pr = rangeOf(rng, 0.016, 0.024);
    for (let p = 0; p < 5; p++) {
      const petal = curvedCard(pr * 1.1, pr * 1.5, -pr * 0.35, 0, 2);
      petal.rotateX(-Math.PI / 2 + rangeOf(rng, 0.55, 0.95));
      petal.rotateY((p / 5) * Math.PI * 2 + rangeOf(rng, -0.12, 0.12));
      petal.translate(bx, by, bz);
      // 白，尖上略透一点暖。
      paint(petal, (_x, y) => {
        const t = clamp((y - by) / (pr * 1.5) + 0.5, 0, 1);
        return [lerp(0.93, 0.99, t), lerp(0.92, 0.97, t), lerp(0.86, 0.93, t)];
      }, pr * 2);
      parts.push(petal);
    }
    const centre = new THREE.SphereGeometry(pr * 0.4, 4, 2);
    centre.translate(bx, by + pr * 0.1, bz);
    paint(centre, () => [0.82, 0.82, 0.5], pr);
    parts.push(centre);
  }

  const geo = mergeGeos(parts);
  geo.computeVertexNormals();
  setFlex(geo, (_x, y) => [Math.pow(clamp(y / height, 0, 1), 1.4), 0.7]);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 一枝隔岸花：高莛，顶端一丛松散的锥形小花序。
 *
 * 「隔岸花分一脉香」没有指名种，形取**远看一团色、近看一堆小朵**的
 * 草花通式（珍珠梅/绣线菊一路）：隔着水面读的是色块和高度，不是花瓣数。
 * `tint` 由散布侧给，一丛之内花色一致。
 */
export function bankFlowerGeometry(seed: number, tint: [number, number, number]): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const height = rangeOf(rng, 0.3, 0.46);
  const spine: THREE.Vector3[] = [];
  const tiltAz = rng() * Math.PI * 2;
  const tilt = rangeOf(rng, 0.04, 0.18);
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    spine.push(new THREE.Vector3(Math.cos(tiltAz) * tilt * height * t * t, height * t, Math.sin(tiltAz) * tilt * height * t * t));
  }
  const stem = taperedTube({ spine, rings: 3, radial: 4, vScale: 1, radius: (t) => 0.007 * (1 - t * 0.35) });
  paint(stem, () => [0.36, 0.52, 0.26], height);
  parts.push(stem);

  // 莛下半截带一两片叶。
  const leafN = 1 + Math.floor(rng() * 2);
  for (let l = 0; l < leafN; l++) {
    const lh = rangeOf(rng, 0.09, 0.15);
    const leaf = curvedCard(lh * 0.4, lh, lh * 0.4, 0, 2);
    leaf.rotateX(rangeOf(rng, 0.7, 1.1));
    leaf.rotateY(rng() * Math.PI * 2);
    const at = spine[1 + Math.floor(rng() * 2)];
    leaf.translate(at.x, at.y, at.z);
    paint(leaf, () => [0.4, 0.56, 0.3], lh);
    parts.push(leaf);
  }

  // 顶端锥形花序：6-9 粒小朵，越往上越收。
  const head = spine[3];
  const grains = 6 + Math.floor(rng() * 3);
  for (let gN = 0; gN < grains; gN++) {
    const t = gN / grains;
    const gaz = gN * 2.39996 + rng() * 0.5;
    const gr = (1 - t) * rangeOf(rng, 0.015, 0.045);
    const pr = rangeOf(rng, 0.012, 0.02) * (1 - t * 0.3);
    const gx = head.x + Math.cos(gaz) * gr;
    const gy = head.y + t * rangeOf(rng, 0.05, 0.1);
    const gz = head.z + Math.sin(gaz) * gr;
    for (let p = 0; p < 4; p++) {
      const petal = curvedCard(pr, pr * 1.3, -pr * 0.3, 0, 1);
      petal.rotateX(-Math.PI / 2 + rangeOf(rng, 0.6, 1.0));
      petal.rotateY((p / 4) * Math.PI * 2 + rng() * 0.3);
      petal.translate(gx, gy, gz);
      paint(petal, (_x, y) => {
        const k = clamp((y - gy) / (pr * 1.3) + 0.5, 0, 1);
        return [
          lerp(tint[0], 1, k * 0.25),
          lerp(tint[1], 1, k * 0.25),
          lerp(tint[2], 1, k * 0.25),
        ];
      }, pr * 2);
      parts.push(petal);
    }
  }

  const geo = mergeGeos(parts);
  geo.computeVertexNormals();
  setFlex(geo, (_x, y) => [Math.pow(clamp(y / height, 0, 1), 1.3), 0.7]);
  geo.computeBoundingSphere();
  return geo;
}
