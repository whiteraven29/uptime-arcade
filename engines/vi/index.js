/* A small real vi: modes, motions, operators, counts, dot-repeat, search, ex commands, text objects,
   visual modes, registers, marks and macros. Ported from legacy/uptime-arcade-source/src and extended
   for the 30-mission vi track (section 8.2). Framework-free: no React, no DOM. */
import { S, host } from '../host.js';
import { HOME, fs, lines, norm } from '../fs/index.js';
import { sh, writeFile } from '../shell/index.js';

/* ========== a small real vi ========== */
const VI={on:false,path:"",shown:"",L:[""],r:0,c:0,mode:"normal",cmd:"",msg:"",keys:0,saved:0,undo:[],redo:[],count:"",op:"",pending:"",reg:[],regLine:true,regs:{},regSel:"",marks:{},macros:{},macroRec:null,lastMacro:"",vis:null,blockIns:null,search:"",dirty:false,rec:[],last:null,changed:false,replay:false,top:0,fch:null,used:new Set()};
function viOpen(p,shown){const n=fs.get(p);if(n&&n.t==="d")return sh.e(`vi: ${shown}: Is a directory`);
  Object.assign(VI,{on:true,path:p,shown,L:n?lines(n.c):[],r:0,c:0,mode:"normal",cmd:"",msg:n?`"${shown}" ${lines(n.c).length}L`:`"${shown}" [New File]`,keys:0,saved:0,undo:[],redo:[],count:"",op:"",pending:"",regSel:"",marks:{},macros:{},macroRec:null,lastMacro:"",vis:null,blockIns:null,dirty:false,rec:[],last:null,top:0,used:new Set()});
  if(!VI.L.length)VI.L=[""];host.viShow(true)}
function viSnap(){VI.undo.push({L:[...VI.L],r:VI.r,c:VI.c});if(VI.undo.length>50)VI.undo.shift();VI.redo=[];VI.changed=true;VI.dirty=true}
const viLine=()=>VI.L[VI.r]??"";
function viClamp(){VI.r=Math.max(0,Math.min(VI.r,VI.L.length-1));const max=Math.max(0,viLine().length-(VI.mode==="insert"?0:1));VI.c=Math.max(0,Math.min(VI.c,max))}
const cls=ch=>ch===undefined||/\s/.test(ch)?0:/\w/.test(ch)?1:2;
function mWord(r,c){let l=VI.L[r],k=cls(l[c]);if(k)while(c<l.length&&cls(l[c])===k)c++;while(true){while(c<l.length&&cls(l[c])===0)c++;if(c<l.length||r>=VI.L.length-1)break;r++;l=VI.L[r];c=0;if(!l.length)break}return{r,c:Math.min(c,Math.max(0,l.length-1)),eol:c>=l.length}}
function mEnd(r,c){let l=VI.L[r];c++;while(true){while(c<l.length&&cls(l[c])===0)c++;if(c<l.length||r>=VI.L.length-1)break;r++;l=VI.L[r];c=0}const k=cls(l[c]);while(c+1<l.length&&cls(l[c+1])===k)c++;return{r,c}}
function mBack(r,c){let l=VI.L[r];c--;while(true){while(c>=0&&cls(l[c])===0)c--;if(c>=0||r===0)break;r--;l=VI.L[r];c=l.length-1}if(c<0)return{r,c:0};const k=cls(l[c]);while(c>0&&cls(l[c-1])===k)c--;return{r,c}}
function viFind(dir){if(!VI.search)return;let re;try{re=new RegExp(VI.search)}catch{VI.msg="Bad search pattern";return}
  const n=VI.L.length;
  if(dir>0){const m=viMatchFrom(re,VI.r,VI.c+1);if(m){VI.r=m.r;VI.c=m.c;return}for(let i=1;i<=n;i++){const r=(VI.r+i)%n;const mm=re.exec(VI.L[r]);if(mm){VI.r=r;VI.c=mm.index;if(r<=VI.r)VI.msg="search wrapped";return}}}
  else{for(let i=0;i<=n;i++){const r=(VI.r-i+n*2)%n,all=[...VI.L[r].matchAll(new RegExp(re.source,"g"))].filter(x=>i>0||x.index<VI.c);if(all.length){VI.r=r;VI.c=all[all.length-1].index;return}}}
  VI.msg="Pattern not found: "+VI.search}
