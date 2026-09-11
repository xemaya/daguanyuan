#!/usr/bin/env node
import '../tests/ts-resolver.mjs';
import {readFileSync} from 'node:fs';
const {auditNarrative}=await import('./narrative-audit.mjs');
const plan=JSON.parse(readFileSync(new URL('../projects/daguanyuan/plan.json',import.meta.url),'utf8'));
const a=auditNarrative(plan);
if(a.fails.length)throw new Error(a.fails.join('\n'));
console.log(JSON.stringify({routes:a.routes,distant:a.distant,access:a.access,runtimeVerified:false}));
