/**
 * 机读规则表的加载器与状态机。
 *
 * 代码只从这里取营造数字,不许写字面量。规则表是真源(docs/DECISIONS.md D-09),
 * 改一条规则不用改代码,改错了手算断言会红。
 *
 * **按 paramSet 取数,不按文件名**:文件按来源章节组织,参数集按消费方组织,
 * 两个轴不平行。清《工程做法》06 章屋顶瓦作官式与苏式并存,整章塞进任何一个
 * 参数集都是错的。见 knowledge/rules/README.md 与 PITFALLS P-14。
 */
import fashiFile from '@knowledge/rules/fashi.rules.json' with { type: 'json' };
import qingFile from '@knowledge/rules/qing.rules.json' with { type: 'json' };
import fayuanFile from '@knowledge/rules/fayuan.rules.json' with { type: 'json' };
import missingFile from '@knowledge/rules/missing.rules.json' with { type: 'json' };
import { AmbiguousRuleError, MissingRuleError, RefutedRuleError } from './errors';
import { emptyProvenance, type Branch, type Provenance, type ProvenanceEntry } from './provenance';

export type RuleStatus = 'ok' | 'contested' | 'refuted' | 'underdetermined' | 'missing';
export type ParamSet = 'fashi' | 'qing' | 'fayuan';
/** 规则集 = 来源文件。**id 只在集内唯一**,跨集有 115 个重号,见 PITFALLS P-16。 */
export type RuleSet = 'fashi' | 'qing' | 'fayuan' | 'missing';

export interface RuleChoice {
  key: string;
  value: unknown;
  note: string;
}

export interface Rule {
  id: string;
  name: string;
  status: RuleStatus;
  statement: string;
  paramSet: ParamSet | 'both' | 'none';
  formula?: string;
  table?: unknown[];
  params?: Record<string, unknown>;
  correction?: string;
  choices?: RuleChoice[];
  resolution?: { method: string; note: string };
  quote?: string;
  location?: string;
  urls?: string[];
  needs?: string[];
  whereToLook?: { books?: string[]; keywords?: string[] };
  notes?: string;
  /** 调用方显式选定口径或覆盖后由 use() 填上,原表里没有这个字段。 */
  value?: unknown;
  /** 来源规则集,加载时按文件填上。 */
  set?: RuleSet;
}

interface RuleFile {
  source: { book: string; doc: string };
  rules: Rule[];
}

const tag = (set: RuleSet, file: unknown): Rule[] =>
  (file as RuleFile).rules.map((r) => ({ ...r, set }));

const ALL: Rule[] = [
  ...tag('fashi', fashiFile),
  ...tag('qing', qingFile),
  ...tag('fayuan', fayuanFile),
  ...tag('missing', missingFile),
];

export interface RuleBookOptions {
  /** 存疑且多口径的规则,指定用哪个 key。不指定就抛 AmbiguousRuleError。 */
  choices?: Record<string, string>;
  /** 缺失的规则可以显式给值。会记进 provenance 的 art 分支,留痕。 */
  overrides?: Record<string, unknown>;
}

export class RuleBook {
  private readonly byId = new Map<string, Rule>();
  private readonly prov = emptyProvenance();

  /** strip-only 模式不支持参数属性,字段显式声明。见 PITFALLS P-15。 */
  readonly paramSet: ParamSet;
  private readonly opts: RuleBookOptions;

  /** 同一 id 在本参数集里来自多个规则集时,记在这里,use() 遇到就要求限定。 */
  private readonly ambiguous = new Map<string, Rule[]>();

  private constructor(rules: Rule[], paramSet: ParamSet, opts: RuleBookOptions = {}) {
    this.paramSet = paramSet;
    this.opts = opts;
    for (const r of rules) {
      // 缺口条目在 missing.rules.json 里一律 paramSet: 'none'——一个空缺对每条链都是空缺。
      // 按参数集过滤会把它们全滤掉,use() 就只剩一句"不在参数集里",丢掉 whereToLook。
      const keep = r.paramSet === paramSet || r.paramSet === 'both' || r.status === 'missing';
      if (!keep) continue;

      // **id 只在规则集内唯一。** 273 个 id 里有 115 个跨文件重号,其中
      // fayuan 的 06-01(已驳倒)会盖住 fashi 的 06-01(通过)——后来者胜就是
      // 一条通过的规则被判成驳倒。所以不静默覆盖,记成歧义,用时必须限定。
      if (r.set) this.byId.set(`${r.set}:${r.id}`, r);
      const prev = this.byId.get(r.id);
      if (prev && prev.set !== r.set) {
        const list = this.ambiguous.get(r.id) ?? [prev];
        list.push(r);
        this.ambiguous.set(r.id, list);
      } else {
        this.byId.set(r.id, r);
      }
    }
  }

