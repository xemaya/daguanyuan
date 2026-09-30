import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { whiteStoneMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import type { Provenance } from '@builder/derive/provenance';

/**
 * 抱鼓石 / 门枕石 — 正门口的"门当"。
 *
 * 第十七回写正门只到「白石台磯」为止,抱鼓石原文无据(07-01 已核验段落内
 * 无此物),规则表(fashi/qing/fayuan/missing 全查过)也没有它的尺寸。设此物
 * 是因为它是"门"最强的视觉符号(ROADMAP PQ-7)。形制的出处状态:
 *
 *   **有出处**(2026-09-15 查维基「门墩」「抱鼓石」两条,甲已核、乙待核——
 *   维基是通论,清代官式门枕石的具体做法与尺寸未核《工程做法》,待裁点见
 *   knowledge/docs/qingshi/07-honglou.md open_questions):
 *   - 整块门枕石跨在门槛下,**门内部分有海窝承门轴,门外部分才是门墩(鼓)**;
 *   - 门墩由**须弥座、抱鼓、兽吻或狮子**几部分构成;须弥座一般刻**莲花**、
 *     上面通常有**锦铺**;
 *   - 抱鼓是**竖立的鼓**,鼓面常刻**螺旋纹**(故又称螺鼓石),鼓面与鼓侧面
 *     刻吉祥纹样;
 *   - 整个门枕石由**一块整石**雕成——所以三段之间不许有"零件摞起来"的
 *     接缝感,收分要连贯、交接要过渡。
 *
 *   **用户指定**(2026-09-15 反馈第 1 条):位置在**门前**(鼓落在门外的地
 *   面上,不躲进门里);朝向**左右相对**(两块互为镜像,鼓面朝两侧互相对
 *   着,不是都面向门外);鼓下要有**祥云、平台**。
 *
 *   **无出处(艺术选择,留 provenance.art)**:所有具体尺寸、莲瓣与祥云的
 *   形状参数、收分比例。
 *
 * 局部坐标:原点在整石底面中心、门槛平面(中柱缝)上;+Z 朝门外,门枕尾
 * 伸向 -Z(门内)。构件自身 X 向对称(圭角前后、鼓的两面同样做法),一对
 * 就是同一构件在门左右各放一份——两面鼓面都刻螺旋纹与鼓钉,两块石的
 * 内侧鼓面自然互相对着(「左右相对」),不需要镜像变体。
 *
 * ⚠️ 鼓顶「兽吻或狮子」做成可选档(variant 'beast'):用户 2026-09-14 已拍板
 * 门前不加石狮(07-53 石狮属府门、07-01 刻意写素),同一条理由倾向素鼓;
 * 但这是形制取舍,两档对照图交用户裁定,默认 'default' = 素鼓。
 */

/** 鼓面(平背那一圈)相对鼓径的半径比——与鼓帮车削剖面的起点对齐。 */
const DRUM_FACE_R_RATIO = 0.6;

/**
 * 鼓面:平背那一圈,局部平面投影(沿鼓轴投)——AN2/AJ2 F-AJ-2:旧版整鼓走
 * 一张 LatheGeometry,车削 UV 在平背上退化成极坐标(u=角度,v=半径),
 * 各向异性的凿痕贴图一到平面就读成从鼓心放射的条纹。`CircleGeometry`
 * 默认躺在 XY 平面、法线 +Z,UV 是 (x,y) 的笛卡尔投影(见 three.js 源码,
 * 不是极坐标)——转个向让法线沿鼓轴(X)朝外,平面投影就天然贴对了鼓轴,
 * 不会再读出放射纹。两面颜色/法线/粗糙度同一档(fine)。
 */
function drumFaceGeometry(rFace: number, outward: 1 | -1): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(rFace, 32);
  g.rotateY((outward * Math.PI) / 2);
  return g;
}

