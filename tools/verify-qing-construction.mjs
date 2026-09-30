#!/usr/bin/env node
/** Inspect the actual P2 Qing frames without claiming P3 geometry exists. */
import '../tests/ts-resolver.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const {deriveQingConstruction}=await import('../builder/derive/qing/building.ts');
const plan=JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json',import.meta.url),'utf8'));
const at=process.argv.indexOf('--out'),out=at<0?'shots/p2-qing-contract':process.argv[at+1];
mkdirSync(out,{recursive:true});
const buildings=plan.regions.flatMap(r=>r.buildings).filter(b=>b.kind==='building');
const objects=buildings.filter(b=>b.construction?.spec.paramSet==='qing').map(b=>({
 id:b.id,name:b.name,position:[b.x,b.z],construction:b.construction,derived:deriveQingConstruction(b.construction)}));
const report={scope:'P2 construction frames, not P3 meshes or P4 assembled world',objects,
 detailedGeometry:buildings.filter(b=>b.construction&&b.construction.status!=='frame-ready').map(b=>b.id),
 missingSpecs:buildings.filter(b=>!b.construction).map(b=>b.id)};
writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const svg=[`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${100+objects.length*310}" viewBox="0 0 1100 ${100+objects.length*310}"><rect width="100%" height="100%" fill="#f7f3e9"/><g font-family="sans-serif" fill="#283b42"><text x="32" y="35" font-size="24">P2 清式施工骨架 · 米制侧样</text><text x="32" y="62" font-size="14">柱网与举架来自实际推导；斗拱分件、屋面开口与楼层连接未绘制，不作为已建模型</text>`];
for(let i=0;i<objects.length;i++) {
 const {id,name,derived:a}=objects[i],y=100+i*310,scale=12,base=y+252;
 const text=(x,y,s,size=13)=>svg.push(`<text x="${x}" y="${y}" font-size="${size}">${esc(s)}</text>`);
 const line=(x1,y1,x2,y2,color,w=2)=>svg.push(`<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="${color}" stroke-width="${w}"/>`);
 text(32,y,name,18);text(32,y+23,id,12);
 text(32,y+47,`柱心面阔 ${a.lower.m.width.toFixed(2)}m · 进深 ${a.lower.m.depth.toFixed(2)}m · 含台基/上层总高 ${a.totalHeight.toFixed(2)}m`);
 text(150,y+78,'俯视柱网（绿：上层）');text(635,y+78,'侧剖举架（从柱脚起；楼面以虚线表示）');
 for(const [f,n] of [[a.lower,0],[a.upper,1]]) {
  if(!f)continue;
  const color=n?'#397965':'#6b5042',cx=230,cz=y+180;
  for(const x of f.m.columnX)for(const z of [-f.m.depthHalf,f.m.depthHalf])
   svg.push(`<circle cx="${cx+x*scale}" cy="${cz+z*scale}" r="${Math.max(2,f.m.columnD/2*scale)}" fill="${color}"/>`);
  const xx=f.m.width/2*scale,zz=f.m.depthHalf*scale;
  svg.push(`<rect x="${cx-xx}" y="${cz-zz}" width="${xx*2}" height="${zz*2}" fill="none" stroke="${color}"/>`);
  const floor=a.floors[n],sx=775;
  for(const sign of [-1,1]) {
   const x=sx+sign*f.m.depthHalf*scale;
   line(x,base-floor*scale,x,base-(floor+f.m.columnH)*scale,color,3);
   const tip=f.m.eaveHalf+f.m.yanchu;
   // Lower full roof is not drawn for a tower: it would intersect the upper
   // floor and pretend the unresolved apron geometry had been designed.
   if(n===1||!a.upper) {
    const points=f.roofSection.map(p=>`${sx+sign*(tip-p.s)*scale},${base-(floor+p.y)*scale}`).join(' ');
    svg.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`);
   }
  }
  svg.push(`<path d="M${sx-125},${base-floor*scale} h250" stroke="${color}" stroke-dasharray="5 4"/>`);
  text(915,base-floor*scale-5,`楼面 ${floor.toFixed(2)}m`,11);
 }
 text(525,y+282,a.upper?'下层屋面仅声明 apron/none；禁止两座完整房屋直接叠放':'P3 仍需生成真实斗科及专用脊型',12);
 line(32,y+302,1068,y+302,'#c5c5b9',1);
}
svg.push('</g></svg>');writeFileSync(`${out}/frames.svg`,svg.join('\n'));
console.log(JSON.stringify({frames:objects.reduce((n,o)=>n+1+Number(!!o.derived.upper),0),contracts:objects.length,missingSpecs:report.missingSpecs,out}));