  /** 从随仓库打包的规则表建一本。 */
  static create(paramSet: ParamSet, opts: RuleBookOptions = {}): RuleBook {
    return new RuleBook(ALL, paramSet, opts);
  }

  /**
   * 从给定的规则数组建一本。测试用,也让调用方能注入被篡改的表做突变测试
   * ——"改坏 JSON 里的数,手算断言立刻红"是规则表真的在驱动代码的唯一证据。
   */
  static fromRules(rules: Rule[], paramSet: ParamSet, opts: RuleBookOptions = {}): RuleBook {
    return new RuleBook(rules, paramSet, opts);
  }

  /** 整张表(未按参数集过滤),给突变测试取原始数据用。 */
  static allRules(): readonly Rule[] {
    return ALL;
  }

  /** 本参数集里可用的规则号。含限定形式(`set:id`)与无歧义的裸 id。 */
  ids(): string[] {
    return [...this.byId.keys()];
  }

  /** 本参数集里重号的规则,给门与调试用。 */
  collisions(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [id, list] of this.ambiguous) out[id] = list.map((r) => `${r.set}:${r.id}`);
    return out;
  }

  /** 原始条目,不判状态、不记出处。给需要看 notes 的地方用。 */
  raw(id: string): Rule | undefined {
    return this.byId.get(id);
  }

  /**
   * 取一条可用的规则:判状态、记出处,或者抛错。
   *
   * 这是整个知识库的执法处。每一条营造数字都要从这里过一次。
   */
  use(id: string): Rule {
    const dup = this.ambiguous.get(id);
    if (dup) {
      throw new AmbiguousRuleError(
        id,
        `规则号 ${id} 在 ${this.paramSet} 参数集里来自多个规则集,必须限定:` +
          dup.map((d) => `${d.set}:${d.id}(${d.name},${d.status})`).join('、') +
          '。id 只在规则集内唯一,见 docs/PITFALLS.md P-16。',
      );
    }
    const r = this.byId.get(id);
    if (!r) {
      throw new MissingRuleError(id, `规则 ${id} 不在 ${this.paramSet} 参数集里(或根本不存在)。`);
    }

    // 驳倒优先于一切:一条被驳倒的规则即使带口径也不许用。
    if (r.status === 'refuted') {
      throw new RefutedRuleError(
        id,
        `规则 ${id}「${r.name}」已被两名核验者驳倒,禁用。` +
          (r.correction ? ` 更正:${r.correction}` : '') +
          (r.location ? ` 出处:${r.location}` : ''),
      );
    }

    // **决定要不要选的是 choices 在不在,不是状态。** 04-03 殿阁举高状态是"通过"
    // ——条文本身没问题——但法式 L/3、唐构实测、辽构 L/4 三档并存,差到 32%。
    // 状态说的是"这条读得对不对",口径说的是"这栋屋按谁的读法造",两回事。
    if (r.choices?.length) {
      const key = this.opts.choices?.[id];
      if (!key) {
        const keys = r.choices.map((c) => `${c.key}(${c.note})`).join('、');
        throw new AmbiguousRuleError(
          id,
          `规则 ${id}「${r.name}」有多个并存口径,必须显式选一个:${keys}。` +
            ` 在 RuleBookOptions.choices 里给 { "${id}": "<key>" },或用 profiles.ts 的时代预设。`,
        );
      }
      const hit = r.choices.find((c) => c.key === key);
      if (!hit) {
        throw new AmbiguousRuleError(
          id,
          `规则 ${id} 没有口径 "${key}",可选:${r.choices.map((c) => c.key).join('、')}。`,
        );
      }
      // 选口径永远是推定,哪怕规则本身状态是"通过"——用哪一档是我们裁的。
      this.push('inference', { id: r.id, name: r.name, note: `选用口径 ${key}:${hit.note}` });
      return { ...r, value: hit.value };
    }

    switch (r.status) {
      case 'ok':
        this.push('evidence', { id: r.id, name: r.name, location: r.location });
        return r;

      case 'contested': {
        this.push('inference', {
          id: r.id,
          name: r.name,
          note: r.correction ?? '存疑,按研究稿的更正值使用',
        });
        return r;
      }

      case 'underdetermined': {
        // 证据在、不冲突,但合法解不唯一。不抛错,但必须记进 art——
        // 不记的话,艺术选择就伪装成考据结论了(DECISIONS D-16)。
        const res = r.resolution;
        this.push('art', {
          id: r.id,
          name: r.name,
          method: res?.method ?? 'artistic_choice',
          note: res?.note ?? '欠定项,未声明解析方式',
        });
        return r;
      }

      case 'missing': {
        const ov = this.opts.overrides?.[id];
        if (ov !== undefined) {
          this.push('art', {
            id: r.id,
            name: r.name,
            method: 'override',
            note: `书里没有,显式覆盖为 ${JSON.stringify(ov)}`,
          });
          return { ...r, value: ov };
        }
        const w = r.whereToLook;
        throw new MissingRuleError(
          id,
          `规则 ${id}「${r.name}」在书里没有,无法推导。` +
            (w?.books?.length ? ` 该查:${w.books.join('、')}。` : '') +
            (w?.keywords?.length ? ` 关键词:${w.keywords.join('、')}。` : '') +
            ` 要先用一个值顶着,在 RuleBookOptions.overrides 里显式给 { "${id}": <值> },会记入 provenance。`,
        );
      }
    }
  }

  /** use() 之后取表。 */
  table<T>(id: string): T[] {
    const r = this.use(id);
    if (!Array.isArray(r.table)) {
      throw new MissingRuleError(id, `规则 ${id}「${r.name}」没有 table 字段。`);
    }
    return r.table as T[];
  }

  /**
   * use() 之后取 params 里的一个数。
   *
   * 取不到就抛,而不是回落到默认值——回落等于把字面量藏进代码,
   * 那正是 P1 要消灭的东西。规则表里缺什么就去补规则表。
   */
  num(id: string, key: string): number {
    const v = this.param(id, key);
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new MissingRuleError(id, `规则 ${id}「${this.byId.get(id)?.name}」的 params.${key} 不是有限数:${JSON.stringify(v)}。`);
    }
    return v;
  }

  /** 同 num,但值是数组(区间、序列)。 */
  nums(id: string, key: string): number[] {
    const v = this.param(id, key);
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'number')) {
      throw new MissingRuleError(id, `规则 ${id} 的 params.${key} 不是数组:${JSON.stringify(v)}。`);
    }
    return v as number[];
  }

  param(id: string, key: string): unknown {
    const r = this.use(id);
    const p = r.params;
    if (!p || !(key in p)) {
      throw new MissingRuleError(
        id,
        `规则 ${id}「${r.name}」的 params 里没有 ${key}。` +
          ` 该数可能只写在 formula 里没结构化:${r.formula ?? '(无 formula)'}。` +
          ` 补进 knowledge/rules/ 的 params,不要写回代码。`,
      );
    }
    return p[key];
  }

  /**
   * 规则给的是区间时,在区间内取一点。
   *
   * 区间内取哪一点**原文无据**——它是我们为了出一个具体的数做的决定,所以逐次
   * 记进 art 分支。不记的话,一个"殿阁柱径 42 分"看起来就跟"举高 L/3"一样硬,
   * 而后者是条文,前者只是区间下限。
   */
  pickInRange(id: string, key: string, at: 'lo' | 'mid' | 'hi'): number {
    const v = this.nums(id, key);
    const lo = v[0];
    const hi = v[v.length - 1];
    const picked = at === 'lo' ? lo : at === 'hi' ? hi : (lo + hi) / 2;
    if (lo !== hi) {
      this.push('art', {
        id,
        name: this.byId.get(id)?.name ?? id,
        method: 'artistic_choice',
        note: `${key} 原文只给区间 [${lo}, ${hi}],取${at === 'lo' ? '下限' : at === 'hi' ? '上限' : '中值'} ${picked}`,
      });
    }
    return picked;
  }

  /**
   * 显式登记一次艺术决策:规则支持这个数,但选它的是我们。
   * 用于"取上界""不起翘"这类条文只给约束不给值的地方。
   */
  artChoice<T>(id: string, note: string, value: T): T {
    this.push('art', {
      id,
      name: this.byId.get(id)?.name ?? id,
      method: 'artistic_choice',
      note,
    });
    return value;
  }

  /** use() 之后取选中口径的值。 */
  choice<T>(id: string): T {
    const r = this.use(id);
    if (r.value === undefined) {
      throw new AmbiguousRuleError(id, `规则 ${id}「${r.name}」不是多口径条目,用 use()/num()/table()。`);
    }
    return r.value as T;
  }

  provenance(): Provenance {
    return {
      evidence: [...this.prov.evidence],
      inference: [...this.prov.inference],
      art: [...this.prov.art],
    };
  }

  private push(branch: Branch, e: ProvenanceEntry): void {
    if (!this.prov[branch].some((x) => x.id === e.id)) this.prov[branch].push(e);
  }
}
