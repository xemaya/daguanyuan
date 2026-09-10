import type { Ring2 } from './geometry';

/** Sampling is configured after project injection, not copied into constants.
 * The returned window is also used for water, scatter and the temporary fence.
 */
export function terrainWindow(plan: {regions: {id:string; polygon:Ring2}[]}, ids: readonly string[], pad=15, cell=.48) {
  if (!ids.length || !Number.isFinite(pad) || pad<0 || !Number.isFinite(cell) || cell<=0)
    throw new Error('采样窗口需要区域、非负边距及正格长');
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const id of ids) {
    const region=plan.regions.find(r=>r.id===id);
    if(!region?.polygon.length) throw new Error(`采样窗口缺区域 ${id}`);
    for(const [x,z] of region.polygon) {
      if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error(`区域 ${id} 有非法坐标`);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
  }
  minX-=pad;maxX+=pad;minZ-=pad;maxZ+=pad;
  const width=maxX-minX,depth=maxZ-minZ;
  if(width<=0||depth<=0)throw new Error('采样窗口面积必须为正');
  return {minX,maxX,minZ,maxZ,width,depth,segX:Math.max(1,Math.round(width/cell)),
    segZ:Math.max(1,Math.round(depth/cell)),playMinX:minX+2,playMaxX:maxX-2,playMinZ:minZ+2,playMaxZ:maxZ-2};
}
