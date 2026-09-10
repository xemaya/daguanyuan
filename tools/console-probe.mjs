#!/usr/bin/env node
// 打开页面,等世界建成,把匹配 --grep 的 console 行打出来。
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:4801/';
const grep = new RegExp(process.argv[3] ?? '.');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (grep.test(m.text())) console.log(m.text()); });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GAME__ !== undefined || document.querySelector('#app pre') !== null, null, { timeout: 150000 }).catch(() => console.log('TIMEOUT'));
await browser.close();
