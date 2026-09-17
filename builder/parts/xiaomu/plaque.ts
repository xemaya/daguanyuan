import * as THREE from 'three';
import { lacquerMaterial, goldMaterial, woodMaterial, CN } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';

/**
 * 匾额:黑漆底、金字、金边。字从 plan.json 的 plaque 来(见
 * builder/plan/objects.ts 的 plaqueFromPlan 与 missing 99-26),构件不写文字面量。
 * 大木作(building.ts)的檐下匾与墙垣(wall.ts)的月洞门门额共用这一件。
 *
 * 单子 AT1(2026-09-16):用户第二轮试玩说「牌匾还是很小气,字体也不够古朴」。
 * **它读成"牌子"不是尺寸一件事,是五件事一起缺**——五件各自很小,合起来才是
 * 「匾」与「牌子」的分界:
 *
 *   ① **字**:原先 `bold STKaiti` 走系统字体,粗体化的印刷楷没有笔锋,
 *      而且同一份代码在没装楷体的机器上直接掉到 serif。改成内置的
 *      **AR PL UKai**(文鼎 PL 中楷,Arphic Public License;单子 AW2 从
 *      Ma Shan Zheng 换过来——MSZ 是简体字集,缺 32 个繁体匾字),
 *      字号顶到匾心高的 0.78,金字**双层描边**
 *      (外圈深金 + 内圈亮金)模拟贴金的厚度。字体来源/授权/子集化见
 *      `public/fonts/README.md`,`@font-face` 在 `garden.html`。
 *   ② **框**:原先是贴在板面上的四条 0.02m 金条——那是"画上去的边",不是框。
 *      改成真的木框:外框起线两道、内一圈金素边,框面高出匾心 0.05m。
 *   ③ **角花**:四角如意云头(简单挤出)。§10「具象要集中」——**只在四角**,
 *      框身仍是素起线。
 *   ④ **挂法**:平贴改**前倾 12°**(上沿离墙、下沿贴额枋),下面两只铁**匾托**
 *      挑出来托着。前倾是匾"挂"出来的最强信号,比放大尺寸管用。
 *   ⑤ **款**:`07-01` 正门匾只有「大观園」三字,上下款原文没有,**不编**
 *      (`D-05`)。只加左下一方朱红**钤印**——钤印是匾的通式,且不带文字。
 *
 * ⚠️ **本件最容易做成金碧辉煌**。`07-01`「並無朱粉塗飾」是这座门的调子:
 * 匾框是**木色起线**,不是描金浮雕;**金只许在字上和内边那一圈**
 * (`ART_DIRECTION` §9)。角花、起线、匾托一律不许沾金。
 */

/** 匾高 / 匾宽。单子 AT1:0.36 → 0.40。旧值把匾拉成一条窄牌子。 */
export const PLAQUE_H_RATIO = 0.4;
/** 前倾角。清式匾"挂"在额枋上:上沿离墙、下沿贴。 */
export const PLAQUE_TILT_RAD = (12 * Math.PI) / 180;

/** 匾额字体。子集在 `public/fonts/`,`@font-face` 在 `garden.html` / `viewer.html` / `fashi.html`。 */
const PLAQUE_FONT = '"AR PL UKai"';
/**
 * 回落链。子集里没有的字、或字体还没下载完的那一瞬间走这里——
 * **回落是静默的**,所以 `warnPlaqueGlyphGaps()` 在字体就位后会逐字复查一遍。
 */
const PLAQUE_FONT_FALLBACK = '"STKaiti","KaiTi","Kaiti SC","Noto Serif SC","Songti SC",serif';

let IRON: THREE.MeshStandardMaterial | undefined;
/** 匾托/铁件:深铁色。全园共用一份实例——材质实例不同,合并时就是两个桶。 */
function ironMaterial(): THREE.MeshStandardMaterial {
  IRON ??= new THREE.MeshStandardMaterial({ color: 0x2b2824, roughness: 0.46, metalness: 0.72 });
  return IRON;
}

/**
 * 子集字体缺字的检查。
 *
 * canvas 的字体回落是**逐字**的:子集里没有「蘅」,浏览器就悄悄用系统楷体画
 * 那一个字,同一块匾上于是两种字——而屏幕上没有任何提示。CJK 字面全是
 * 1em 全角,拿 `measureText` 比宽度是量不出来的(覆盖与否宽度都一样),
 * 所以这里**画出来比像素**:同一个字分别用「子集字体 + 回落链」和
 * 「只有回落链」各画一次,两张一模一样就说明前者根本没生效。
 *
 * 一块匾三五个字、一张 40×40 的离屏画布,只在字体 ready 之后跑一次。
 */
