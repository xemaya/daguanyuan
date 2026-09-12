import * as THREE from 'three';
import { registerPart, type PartBuild, type PartContext } from '@builder/parts/registry';
import { getPlan, TERRAIN } from '@builder/compose/terrain';
import { resamplePath, makeTerrainField } from '@builder/compose/terrain-from-plan';
import { SEED } from '@builder/compose/config';
import { pathStations, offsetStation } from '@builder/plan/polyline';
import type { Point2 } from '@builder/plan/geometry';
import { stoneMaterial } from '../materials';
import { mergeByMaterial } from '../merge';
import type { Provenance } from '@builder/derive/provenance';

/**
 * 路牙 / 侧石 — 铺装路的收边。
 *
 * 参照图里地面读得出来,一半靠的是缝与边,不是贴图本身。地形层的铺装遮罩
 * (terrain-from-plan.ts 的 cobble/slab)管"面",这里管"边":沿每条带
 * `paving` 的 plan 路径折线挤出一条矮侧石,把石板/石子与路肩浮土分开。
 * 土路(没带 paving 的)不做边——园林里土路的边本来就是草咬出来的。
 *
 * 依据:路本身有原文(潇湘馆院内「羊腸一條石子漫的路」07-41、近门大路
 * 「平坦寬闊大路」第17回);路牙这个物件原文未点名,是江南园林铺地的通行
 * 收边做法,尺寸为观感取值——留痕在 root.userData.provenance.art。
 *
 * 几何:世界坐标直接挤出(像 garden-wall 那类 plan 线性构件),原点无意义,
 * composer 以 x:0,z:0,y:0 落位。不登记碰撞体——7cm 高的侧石不该绊人。
 */

/** 侧石断面:宽 0.13m,顶面高出地面 0.07m,下埋 0.09m(地形起伏不外露底脚)。 */
const CURB_W = 0.13;
const CURB_UP = 0.07;
const CURB_DOWN = 0.09;
/** 侧石中线离路心的偏移 = 路半宽 + 路面到侧石的浮土肩。 */
const CURB_SHOULDER = 0.10;

export interface CurbRun {
  name: string;
  halfWidth: number;
  points: [number, number][];
}

function pavedRuns(): CurbRun[] {
  return getPlan()
    .paths.filter((p) => p.paving)
    .map((p) => ({
      name: p.name,
      halfWidth: (p.width_m ?? 2.7) / 2,
      points: p.points,
    }));
}

/**
 * 沿一条折线在两侧各挤出一条侧石带,合并为一段几何。
 * 断面四角(外下/外上/内上/内下),顶面+两侧面成带,端头封口。
 * 顶面随地形:逐站取 curb 中线处的地面高,整条抬高 CURB_UP。
 * 导出给检查脚本/测试用(几何是纯数学,不依赖 canvas 材质)。
 */