/**
 * 鼓帮:平背之外鼓起的那圈曲面,车削生成,轴沿 X(鼓面朝两侧,一对石左右
 * 相对;旧版鼓轴沿 Z 朝内外,是"都面向门外")。剖面只剩鼓帮这一段(不再带
 * 平背),车削默认 UV(u=绕轴角度分数、v=沿剖面弧长分数——"周向展开")
 * 不再跨平背,不会再把半径线性映进 v。走 rough(看得出雕凿走向的立面)。
 */
function drumBarrelGeometry(R: number, T: number): THREE.BufferGeometry {
  const rFace = R * DRUM_FACE_R_RATIO;
  const pts = [
    new THREE.Vector2(rFace, -T / 2),
    new THREE.Vector2(R * 0.94, -T * 0.42),
    new THREE.Vector2(R, 0),
    new THREE.Vector2(R * 0.94, T * 0.42),
    new THREE.Vector2(rFace, T / 2),
  ];
  const g = new THREE.LatheGeometry(pts, 22);
  g.rotateZ(Math.PI / 2); // 鼓轴从 Y 转到 X:鼓面朝门的左右两侧
  return g;
}

/** 平螺旋(阿基米德螺线)圆管——螺鼓石的鼓面螺旋纹 / 鼓脚的祥云卷。
 * 在 Y-Z 平面上盘,x 由 caller 平移;sign 控制旋向(两面镜像)。 */
