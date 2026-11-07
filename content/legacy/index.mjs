/* The launch catalogue as it stands today: 150 missions, 30 per track, each track from zero.
   Section 8 lists them. NetLab and Operations follow in M6 and M7. */
import './data.mjs';
import { TK, CHAPTERS } from './registry.mjs';
import './shell.mjs';
import './vi.mjs';
import './python.mjs';
import './go.mjs';
import './net.mjs';

const TRACKS = [
  ['SH', 'Shell', 'From your first command to real scripts'],
  ['VI', 'vi', 'From opening a file to macros'],
  ['PY', 'Python', 'From your first print to a log analyser'],
  ['GO', 'Go', 'From hello to a worker pool'],
  ['NET', 'Networking', 'From what an address is to fixing outages'],
];
const TICKETS = [];
for (const [k] of TRACKS) {
  TK[k].forEach((t, i) => {
    t.pos = i;
    t.xp = i < TK[k].length / 3 ? 100 : i < (TK[k].length * 2) / 3 ? 130 : 160;
    TICKETS.push(t);
  });
}

/* Saves from before the rebuild used numbered ids. Where the mission survives, keep the progress. */
const OLD_IDS = {
  'sh-1': 'sh-04', 'sh-2': 'sh-08', 'sh-4': 'sh-10', 'sh-5': 'sh-13', 'sh-7': 'sh-14', 'sh-8': 'sh-15', 'sh-9': 'sh-19', 'sh-11': 'sh-20', 'sh-13': 'sh-21', 'sh-15': 'sh-22', 'sh-16': 'sh-23', 'sh-17': 'sh-25', 'sh-19': 'sh-24', 'sh-21': 'sh-26', 'sh-22': 'sh-17', 'sh-23': 'sh-18', 'sh-24': 'sh-28', 'sh-28': 'sh-29',
  'vi-1': 'vi-06', 'vi-3': 'vi-11', 'vi-4': 'vi-09', 'vi-5': 'vi-15', 'vi-6': 'vi-14', 'vi-7': 'vi-12', 'vi-8': 'vi-10', 'vi-9': 'vi-17', 'vi-10': 'vi-20', 'vi-11': 'vi-18', 'vi-12': 'vi-16',
  'py-1': 'py-04', 'py-3': 'py-11', 'py-4': 'py-15', 'py-5': 'py-13', 'py-7': 'py-05', 'py-10': 'py-14', 'py-11': 'py-12', 'py-12': 'py-18', 'py-14': 'py-24', 'py-17': 'py-29',
  'go-1': 'go-02', 'go-2': 'go-19', 'go-4': 'go-13', 'go-6': 'go-14', 'go-7': 'go-11', 'go-8': 'go-10', 'go-9': 'go-12', 'go-11': 'go-16', 'go-12': 'go-05', 'go-14': 'go-18', 'go-15': 'go-21', 'go-16': 'go-25', 'go-17': 'go-26', 'go-18': 'go-27',
  'net-1': 'net-04', 'net-2': 'net-03', 'net-3': 'net-06', 'net-7': 'net-11', 'net-8': 'net-08', 'net-9': 'net-09', 'net-10': 'net-19', 'net-11': 'net-20', 'net-12': 'net-17', 'net-13': 'net-15', 'net-14': 'net-14', 'net-15': 'net-26', 'net-16': 'net-25', 'net-18': 'net-16', 'net-19': 'net-22', 'net-21': 'net-29',
};

export { TK, TRACKS, CHAPTERS, TICKETS, OLD_IDS };