export function curbGeometry(run: CurbRun, ground: (x: number, z: number) => number): THREE.BufferGeometry {
  // 与路面遮罩同一条密采样线(resamplePath 16/段),边才贴得住遮罩的弯。
  const dense = resamplePath(run.points, 16);
  const pts: [number, number][] = [];
  for (let i = 0; i < dense.xs.length; i++) pts.push([dense.xs[i], dense.zs[i]]);
  const stations = pathStations(pts);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const hw = CURB_W / 2;

  /*
   * 断面不同朝向的面不共享顶点——共享会被 computeVertexNormals 平滑成
   * 斜向法线,7cm 高的侧石顶面会读成侧光,整条黑掉(这次就这么栽的)。
   * 每条面带走自己的顶点流。winding 随左右侧镜像:side<0 时全部翻面。
   */
  const addStrip = (aOut: readonly Point2[], aIn: readonly Point2[], ys: [number, number][], flip: boolean) => {
    const base = positions.length / 3;
    for (let i = 0; i < aOut.length; i++) {
      positions.push(aOut[i][0], ys[i][0], aOut[i][1], aIn[i][0], ys[i][1], aIn[i][1]);
      uvs.push(i * 0.35, 0, i * 0.35, 0.13);
    }
    for (let i = 0; i + 1 < aOut.length; i++) {
      const a = base + i * 2, b = base + (i + 1) * 2;
      if (flip) indices.push(a, b + 1, b, a, a + 1, b + 1);
      else indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  };
  const addCap = (corners: [number, number, number][], flip: boolean) => {
    const base = positions.length / 3;
    for (const c of corners) positions.push(...c);
    for (let i = 0; i < 4; i++) uvs.push(0, i * 0.05);
    if (flip) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (const side of [1, -1]) {
    const flip = side < 0;
    const off = (run.halfWidth + CURB_SHOULDER + hw) * side;
    const outer: Point2[] = [];
    const inner: Point2[] = [];
    const gy: number[] = [];
    for (const s of stations) {
      outer.push(offsetStation(s, off + hw * side));
      inner.push(offsetStation(s, off - hw * side));
      gy.push(ground(...offsetStation(s, off)));
    }
    const top = gy.map((y) => y + CURB_UP);
    const bot = gy.map((y) => y - CURB_DOWN);
    // 外侧面、顶面、内侧面三条带——从路上看对面那一条时看到的就是内侧面。
    addStrip(outer, outer, bot.map((b, i) => [b, top[i]] as [number, number]), flip);
    addStrip(outer, inner, top.map((t) => [t, t] as [number, number]), flip);
    addStrip(inner, inner, top.map((t, i) => [t, bot[i]] as [number, number]), flip);
    // 端头封口(外下/外上/内上/内下四角的四边形),朝路的两端外。
    const cap = (i: number): [number, number, number][] => [
      [outer[i][0], bot[i], outer[i][1]],
      [outer[i][0], top[i], outer[i][1]],
      [inner[i][0], top[i], inner[i][1]],
      [inner[i][0], bot[i], inner[i][1]],
    ];
    addCap(cap(0), !flip);
    addCap(cap(stations.length - 1), flip);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

let previewGround: ((x: number, z: number) => number) | undefined;

export function buildLuya(context?: PartContext): PartBuild {
  const ground =
    context?.ground ??
    (previewGround ??= makeTerrainField(getPlan(), {
      seed: SEED,
      bounds: { minX: TERRAIN.minX, maxX: TERRAIN.maxX, minZ: TERRAIN.minZ, maxZ: TERRAIN.maxZ },
    }).height);

  const group = new THREE.Group();
  group.name = 'Luya';
  const stone = stoneMaterial(1);
  const runs = pavedRuns();
  for (const run of runs) {
    const mesh = new THREE.Mesh(curbGeometry(run, ground), stone);
    mesh.castShadow = false; // 7cm 高的侧石投影只会在路肩上拉脏线,不投
    mesh.receiveShadow = true;
    mesh.name = `路牙:${run.name}`;
    group.add(mesh);
  }
  const merged = mergeByMaterial(group);
  merged.name = 'Luya';

  const provenance: Provenance = {
    evidence: [
      {
        id: 'honglou:07-41',
        name: '潇湘馆院内羊肠石子路',
        location: '《红楼梦》第四十回',
        note: '「一進門,只見兩邊翠竹夾路,土地下蒼苔布滿,中間羊腸一條石子漫的路」——院内窄路与石子铺装本身有原文。',
      },
      {
        id: 'honglou:ch17-broad-road',
        name: '近门平坦宽阔大路',
        location: '《红楼梦》第十七回',
        note: '「直由山腳邊忽一轉,便是平坦寬闊大路,豁然大門前見」——近门大路的宽阔有原文。',
      },
    ],
    inference: [],
    art: [
      {
        id: 'project:pudi-luya-dimensions',
        name: '路牙/侧石尺寸与设置范围',
        method: 'artistic_choice',
        note:
          `路牙(侧石)这个物件原文未点名,规则表(fashi/qing/fayuan/missing 查过)无铺地收边条目;` +
          `设它是江南园林铺地的通行收边,且「地面靠缝与边读出来」是 ART_DIRECTION 的观感要求。` +
          `断面 ${CURB_W}m 宽、出露 ${CURB_UP}m、路肩留 ${CURB_SHOULDER}m 浮土,皆为观感取值;` +
          `只沿 plan.paths 里带 paving 的路挤出(当前:潇湘馆院内甬路、近门大路),土路不设边。` +
          `不登记碰撞体——侧石不该绊人(playtest 验收)。`,
      },
    ],
  };
  merged.userData.provenance = provenance;
  return { root: merged };
}

registerPart('luya', (_variant, context) => buildLuya(context));
