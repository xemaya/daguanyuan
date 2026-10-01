import { grassTurfMaps, cobbleMaps, dirtPathMaps } from '@engine/core/TextureLab';
import { trackEarthMaps, sandMaps } from '@engine/render/TerrainMaterials';
import {
  CN, woodMaterial, tileMaterial, plasterMaterial, stoneMaterial,
  paperMaterial, lacquerMaterial, goldMaterial, taihuMaterial,
  whiteStoneMaterial, baishiMaterial, tigerSkinMaterial,
} from '@builder/parts/materials';
import {
  earthWallMaterial, thatchMaterial, thatchEndMaterial, strawFringeMaterial, thatchUnderMaterial,
  freshThatchMaterial, freshStubbleMaterial, blueBrickMaterial, planedWoodMaterial, roughWoodMaterial, dressedStoneMaterial,
} from '@builder/parts/xiangye/materials';
import { bakeScrollSampleMaps } from '@builder/parts/ornament/scroll-sample';
import { bakeTiaohuanAtlas } from '@builder/parts/ornament/tiaohuan-band';
import { barkSet, leafMaps } from '@builder/parts/zhiwu/foliage-materials';

/**
 * **A 批**:A 段(出生区 + 全局件 + 地面 / 植被)要用的配方。「调色」一步等它们全部 adopt(`warmup.done`)。
 * 单子 BI2 追加末三项(`D-45`):正门 / 翠嶂的白石两种做法、白石峰、虎皮墙——BI 剖析里各占 1.1–1.5 s 的主线程首建。
 */
export const TEXTURE_JOBS = ['wood', 'dirt', 'sand', 'turf', 'tile', 'stone', 'taihu', 'plaster', 'cobble', 'paper', 'xifancao', 'tiaohuan', 'foliage', 'whitestone', 'baishi', 'tigerskin'] as const;
/**
 * **B 批**(单子 BI2):只有 B 段后台区用的配方。**A 批全部 adopt 之后才派**,不进 `warmup.done`——A 段一刻也不等它们;
 * B 段建某区前只等该区要的那几个(`UNIT_TEXTURE_JOBS`)。没赶上就照旧在主线程同步烤,结果逐位相同(adopt 只填缓存、已有 key 跳过)。
 * 顺序 = B 段出队顺序里谁先用谁先烤。
 */
export const DEFERRED_TEXTURE_JOBS = ['xiangye-earth', 'xiangye-cottage', 'xiangye-wood', 'dirtpath', 'vermilion'] as const;
export const ALL_TEXTURE_JOBS = [...TEXTURE_JOBS, ...DEFERRED_TEXTURE_JOBS] as const;
export type TextureJob = typeof ALL_TEXTURE_JOBS[number];
/** B 段各区要等的 B 批 job(区名 = composer 的构件单位)。不在表里的区不等。 */
export const UNIT_TEXTURE_JOBS: Readonly<Record<string, readonly TextureJob[]>> = {
  // 稻香村:泥墙(黄泥版筑 + 墙头茅)、茆堂 / 东厢(新苫、秆口、苇箔、青砖、刨光木、条石)、井(糙木)、菜畦(土路图)、红栏桥(朱木)。
  daoxiangcun: ['xiangye-earth', 'xiangye-cottage', 'xiangye-wood', 'dirtpath', 'vermilion'],
};

/**
 * 单子 BH1:「理地」要用的四张地面图(`terrain.ts` 的 turf / trackEarth / cobble / sand)。
 * `world.ts` 把它们排在预热队列最前、只等它们就开始理地,其余的图在理地、引水的同时接着烤。
 */
export const TERRAIN_TEXTURE_JOBS: readonly TextureJob[] = ['turf', 'dirt', 'sand', 'cobble'];

/**
 * 单子 BH1:植被三套树皮、四套叶片的烘焙参数——**唯一真源**,`vegetation.ts` 建材质与 worker 的 `foliage` job 都读它。
 *
 * 为什么非得一份:`recipeKey` 只含名字与尺寸、**不含颜色**。两处参数一旦分叉,worker 烤出来的图会顶着同一个 key
 * 被主线程当成缓存命中,树悄悄换了颜色,而没有一道门会红。这一段的烘焙在主线程上约 3.7 s(BH0 剖析,
 * 树皮每套 ~0.8 s、叶片每套 ~0.3 s),挪进 worker 与理地、引水同时跑。
 * 数值是从 `vegetation.ts` 原样搬来的(那里的取色理由注释留在原处)。
 */
