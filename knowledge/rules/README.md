# 机读规则表

代码唯一的取数入口。研究稿（`knowledge/docs/`）是人读真源，带出处与两名核验者的裁决；
这里是机读真源，`npm run check:rules` 保证两者条目与状态一致。

**门不校验数值**。研究稿里的公式是散文，自动抽取只会给出虚假的安全感。数值由誊写者负责，
抽样人工核对，再由推导链的手算断言兜底（佛光寺、长春宫、月到风来亭）。

## 两个轴不要混

| 轴 | 由什么表示 | 意思 |
|---|---|---|
| **来源** | 文件名与 id 前缀 | 这条出自哪本书的哪一章 |
| **消费** | 每条的 `paramSet` 字段 | 哪条推导链会用它 |

这两个轴**不平行**。清《工程做法》06 章屋顶瓦作里，走兽数目、正吻、清水脊、琉璃瓦等级、
王府规制是清官式，江南屋脊、苏式水戗、小青瓦是江南做法——整章塞进任何一个参数集都是错的。

所以 `fayuan.rules.json`（源：`qingshi/05-06`）里有 9 条 `paramSet: "qing"`、2 条 `"both"`。
**推导层按 `paramSet` 取数，不按文件名。**

## 文件

| 文件 | 来源 | 条数 |
|---|---|---|
| `fashi.rules.json` | `docs/fashi/01-07` 宋《营造法式》材分制 | 155 |
| `qing.rules.json` | `docs/qingshi/01-04` 清《工程做法》斗口制 | 70 |
| `fayuan.rules.json` | `docs/qingshi/05-06` 《营造法原》与屋顶瓦作 | 43 |
| `honglou.rules.json` | `docs/qingshi/07` 《红楼梦》建筑原文 | 74 |
| `plants.rules.json` | 跨章汇编：花木名录与用法 | 24 |
| `missing.rules.json` | 两份批评稿：已知缺口 | 22 |
| `schema.json` | 字段契约（不在门里强制，供人对照） | — |

`plants` 与 `missing` 是跨章汇编，研究稿里没有对应的 `###` 标题，所以门对它们只校验
JSON 合法与依赖不悬空，不做条目对齐。

## 状态

`ok` 通过 · `contested` 存疑（用 `correction`；有 `choices` 的必须显式选一个）·
`refuted` 驳倒（禁用，引用即抛）· `missing` 缺失（抛错并给 `whereToLook`）。

**驳倒的条目必须保留**，不能因为不用就删——代码引用它时要能抛出带出处的错误，门也要对得上。

规则状态机的完整语义见 `docs/superpowers/specs/2026-09-10-layered-architecture-design.md` §5。
