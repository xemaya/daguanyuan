import { grassTurfMaps, cobbleMaps } from '@engine/core/TextureLab';
import { trackEarthMaps, sandMaps } from '@engine/render/TerrainMaterials';
import {
  CN, woodMaterial, tileMaterial, plasterMaterial, stoneMaterial,
  paperMaterial, lacquerMaterial, goldMaterial, taihuMaterial,
} from '@builder/parts/materials';
import { bakeScrollSampleMaps } from '@builder/parts/ornament/scroll-sample';
import { bakeTiaohuanAtlas } from '@builder/parts/ornament/tiaohuan-band';

/** Match the recipes consumed by the current garden, including both wood colours. */
export const TEXTURE_JOBS = ['wood', 'dirt', 'sand', 'turf', 'tile', 'stone', 'taihu', 'plaster', 'cobble', 'paper', 'xifancao', 'tiaohuan'] as const;
export type TextureJob = typeof TEXTURE_JOBS[number];

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
    default: throw new Error(`Unknown texture bake job: ${job}`);
  }
}
