#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const url = option('--url','http://127.0.0.1:4822/viewer.html');
const out = option('--out','shots/p2-building-catalog');
const plan = JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json',import.meta.url),'utf8'));
const objects = plan.regions.flatMap(r=>r.buildings).filter(b=>b.construction);
const report = { expected:objects.length, objects:[], errors:[] };
mkdirSync(out,{recursive:true});
const browser = await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
  const page = await browser.newPage({viewport:{width:1000,height:850},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  for (const object of objects) {
    await page.goto(`${url}?subject=${encodeURIComponent('garden-building:'+object.id)}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__VIEWER__,null,{timeout:60000});
    const result = await page.evaluate(expected=>{
      const viewer = window.__VIEWER__, part = viewer.part, m = part.frame.m;
      const seen = new Set(); let meshes=0, vertices=0, invalid=0;
      part.root.traverse(mesh=>{
        if(!mesh.isMesh)return;
        meshes++;
        if(seen.has(mesh.geometry))return;
        seen.add(mesh.geometry);
        for(const attr of Object.values(mesh.geometry.attributes)) {
          for(const value of attr.array) if(!Number.isFinite(value)) invalid++;
        }
        const position=mesh.geometry.attributes.position;
        vertices+=position.count;
        if(mesh.geometry.index) for(const index of mesh.geometry.index.array)
          if(index<0||index>=position.count)invalid++;
      });
      const actualColumns = part.blockers.filter(b => Math.abs(b.hx-m.columnD/2-.02)<1e-6 && Math.abs(b.hz-b.hx)<1e-6);
      const validColumns = m.columnX.every(x=>[m.depthHalf,-m.depthHalf].every(z=>
        actualColumns.some(b=>Math.abs(b.cx-x)<1e-6&&Math.abs(b.cz-z)<1e-6)));
      return { id:expected.id, meshes, vertices, invalid, size:viewer.size(), validColumns,
        columnCount:actualColumns.length, expectedColumns:(expected.bays+1)*2,
        kind:part.kind, construction:part.root.userData.construction, planObject:part.root.userData.planObject,
        passed:invalid===0&&meshes>0&&vertices>0&&validColumns&&actualColumns.length===(expected.bays+1)*2&&
          part.kind==='building'&&viewer.size().every(n=>Number.isFinite(n)&&n>0)&&
          part.root.userData.planObject?.id===expected.id&&part.root.userData.construction?.paramSet==='fayuan'&&
          ['front','sides','back'].every(key=>part.root.userData.construction.surfaces[key]===expected.construction.options[key]) };
    },object);
    await page.screenshot({path:`${out}/${object.id}.png`});
    report.objects.push(result);
    console.log(`${result.passed?'PASS':'FAIL'} ${object.id} ${result.columnCount} columns, ${result.vertices} vertices`);
  }
} catch(error) { report.errors.push(String(error)); }
finally {
  report.passed = report.objects.length===report.expected && report.errors.length===0 && report.objects.every(x=>x.passed);
  writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  await browser.close();
  if(!report.passed)process.exitCode=1;
}
