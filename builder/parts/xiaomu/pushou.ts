import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { roundedBox } from '@builder/parts/sculpt';
import type { Provenance } from '@builder/derive/provenance';

/**
 * 铺首门环（单子 AU2）。
 *
 * ## 为什么是门环，不是门钉
 *
 * 用户 2026-09-16 问：「门板上是否要有铜钉？不确定这个规格的建筑是否要，
 * 或者有个门环是不是就可以。」**答：门环，不装门钉。**
 *
 * 门钉是**等级制**（《大清会典》：宫门纵九横九、亲王府纵九横七，以下递减），
 * 装在**府门**上论品级。大观园正门是**园门**——`07-01`「並無朱粉塗飾」是刻意
 * 写素的一句，`building.ts` 板门那段「不上朱漆不装门钉」的注就是从它来的。
 * 而**铺首门环**是板门通式，**不分等级**：一块铺首座压在门板上，衔一只环，
 * 谁家的板门都有。所以这一件补的是「门板太空」，不是给这座门加品级。
 *
 * ## 三条不许越的线
 *
 * ① **不鎏金**。`ART_DIRECTION` §9：**金只给匾字**。这里用熟铜色——
 *    比 `CN.gold` 暗一档、钝一档（roughness 0.55 对 0.35），放一起不会认错。
 * ② **素面，不做兽面**。§10「具象要集中」：正门的具象名额已经给了抱鼓石
 *    与匾的四角如意云头，再添一张兽脸，正门就从「素」滑到「繁」。
 *    兽面一档待人裁（`07-honglou.md` open_questions 追加一条：门环形制
 *    素面 vs 兽面，乙待核）。
 * ③ **≤ 600 三角一副**（实测 560：座板 192 / 乳钉 32 / 衔口 80 / 环 256）。
 * 一座门两副，它是配角不是主角。
 *
 * ## 坐标约定
 *
 * 原点 = 铺首座**贴在门板面上的那一点**（不是地面），`+Z` 朝门外。
 * 环从铺首下方垂下来，整件在原点的 -Y 一侧居多——挂点给的是「钉在哪」，
 * 不用消费方再去算环垂多少。
 *
 * 尺寸全部无出处（规则表是《营造法式》材分制，门环不在其中），
 * 留痕在 `root.userData.provenance.art`。
 */

/** 铺首座板宽 / 高（门板上压的那块素面座）。 */
const PLATE_W = 0.15;
const PLATE_H = 0.17;
/** 座板离门板面的厚度。 */
const PLATE_T = 0.026;
/** 环的中径与铜条粗细。 */
export const PUSHOU_RING_R = 0.075;
const RING_TUBE = 0.0125;
/** 整副的外包络高度（座顶到环底），消费方核净空用。 */
export const PUSHOU_DROP = PLATE_H / 2 + 0.045 + PUSHOU_RING_R * 2 + RING_TUBE;

let BRONZE: THREE.MeshStandardMaterial | undefined;
/**
 * 熟铜：**不是金**。全园共用一份实例——材质实例不同，静态合并时就多一个桶。
 *
 * ⚠️ 这个色本该进 `materials.ts` 的 `CN` 色板（`ART_DIRECTION` §3「所有中式
 * 构件只从这里取材质」），但 `materials.ts` 不在单子 AU 的文件域里，
 * 顺手改会让并行单子的合并冲突与预算归因都失效（`STANDARD-ACTIONS` 13/14）。
 * 已在回报里点名：`CN.bronze` 该补，归后续单子。`plaque.ts` 的 `ironMaterial`
 * 也是同一个口子，两处一起收。
 */
function bronzeMaterial(): THREE.MeshStandardMaterial {
  BRONZE ??= new THREE.MeshStandardMaterial({ color: 0x6e5436, roughness: 0.55, metalness: 0.74 });
  return BRONZE;
}

function buildPushou(): PartBuild {
  const g = new THREE.Group();
  g.name = 'Pushou';
  const bronze = bronzeMaterial();

  // 座板：素面，四角圆钝。压在门板上，前面（+Z）微微凸出。
  const plate = new THREE.Mesh(roundedBox(PLATE_W, PLATE_H, PLATE_T, 0.022, 2), bronze);
  plate.position.z = PLATE_T / 2;
  g.add(plate);

  // 座心一枚乳钉（素面铺首唯一的起伏；不是兽鼻，也不刻纹）。
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.036, 0.018, 8), bronze);
  boss.rotation.x = Math.PI / 2;
  boss.position.set(0, 0.022, PLATE_T + 0.008);
  g.add(boss);

  // 衔口：座下沿一只小鼻钮，环从这里穿出来。
  const NOSE_Y = -PLATE_H / 2 + 0.028;
  const nose = new THREE.Mesh(new THREE.TorusGeometry(0.020, 0.008, 5, 8), bronze);
  nose.position.set(0, NOSE_Y, PLATE_T + 0.006);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);

  // 环：贴着门板垂下来，略微外倾 —— 正贴在板上会读成画上去的一个圈。
  const ring = new THREE.Mesh(new THREE.TorusGeometry(PUSHOU_RING_R, RING_TUBE, 8, 16), bronze);
  ring.position.set(0, NOSE_Y - 0.012 - PUSHOU_RING_R, PLATE_T + 0.012);
  ring.rotation.x = 0.16;
  g.add(ring);

  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });

  const provenance: Provenance = {
    evidence: [],
    inference: [
      {
        id: 'project:pushou-not-mending',
        name: '正门装铺首门环、不装门钉',
        method: 'derived',
        note:
          '门钉是等级制(《大清会典》宫门纵九横九、亲王府纵九横七,以下递减),装在府门上;'
          + '大观园正门是园门,`07-01`「並無朱粉塗飾」刻意写素,故不装门钉。'
          + '铺首门环是板门通式、不分等级,补的是门板空白,不是给门加品级。'
          + '用户 2026-09-16 提问「有个门环是不是就可以」,单子 AU2 据此裁定。'
          + '素面 vs 兽面一档乙待核(见 07-honglou.md open_questions)。',
      },
    ],
    art: [
      {
        id: 'project:pushou-dimensions',
        name: '铺首门环尺寸与素面做法',
        method: 'artistic_choice',
        note:
          `座板 ${PLATE_W.toFixed(2)}×${PLATE_H.toFixed(2)}×${PLATE_T.toFixed(3)}m、`
          + `环中径 ${(PUSHOU_RING_R * 2).toFixed(2)}m、铜条粗 ${(RING_TUBE * 2).toFixed(3)}m、`
          + `外倾 0.16rad,规则表(《营造法式》材分制)无门环条目,全为观感取值;`
          + '铺首取素面(§10 具象要集中——正门的具象名额已给抱鼓石与匾角花),'
          + '熟铜色 0x6e5436 / roughness 0.55 / metalness 0.74,'
          + '刻意暗于 CN.gold(0xc9a84c / 0.35 / 0.85):ART_DIRECTION §9「金只给匾字」。',
      },
    ],
  };
  g.userData.provenance = provenance;
  return { root: g, groundRadius: 0.35 };
}

registerPart('pushou', (variant) => {
  if (variant !== 'default' && variant !== 'plain') throw new Error(`未登记铺首变体 ${variant}`);
  return buildPushou();
});

export { buildPushou };
