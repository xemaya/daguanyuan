#!/usr/bin/env node
import '../tests/ts-resolver.mjs';import {readFileSync} from 'node:fs';
const {compileDistantScene}=await import('../builder/plan/distant-scene.ts');
const plan=JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json',import.meta.url),'utf8'));
console.log(JSON.stringify({detail:'distant',scenes:plan.distantScenes.map(s=>({spec:s,compiled:compileDistantScene(s,plan)}))}));
