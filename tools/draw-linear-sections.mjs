#!/usr/bin/env node
import '../tests/ts-resolver.mjs';import {readFileSync,writeFileSync} from 'node:fs';
const {auditLinearLayouts}=await import('./linear-layout-audit.mjs');
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8')),a=auditLinearLayouts(plan);
if(a.fails.length)throw new Error(a.fails.join('\n'));
const road=a.objects.find(o=>o.id==='liaoting_huaxu.mountain-path').runs[0],bridge=a.objects.find(o=>o.id==='qinfang_ting_qiao.three-opening-bridge');
const X=d=>80+d*10,Y=y=>270-y*32,svg=[];const e=s=>svg.push(s);
e('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="670" viewBox="0 0 1200 670" font-family="sans-serif"><rect width="1200" height="670" fill="#f7f2e7"/>');
e('<text x="55" y="46" fill="#33291d" font-size="25">P2 线性构件纵断 · 从同一施工输入生成</text>');
e('<text x="55" y="77" fill="#766953" font-size="15">几何设计图，非已装配实景。横纵比例不同；米制尺寸为艺术工程输入，P3/P4 继续细化。</text>');
for(let y=0;y<=5;y++){e(`<path d="M80 ${Y(y)} H1100" stroke="#d9d1c2"/>`);e(`<text x="40" y="${Y(y)+5}" fill="#766953" font-size="13">${y}m</text>`);}
const points=[];
for(const [i,s] of road.segments.entries()) {
 const stair=road.stairs.find(t=>t.segment===i);
 if(stair){points.push([X(s.start),Y(s.y0)]);for(let j=1;j<stair.levels.length;j++){const prev=stair.levels[j-1],b=stair.levels[j];points.push([X(b.distance),Y(prev.y)],[X(b.distance),Y(b.y)]);}}
 else points.push([X(s.start),Y(s.y0)],[X(s.start+s.length),Y(s.y1)]);
}
e(`<rect x="${X(a.caveTop.overlapStartM)}" y="${Y(2.4)}" width="${(a.caveTop.overlapEndM-a.caveTop.overlapStartM)*10}" height="${3.1*32}" fill="#b9dde2" fill-opacity=".7" stroke="#60969c"/>`);
e(`<polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#8b5d3d" stroke-width="4"/>`);
e('<text x="100" y="120" font-size="17" fill="#33291d">花溆 E17 → E18 · 西侧登山，跨洞顶后沿石阶下池岸</text>');
e(`<text x="80" y="318" font-size="15" fill="#554736">长 ${road.length.toFixed(2)}m；坡道最大 ${(road.maxRampSlope*100).toFixed(2)}%；18 级踏步：踏高 0.153m / 踏深 0.512m。</text>`);
e(`<text x="80" y="344" font-size="15" fill="#554736">蓝框为船行净空投影：水上 2.4m / 水下 0.7m；密采样 ${a.caveTop.boatOverlapSamples} 点，扣除路面厚度后的岩体最小 ${a.caveTop.minRockM.toFixed(3)}m。</text>`);
e('<text x="80" y="407" font-size="19" fill="#33291d">沁芳三港桥 · 断面七段，过水净口与桥墩分别表达</text>');
const bx=d=>80+d*90,by=y=>525-y*45;
for(const s of bridge.bridgeSections)e(`<rect x="${bx(s.from)}" y="${by(s.topY)}" width="${(s.to-s.from)*90}" height="${(s.topY-s.bottomY)*45}" fill="${s.role==='water-opening'?'#b9dde2':'#a29b8d'}" stroke="#675f53"/>`);
e(`<rect x="80" y="${by(.4)}" width="900" height="13.5" fill="#a29b8d" stroke="#675f53"/>`);
e('<text x="80" y="465" font-size="15" fill="#554736">1.2 + 2.2 + 0.5 + 2.2 + 0.5 + 2.2 + 1.2 = 10m；三处净口，不把 bays 当木构开间。</text>');
e('<text x="80" y="615" font-size="15" fill="#554736">桥底 -1.3m / 盖底 0.1m / 桥面 0.4m。此断面只保证设计过水空间，不据诗句声称可通舟。</text>');
e('</svg>');writeFileSync('knowledge/docs/plan/sections.svg',svg.join('\n')+'\n');
