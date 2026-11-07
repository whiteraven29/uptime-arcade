#!/usr/bin/env node
/* Builds a fault drill: a lab solved by its own solution, then broken. Reads {lab, solution, goals, seed, count} as JSON on
   stdin and writes {state, faults}. The state goes to the player and what broke stays on the server until they ask. */
import { createLab, injectFaults, playSolution } from '../engines/netsim/index.js';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const { lab: spec, solution, goals, seed, count } = JSON.parse(raw);
const lab = createLab(spec);
playSolution(lab, solution);
const faults = injectFaults(lab, goals, seed, count);
process.stdout.write(JSON.stringify({ state: lab.serialize(), faults }));
