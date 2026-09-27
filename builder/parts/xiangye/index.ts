import type { PartBuilder } from '../registry';
import { buildPlannedCottage } from './thatch-cottage';

/**
 * 乡野门类(稻香村,单子 BA)的构件表。
 *
 * `builder/parts/index.ts` 的 glob 不含 xiangye 目录,本门类由 `registry.ts` 末尾显式登记。
 * 这里**只导出**、不在求值时调 `registerPart`,也不在运行时 import `registry.ts`
 * (只有 type import)——否则 registry → xiangye → registry 成环,`PARTS` 还没初始化就被调用。
 */
export const XIANGYE_PARTS: [string, PartBuilder][] = [
  ['thatch-cottage', (variant) => buildPlannedCottage(variant)],
];