function spiralTube(
  r0: number, r1: number, turns: number, tubeR: number, sign: number, mat: THREE.Material,
): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  const steps = Math.ceil(turns * 16);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const a = t * turns * Math.PI * 2 * sign;
    const r = r0 + (r1 - r0) * t;
    pts.push(new THREE.Vector3(0, Math.cos(a) * r, Math.sin(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
  const geo = new THREE.TubeGeometry(curve, Math.max(12, steps * 2), tubeR, 5, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 尺寸全部无出处,为观感取值(见 userData.provenance.art)。用户 2026-09-14
// 走完正门拍板「做大、做精」(D6):整体尺度沿用那一档(×1.3)。
const SCALE = 1.3;
const BAOGUSHI_DRUM_R_M = 0.34 * SCALE;
const BAOGUSHI_DRUM_T_M = 0.18 * SCALE;
/** 鼓心到门槛平面(中柱缝)的距离:鼓背贴在门槛外一线,鼓落在门外地面上。 */
const BAOGUSHI_DRUM_Z_M = 0.03 + BAOGUSHI_DRUM_R_M;
/** 门枕尾伸进门内的长度(海窝那一端,过门轴 0.5m——「长度要够」)。 */
const BAOGUSHI_PILLOW_BACK_M = 0.52;
/** 须弥座最下一层(圭角)的 Z 向半深。落位要拿它躲开踏跺、对墁缝,所以导出。 */
const BAOGUSHI_SEAT_HALF_Z_M = 0.84 / 2;
export { BAOGUSHI_DRUM_T_M, BAOGUSHI_DRUM_R_M, BAOGUSHI_DRUM_Z_M, BAOGUSHI_SEAT_HALF_Z_M };

export type BaogushiTopping = 'none' | 'beast';

/**
 * 单子 AT2(2026-09-16):**垂带抱鼓**一档。
 *
 * 用户 2026-09-16 试玩后拍板:「抱鼓石样式 OK 了,但位置还是不对,不会放在
 * 门里面的,放到台阶两侧」。清式踏跺的**垂带石下端**常设抱鼓石(垂带抱鼓 /
 * 砚窝石一带),鼓面朝踏跺、左右相对,坐在踏跺脚的地面上——正是用户要的位置。
 * (甲核:通式;乙待核:《工程做法》踏跺垂带条目有无抱鼓规定,记
 * `knowledge/docs/qingshi/07-honglou.md` open_questions,与 AJ2 那条并排。)
 *
 * 挪到台阶脚就**不跨门槛**了,所以 `withPillow:false` 这一档把门枕那一截
 * (连同它的海窝端)整个去掉:门枕的用处是承门轴,踏跺脚没有门轴,留着它
 * 就是一条从须弥座伸出来、伸进空气里的石舌头。
 *
 * 去掉门枕之后整件在 Z 向就**前后对称**了(圭角/下枋/束腰/上枋/锦铺/鼓/祥云
 * 都是对称的),于是局部原点顺势从"门槛平面"挪到**须弥座中心**——`drumZ`
 * 归零。落位方因此拿到一个"就是这块石头的中心"的原点,不用再记
 * `BAOGUSHI_DRUM_Z_M` 这个偏移(门枕档仍然要记,它的原点还在门槛上)。
 */
export interface BaogushiOptions {
  /** 跨门槛的门枕那一截。门当档 true(默认),垂带抱鼓档 false。 */
  withPillow?: boolean;
}

export function buildBaogushi(topping: BaogushiTopping = 'none', opts: BaogushiOptions = {}): PartBuild {
  const withPillow = opts.withPillow !== false;
  // AN2:白石两档——鼓帮(周向鼓起、看得出雕凿)与须弥座束腰用 rough,
  // 其余(门枕、圭角、下枋、莲瓣、上枋、锦铺、鼓面、鼓钉、螺旋纹、祥云托、
  // 兽)都是 fine(默认档)。
  const stone = whiteStoneMaterial(1);
  const stoneRough = whiteStoneMaterial(1, 'rough');
  const g = new THREE.Group();
  g.name = 'Baogushi';

  const drumR = BAOGUSHI_DRUM_R_M;
  const drumT = BAOGUSHI_DRUM_T_M;
  // 门当档的原点在门槛平面上、鼓在 +Z 外;垂带抱鼓档没有门槛可对,原点就是
  // 石头自己的中心(见 BaogushiOptions 的注释)。
  const drumZ = withPillow ? BAOGUSHI_DRUM_Z_M : 0;

  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, mat: THREE.Material = stone) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  /* ---- 门枕(整石的脊):从门内海窝端穿过门槛下,接进须弥座 -------------
   * 低而窄,顶面压在门槛(0.08m 高)之下——门槛跨在它上面,读作"嵌在石槽里"
   * (考据:门枕石中间有槽支撑门框)。海窝本身从略(藏在门槛与门扇下,看不见),
   * 但长度留够:门内一端过门轴 0.52m。 */
  if (withPillow) {
    add(roundedBox(0.31, 0.075, BAOGUSHI_PILLOW_BACK_M + 0.3, 0.012, 1), 0, 0.0375, (0.3 - BAOGUSHI_PILLOW_BACK_M) / 2);
  }

  /* ---- 须弥座(三段之底,考据:刻莲花、上面有锦铺) ----------------------
   * 圭角 → 下枋 → 束腰(仰莲) → 上枋锦铺,逐层收分;层与层之间用圆角
   * 过渡,不读成几个独立 box 摞着(考据:一块整石)。 */
  // 圭角:最宽一层,贴地,前后挑出,把整石"放稳"。
  add(roundedBox(0.56, 0.07, 0.84, 0.015, 1), 0, 0.035, drumZ);
  // 下枋:收进。
  add(roundedBox(0.34, 0.04, 0.72, 0.012, 1), 0, 0.09, drumZ);
  // 束腰:再收,是须弥座的"腰"(AN2:雕凿感最强的一层,走 rough)。
  add(roundedBox(0.29, 0.09, 0.62, 0.01, 1), 0, 0.155, drumZ, stoneRough);
  // 仰莲瓣一圈(考据:须弥座一般刻莲花):花瓣尖朝上,托住上枋。
  {
    const petalGeo = new THREE.ConeGeometry(0.03, 0.085, 4, 1);
    petalGeo.scale(1, 1, 0.5);
    const spots: { x: number; z: number; rotY: number }[] = [];
    const hx = 0.29 / 2, hz = 0.62 / 2;
    for (let i = 0; i <= 3; i++) {
      const x = -hx + (i / 3) * hx * 2;
      spots.push({ x, z: drumZ + hz, rotY: 0 }, { x, z: drumZ - hz, rotY: Math.PI });
    }
    for (let i = 1; i < 7; i++) {
      const z = drumZ - hz + (i / 7) * hz * 2;
      spots.push({ x: hx, z, rotY: Math.PI / 2 }, { x: -hx, z, rotY: -Math.PI / 2 });
    }
    for (const s of spots) {
      const petal = new THREE.Mesh(petalGeo, stone);
      petal.position.set(s.x * 1.1, 0.168, drumZ + (s.z - drumZ) * 1.08);
      petal.rotation.y = s.rotY;
      petal.castShadow = true;
      g.add(petal);
    }
  }
  // 上枋:放出一线,顶面是鼓的床。
  add(roundedBox(0.33, 0.05, 0.74, 0.012, 1), 0, 0.225, drumZ);
  // 锦铺(考据:须弥座上面通常有锦铺):搭在上枋上的"包袱皮",两侧垂下
  // 两片薄搭脑,顶边贴鼓床、底边略向外撇——读作搭着的布,不是又一截石。
  // 外撇幅度刻意收住:全石 y>0.08m 的部分都要让开全开门扇的站立面
  // (见 composer 的落位推导),底边不许探进扇带。
  for (const sx of [-1, 1]) {
    const flap = add(roundedBox(0.025, 0.1, 0.7, 0.008, 1), sx * 0.155, 0.2, drumZ);
    flap.rotation.z = sx * 0.15;
  }

  /* ---- 鼓(三段之顶,考据:竖立的鼓) ------------------------------------ */
  const drumY = 0.25 + drumR - 0.06; // 鼓帮沉进锦铺 0.06,整石不悬空
  const drumFaceR = drumR * DRUM_FACE_R_RATIO;
  add(drumFaceGeometry(drumFaceR, 1), drumT / 2, drumY, drumZ, stone);
  add(drumFaceGeometry(drumFaceR, -1), -drumT / 2, drumY, drumZ, stone);
  add(drumBarrelGeometry(drumR, drumT), 0, drumY, drumZ, stoneRough);

  // 鼓钉:每脸各一圈十四颗,紧贴鼓面外缘(D6:钉小、密、只沿边缘一圈,
  // 鼓心留素面,才读成"钉"不是散点——第一轮改对的一步,保留)。
  {
    const studGeo = new THREE.SphereGeometry(0.016, 6, 4);
    const studCount = 14;
    const studRingR = drumR * 0.86;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < studCount; i++) {
        const a = (i / studCount) * Math.PI * 2;
        add(
          studGeo,
          sx * (drumT / 2 + 0.007),
          drumY + Math.sin(a) * studRingR,
          drumZ + Math.cos(a) * studRingR,
        );
      }
    }
  }

  // 鼓面螺旋纹(考据:鼓面常刻螺旋纹,故又称螺鼓石):每脸一盘平螺旋,
  // 两面旋向相反(左右相对的一对石,朝里的两面互为镜像)。
  for (const sx of [-1, 1]) {
    const sp = spiralTube(0.045, drumR * 0.68, 2.2, 0.011, sx, stone);
    sp.position.set(sx * (drumT / 2 + 0.004), drumY, drumZ);
    g.add(sp);
  }

  /* ---- 祥云托(用户指定:鼓下要有祥云):鼓脚前后各一卷云,从锦铺上卷
   * 起托住鼓帮——结构上就是旧版"挟鼓"楔子的纹样化,把鼓"抱"住。 */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cloud = spiralTube(0.02, 0.105, 1.4, 0.013, sx * sz, stone);
      cloud.position.set(sx * (drumT / 2 + 0.004), 0.32, drumZ + sz * (drumR * 0.62));
      g.add(cloud);
    }
  }

  /* ---- 鼓顶小兽(可选档,⚠️ 形制取舍待用户裁定) --------------------------
   * 考据:门墩"在抱鼓或箱体上面雕刻有兽吻或狮子"。但 07-53 石狮属府门、
   * 07-01 刻意写素——同一条理由倾向不加,两档对照图交用户选。 */
  if (topping === 'beast') {
    const topY = drumY + drumR;
    // 蹲兽:身、首、双耳,从简(§10 具象雕刻要集中),面朝门外。
    add(roundedBox(0.15, 0.13, 0.22, 0.05, 2), 0, topY + 0.045, drumZ - 0.02);
    add(roundedBox(0.12, 0.11, 0.12, 0.045, 2), 0, topY + 0.12, drumZ + 0.08);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 4, 1), stone);
      ear.position.set(sx * 0.04, topY + 0.2, drumZ + 0.07);
      ear.castShadow = true;
      g.add(ear);
    }
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
 * 代价:交出去的树大得多(抱鼓石 64 个 mesh 而不是 2 个),`composer` 对重复
 * 摆放要 `clone()` 这棵树。`Object3D.clone()` 共享 geometry/material 引用,
 * 所以这是指针的钱不是顶点的钱(实测世界构建时间见回报)。
 */
  g.name = 'Baogushi';
  const provenance: Provenance = {
    evidence: [],
    inference: [
      {
        id: 'project:baogushi-menzhen-form',
        name: '门枕石三段形制(须弥座+抱鼓,跨门槛)',
        method: 'derived',
        note:
          '维基「门墩」「抱鼓石」(2026-09-15 查,甲已核、乙待核——清代官式门枕石做法尺寸' +
          '未核《工程做法》,见 07-honglou.md open_questions):门枕石跨门槛、门内有海窝承门轴、' +
          '门外部分是门墩;门墩由须弥座(刻莲花、上有锦铺)、抱鼓(竖立的鼓、鼓面常刻螺旋纹)、' +
          '兽吻或狮子构成;整石雕成。位置与"左右相对"朝向、祥云托为用户 2026-09-15 指定;' +
          '兽吻一档按 07-53/07-01 倾向不加(素鼓),两档对照交用户裁定。',
      },
    ],
    art: [
      {
        id: 'project:baogushi-dimensions',
        name: '抱鼓石/门枕石尺寸与形制细节',
        method: 'artistic_choice',
        note:
          '《红楼梦》第十七回写正门无抱鼓石(07-01),规则表亦无门枕石条目;' +
          '设此物是因为它是"门"最强的视觉符号(ROADMAP PQ-7)。' +
          `鼓径 ${(drumR * 2).toFixed(2)}m、鼓厚 ${drumT.toFixed(2)}m、` +
          (withPillow
            ? `鼓心距门槛平面 ${drumZ.toFixed(2)}m、门枕伸入门内 ${BAOGUSHI_PILLOW_BACK_M}m,`
            : `垂带抱鼓档(单子 AT2):去门枕、原点即须弥座中心,落位在前踏跺两条垂带石的下端外侧,`) +
          `均为观感取值,沿用 2026-09-14 D6"做大做精"的 ${SCALE}× 一档;` +
          '莲瓣形状、祥云卷的圈数与半径、须弥座各层收分、螺旋纹盘数均无出处;' +
          (withPillow
            ? '海窝(门内承门轴的圆窝)从略——藏在门槛与门扇下看不见,但门枕长度留够。'
            : '门枕与海窝整段不做:踏跺脚没有门轴,留着就是一条伸进空气里的石舌头。'),
      },
    ],
  };
  g.userData.provenance = provenance;
  return { root: g, groundRadius: 1.2 * SCALE };
}

/**
 * 三档:`default` = 门当(跨门槛、素鼓)、`beast` = 门当加鼓顶小兽、
 * `chuidai` = 垂带抱鼓(去门枕,坐踏跺脚,单子 AT2 用的就是这一档)。
 */
registerPart('baogushi', (variant) =>
  buildBaogushi(variant === 'beast' ? 'beast' : 'none', { withPillow: variant !== 'chuidai' }));
