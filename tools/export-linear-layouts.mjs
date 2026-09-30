#!/usr/bin/env node
import '../tests/ts-resolver.mjs';import {readFileSync} from 'node:fs';
const {auditLinearLayouts}=await import('./linear-layout-audit.mjs');
const result=auditLinearLayouts(JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8')));
console.log(JSON.stringify(result));if(result.fails.length)process.exitCode=1;
