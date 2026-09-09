/**
 * 构件库入口:import 这里即登记全部构件。
 *
 * `parts/` 下每个模块在文件末尾 `registerPart(...)`;这里用 eager glob 自动
 * 拉全,新构件不用回来改这个文件——多人并行时唯一会撞的文件就没了。
 */
export * from './registry';
import.meta.glob('./parts/*.ts', { eager: true });
