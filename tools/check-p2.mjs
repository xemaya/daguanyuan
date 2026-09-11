#!/usr/bin/env node
import '../tests/ts-resolver.mjs';import {readFileSync} from 'node:fs';
const {auditP2}=await import('./p2-audit.mjs');
const result=auditP2(JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8')));
console.log(JSON.stringify(result,null,2));if(!result.complete)process.exitCode=1;
