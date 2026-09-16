import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { CN, woodMaterial, stoneMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { buildLanternMesh, LANTERN_DIAMETER, LANTERN_DROP } from '@builder/parts/xiaomu/lantern';
import type { Provenance } from '@builder/derive/provenance';

/**
 * 高照（落地灯杆）——单子 AU1 · 台账 D5。
 *
 * ## 为什么补这一件
 *
 * `07-70`（第五十三回）：「大觀園正門上也挑著大明角燈，**兩溜高照**，各處皆有路燈」；
 * `07-69`：「兩邊**階下**一色朱紅大高照」。**「两溜高照」是阶下两列落地灯杆**，
 * 和檐下挂的宫灯是两件东西——在单子 AU 之前，正门只有檐下两盏，
 * **两溜高照一根都没有**（台账 D5）。用户 2026-09-16 说「灯笼只有两盏，
 * 而且不够大，略小气」，小气的一半是尺寸，另一半就是这两溜缺席。
 *
 * ## 三件裁定
 *
 * ① **不朱红**。`07-69` 原文写的是「一色**朱紅**大高照」，但那是第五十三回
 *    元宵夜的省亲别墅排场；这座园门是 `07-01`「並無朱粉塗飾」，`ART_DIRECTION`
 *    §9 也把红压到只给 `bridgeVermilion` 一处。**这里取灯罩纸色、杆木色、座石色**，
 *    朱红不上——两条出处打架时以本门自己那一句为准（`D-05` 同口径）。
 * ② **明角灯不挂**。53 回是元宵夜；本场景是晴天上午，台账 D5 原判不变。
 * ③ **不配 PointLight**。与檐灯同一条规矩（见 `lantern.ts` 头注）：
 *    纸面 emissive 假透光，前向渲染里一个点光要进所有材质的着色循环。
 *
 * ## 坐标约定
 *
 * 原点在**石座底面中心**（地面件），`+Z` 朝外。座脚有 `BURY` 一段埋深，
 * 落位的人不用把地面高程算到毫米——地面抖 2cm 也不会露出杆底的缝。
 *
 * 杆高 3.2m 无出处（书里只说「大高照」不给尺寸），艺术取值：
 * 人站在阶下抬头看，灯心略高于视线两倍，是路灯读起来的高度。
 */

/** 杆高（石座顶到杆顶）。无出处，艺术取值。 */
const POLE_H = 3.2;
/** 杆径（下粗上细，清式灯杆收分）。 */
const POLE_R_BOT = 0.075;
const POLE_R_TOP = 0.058;
/** 石座：两层覆盆，下层压地、上层收口。 */
const SEAT_W0 = 0.62;
const SEAT_H0 = 0.20;
const SEAT_W1 = 0.44;
const SEAT_H1 = 0.14;
/** 座脚埋深：落位只给 `dy`，地面高程抖一点也不许露出杆底的缝。 */
const BURY = 0.05;

/** 整根的高度（埋深以上），落位核净空与镜头构图用。 */
export const GAOZHAO_TOTAL_H = SEAT_H0 + SEAT_H1 + POLE_H;
/** 灯心离地高（世界 y 加这个数就是灯身中心）。 */
export const GAOZHAO_LANTERN_Y = GAOZHAO_TOTAL_H - LANTERN_DROP + LANTERN_DIAMETER / 2;

function buildGaozhao(): PartBuild {
  const g = new THREE.Group();
  g.name = 'Gaozhao';
  const wood = woodMaterial(CN.column, 1);
  const stone = stoneMaterial(1);

  // ① 石座:两层覆盆。下层埋进去 BURY,露出的高度才是 SEAT_H0 - BURY。
  const s0 = new THREE.Mesh(roundedBox(SEAT_W0, SEAT_H0, SEAT_W0, 0.03, 2), stone);
  s0.position.y = SEAT_H0 / 2 - BURY;
  g.add(s0);
  const s1 = new THREE.Mesh(roundedBox(SEAT_W1, SEAT_H1, SEAT_W1, 0.025, 2), stone);
  s1.position.y = SEAT_H0 + SEAT_H1 / 2 - BURY;
  g.add(s1);

  // ② 木杆:下粗上细。
  const seatTop = SEAT_H0 + SEAT_H1 - BURY;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(POLE_R_TOP, POLE_R_BOT, POLE_H, 8), wood);
  pole.position.y = seatTop + POLE_H / 2;
  g.add(pole);
  // 杆根一道箍(木杆坐进石座的收口),杆身中段一道——没有这两道,
  // 3.2m 的圆柱远看就是一根牙签。
  for (const [y, r, h] of [[seatTop + 0.06, POLE_R_BOT + 0.018, 0.10], [seatTop + POLE_H * 0.52, POLE_R_BOT + 0.004, 0.055]] as const) {
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), wood);
    hoop.position.y = y;
    g.add(hoop);
  }

  // ③ 杆顶:小木斗托住灯,上面再扣一顶小盖(挡雨,也是杆顶的收头)。
  const poleTop = seatTop + POLE_H;
  const dou = new THREE.Mesh(roundedBox(0.18, 0.07, 0.18, 0.012, 1), wood);
  dou.position.y = poleTop - 0.035;
  g.add(dou);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.19, 0.11, 6), wood);
  cap.position.y = poleTop + 0.055;
  g.add(cap);

  // ④ 灯:与檐下同款同径(`07-70`「大明角燈」是同一种灯),吊在小木斗下。
  const lantern = buildLanternMesh();
  lantern.position.y = poleTop - 0.07;
  g.add(lantern);

  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  // 纸面不投影(与檐灯同):它是"亮的物体",投影会让它读成一块木头。
  lantern.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.MeshStandardMaterial).emissive) m.castShadow = false;
  });

  const provenance: Provenance = {
    evidence: [
      {
        id: 'honglou:07-69',
        name: '「兩邊階下一色朱紅大高照」',
        location: 'knowledge/honglou 07-69（第五十三回）',
      },
      {
        id: 'honglou:07-70',
        name: '「大觀園正門上也挑著大明角燈，兩溜高照，各處皆有路燈」',
        location: 'knowledge/honglou 07-70（第五十三回）',
      },
    ],
    inference: [
      {
        id: 'project:gaozhao-not-vermilion',
        name: '高照不上朱红',
        method: 'derived',
        note:
          '`07-69` 的「朱紅」说的是五十三回元宵夜的省亲别墅排场;本场景是晴天上午的园门,'
          + '`07-01`「並無朱粉塗飾」是这座门自己的一句,两条打架以本门那句为准(D-05 同口径)。'
          + '故取灯罩纸色 / 杆木色 / 座石色,朱红不上。明角灯同理不挂(元宵夜才挂,台账 D5 原判)。',
      },
    ],
    art: [
      {
        id: 'project:gaozhao-dimensions',
        name: '高照杆尺寸',
        method: 'artistic_choice',
        note:
          `杆高 ${POLE_H}m(石座顶起算)、杆径 ${(POLE_R_BOT * 2).toFixed(3)}→${(POLE_R_TOP * 2).toFixed(3)}m、`
          + `石座 ${SEAT_W0}m 见方两层共 ${(SEAT_H0 + SEAT_H1).toFixed(2)}m、座脚埋深 ${BURY}m;`
          + `灯与檐下同款同径 ${LANTERN_DIAMETER.toFixed(2)}m。`
          + '「大高照」原文不给尺寸,规则表(《营造法式》材分制)也没有灯杆条目,全为观感取值:'
          + '灯心落在 2.9m 上下,是人在阶下抬头看得见灯、又不至于压住门脸的一档。',
      },
    ],
  };
  g.userData.provenance = provenance;
  return { root: g, groundRadius: SEAT_W0 };
}

registerPart('gaozhao', (variant) => {
  if (variant !== 'default') throw new Error(`未登记高照变体 ${variant}`);
  return buildGaozhao();
});