export const BARK_SETS = {
  oak: ['oak', 0x3d2716, 0xb28c5a, 1.0, 512],
  ash: ['ash', 0x453424, 0xac9268, 0.72, 512],
  pale: ['pale', 0x7d7565, 0xf2ece0, 0.22, 512],
} as const satisfies Record<string, readonly [string, number, number, number, number]>;
export const LEAF_SETS = {
  warm: ['warm', 0x4e8c3c, 0xaadd6c, 512],
  cool: ['cool', 0x3f7d4a, 0x92d072, 512],
  needle: ['needle', 0x3a6b46, 0x7cb266, 512],
  apricot: ['apricot', 0xa8344c, 0xf4a494, 512],
} as const satisfies Record<string, readonly [string, number, number, number]>;

export function bakeTextureJob(job: TextureJob): void {
  switch (job) {
    case 'turf': grassTurfMaps(); break;
    case 'dirt': trackEarthMaps(); break;
    case 'sand': sandMaps(); break;
    case 'cobble': cobbleMaps(); break;
    case 'wood': woodMaterial(CN.wood, 1); woodMaterial(CN.column, 1); break;
    case 'tile': tileMaterial(1, 1); break;
    case 'stone': stoneMaterial(1); break;
    case 'taihu': taihuMaterial(); break;
    case 'plaster': plasterMaterial(); break;
    case 'paper': paperMaterial(); lacquerMaterial(); goldMaterial(); break;
    // 单子 AO:西番草样件贴图版的法线 + 凹槽遮蔽(两张 512²)。默认场景走的是
    // 几何版,这两张只在 `?relief=tex` 下用——登记在这里是为了让评审那一版
    // 也走同一条预热链,不在主线程边走边烤(全程 ~0.1s,见单子回报)。
    case 'xifancao': bakeScrollSampleMaps(); break;
    // 单子 AS:绦环板贴图版的四格图集(法线 + 凹槽遮蔽,两张 512²)。**全园只此一份**
    // ——36 扇格扇里除了正门门道两旁那 4 扇走几何版,其余全靠这两张图 + uv 偏移。
    // 它是默认场景就要用的(不像 xifancao 只在 `?relief=tex` 下用),所以更得预热:
    // 不登记的话第一栋建筑装配时会在主线程边走边烤。
    case 'tiaohuan': bakeTiaohuanAtlas(); break;
    // 单子 BH1:植被的树皮与叶片(参数见 BARK_SETS / LEAF_SETS)。叶簇卡片(leafClusterTexture)不在这里:
    // 它用 document 画布、主线程上只要 ~1 ms,不值得为它给 worker 垫一个 document。
    case 'foliage':
      for (const a of Object.values(BARK_SETS) as readonly (readonly [string, number, number, number, number])[]) barkSet(...a);
      for (const a of Object.values(LEAF_SETS) as readonly (readonly [string, number, number, number])[]) leafMaps(...a);
      break;
    // 单子 BI2 · A 批:白石两种做法(细磨 / 粗凿)、白石峰、虎皮石墙。
    case 'whitestone': whiteStoneMaterial(1, 'fine'); whiteStoneMaterial(1, 'rough'); break;
    case 'baishi': baishiMaterial(); break;
    case 'tigerskin': tigerSkinMaterial(); break;
    // 单子 BI2 · B 批(稻香村)。
    case 'xiangye-earth': earthWallMaterial(); thatchMaterial(); thatchEndMaterial(); strawFringeMaterial(); break;
    case 'xiangye-cottage': freshThatchMaterial(); freshStubbleMaterial(); thatchUnderMaterial(); blueBrickMaterial(); dressedStoneMaterial(); break;
    case 'xiangye-wood': planedWoodMaterial(); roughWoodMaterial(); break;
    case 'dirtpath': dirtPathMaps(); break;
    case 'vermilion': woodMaterial(CN.bridgeVermilion); break;
    default: throw new Error(`Unknown texture bake job: ${job}`);
  }
}
