import * as THREE from 'three';
import { registerPart, type PartBuild, type PartContext } from '@builder/parts/registry';
import { getPlan, TERRAIN } from '@builder/compose/terrain';
import { makeTerrainField } from '@builder/compose/terrain-from-plan';
import { SEED } from '@builder/compose/config';
import { pathStations, offsetStation } from '@builder/plan/polyline';
import type { Point2 } from '@builder/plan/geometry';
import { stoneMaterial } from '../materials';
import { mergeByMaterial } from '../merge';
import type { Provenance } from '@builder/derive/provenance';

/**
 * 石压边 —— 窄水沟两岸的石板压沿(pudi 门类第二件,`luya.ts` 是第一件)。
 *
 * 依据:单子 AH(`docs/PITFALLS.md` P-20)。潇湘馆的引泉沟原文「開溝僅尺許,
 * 灌入牆內」(17 回)只说沟窄,没说岸怎么收边——石压边这个物件是江南园林
 * 窄沟的通行做法(一条尺许宽的沟用石板压沿,不是驳岸乱石;乱石是给大水面
 * 的假山驳岸用的,尺许沟砌乱石会荒谬),尺寸是观感取值,留痕在
 * `root.userData.provenance.art`。
 *
 * 只沿 `plan.water[]` 里 `id === 'ditch.xiaoxiang'` 那一条走——按 `id` 精确
 * 点名,不按「带不带 `centerline`」过滤(见下面 `ditchRuns` 的注释:那个字段
 * 是流动水系的通用标记,沁芳溪三段、舡坞支港也都带,拿它当过滤条件会把
 * 那些宽水系一并误套上石边)。
 *
 * 与沟本身的对齐见单子 AH 的"顺序不能反":石边的偏移量直接读 `width_m`,
 * 与 `terrain-from-plan.ts` 挖沟用的同一条 `plan.water[]` 记录同源
 * ——沟宽改了石边跟着改,不会有人只改一处。
 *
 * 几何:世界坐标直接挤出(与 `luya.ts` 同一路数),原点无意义,composer
 * 以 x:0,z:0,y:0 落位。不登记碰撞体——5cm 高的石唇不该绊人。
 */

/** 石压边断面:宽 0.16m(比路牙 luya 稍宽,读成"压"而非"立"的扁石唇),
 *  顶面高出地面 0.05m,下埋 0.08m(地形起伏不外露底脚)。 */
const EDGE_W = 0.16;
const EDGE_UP = 0.05;
const EDGE_DOWN = 0.08;
/** 沟宽缺省档(m)——`plan.water[].width_m` 缺省时兜底,当前引泉沟自带该字段用不到。 */
const DITCH_WIDTH_FALLBACK = 0.8;

export interface EdgeRun {
  name: string;
  /** 沟中线到石边中线的偏移 = 沟半宽,与挖沟同一份数据。 */
  halfWidth: number;
  points: [number, number][];
}

/**
 * 本单只做潇湘馆穿院引泉沟一条,按 id 精确点名——`centerline` 是「流动水系」
 * 的通用字段(`tools/check-plan.mjs`、`engine/render/Water.ts` 的流向渲染都在用),
 * 沁芳溪三段、舡坞支港(4.8m 宽)也都带它,拿"有没有 centerline"当过滤条件
 * 会把那些宽水系一并扫进来挤一圈石边——这不是本单要做的事,也不是它们的
 * 尺度该配的收边(实测：这一疏忽让 xiaoxiang/grass_close 两镜三角数分别
 * 涨了 3.9%/2.2%,远超预算,见回报)。
 */
const DITCH_ID = 'ditch.xiaoxiang';

function ditchRuns(): EdgeRun[] {
  return getPlan()
    .water.filter((w) => w.id === DITCH_ID)
    .map((w) => ({
      name: w.name,
      halfWidth: (w.width_m ?? DITCH_WIDTH_FALLBACK) / 2,
      points: w.centerline!,
    }));
}

/**
 * 沿一条折线在两侧各挤出一条石压边,合并为一段几何。断面四角(外下/外上/
 * 内上/内下),顶面随地形逐站取样、整条抬高 EDGE_UP。不裁地形窗口——引泉沟
 * 整条都在潇湘馆院内,是已建成区,不会伸到窗口外面(与 `luya.ts` 的近门
 * 大路不同,那条路贴着画布边缘,必须裁)。
 */
