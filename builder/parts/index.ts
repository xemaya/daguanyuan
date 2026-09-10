/**
 * 构件库入口:import 这里即登记全部构件。
 *
 * 每个构件模块在文件末尾 `registerPart(...)`;这里用 eager glob 自动拉全,
 * 新构件不用回来改这个文件——多人并行时唯一会撞的文件就没了。
 *
 * glob 按门类子目录展开(damu/xiaomu/qiangyuan/shishan/shuigong/zhiwu/pudi)。
 * 加新门类要在这里补一段,否则那一类构件不会被登记,而症状是运行时
 * 「未登记构件 X」——不是编译错误,所以这行改错很难被发现。
 */
export * from './registry';
import.meta.glob('./{damu,xiaomu,qiangyuan,shishan,shuigong,zhiwu,pudi}/*.ts', { eager: true });