function viMatchFrom(re,r,c){const m=new RegExp(re.source,"g");m.lastIndex=c;const x=m.exec(VI.L[r]);return x&&x.index>=c?{r,c:x.index}:null}
function viInsert(t){const l=viLine();VI.L[VI.r]=l.slice(0,VI.c)+t+l.slice(VI.c);VI.c+=t.length}
/* Yanks and deletes always fill the unnamed register, and also a named one after "x. */
function setReg(L,lineWise){VI.reg=L;VI.regLine=lineWise;if(VI.regSel){VI.regs[VI.regSel]={L,lineWise};VI.regSel=""}}
function viOperate(op,from,to,lineWise){
  viSnap();
  if(lineWise){const a=Math.min(from.r,to.r),b=Math.max(from.r,to.r);setReg(VI.L.slice(a,b+1),true);if(op==="y"){VI.undo.pop();VI.changed=false;VI.dirty=VI.undo.length>0;VI.r=a;return}
    VI.L.splice(a,b-a+1);if(op==="c"){VI.L.splice(a,0,"");VI.r=a;VI.c=0;VI.mode="insert";return}if(!VI.L.length)VI.L=[""];VI.r=Math.min(a,VI.L.length-1);VI.c=0;return}
  if(from.r!==to.r)to={r:from.r,c:VI.L[from.r].length};
  const a=Math.min(from.c,to.c),b=Math.max(from.c,to.c),l=VI.L[from.r];setReg([l.slice(a,b)],false);
  if(op==="y"){VI.undo.pop();VI.changed=false;return}
  VI.L[from.r]=l.slice(0,a)+l.slice(b);VI.c=a;if(op==="c")VI.mode="insert"}

/* ========== ex commands ========== */
const ADDR="%|(?:\\d+|\\.|\\$|'[a-z])(?:,(?:\\d+|\\.|\\$|'[a-z]))?";
const SUB="s\\/((?:\\\\\\/|[^/])*)\\/((?:\\\\\\/|[^/])*)(?:\\/([gi]*))?";
const RE_SUB=new RegExp(`^(${ADDR})?${SUB}$`),RE_DEL=new RegExp(`^(${ADDR})?d$`),RE_GLOBAL=/^(g|v)\/((?:\\\/|[^/])*)\/(.*)$/;
function viRange(spec){if(!spec)return[VI.r,VI.r];if(spec==="%")return[0,VI.L.length-1];
  const one=t=>t==="."?VI.r:t==="$"?VI.L.length-1:t[0]==="'"?(VI.marks[t[1]]?VI.marks[t[1]].r:NaN):+t-1;
  const q=spec.split(",");return[one(q[0]),one(q[q.length-1])]}
