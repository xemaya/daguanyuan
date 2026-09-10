#!/usr/bin/env node
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
const out=resolve(process.argv[2] ?? 'shots/p2-layout/plan.png');
const svg=readFileSync(new URL('../knowledge/docs/plan/plan.svg',import.meta.url),'utf8');
mkdirSync(dirname(out),{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1410,height:1185},deviceScaleFactor:1});
  await page.setContent(`<style>body{margin:0}</style>${svg}`);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:out,fullPage:true});
  console.log(out);
} finally { await browser.close(); }
