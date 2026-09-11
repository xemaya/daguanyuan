#!/usr/bin/env node
/** JSON bridge for the plan SVG: reuse the TypeScript compiler, never repeat
 * architectural formulas in Python or draw guessed widths from a bay count. */
import '../tests/ts-resolver.mjs';
import {readFileSync} from 'node:fs';
const {auditConstructions}=await import('./construction-audit.mjs');
const plan=JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json',import.meta.url),'utf8'));
const a=auditConstructions(plan);
if(a.fails.length)throw new Error(a.fails.join('\n'));
console.log(JSON.stringify({total:a.total,meshFactories:a.meshFactories,frameOnly:a.frameOnly,
 objects:a.objects.map(o=>({id:o.id,footprints:o.footprints,
   meshFactoryAvailable:o.compiled.meshFactoryAvailable,totalHeight:o.compiled.totalHeight,
   modules:o.compiled.modules.map(m=>({id:m.id,at:m.at,roofMode:m.roofMode,dimensions:m.frame.m,provenance:m.frame.provenance})),
   gallery:o.compiled.gallery,boat:o.compiled.boat,site:o.compiled.site,passage:o.compiled.passage,rearDoor:o.compiled.rearDoor,
   walkSurfaces:o.compiled.walkSurfaces,pendingGeometry:o.compiled.pendingGeometry}))}));