export function edgeGeometry(run: EdgeRun, ground: (x: number, z: number) => number): THREE.BufferGeometry {
  const hw = EDGE_W / 2;
  const stations = pathStations(run.points);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  /*
   * 断面不同朝向的面不共享顶点(同 luya.ts 的教训:共享会被
   * computeVertexNormals 平滑成斜向法线,矮石唇的顶面会读成侧光,整条黑掉)。
   */
  const addStrip = (aOut: readonly Point2[], aIn: readonly Point2[], ys: [number, number][], flip: boolean) => {
    const base = positions.length / 3;
    for (let i = 0; i < aOut.length; i++) {
      positions.push(aOut[i][0], ys[i][0], aOut[i][1], aIn[i][0], ys[i][1], aIn[i][1]);
      uvs.push(i * 0.35, 0, i * 0.35, 0.16);
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
    const off = run.halfWidth * side;
    const outer: Point2[] = [];
    const inner: Point2[] = [];
    const gy: number[] = [];
    for (const s of stations) {
      outer.push(offsetStation(s, off + hw * side));
      inner.push(offsetStation(s, off - hw * side));
      gy.push(ground(...offsetStation(s, off)));
    }
    const top = gy.map((y) => y + EDGE_UP);
    const bot = gy.map((y) => y - EDGE_DOWN);
    // 外侧面、顶面、内侧面三条带——沟内看对岸那一条时看到的就是内侧面。
    addStrip(outer, outer, bot.map((b, i) => [b, top[i]] as [number, number]), flip);
    addStrip(outer, inner, top.map((t) => [t, t] as [number, number]), flip);
    addStrip(inner, inner, top.map((t, i) => [t, bot[i]] as [number, number]), flip);
    // 端头封口(外下/外上/内上/内下四角的四边形),朝沟的两端外——沟的
    // 两端分别没入后院墙下、盘出竹下,封口不会露天穿帮。
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

export function buildShiyabian(context?: PartContext): PartBuild {
  const ground =
    context?.ground ??
    (previewGround ??= makeTerrainField(getPlan(), {
      seed: SEED,
      bounds: { minX: TERRAIN.minX, maxX: TERRAIN.maxX, minZ: TERRAIN.minZ, maxZ: TERRAIN.maxZ },
    }).height);

  const group = new THREE.Group();
  group.name = 'Shiyabian';
  const stone = stoneMaterial(1);
  const runs = ditchRuns();
  for (const run of runs) {
    const geo = edgeGeometry(run, ground);
    const mesh = new THREE.Mesh(geo, stone);
    mesh.castShadow = false; // 5cm 高的石唇投影只会在沙带上拉脏线,不投
    mesh.receiveShadow = true;
    mesh.name = `石压边:${run.name}`;
    group.add(mesh);
  }
  const merged = mergeByMaterial(group);
  merged.name = 'Shiyabian';

  const provenance: Provenance = {
    evidence: [
      {
        id: 'honglou:ch17-spring-ditch',
        name: '得泉一派开沟尺许灌入墙内',
        location: '《红楼梦》第十七回',
        note: '「後院墙下......想是要接泉脉那笑道原是从那闸起,流至那洞口,从东北墙根下引泉一脉......开沟僅尺許,灌入牆內」——沟窄本身有原文。',
      },
    ],
    inference: [],
    art: [
      {
        id: 'project:pudi-shiyabian-dimensions',
        name: '石压边尺寸与偏移',
        method: 'artistic_choice',
        note:
          `石压边这个物件原文未点名,规则表(fashi/qing/fayuan/missing 查过)无窄沟收边条目;` +
          `设它是江南园林窄沟的通行收边,参照物是石板压沿而非驳岸乱石(尺许沟砌乱石假山会荒谬)。` +
          `断面 ${EDGE_W}m 宽、出露 ${EDGE_UP}m、埋深 ${EDGE_DOWN}m,均为观感取值;` +
          `偏移量直接取 plan.water[].width_m 的半宽,与挖沟同一份数据生成,不许沟就石边改宽。` +
          `不登记碰撞体——石唇不该绊人(playtest 验收)。`,
      },
    ],
  };
  merged.userData.provenance = provenance;
  return { root: merged };
}

registerPart('shiyabian', (_variant, context) => buildShiyabian(context));
