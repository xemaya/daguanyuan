import * as THREE from 'three';
import { registerPart, type PartBuild, type PartContext } from '@builder/parts/registry';
import { getPlan, TERRAIN } from '@builder/compose/terrain';
import { resamplePath, makeTerrainField } from '@builder/compose/terrain-from-plan';
import { SEED } from '@builder/compose/config';
import { pathStations, offsetStation } from '@builder/plan/polyline';
import type { Point2 } from '@builder/plan/geometry';
import { smoothstep } from '@engine/core/Noise';
import { stoneMaterial } from '../materials';
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

/**
 * 侧石断面:宽 0.08m,顶面高出地面 0.035m,下埋 0.09m(地形起伏不外露底脚)。
 *
 * **单子 AL4(用户 2026-09-21 拍板 `D-30`「路牙留但压低压窄」)**:原来是
 * 宽 0.13 / 出露 0.07。在潇湘馆那条净宽只有 1.0m 的羊肠路上,两条牙占掉
 * **26%** 的路宽,`cu_xx_path` 贴脸读成市政混凝土道牙,不是江南园路的石压边。
 * 压到 0.08 / 0.035 之后两条牙占 16%、出露只有三个半厘米——读成「压边的石条」。
 *
 * ⚠️ **这是全园通用构件**。改之前把带 `paving` 的路全列了一遍(见 `pavedRuns`),
 * 全园只有两条:潇湘馆院内甬路(cobble,`width_m` 1.2)与近门大路(slab,
 * `width_m` 4.4)。所以这一改也作用在近门大路上——`gate_approach` 前后对照过,
 * 牙变细变矮、仍收得住石板边,不突兀(数与图进回报)。没有按 `width_m` 加阈值:
 * 两条路一条 1.2m 一条 4.4m,同一个断面在两处都读得通,现在加档是给一个不存在
 * 的问题先造一台机器。
 */
const CURB_W = 0.08;
const CURB_UP = 0.035;
const CURB_DOWN = 0.09;
/** 侧石中线离路心的偏移 = 路半宽 + 路面到侧石的浮土肩。 */
const CURB_SHOULDER = 0.10;
/**
 * 边缘淡出宽度(m):距(缩进后的)地形窗口边界这段内,出露高度按 smoothstep
 * 降到 0——到边界正好与地面齐平,不会硬切成"半空里被削平"(和伸到天边
 * 一样出戏,③)。取值要明显大于 curbGeometry 里算的 inset(近门大路
 * halfWidth=2.2m 时 inset≈2.43m),否则裁窗口就把淡出区吃掉了,又变回硬切。
 */
const CURB_FEATHER = 5;

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
 * 点到地形窗口边界的距离,窗口内为正、窗口外为负;`inset` 把窗口整体缩小
 * (四边各收进这么多米)再量。路牙的顶点不在折线中线上,而是side-offset
 * 出去最多 `run.halfWidth + CURB_SHOULDER + CURB_W`(见 curbGeometry 的
 * outer/inner 计算)——只按中线量距离,offset 出去的顶点仍可能戳出窗口
 * 一小截(实测 near-门大路 那条最多戳出 0.34m)。传入这个偏移量当 inset,
 * 中线在"缩小后的窗口"内就保证所有 offset 顶点都在"真窗口"内。
 */
function marginToWindow(x: number, z: number, inset = 0): number {
  return Math.min(x - TERRAIN.minX, TERRAIN.maxX - x, z - TERRAIN.minZ, TERRAIN.maxZ - z) - inset;
}

/**
 * 把密采样折线按(缩进 inset 后的)地形窗口裁成落在窗口内的子段(可能不止
 * 一段);每段两端插值到边界(margin=0)上。窗口外的部分整段丢弃——地形网格
 * 本身到窗口边缘为止,侧石挤到窗口外面纯属浪费三角,也正是③里"飘在空里
 * 一路伸到天边"的根因。相邻采样点距离小于 2cm 时丢弃较新的一个,避免插值
 * 出的边界点与既有采样点重合导致 pathStations 的"零长段"断言炸掉。
 */
