import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--enable-unsafe-webgpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({viewport:{width:1000,height:1000},deviceScaleFactor:1});
let errors=[]; page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const out='shots/wg4-parts';mkdirSync(out,{recursive:true});const rows=[];
const source=createHash('sha256').update(readFileSync('artifacts/wg-current/dist/viewer.html')).digest('hex');
try {
 for(const backend of ['legacy','webgpu','webgl2']) for(const subject of ['building:ting','taihu:peak','bamboo:default']) {
  errors=[];const prefix=backend==='legacy'?'baseline/':'';
  await page.goto(`http://127.0.0.1:4801/${prefix}viewer.html?subject=${subject}&backend=${backend}`);
  await page.waitForFunction(()=>window.__VIEWER__,null,{timeout:90000});
  if(subject==='building:ting'){await page.reload();await page.waitForFunction(()=>window.__VIEWER__,null,{timeout:90000});}
  await page.evaluate(()=>{const part=window.__VIEWER__.part;if(part.update){const update=part.update.bind(part);part.update=()=>update(0,10)}});
  await page.waitForTimeout(700);
  const stats=await page.evaluate(()=>{const v=window.__VIEWER__;return {backend:v.backend??'legacy',tris:v.triangles(),calls:v.drawCalls(),size:v.size()}});
  await page.screenshot({path:`${out}/${backend}-${subject.replace(':','-')}.png`});
  await page.setViewportSize({width:900,height:800});await page.waitForTimeout(250);
  const resized=await page.evaluate(()=>{const v=window.__VIEWER__;return v.renderer.domElement.width===900&&v.renderer.domElement.height===800&&Math.abs(v.camera.aspect-900/800)<1e-8});
  await page.setViewportSize({width:1000,height:1000});await page.waitForTimeout(200);
  rows.push({requested:backend,subject,stats,resized,errors});console.log(JSON.stringify(rows.at(-1)));
  if(errors.length||stats.backend!==backend||!resized||stats.tris<=0)throw Error(`${backend}/${subject} viewer failed`);
 }
} finally {writeFileSync(`${out}/manifest.json`,JSON.stringify({source,rows},null,2));await browser.close()}
