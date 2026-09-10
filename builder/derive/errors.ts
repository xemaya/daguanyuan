/**
 * 规则状态机的四种拒绝。
 *
 * 设计意图见 docs/DECISIONS.md D-08 与 D-16:让"我们不知道"成为程序能表达的状态。
 * 推导器宁可抛错停下,也不拿一个编出来的中值蒙混——那个数会一路传进几何,
 * 然后没人再知道它是猜的。
 */
export class RuleError extends Error {
  /**
   * 参数属性(`constructor(readonly x: T)`)在 Node 的 strip-only 模式下不支持
   * ——它需要真编译才能生成赋值。测试跑的就是 strip-only,所以这里显式赋值。
   * 见 docs/PITFALLS.md P-15。
   */
  readonly ruleId: string;

  constructor(ruleId: string, message: string) {
    super(message);
    this.ruleId = ruleId;
    this.name = new.target.name;
  }
}

/** 两名核验者都驳倒的规则。禁用,引用即抛。 */
export class RefutedRuleError extends RuleError {}

/** 存疑且有多个并存口径,调用方没说用哪个。 */
export class AmbiguousRuleError extends RuleError {}

/** 书里根本没有这条规则,或规则表里没有这个 id。 */
export class MissingRuleError extends RuleError {}
