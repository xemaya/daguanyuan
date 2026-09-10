import { grassTurfMaps, cobbleMaps } from '@engine/core/TextureLab';
import { trackEarthMaps, sandMaps } from '@engine/render/TerrainMaterials';
import {
  CN, woodMaterial, tileMaterial, plasterMaterial, stoneMaterial,
  paperMaterial, lacquerMaterial, goldMaterial, taihuMaterial,
} from '@builder/parts/materials';

/** Match the recipes consumed by the current garden, including both wood colours. */
export const TEXTURE_JOBS = ['wood', 'dirt', 'sand', 'turf', 'tile', 'stone', 'taihu', 'plaster', 'cobble', 'paper'] as const;
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
    default: throw new Error(`Unknown texture bake job: ${job}`);
  }
}
