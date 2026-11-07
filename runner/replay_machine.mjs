#!/usr/bin/env node
/* Replays one shell or vi mission from {base, fixtures, log} on stdin and writes the resulting machine on stdout.
   It runs on the server as a short-lived process with a time and memory limit, like grade_lab.mjs. */
import { replay } from '../engines/replay.js';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
process.stdout.write(JSON.stringify(replay(JSON.parse(raw))));
