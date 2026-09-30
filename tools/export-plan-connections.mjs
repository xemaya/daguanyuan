#!/usr/bin/env node
import '../tests/ts-resolver.mjs';import {readFileSync} from 'node:fs';
const {auditConnections}=await import('./connection-audit.mjs');
const {makeTerrainField}=await import('../builder/compose/terrain-from-plan.ts');
const {SEED}=await import('../builder/compose/config.ts');
const plan=JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json',import.meta.url),'utf8'));
const a=auditConnections(plan);if(a.fails.length)throw new Error(a.fails.join('\n'));
const field=makeTerrainField(plan,{seed:SEED});
console.log(JSON.stringify({scope:'P2 executable bridge geometry and terrain; not whole-world instancing',connections:a.connections.map(c=>({
 ...c,endpoints:[c.spec.points[0],c.spec.points.at(-1)].map(p=>({point:p,ground:field.height(...p),deck:c.spec.elevation_m})),
 deepestCrossing:Math.min(...c.checks.flatMap(k=>k.waterPoints.map(p=>field.height(...p.point))))}))}));