function clipToWindow(xs: Float64Array, zs: Float64Array, inset: number): [number, number][][] {
  const MIN_LEG = 0.02;
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  const push = (p: [number, number]) => {
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_LEG) cur.push(p);
  };
  let prevM = marginToWindow(xs[0], zs[0], inset);
  if (prevM >= 0) push([xs[0], zs[0]]);
  for (let i = 1; i < xs.length; i++) {
    const m = marginToWindow(xs[i], zs[i], inset);
    if (prevM >= 0 !== m >= 0) {
      const t = prevM / (prevM - m);
      const boundary: [number, number] = [xs[i - 1] + (xs[i] - xs[i - 1]) * t, zs[i - 1] + (zs[i] - zs[i - 1]) * t];
      if (prevM >= 0) {
        push(boundary);
        if (cur.length >= 2) segs.push(cur);
        cur = [];
      } else {
        cur = [boundary];
      }
    }
    if (m >= 0) push([xs[i], zs[i]]);
    prevM = m;
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

/**
 * 沿一条折线在两侧各挤出一条侧石带,合并为一段几何。
 * 断面四角(外下/外上/内上/内下),顶面+两侧面成带,端头封口。
 * 顶面随地形:逐站取 curb 中线处的地面高,整条抬高 CURB_UP,并按到窗口边界
 * 的距离淡出(见 CURB_FEATHER)。导出给检查脚本/测试用(几何是纯数学,不依赖
 * canvas 材质)。
 */
export function curbGeometry(run: CurbRun, ground: (x: number, z: number) => number): THREE.BufferGeometry {
  const hw = CURB_W / 2;
  // 中线到侧石最外沿的最大距离——裁窗口与淡出都按这个量 inset,否则中线量
  // 着"在窗口内"了,side-offset 出去的顶点仍可能戳出窗口一截。
  const inset = run.halfWidth + CURB_SHOULDER + CURB_W;
  // 与路面遮罩同一条密采样线(resamplePath 16/段),边才贴得住遮罩的弯;
  // 再按(缩进后的)地形窗口裁段(③)。
  const dense = resamplePath(run.points, 16);
  const segs = clipToWindow(dense.xs, dense.zs, inset);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

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

  for (const pts of segs) {
    const stations = pathStations(pts);
    const fade = stations.map((s) => smoothstep(0, CURB_FEATHER, marginToWindow(s.point[0], s.point[1], inset)));
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
      const top = gy.map((y, i) => y + CURB_UP * fade[i]);
      const bot = gy.map((y, i) => y - CURB_DOWN * fade[i]);
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
    const geo = curbGeometry(run, ground);
    if (!geo.attributes.position || geo.attributes.position.count === 0) continue; // 整条路都在地形窗口外
    const mesh = new THREE.Mesh(geo, stone);
    mesh.castShadow = false; // 7cm 高的侧石投影只会在路肩上拉脏线,不投
    mesh.receiveShadow = true;
    mesh.name = `路牙:${run.name}`;
    group.add(mesh);
  }
/*
 * 单子 AQ-b1:**不在构件内部提前合并**。
 *
 * 以前这里是 `mergeByMaterial(root)`——一栋房子按材质合成十来个大 mesh 再交出去。
 * 合完之后 `composer` 末端 `assembleStatic` 的实例化(≥ 8 个同几何原型 →
 * `InstancedMesh`)就**没有原型可认**了:重复的小件已经被烤进大 mesh 的顶点里。
 *
 * 所以构件改为交出**未合并的 `Object3D` 树**,由 `assembleStatic` 统一处理:
 * 先按 `geometry.uuid + material.uuid + 阴影/renderOrder/layers` 分桶实例化,
 * 剩下的才 `mergeByMaterial`。**合并这件事本身没有取消,只是挪到了末端**——
 * 末端的桶跨构件,所以同材质的石作、木作合得比以前更拢,draw call 只会降不会升。
 *
 * 代价:交出去的树大得多(路牙 2 段——这两处本来就没什么可合的),`composer` 对重复
 * 摆放要 `clone()` 这棵树。`Object3D.clone()` 共享 geometry/material 引用,
 * 所以这是指针的钱不是顶点的钱(实测世界构建时间见回报)。
 */
  group.name = 'Luya';

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
          `断面 ${CURB_W}m 宽、出露 ${CURB_UP}m、路肩留 ${CURB_SHOULDER}m 浮土,皆为观感取值` +
          `(2026-09-21 用户拍板 D-30 由 0.13/0.07 压到 0.08/0.035:1.0m 净宽的羊肠路上,` +
          `旧断面两条牙占 26% 路宽,贴脸读成市政道牙);` +
          `只沿 plan.paths 里带 paving 的路挤出(当前:潇湘馆院内甬路、近门大路),土路不设边。` +
          `不登记碰撞体——侧石不该绊人(playtest 验收)。`,
      },
    ],
  };
  group.userData.provenance = provenance;
  return { root: group };
}

registerPart('luya', (_variant, context) => buildLuya(context));
