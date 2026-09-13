/** Shared art dimensions for geometry and collision; not historical ratios. */
export const WALL_STYLE = {
  bodyTop: 2.44, collisionTop: 2.63, footHalf: .23,
  gate: { radius: 1.1, clearRadius: 1.088, centerY: 1.15, sillY: .25, sillWidth: 1.74, sillDepth: .4 },
  /**
   * 虎皮石墙基"隨勢砌去":基脚随墙线起伏地沉入地面的最大深度。严格只沉不浮
   * ——起伏方向只往下,绝不让石作抬高过墙脚原本的水平基准,这样任何一段
   * 都不会露出悬空的缝(石头只会多埋一点,不会少埋)。取值须小于 plan.json
   * 里出现过的最浅 foundationDepth_m(0.15m)并留出余量,否则在最浅基础的
   * 墙段会把埋深比基础还深,顶出底盘边缘。
   */
  baseSink: .08,
} as const;