function viSubst(a,b,pat,repText,flags){let re;try{re=new RegExp(pat.replace(/\\\//g,"/"),(flags||"").includes("g")?"g":"")}catch{VI.msg="Bad pattern";return}
  viSnap();let n=0;const rep=repText.replace(/\\\//g,"/");for(let i=a;i<=b&&i<VI.L.length;i++){VI.L[i]=VI.L[i].replace(re,()=>{n++;return rep})}
  VI.changed=false;VI.msg=n?`${n} substitutions`:"Pattern not found"}
function viWrite(target){const body=VI.L.join("\n")+"\n";if(target&&target!==VI.path){writeFile(target,body,"vi");VI.msg=`"${target}" ${VI.L.length}L written`;return}
  writeFile(VI.path,body,"vi");S.viKeys[VI.path]=(S.viKeys[VI.path]||0)+VI.keys-VI.saved;VI.saved=VI.keys;
  S.viUsed=S.viUsed||{};S.viUsed[VI.path]=[...new Set([...(S.viUsed[VI.path]||[]),...VI.used])];VI.dirty=false;VI.msg=`"${VI.shown}" ${VI.L.length}L written`}
const exPath=p=>norm(p.replace(/^~(?=\/|$)/,HOME));
function viExCmd(c){const cmd=c.trim();let m;
  const note=v=>VI.used.add(":"+v);
  if(cmd==="w"){note("w");return viWrite()}
  if(cmd==="wq"||cmd==="x"){note("wq");viWrite();viClose();return}
  if(cmd==="q"){note("q");if(VI.dirty){VI.msg="No write since last change (use :q! to discard)";return}viClose();return}
  if(cmd==="q!"){note("q!");viClose();return}
  if(/^\d+$/.test(cmd)){note("N");VI.r=+cmd-1;viClamp();VI.c=0;return}
  if(cmd==="$"){note("N");VI.r=VI.L.length-1;VI.c=0;return}
  if((m=/^w\s+(\S+)$/.exec(cmd))){note("w");viWrite(exPath(m[1]));return}
  if((m=/^r\s+(\S+)$/.exec(cmd))){note("r");const n=fs.get(exPath(m[1]));if(!n||n.t==="d"){VI.msg=`Can't open file ${m[1]}`;return}viSnap();const add=lines(n.c);VI.L.splice(VI.r+1,0,...add);VI.r+=1;VI.c=0;VI.changed=false;return}
  if((m=/^e(!?)\s+(\S+)$/.exec(cmd))){note("e");if(VI.dirty&&!m[1]){VI.msg="No write since last change (use :e! to discard)";return}viOpen(exPath(m[2]),m[2]);return}
  if((m=RE_DEL.exec(cmd))){note("d");const[a,b]=viRange(m[1]);if(!(a>=0&&b>=a)){VI.msg="Bad range";return}viSnap();setReg(VI.L.slice(a,b+1),true);VI.L.splice(a,b-a+1);if(!VI.L.length)VI.L=[""];VI.r=a;VI.c=0;viClamp();VI.changed=false;return}
  if((m=RE_SUB.exec(cmd))){note("s");const[a,b]=viRange(m[1]);if(!(a>=0&&b>=a)){VI.msg="Bad range";return}viSubst(a,b,m[2],m[3],m[4]);return}
  if((m=RE_GLOBAL.exec(cmd))){note(m[1]);let re;try{re=new RegExp(m[2].replace(/\\\//g,"/"))}catch{VI.msg="Bad pattern";return}
    const want=m[1]==="g",hit=l=>re.test(l)===want;
    if(m[3]==="d"){viSnap();const keep=VI.L.filter(l=>!hit(l));VI.msg=`${VI.L.length-keep.length} fewer lines`;VI.L=keep.length?keep:[""];VI.r=0;VI.c=0;VI.changed=false;return}
    const s=new RegExp(`^${SUB}$`).exec(m[3]);if(s){viSnap();VI.L.forEach((l,i)=>{if(hit(l)){const r=new RegExp(s[1],(s[3]||"").includes("g")?"g":"");VI.L[i]=l.replace(r,()=>s[2])}});VI.changed=false;return}
    VI.msg="This vi runs :g with d or s";return}
  VI.msg=`Not an editor command here: ${cmd}`}
function viClose(){VI.on=false;VI.vis=null;host.viShow(false);host.afterVi()}

/* ========== motions and text objects ========== */
function viMotion(k,n){let{r,c}=VI,pos={r,c};
  for(let i=0;i<n;i++){switch(k){
    case"h":case"ArrowLeft":pos.c=Math.max(0,pos.c-1);break;
    case"l":case"ArrowRight":pos.c=pos.c+1;break;
    case"j":case"ArrowDown":pos.r=Math.min(VI.L.length-1,pos.r+1);break;
    case"k":case"ArrowUp":pos.r=Math.max(0,pos.r-1);break;
    case"w":pos=mWord(pos.r,pos.c);break;
    case"e":pos=mEnd(pos.r,pos.c);break;
    case"b":pos=mBack(pos.r,pos.c);break;
    case"0":pos.c=0;break;
    case"^":pos.c=Math.max(0,VI.L[pos.r].search(/\S/));break;
    case"$":pos.c=Math.max(0,VI.L[pos.r].length-1);break;
    case"G":pos={r:VI.count?Math.min(n,VI.L.length)-1:VI.L.length-1,c:0};return pos;
    default:return null}}
  return pos}
function viObject(kind,ch){const l=viLine(),c=VI.c;
  if(ch==="w"){let a=c,b=c;const t=cls(l[c]);while(a>0&&cls(l[a-1])===t)a--;while(b+1<l.length&&cls(l[b+1])===t)b++;
    if(kind==="a"){let e=b;while(e+1<l.length&&/\s/.test(l[e+1]))e++;if(e>b)b=e;else while(a>0&&/\s/.test(l[a-1]))a--}return[a,b+1]}
  if(ch==='"'||ch==="'"||ch==="`"){const q=[];for(let i=0;i<l.length;i++)if(l[i]===ch&&l[i-1]!=="\\")q.push(i);
    for(let i=0;i+1<q.length;i+=2)if(c<=q[i+1])return kind==="i"?[q[i]+1,q[i+1]]:[q[i],q[i+1]+1];return null}
  const pair={"(":"()",")":"()",b:"()","[":"[]","]":"[]","{":"{}","}":"{}",B:"{}"}[ch];if(!pair)return null;
  let d=0,a=-1;for(let i=c;i>=0;i--){if(l[i]===pair[1]&&i!==c)d++;else if(l[i]===pair[0]){if(d===0){a=i;break}d--}}
  if(a<0)return null;d=0;let b=-1;for(let i=a+1;i<l.length;i++){if(l[i]===pair[0])d++;else if(l[i]===pair[1]){if(d===0){b=i;break}d--}}
  if(b<0)return null;return kind==="i"?[a+1,b]:[a,b+1]}
/* Where f, F, t and T land on this line, or -1. */
function viChar(d,k,forOp){const l=viLine();
  if(d==="f")return l.indexOf(k,VI.c+1);
  if(d==="F")return VI.c>0?l.lastIndexOf(k,VI.c-1):-1;
  if(d==="t"){const i=l.indexOf(k,VI.c+1);return i>=0&&(forOp||i>VI.c+1)?i-1:-1}
  const i=VI.c>0?l.lastIndexOf(k,VI.c-1):-1;return i>=0&&(forOp||i<VI.c-1)?i+1:-1}
function viF(d,k){const i=viChar(d,k);if(i>=0)VI.c=i}
const FLIP={f:"F",F:"f",t:"T",T:"t"};

/* ========== visual modes ========== */
function visRange(){const v=VI.vis,a={r:v.r,c:v.c},b={r:VI.r,c:VI.c};return a.r<b.r||(a.r===b.r&&a.c<=b.c)?[a,b]:[b,a]}
/* For the editor: the selected columns on a row, as [from, to) or null. */
function viSelection(r){if(!VI.vis)return null;const[s,e]=visRange();if(r<s.r||r>e.r)return null;const len=(VI.L[r]||"").length;
  if(VI.vis.kind==="V")return[0,Math.max(len,1)];
  if(VI.vis.kind==="b"){const a=Math.min(VI.vis.c,VI.c),b=Math.max(VI.vis.c,VI.c);return[a,b+1]}
  return[r===s.r?s.c:0,r===e.r?e.c+1:Math.max(len,1)]}
function viVisual(k){const v=VI.vis,[s,e]=visRange();const op=k==="x"?"d":k;
  const off=()=>{VI.vis=null;VI.count=""};
  if(k==="Escape"){off();return true}
  if((k==="v"&&v.kind==="v")||(k==="V"&&v.kind==="V")){off();return true}
  if(k==="v"||k==="V"){v.kind=k;return true}
  if(k===">"||k==="<"){viSnap();for(let i=s.r;i<=e.r;i++)VI.L[i]=k===">"?"  "+VI.L[i]:VI.L[i].replace(/^ {1,2}/,"");VI.r=s.r;VI.c=0;off();viDone();return true}
  if(v.kind==="V"&&"dyc".includes(op)){off();viOperate(op,{r:s.r,c:0},{r:e.r,c:0},true);if(VI.mode==="normal"){viClamp();viDone()}return true}
  if(v.kind==="v"&&"dyc".includes(op)){const first=VI.L[s.r],last=VI.L[e.r];
    const text=s.r===e.r?first.slice(s.c,e.c+1):[first.slice(s.c),...VI.L.slice(s.r+1,e.r),last.slice(0,e.c+1)].join("\n");
    setReg([text],false);off();VI.r=s.r;VI.c=s.c;if(op==="y")return true;
    viSnap();VI.L.splice(s.r,e.r-s.r+1,first.slice(0,s.c)+last.slice(e.c+1));if(op==="c")VI.mode="insert";else{viClamp();viDone()}return true}
  if(v.kind==="b"){const a=Math.min(v.c,VI.c),b=Math.max(v.c,VI.c);
    if(k==="I"){viSnap();VI.blockIns={from:s.r+1,to:e.r,col:a,len:VI.L[s.r].length};off();VI.r=s.r;VI.c=a;VI.mode="insert";return true}
    if("dy".includes(op)){const part=[];if(op==="d")viSnap();for(let i=s.r;i<=e.r;i++){const l=VI.L[i];part.push(l.slice(a,b+1));if(op==="d")VI.L[i]=l.slice(0,a)+l.slice(b+1)}setReg(part,false);off();VI.r=s.r;VI.c=a;if(op==="d"){viClamp();viDone()}return true}}
  return false}

/* ========== the keyboard ========== */
function viKey(k,ctrl){
  if(!VI.replay){if(!["Shift","Control","Alt","Meta","CapsLock","Tab"].includes(k))VI.keys++}
  if(VI.macroRec&&!VI.replay&&!(k==="q"&&VI.mode==="normal"&&!VI.pending&&!ctrl))VI.macroRec.keys.push([k,ctrl]);
  VI.msg=VI.mode==="command"?VI.msg:"";
  const rec=()=>{if(!VI.replay)VI.rec.push(k)};
  if(VI.mode==="insert"){rec();
    if(k==="Escape"||(ctrl&&k==="[")){VI.mode="normal";
      if(VI.blockIns){const b=VI.blockIns,typed=VI.L[VI.r].slice(b.col,b.col+VI.L[VI.r].length-b.len);for(let i=b.from;i<=b.to;i++){const l=VI.L[i].padEnd(b.col);VI.L[i]=l.slice(0,b.col)+typed+l.slice(b.col)}VI.blockIns=null}
      VI.c=Math.max(0,VI.c-1);viClamp();viDone();return}
    if(k==="Backspace"){if(VI.c>0){const l=viLine();VI.L[VI.r]=l.slice(0,VI.c-1)+l.slice(VI.c);VI.c--}else if(VI.r>0){const l=viLine(),p=VI.L[VI.r-1];VI.L.splice(VI.r,1);VI.r--;VI.c=p.length;VI.L[VI.r]=p+l}return}
    if(k==="Enter"){const l=viLine();VI.L[VI.r]=l.slice(0,VI.c);VI.L.splice(VI.r+1,0,l.slice(VI.c));VI.r++;VI.c=0;return}
    if(k.length===1)viInsert(k);return}
  if(VI.mode==="command"){
    if(k==="Escape"){VI.mode="normal";VI.cmd="";return}
    if(k==="Backspace"){VI.cmd=VI.cmd.slice(0,-1);if(!VI.cmd){VI.mode="normal"}return}
    if(k==="Enter"){const c=VI.cmd;VI.mode="normal";VI.cmd="";if(c[0]===":")viExCmd(c.slice(1));else{VI.search=c.slice(1);viFind(c[0]==="/"?1:-1)}return}
    if(k.length===1)VI.cmd+=k;return}
  /* normal, and visual which shares its motions */
  if(ctrl&&k!=="r"&&k!=="v"&&k!=="[")return;
  if(ctrl&&k==="[")k="Escape";
  if(VI.pending){const p=VI.pending;VI.pending="";
    if(p==="r"){rec();if(k.length===1){viSnap();const l=viLine();VI.L[VI.r]=l.slice(0,VI.c)+k+l.slice(VI.c+1)}viDone();return}
    if("fFtT".includes(p)){if(VI.op){rec();const op=VI.op;VI.op="";const i=viChar(p,k,true);VI.fch={d:p,k};if(i>=0){const forward=p==="f"||p==="t";viOperate(op,{r:VI.r,c:VI.c},{r:VI.r,c:forward?i+1:i},false);if(VI.mode==="normal"){viClamp();viDone()}}VI.count="";return}
      VI.fch={d:p,k};viF(p,k);return}
    if(p==="g"){if(k==="g"){if(VI.op){viOperate(VI.op,{r:VI.r,c:0},{r:0,c:0},true);VI.op="";viDone()}else{VI.r=VI.count?Math.min(+VI.count,VI.L.length)-1:0;VI.c=0}}VI.count="";return}
    if(p==="Z"){if(k==="Z")viExCmd("wq");return}
    if(p==='"'){VI.regSel=k;return}
    if(p==="m"){VI.marks[k]={r:VI.r,c:VI.c};VI.msg=`mark ${k} set`;return}
    if(p==="'"){const mk=VI.marks[k];if(!mk){VI.msg=`Mark not set: ${k}`;VI.op="";return}if(VI.op){rec();const op=VI.op;VI.op="";viOperate(op,{r:VI.r,c:0},{r:mk.r,c:0},true);if(VI.mode==="normal")viDone();return}VI.r=mk.r;VI.c=Math.max(0,viLine().search(/\S/));return}
    if(p==="q"){VI.macroRec={name:k,keys:[]};VI.msg=`recording @${k}`;return}
    if(p==="@"){const name=k==="@"?VI.lastMacro:k,keys=VI.macros[name],n=+(VI.count||1);VI.count="";if(!keys){VI.msg=`Nothing recorded in @${k}`;return}if(VI.replay)return;
      VI.lastMacro=name;VI.replay=true;for(let i=0;i<n;i++)for(const[x,c]of keys)viKey(x,c);VI.replay=false;VI.changed=false;VI.rec=[];return}
    if(p==="obj-i"||p==="obj-a"){rec();const op=VI.op;VI.op="";VI.count="";const rng2=viObject(p[4],k);if(rng2){viOperate(op,{r:VI.r,c:rng2[0]},{r:VI.r,c:rng2[1]},false);if(VI.mode==="normal"){viClamp();viDone()}}return}
    return}
  if(/^[1-9]$/.test(k)||(k==="0"&&VI.count)){VI.count+=k;if(!VI.op)VI.rec=[k];else rec();return}
  VI.used.add(ctrl?"C-"+k:k);
  const n=+(VI.count||1);
  if(VI.vis&&viVisual(k))return;
  if(VI.op){rec();const op=VI.op;
    if(op===">"||op==="<"){VI.op="";VI.count="";if(k===op){viSnap();for(let i=VI.r;i<Math.min(VI.r+n,VI.L.length);i++)VI.L[i]=op===">"?"  "+VI.L[i]:VI.L[i].replace(/^ {1,2}/,"");viDone()}return}
    if(k===op){const end={r:Math.min(VI.r+n-1,VI.L.length-1),c:0};VI.op="";VI.count="";viOperate(op,{r:VI.r,c:VI.c},end,true);if(VI.mode==="normal")viDone();return}
    if(k==="i"||k==="a"){VI.pending="obj-"+k;return}
    if("fFtT".includes(k)||k==="'"){VI.pending=k;return}
    if(k==="g"){VI.pending="g";return}
    let to;
    if(k==="w"&&op==="c")to=(p=>({r:p.r,c:p.c+1}))(viMotion("e",n));
    else if(k==="w"){const p=viMotion("w",n);to=p.r!==VI.r||p.eol?{r:VI.r,c:viLine().length}:p}
    else if(k==="e"){const p=viMotion("e",n);to={r:p.r,c:p.c+1}}
    else if(k==="$")to={r:VI.r,c:viLine().length};
    else to=viMotion(k,n);
    VI.op="";VI.count="";
    if(to)viOperate(op,{r:VI.r,c:VI.c},to,false);
    if(VI.mode==="normal"){viClamp();viDone()}return}
  const m=viMotion(k,n);
  if(m){VI.r=m.r;VI.c=m.c;viClamp();VI.count="";return}
  if(VI.vis){if(k==="g"||"fFtT".includes(k))VI.pending=k;else if(k===";"&&VI.fch)viF(VI.fch.d,VI.fch.k);else if(k===","&&VI.fch)viF(FLIP[VI.fch.d],VI.fch.k);return}
  const startRec=()=>{VI.rec=(VI.count?[...VI.count]:[]).concat(k)};
  const enterInsert=()=>{VI.mode="insert";VI.count=""};
  if(ctrl&&k==="r"){const f=VI.redo.pop();if(f){VI.undo.push({L:[...VI.L],r:VI.r,c:VI.c});VI.L=f.L;VI.r=f.r;VI.c=f.c;VI.dirty=true;VI.msg="redo"}else VI.msg="Already at newest change";viClamp();VI.count="";return}
  if(ctrl&&k==="v"){VI.vis={kind:"b",r:VI.r,c:VI.c};VI.count="";return}
  switch(k){
    case"i":if(!VI.replay)startRec();viSnap();enterInsert();break;
    case"a":if(!VI.replay)startRec();viSnap();VI.c=Math.min(VI.c+1,viLine().length);enterInsert();break;
    case"I":if(!VI.replay)startRec();viSnap();VI.c=Math.max(0,viLine().search(/\S/));enterInsert();break;
    case"A":if(!VI.replay)startRec();viSnap();VI.mode="insert";VI.c=viLine().length;VI.count="";break;
    case"o":if(!VI.replay)startRec();viSnap();VI.L.splice(VI.r+1,0,"");VI.r++;VI.c=0;enterInsert();break;
    case"O":if(!VI.replay)startRec();viSnap();VI.L.splice(VI.r,0,"");VI.c=0;enterInsert();break;
    case"x":if(!VI.replay)startRec();if(viLine().length){viSnap();const l=viLine();setReg([l.slice(VI.c,VI.c+n)],false);VI.L[VI.r]=l.slice(0,VI.c)+l.slice(VI.c+n);viClamp()}VI.count="";viDone();break;
    case"D":if(!VI.replay)startRec();viSnap();VI.L[VI.r]=viLine().slice(0,VI.c);viClamp();viDone();break;
    case"C":if(!VI.replay)startRec();viSnap();VI.L[VI.r]=viLine().slice(0,VI.c);enterInsert();break;
    case"J":if(!VI.replay)startRec();if(VI.r<VI.L.length-1){viSnap();const j=viLine().length;VI.L[VI.r]=viLine().replace(/\s+$/,"")+" "+VI.L[VI.r+1].trim();VI.L.splice(VI.r+1,1);VI.c=j}viDone();break;
    case"d":case"c":case"y":if(!VI.replay)startRec();VI.op=k;break;
    case">":case"<":if(!VI.replay)startRec();VI.op=k;break;
    case"r":if(!VI.replay)startRec();VI.pending="r";break;
    case"g":case"Z":case"f":case"F":case"t":case"T":case'"':case"m":case"'":case"@":VI.pending=k;break;
    case"q":if(VI.macroRec){VI.macros[VI.macroRec.name]=VI.macroRec.keys;VI.msg=`recorded @${VI.macroRec.name}`;VI.macroRec=null}else VI.pending="q";break;
    case"v":case"V":VI.vis={kind:k,r:VI.r,c:VI.c};VI.count="";break;
    case";":if(VI.fch)viF(VI.fch.d,VI.fch.k);break;
    case",":if(VI.fch)viF(FLIP[VI.fch.d],VI.fch.k);break;
    case"p":case"P":{if(!VI.replay)startRec();let src={L:VI.reg,lineWise:VI.regLine};if(VI.regSel){src=VI.regs[VI.regSel]||{L:[],lineWise:true};VI.regSel=""}if(!src.L.length)break;viSnap();
      if(src.lineWise){const at=k==="p"?VI.r+1:VI.r;VI.L.splice(at,0,...src.L);VI.r=at;VI.c=0}
      else{const l=viLine(),at=k==="p"?Math.min(VI.c+1,l.length):VI.c,parts=(l.slice(0,at)+src.L[0]+l.slice(at)).split("\n");VI.L.splice(VI.r,1,...parts);VI.c=at+src.L[0].length-1;viClamp()}
      viDone();break}
    case"u":{const u=VI.undo.pop();if(u){VI.redo.push({L:[...VI.L],r:VI.r,c:VI.c});VI.L=u.L;VI.r=u.r;VI.c=u.c;VI.dirty=VI.undo.length>0;VI.msg="undo"}else VI.msg="Already at oldest change";viClamp();break}
    case".":if(VI.last&&!VI.replay){VI.replay=true;for(const x of VI.last)viKey(x,false);VI.replay=false;VI.changed=false}break;
    case"n":viFind(1);break;
    case"N":viFind(-1);break;
    case":":VI.mode="command";VI.cmd=":";break;
    case"/":VI.mode="command";VI.cmd="/";break;
    case"?":VI.mode="command";VI.cmd="?";break;
    case"Escape":VI.count="";VI.op="";VI.regSel="";break;
    default:VI.msg=`${k} is not mapped in this vi`}
  if(k!=="."&&!"dcyrgZfFtT><\"m'@".includes(k))VI.count="";}
function viDone(){if(VI.changed&&!VI.replay){VI.last=[...VI.rec]}VI.changed=false;VI.rec=[]}

export { VI, viOpen, viKey, viSelection };
