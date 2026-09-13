import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--enable-unsafe-webgpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({viewport:{width:1000,height:1000}});
let errors=[]; page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
mkdirSync('shots/wg1',{recursive:true});
const rows=[];
for(const backend of ['webgpu','webgl2']) for(const subject of ['building:ting','taihu:peak']) {
 errors=[]; await page.goto(`http://127.0.0.1:4801/viewer.html?subject=${subject}&backend=${backend}`);
 await page.waitForFunction(()=>window.__VIEWER__,null,{timeout:60000}).catch(()=>{});
 await page.waitForTimeout(700);
 const stats=await page.evaluate(()=>{const v=window.__VIEWER__;return v?{backend:v.backend,tris:v.triangles(),calls:v.drawCalls(),size:v.size()}:null});
 await page.screenshot({path:`shots/wg1/${backend}-${subject.replace(':','-')}.png`});
 await page.setViewportSize({width:900,height:800});await page.waitForTimeout(150);await page.setViewportSize({width:1000,height:1000});
 rows.push({requested:backend,subject,stats,errors});console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync('shots/wg1/manifest.json',JSON.stringify(rows,null,2));await browser.close();
