/* Helpers and the virtual file system.
   Ported from legacy/uptime-arcade-source/src. Framework-free: no React, no DOM. */
import { S } from '../host.js';

/* ========== helpers ========== */
const HOST="wr-dev01";
const pad=n=>String(n).padStart(2,"0");
function rng(seed){return()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const lines=t=>{if(!t)return[];const l=t.split("\n");if(l[l.length-1]==="")l.pop();return l};
const joinL=l=>l.length?l.join("\n")+"\n":"";

/* ========== virtual filesystem ========== */
const HOME="/home/ops";
const base=new Map();
function D(p,m=0o755){base.set(p,{t:"d",m,mt:"Nov  2 08:00"})}
function F(p,c,m=0o644,mt="Nov  2 08:00"){
  const parts=p.split("/");for(let i=2;i<parts.length;i++){const d=parts.slice(0,i).join("/");if(!base.has(d))D(d)}
  base.set(p,{t:"f",c,m,mt})}
D("/");
const fs={nodes:new Map(),
  reset(overlay){this.nodes=new Map(base);for(const[k,v]of Object.entries(overlay)){if(v===null)this.nodes.delete(k);else this.nodes.set(k,v)}},
  get(p){return this.nodes.get(p)},
  put(p,n){this.nodes.set(p,n);S.overlay[p]=n},
  del(p){this.nodes.delete(p);S.overlay[p]=null},
  kids(p){const pre=p==="/"?"/":p+"/",r=[];for(const k of this.nodes.keys()){if(k!=="/"&&k.startsWith(pre)&&!k.slice(pre.length).includes("/"))r.push(k)}return r.sort()}};
function norm(p){const o=p.startsWith("/")?[]:S.cwd.split("/").filter(Boolean);for(const s of p.split("/")){if(!s||s===".")continue;if(s==="..")o.pop();else o.push(s)}return"/"+o.join("/")}

export { HOST, pad, rng, lines, joinL, HOME, base, D, F, fs, norm };
