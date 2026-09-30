# 单子 AQ-a：管线两处小修——贴图缓存键补尺寸、合并按属性布局分桶

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联。**
> 依据：`docs/reviews/2026-09-15-procedural-detail-review.md` §8（codex 评审）。
> 评审把管线排在样件之后；这两处**小**的提前，因为样件一做就会踩上（`docs/reviews/2026-09-15-detail-review-response.md` §2.3）。
> **大的**（构件交原型 + 摆放、先实例化再合并、近中远三档 + 滞回）是 **AQ-b**，等样件证明值得再做，本单不碰。
>
> **文件域**：`engine/core/TextureLab.ts`、`builder/parts/materials.ts`、`builder/parts/zhiwu/foliage-materials.ts`（只改 `cached(` 的键）、
> `builder/parts/merge.ts`、`tests/`。**不碰任何构件几何、composer、building.ts。** 与 AJ / AN1 零重叠。

---

## AQ-a1 · 缓存键补尺寸与配方版本

`cached(key, build)` 的 55 处调用（TextureLab 19、materials 23、foliage-materials 13）键里都没有 `size`：
`turfMaps(512)` 与 `turfMaps(1024)` 会命中同一张贴图。样件要出多分辨率（近景 2048 / 中景 512）时第一次调用赢，之后全错。

- 键改成 `${name}@${size}`，`bakeNormalMap` 的强度、`repeat` 之类影响像素的参数也进键；
- 加一个**配方版本号**常量（`TEXTURE_RECIPE_VERSION`），进键。改了高度函数没改版本号 → 命中旧缓存，这是下一个坑，先把口子留好；
- `builder/compose/texture-jobs.ts` 与 worker 那条预热链**键要同步**，否则预热的和用的不是同一张（预热等于白做）。
- **判据**：同名不同 size 调两次得到两张不同尺寸的贴图；同参调两次是同一对象；预热后主线程首次取用不重烤（加计数断言）。

## AQ-a2 · 合并按属性布局分桶，不再删属性

`merge.ts` 现在把非 position/normal/uv/color 的属性一律删掉。评审 §8 说的 `surfaceId`、第二套 uv、湿度、部件 id 都会在这里没掉。

- 合并键加上**属性布局签名**（属性名 + itemSize 排序后拼串）；布局不同的进不同桶，**不删属性**；
- 没有 `normal` 的照旧补算，没有 `uv` 的照旧补零——这两条是现有行为，保留；
- `static-batches.ts` 调 `mergeByMaterial(residual)` 那一路跟着受益，不用改它；
- **draw call 会不会涨？** 会——布局不同就多一个桶。现在全仓构件没人写第二套属性，所以**本单落地后 draw call 应当一个不变**，
  用 `D-25` 四镜验证（±0）。将来谁加属性谁付 draw call，这是对的。
- **判据**：测试——两块几何一块带 `uv2` 一块不带，合并后两个桶、`uv2` 还在；全带 `uv2` 的合成一个桶；四镜 draw call 与三角 **完全不变**（`manifest-diff` 容差 0）。

## 顺手记账（不做）

- 构件内部先合的模式有 5 处（`building.ts:1619`、`baogushi.ts:106`、`shiyabian.ts:166`、`luya.ts:217`、`static-batches.ts:67`），
  把它们改成「交原型 + 摆放」是 AQ-b。本单在回报里把这 5 处**各自合了多少个 mesh、有多少重复原型被打散**量出来（加一个临时计数就行），
  给 AQ-b 当开工依据。

## 验收

- `npm run check:all` 全过 + 新增测试；
- 四镜 draw call / 三角 **零变化**（本单是纯管线，观感一个像素不该动）；
- 世界构建时间前后（`manifest.json` 里有）：缓存键变长不该慢，预热若失效会慢，这是它的探针。

## 回报

键的格式；版本号放哪；分桶签名怎么拼；5 处构件内合并的计数；四镜与建时前后。
**规模**：小。**风险**：低。最容易跑偏：**借机做通用属性系统**——不许，只分桶不删属性，够用为止（`D-18`）。