function warnPlaqueGlyphGaps(text: string): void {
  if (typeof document === 'undefined') return;
  const S = 40;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  const snap = (ch: string, font: string): string => {
    g.clearRect(0, 0, S, S);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.fillText(ch, S / 2, S / 2);
    return g.getImageData(0, 0, S, S).data.join(',');
  };
  for (const ch of new Set(text)) {
    if (snap(ch, `32px ${PLAQUE_FONT}, ${PLAQUE_FONT_FALLBACK}`) !== snap(ch, `32px ${PLAQUE_FONT_FALLBACK}`)) continue;
    console.warn(
      `[plaque] 「${ch}」不在 public/fonts 的字体子集里,已静默回落到系统楷体——` +
        `同一块匾上会出现两种字。按 public/fonts/README.md 重跑一次 pyftsubset。`,
    );
  }
}

/**
 * 匾心的字面(黑漆底 + 贴金字 + 左下一方钤印)。
 *
 * `aspect` 是**匾心**(框以内那块黑漆)的宽高比,不是整块匾的——画布与它
 * 一致,字才不会被 UV 拉长。`sealFrac` 是钤印边长占匾心高的比例。
 */
function plaqueTexture(text: string, aspect: number, sealFrac: number): THREE.CanvasTexture {
  const H = 256;
  const W = Math.max(96, Math.round(H * aspect));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const paint = (): void => {
    g.fillStyle = '#1c1a18';
    g.fillRect(0, 0, W, H);
    const n = Math.max(1, text.length);
    // 字号顶到匾心高的 0.78(旧值 0.70)。字挤满匾心是榜书的样子;
    // 留太多边就读成标签。字多时再让宽度这一侧兜底。
    const size = Math.min(H * 0.78, (W * 0.84) / n);
    g.font = `${size}px ${PLAQUE_FONT}, ${PLAQUE_FONT_FALLBACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    // 贴金的厚度:金箔贴在阴刻的字上,边缘有一圈压亮、外面一圈暗。
    // 先粗描深金(外圈)、再细描亮金(内圈)、最后填金身——三层叠出来的
    // 那一圈亮边,就是"贴上去的金"与"画上去的黄漆"的区别。
    const body = g.createLinearGradient(0, H * 0.5 - size * 0.5, 0, H * 0.5 + size * 0.5);
    body.addColorStop(0, '#e8cd77');
    body.addColorStop(0.55, '#c9a84c');
    body.addColorStop(1, '#a8862f');
    const gap = size * 1.12;
    const x0 = W / 2 - ((n - 1) * gap) / 2;
    const y = H / 2 + size * 0.03;
    // 古代横额从右到左读——第 i 个字画在从右数第 i 个位置上。
    for (let i = 0; i < n; i++) {
      const x = x0 + (n - 1 - i) * gap;
      g.strokeStyle = '#6b4d15';
      g.lineWidth = size * 0.072;
      g.strokeText(text[i], x, y);
      g.strokeStyle = '#f3dd9c';
      g.lineWidth = size * 0.026;
      g.strokeText(text[i], x, y);
      g.fillStyle = body;
      g.fillText(text[i], x, y);
    }
    drawSeal(g, H * sealFrac, H);
  };

  paint();
  // 字体是**异步**的:@font-face 还没下载完就画,拿到的是回落楷体。
  // 先画一版(不让匾空着)、字体就位后重画并 needsUpdate——CanvasTexture
  // 的画布还挂在材质上,静态合并之后重画一样生效(合并动的是几何不是贴图)。
  const fonts = document.fonts as FontFaceSet | undefined;
  if (fonts?.load) {
    fonts
      .load(`${H}px ${PLAQUE_FONT}`, text)
      .then(() => {
        paint();
        tex.needsUpdate = true;
        warnPlaqueGlyphGaps(text);
      })
      .catch(() => {});
  }
  return tex;
}

/**
 * 左下一方朱红钤印。
 *
 * **章面不刻字**:`07-01` 正门匾只有「大观園」三字,上款下款原文都没有,
 * 编一个落款是这个项目的第一性违规(`D-05`)。印文同理——所以这里是一方
 * 素红方章(朱文边栏 + 素心),它给出的信息只有"这是一方印",没有伪造任何
 * 人名。钤印本身是匾的通式,不是杜撰。
 *
 * 印色不是纯红:印泥是朱砂调油,偏暗偏橙,且盖出来边缘不齐——四角各啃掉
 * 一点、再压一道半透明的重影,才不像一个红色 CSS 方块。
 */
function drawSeal(g: CanvasRenderingContext2D, side: number, H: number): void {
  const m = side * 0.62;
  const x = m;
  const y = H - m - side;
  g.save();
  g.fillStyle = '#9d2f22';
  g.globalAlpha = 0.92;
  g.fillRect(x, y, side, side);
  // 盖歪一点点的重影:同一方印按下去时的二次接触。
  g.globalAlpha = 0.28;
  g.fillRect(x + side * 0.035, y - side * 0.03, side, side);
  // 朱文边栏:印面四周是一圈粗边,心里留素。
  g.globalAlpha = 1;
  const t = side * 0.17;
  g.fillStyle = '#1c1a18';
  g.fillRect(x + t, y + t, side - 2 * t, side - 2 * t);
  g.restore();
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

/**
 * 矩形环的挤出体——匾框、两道起线、内边那一圈金线共用同一个形状发生器。
 * 外框 `ow × oh`、壁厚 `t`、沿 +Z 挤出 `depth`。
 *
 * 用一个带洞的 `Shape` 而不是四条 box:四条 box 的对角接缝在贴脸镜头里
 * 是四道明缝,而框是**一根料挖出来的**,不该有缝。
 */
function rectRing(ow: number, oh: number, t: number, depth: number, bevel = 0): THREE.ExtrudeGeometry {
  const rect = (w: number, h: number, path: THREE.Path | THREE.Shape): void => {
    path.moveTo(-w / 2, -h / 2);
    path.lineTo(w / 2, -h / 2);
    path.lineTo(w / 2, h / 2);
    path.lineTo(-w / 2, h / 2);
    path.closePath();
  };
  const shape = new THREE.Shape();
  rect(ow, oh, shape);
  const hole = new THREE.Path();
  rect(ow - 2 * t, oh - 2 * t, hole);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(
    shape,
    bevel > 0
      ? { depth: Math.max(0.001, depth - bevel), bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 }
      : { depth, bevelEnabled: false, steps: 1 },
  );
}

/**
 * 四角的如意云头角花。
 *
 * 极坐标三瓣:`r(a) = R(0.58 + 0.42·√|cos 4a|)`,`a ∈ [0, π/2]`。
 * `|cos 4a|` 在 `a = 0 / π/4 / π/2` 取满、在 `π/8 / 3π/8` 归零,于是
 * **两条框边上各贴半个瓣、45° 对角线上整一个瓣**——云头"中间一大、
 * 两边各半"的读法;开方是把瓣顶压圆,不然是尖角,读成齿轮不读成云。
 *
 * ⚠️ 谷底 `0.58R` 是**下限不是造型**:`R = 框宽 × 2.4` 时谷底仍有 1.4 倍框宽,
 * 花瓣之间的凹口**咬不进框以内**。第一版取 `0.70 + 0.26·cos 8a`(谷底 0.44R
 * < 框宽),凹口直接切进匾心,四个角读成四支箭头——取证见 `shots/AT/`。
 *
 * 原点(匾框外角)也收进多边形,两条直边就顺着框的外沿贴住;
 * `§10`「具象雕刻要集中」:框身通篇是素起线,具象只给这四个角。
 */
function ruyiCornerGeometry(R: number, depth: number): THREE.ExtrudeGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 34;
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * (Math.PI / 2);
    const rr = R * (0.58 + 0.42 * Math.sqrt(Math.abs(Math.cos(4 * a))));
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  pts.push(new THREE.Vector2(0, 0));
  return new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth,
    bevelEnabled: true,
    bevelSize: depth * 0.4,
    bevelThickness: depth * 0.4,
    bevelSegments: 1,
    steps: 1,
  });
}

/**
 * 匾额一件。
 *
 * 局部坐标:原点在**匾心板的几何中心**,+Z 朝人(匾面),+Y 朝上。
 * 前倾由调用方在落位时绕 X 转(`building.ts` 转 `PLAQUE_TILT_RAD`)。
 *
 * **匾托只给檐下匾**(`opts.hangers`)。墙垣那块月洞门门额是嵌在券脸上的
 * 石/灰作,不挂在铁钩上、也不前倾——`wall.ts` 不传这个开关,一个字不用改。
 * 匾托钉在额枋上、**不跟着匾转**,所以单独收在一个反向旋转的子组里:
 * 匾倾 12°,钩仍然是正的。
 */
export interface PlaqueOptions {
  /** 檐下匾:下沿配两只铁匾托。默认不配。 */
  hangers?: boolean;
  /** 调用方落位时会给匾的前倾角(弧度)。匾托要反着转这么多才立得正。 */
  tilt?: number;
}

export function makePlaque(text: string, width: number, opts: PlaqueOptions = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Plaque';
  const h = width * PLAQUE_H_RATIO;

  /* ---- 尺寸(全部无出处,艺术选择,留痕在 building.ts 的 provenance.art) ---- */
  const boardT = 0.06; // 匾心板厚
  const frameW = h * 0.09; // 框宽(单子 AT1 指定:匾高 × 0.09)
  const frameOut = 0.05; // 框面高出匾心的量
  const beadOut = 0.013; // 起线再高出框面的量
  const goldLineT = 0.009; // 内边那一圈金线的宽
  const innerW = width - 2 * frameW; // 匾心(框以内)
  const innerH = h - 2 * frameW;
  const faceZ = boardT / 2; // 匾心面

  /* ---- 匾心板 ---- */
  const board = new THREE.Mesh(roundedBox(width, h, boardT, 0.012, 3), lacquerMaterial());
  board.castShadow = true;
  board.receiveShadow = true;
  g.add(board);

  /* ---- 字面 ---- */
  const faceW = innerW - 2 * goldLineT;
  const faceH = innerH - 2 * goldLineT;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(faceW, faceH),
    new THREE.MeshStandardMaterial({
      // 钤印边长 = 匾高的 1/12(单子 AT1),换算成匾心高的比例交给贴图。
      map: plaqueTexture(text, faceW / faceH, h / 12 / faceH),
      roughness: 0.4,
      metalness: 0.2,
    }),
  );
  face.position.z = faceZ + 0.001;
  g.add(face);

  /* ---- 内边一圈金线 ---- */
  // ⚠️ `ART_DIRECTION` §9 / `07-01`「並無朱粉塗飾」:**全件只有字和这一圈是金**。
  // 框、起线、角花、匾托一律木色或铁色,沾了金这块匾就成了戏台。
  const goldLine = new THREE.Mesh(rectRing(innerW, innerH, goldLineT, 0.006), goldMaterial());
  goldLine.position.z = faceZ;
  g.add(goldLine);

  /* ---- 匾框:木色,一根料挖出来 + 两道起线 ---- */
  // 用 `CN.wood` 不用 `CN.column`:第一版取了柱色(最深的一档),匾挂在檐下
  // 的**阴影**里,深木框贴着深铺作,在 `cu_gate_plaque` 里一条边都读不出来
  // (取证见 `shots/AT/`)。木作两档都是这栋房子已经在用的桶,换色不多一个
  // draw call,但换来一整圈明暗差。**仍然是木色,不许描金**(`07-01`)。
  const wood = woodMaterial(CN.wood, 1);
  const frame = new THREE.Mesh(rectRing(width, h, frameW, frameOut, 0.006), wood);
  frame.position.z = faceZ;
  frame.castShadow = true;
  frame.receiveShadow = true;
  g.add(frame);
  // 起线两道:一道压在框的外沿一线,一道在框中偏内——两道之间是素面。
  // 线本身不许出彩,它只负责在掠射光下把框身切成三条明暗带。
  for (const [inset, t] of [
    [frameW * 0.16, 0.013],
    [frameW * 0.64, 0.010],
  ]) {
    const bead = new THREE.Mesh(rectRing(width - 2 * inset, h - 2 * inset, t, frameOut + beadOut), wood);
    bead.position.z = faceZ;
    bead.castShadow = true;
    g.add(bead);
  }

  /* ---- 四角如意云头 ---- */
  const cornerR = frameW * 2.4;
  const cornerGeo = ruyiCornerGeometry(cornerR, 0.018);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const c = new THREE.Mesh(cornerGeo, wood);
      c.position.set((sx * width) / 2, (sy * h) / 2, faceZ + frameOut - 0.006);
      // 第一象限的四分之一花瓣转到各自的角上(外角在原点,花开向匾心)。
      c.rotation.z = sx > 0 ? (sy > 0 ? Math.PI : Math.PI / 2) : sy > 0 ? -Math.PI / 2 : 0;
      c.castShadow = true;
      g.add(c);
    }
  }

  /* ---- 匾托:两只铁钩,从额枋下挑出来托住匾的下沿 ---------------------
   * 前倾靠它成立:匾的下沿压在钩的平臂上、上沿离墙——所以钩**不跟着匾转**,
   * 收在一个反向旋转的子组里。钩做三段:贴墙的耳板、挑出的平臂、翘起的
   * 舌头(挡住匾下沿往外滑)。铁件不沾金。 */
  if (opts.hangers) {
    const hangers = new THREE.Group();
    hangers.name = 'PlaqueHangers';
    hangers.rotation.x = -(opts.tilt ?? 0);
    hangers.position.y = -h / 2;
    const iron = ironMaterial();
    const armZ = boardT / 2 + 0.035;
    for (const sx of [-1, 1]) {
      const x = sx * width * 0.3;
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.19, 0.022), iron);
      ear.position.set(x, 0.055, -boardT / 2 - 0.012);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.022, boardT + 0.09), iron);
      arm.position.set(x, -0.011, (-boardT / 2 - 0.012 + armZ) / 2 + 0.006);
      const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.055, 0.018), iron);
      tongue.position.set(x, 0.016, armZ);
      for (const m of [ear, arm, tongue]) {
        m.castShadow = true;
        hangers.add(m);
      }
    }
    g.add(hangers);
  }
  return g;
}
