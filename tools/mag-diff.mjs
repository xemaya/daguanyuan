import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const uri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const r = await page.evaluate(async ([ua, ub]) => {
  const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
  const [ia, ib] = await Promise.all([load(ua), load(ub)]);
  const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
  g.clearRect(0,0,c.width,c.height); g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  const buckets = { '0': 0, '1-2': 0, '3-8': 0, '9-24': 0, '25-64': 0, '>64': 0 };
  let sum = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.max(Math.abs(da[i]-db[i]), Math.abs(da[i+1]-db[i+1]), Math.abs(da[i+2]-db[i+2]));
    sum += d;
    if (d === 0) buckets['0']++; else if (d <= 2) buckets['1-2']++; else if (d <= 8) buckets['3-8']++;
    else if (d <= 24) buckets['9-24']++; else if (d <= 64) buckets['25-64']++; else buckets['>64']++;
  }
  return { n, mae: sum / n, buckets };
}, [uri(a), uri(b)]);
console.log(`${a.split('/').pop()}  平均绝对差 ${r.mae.toFixed(2)}/255`);
for (const [k, v] of Object.entries(r.buckets)) console.log(`   差 ${k.padStart(6)} 色阶: ${(v / r.n * 100).toFixed(2)}%`);
await browser.close();
