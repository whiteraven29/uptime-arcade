#!/usr/bin/env node
/* Grades one lab. Reads {lab, state, goals} as JSON on stdin and writes the result on stdout. The same engine the
   browser runs, on nothing but the submitted configs, so a lab can't be passed by claiming it was. The config is
   only ever parsed by the engine's command tables: nothing in it is evaluated as code. */
import { gradeLab } from '../engines/netsim/index.js';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const { lab, state, goals } = JSON.parse(raw);
process.stdout.write(JSON.stringify({ goals: gradeLab(lab, state, goals) }));
