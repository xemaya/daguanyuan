#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const url = process.env.TEXTURE_TEST_URL ?? 'http://127.0.0.1:4818';
const browser = await chromium.launch({ headless: true });
try {
  const results = [];
  for (const mode of ['synchronous', 'workers']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/__texture_check', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Texture verification</title>',
    }));
    await page.goto(`${url}/__texture_check`);
    const result = await page.evaluate(async mode => {
      const lab = await import('/engine/core/TextureLab.ts');
      const start = performance.now();
      let warmup;
      if (mode === 'workers') {
        const { prewarmTextures } = await import('/builder/compose/prewarm-textures.ts');
        warmup = await prewarmTextures();
        if (!warmup.workers) throw new Error(`Worker preparation fell back: ${warmup.fallback}`);
      } else {
        const { TEXTURE_JOBS, bakeTextureJob } = await import('/builder/compose/texture-jobs.ts');
        for (const job of TEXTURE_JOBS) bakeTextureJob(job);
      }
      const ms = performance.now() - start;
      const textures = [];
      for (const { data, ...metadata } of lab.exportBakedTextures()) {
        const hash = await crypto.subtle.digest('SHA-256', data);
        textures.push({ ...metadata, hash: [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('') });
      }
      textures.sort((a, b) => a.key.localeCompare(b.key));
      return { mode, ms, warmup, textures };
    }, mode);
    results.push(result);
    console.log(`${mode}: ${result.textures.length} textures, ${result.ms.toFixed(0)}ms`);
    await context.close();
  }
  const a = results[0].textures, b = results[1].textures;
  if (a.length < 25 || JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Texture pixel or sampler mismatch across worker boundary');
  const failurePage = await browser.newPage();
  await failurePage.route('**/__texture_check', route => route.fulfill({ contentType: 'text/html', body: '<title>Failure verification</title>' }));
  await failurePage.goto(`${url}/__texture_check`);
  const fallback = await failurePage.evaluate(async () => {
    const NativeWorker = window.Worker;
    let created = 0, terminated = 0;
    window.Worker = class {
      constructor() { this.id = created++; }
      postMessage() {
        if (this.id === 0) queueMicrotask(() => this.onerror?.({ message: 'forced verification failure', preventDefault() {} }));
      }
      terminate() { terminated++; }
    };
    try {
      const { prewarmTextures } = await import('/builder/compose/prewarm-textures.ts');
      const { exportBakedTextures } = await import('/engine/core/TextureLab.ts');
      const result = await prewarmTextures();
      return { result, created, terminated, adopted: exportBakedTextures().length };
    } finally { window.Worker = NativeWorker; }
  });
  if (fallback.result.workers !== 0 || fallback.created !== fallback.terminated || fallback.adopted !== 0) {
    throw new Error('Worker failure did not cancel all jobs and preserve the synchronous cache path');
  }
  mkdirSync('shots/p1f-textures', { recursive: true });
  writeFileSync('shots/p1f-textures/report.json', JSON.stringify({ passed: true, results, fallback }, null, 2));
  console.log('PASS: pixel hashes, dimensions, colour space, wrapping, filtering, repeat and orientation all match.');
} finally {
  await browser.close();
}
