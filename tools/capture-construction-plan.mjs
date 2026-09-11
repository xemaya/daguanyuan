#!/usr/bin/env node
import {chromium} from 'playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const out=process.argv[2]??'shots/p2-construction';mkdirSync(out,{recursive:true});
const svg=readFileSync(new URL('../knowledge/docs/plan/plan.svg',import.meta.url),'utf8');
const views=[['hengwu',[-140,-182,48,38.4]],['yihong',[98,158,40,32]],['boathouse',[-160,-98,60,48]],['daoxiang',[-230,-64,48,38.4]],['luxue',[101,13,38,30.4]]];
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1410,height:1185},deviceScaleFactor:1});
 await page.setContent('<body style="margin:0">'+svg+'</body>');await page.screenshot({path:`${out}/plan.png`});
 await page.setViewportSize({width:1000,height:800});
 // Local construction views omit the regional labels and large tour markers;
 // they would cover the very geometry being checked when enlarged.
 await page.addStyleTag({content:'svg text {display:none} svg path, svg line, svg polyline, svg polygon, svg rect {vector-effect:non-scaling-stroke}'});
 await page.evaluate(()=>{
  for(const c of document.querySelectorAll('svg circle'))if(+c.getAttribute('r')>1)c.remove();
  for(const r of document.querySelectorAll('svg rect[rx="8.5"]'))r.remove();
  for(const e of document.querySelectorAll('[marker-end]'))e.removeAttribute('marker-end');
 });
 for(const [id,box] of views) {
  await page.evaluate(box=>{const s=document.querySelector('svg');s.setAttribute('viewBox',box.join(' '));s.setAttribute('width','1000');s.setAttribute('height','800');},box);
  await page.screenshot({path:`${out}/${id}.png`});
 }
 writeFileSync(`${out}/views.json`,JSON.stringify({scope:'P2 construction footprints, not rendered building meshes',views},null,2));
}finally{await browser.close();}
