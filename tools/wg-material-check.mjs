import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1000,height:1000}});
let errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const rows=[];mkdirSync('shots/wg2-samples',{recursive:true});
try {
 for(const backend of ['webgpu','webgl2']) for(const sample of ['sky','terrain','water','foliage','bamboo']) {
  errors=[];
  const query=sample==='bamboo'?'subject=bamboo:default':`sample=${sample}`;
  await page.goto(`http://127.0.0.1:4801/viewer.html?${query}&backend=${backend}&fixed=1`);
  await page.waitForFunction(()=>window.__WG_SAMPLE__||window.__VIEWER__,null,{timeout:90000});
  await page.waitForTimeout(400);
  const stats=await page.evaluate(()=>{const v=window.__WG_SAMPLE__;const e=v?.engine;const r=e?.renderer??window.__VIEWER__.renderer;return {backend:e?.backend??window.__VIEWER__.backend,buildMs:v?.buildMs??null,calls:r.info.render.drawCalls,triangles:r.info.render.triangles}});
  await page.screenshot({path:`shots/wg2-samples/${backend}-${sample}.png`});
  rows.push({backend,sample,stats,errors});console.log(JSON.stringify(rows.at(-1)));
  if(errors.length||stats.backend!==backend)throw new Error(`${sample} failed on ${backend}`);
 }
} finally {writeFileSync('shots/wg2-samples/manifest.json',JSON.stringify(rows,null,2));await browser.close()}
