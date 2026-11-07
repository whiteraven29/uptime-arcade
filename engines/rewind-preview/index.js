/* Rewind task generation. Moves to the server in M5 so answers stay server-side.
   Ported from legacy/uptime-arcade-source/src. Framework-free: no React, no DOM. */
import { rng } from '../fs/index.js';

/* ========== rewind: five review tasks generated from each mission ========== */
const hashId=s=>{let h=7;for(const c of s)h=Math.imul(h,31)+c.charCodeAt(0)|0;return h};
const shuffled=(a,r)=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const isCmdLine=l=>l&&!l.startsWith("submit");
function keyLine(m){const L=(m.sol||"").split("\n").filter(isCmdLine);return L.sort((a,b)=>b.length-a.length)[0]||""}
function peersOf(m,r,TK){const list=TK[m.track];const earlier=list.slice(Math.max(0,m.pos-6),m.pos),later=list.slice(m.pos+1,m.pos+8);return shuffled([...earlier,...later],r)}
function picks(val,pool,n,r){const seen=new Set([val]),o=[val];for(const p of pool){if(o.length>=n+1)break;if(p&&!seen.has(p)){seen.add(p);o.push(p)}}return shuffled(o,r)}
function shownAnswer(m){if(m.track==="VI")return m.sol;if(m.answer&&(m.track==="GO"||m.track==="NET"))return m.answer[0];return m.kind==="py"?m.tests[0][1]:keyLine(m)}
const WORDS={PY:["return","for","if","split","get","sorted","append","range","int","float","round","min","max","not","len","strip","lower","replace","reverse","set","add"],GO:["defer","append","range","make","close","len","cap","copy","select","map","chan","var","func","type","switch","errors","Lock","Println"]};
function blank(text,tok){const i=text.indexOf(tok);return text.slice(0,i)+"____"+text.slice(i+tok.length)}
function fillTask(m,r){
  if(m.track==="VI"){const c=["3dd",">>",":%s","yyp","yy","dd","cw","J","n.","r2","f,","G","fc","o"].filter(x=>m.sol.includes(x));const tok=c[0]||":wq";return{type:"fill",q:"Fill the gap in the keys you used.",show:blank(m.sol,tok),answer:[tok]}}
  if(WORDS[m.track]){const src=m.track==="PY"?m.sol:m.code;const c=WORDS[m.track].filter(w=>new RegExp("\\b"+w+"\\b").test(src));if(c.length){const w=c[Math.floor(r()*c.length)];const i=src.search(new RegExp("\\b"+w+"\\b"));return{type:"fill",q:"Fill the missing word.",show:src.slice(0,i)+"____"+src.slice(i+w.length),answer:[w]}}}
  const line=keyLine(m);
  if(line){const toks=line.split(/\s+/);const flags=toks.filter(t=>/^-[a-zA-Z0-9,]+$/.test(t));const tools=toks.filter(t=>/^(grep|sort|uniq|cut|awk|sed|tail|head|wc|find|tr|paste|diff|mv|mkdir|chmod|touch|ip|dig|cat|ls|netplan|ping)$/.test(t));const c=flags.length?flags:tools;if(c.length){const tok=c[Math.floor(r()*c.length)];return{type:"fill",q:"Fill the gap in the command.",show:blank(line,tok),answer:[tok]}}}
  const nums=(m.why.match(/\/?\d[\d.]*\d|\b\d\b/g)||[]),ws=(m.why.match(/\b[A-Za-z]{6,}\b/g)||[]);const tok=(nums[0]||ws[Math.floor(r()*ws.length)]||m.why.split(" ")[0]).replace(/[.]$/,"");
  return{type:"fill",q:"Fill the gap in the rule.",show:blank(m.why,tok),answer:[tok]}}
function orderTask(m,r,TK){
  let items=[],q="";
  if(m.track==="VI"){items=m.sol.match(/[^<]+(?:<CR>|<Esc>)?|<[^>]+>/g)||[];q="Put the keys in order."}
  else if(m.kind==="py"){items=m.sol.split("\n").filter(l=>l.trim());q="Put these lines in order."}
  else if(m.track==="GO"){items=m.code.split("\n").filter(l=>l.trim());q="Put this code back in order."}
  else{const L=(m.sol||"").split("\n").filter(isCmdLine);if(L.length>1){items=L;q="Put the steps in order."}else if(L[0]&&L[0].includes(" | ")){items=L[0].split(" | ");q="Put the pipeline in order."}}
  if(items.length>=3&&items.length<=10&&new Set(items).size===items.length)return{type:"order",q,items,scrambled:(()=>{let s=shuffled(items,r);for(let i=0;i<6&&s.join()===items.join();i++)s=shuffled(items,r);return s})(),answer:items};
  const pool=peersOf(m,r,TK).map(p=>p.hints[0]);return{type:"mc",q:`Which tip belongs to "${m.title}"?`,options:picks(m.hints[0],pool,3,r),answer:m.hints[0]}}
function rewindTasks(m,TK){const r=rng(hashId(m.id));const peers=peersOf(m,r,TK);
  const t1={type:"mc",kicker:"Concept",q:`What's the key idea from "${m.title}"?`,options:picks(m.why,peers.map(p=>p.why),3,r),answer:m.why};
  const t2={kicker:"Fill the gap",...fillTask(m,r)};
  const t3={kicker:"Put it in order",...orderTask(m,r,TK)};
  const right=shownAnswer(m);
  const t4={type:"mc",kicker:"Which one fits?",q:`Which of these solved it? ${m.goal.replace(/^Run: submit.*/,"")}`.trim(),show:m.code||"",brief:m.brief,options:picks(right,peers.map(shownAnswer),3,r),answer:right};
  const mem=m.kind==="py"?m.sol.split("\n").filter(l=>!l.startsWith("def")&&l.trim()).sort((a,b)=>b.length-a.length)[0].trim():right;
  const t5={type:"memory",kicker:"From memory",q:m.kind==="py"?"Type the most important line of your solution.":m.track==="VI"?"Type the keys you used, with <CR> for Enter and <Esc> for Escape.":m.track==="GO"?"Type what the program printed.":"Type the answer or command from memory.",brief:m.brief,show:m.code||"",answer:m.answer&&m.track!=="SH"?m.answer:[mem],start:String(mem).split(/\s+/)[0].slice(0,12)};
  return[t1,t2,t3,t4,t5]}
const normA=s=>String(s).trim().replace(/\s+/g," ").replace(/'/g,'"').toLowerCase();

export { rewindTasks, normA };
