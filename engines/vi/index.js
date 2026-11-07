/* A small real vi: modes, motions, operators, counts, dot-repeat, search and ex commands.
   Ported from legacy/uptime-arcade-source/src. Framework-free: no React, no DOM. */
import { S, host } from '../host.js';
import { fs, lines } from '../fs/index.js';
import { sh, writeFile } from '../shell/index.js';

/* ========== a small real vi ========== */
const VI={on:false,path:"",shown:"",L:[""],r:0,c:0,mode:"normal",cmd:"",msg:"",keys:0,undo:[],count:"",op:"",pending:"",reg:[],regLine:true,search:"",dirty:false,rec:[],last:null,changed:false,replay:false,top:0,fch:null};
function viOpen(p,shown){const n=fs.get(p);if(n&&n.t==="d")return sh.e(`vi: ${shown}: Is a directory`);
  Object.assign(VI,{on:true,path:p,shown,L:n?lines(n.c):[],r:0,c:0,mode:"normal",cmd:"",msg:n?`"${shown}" ${lines(n.c).length}L`:`"${shown}" [New File]`,keys:0,undo:[],count:"",op:"",pending:"",dirty:false,rec:[],last:null,top:0});
  if(!VI.L.length)VI.L=[""];host.viShow(true)}
function viSnap(){VI.undo.push({L:[...VI.L],r:VI.r,c:VI.c});if(VI.undo.length>50)VI.undo.shift();VI.changed=true;VI.dirty=true}
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
function viOperate(op,from,to,lineWise){
  viSnap();
  if(lineWise){const a=Math.min(from.r,to.r),b=Math.max(from.r,to.r);VI.reg=VI.L.slice(a,b+1);VI.regLine=true;if(op==="y"){VI.undo.pop();VI.changed=false;VI.dirty=VI.undo.length>0;VI.r=a;return}
    VI.L.splice(a,b-a+1);if(op==="c"){VI.L.splice(a,0,"");VI.r=a;VI.c=0;VI.mode="insert";return}if(!VI.L.length)VI.L=[""];VI.r=Math.min(a,VI.L.length-1);VI.c=0;return}
  if(from.r!==to.r)to={r:from.r,c:VI.L[from.r].length};
  const a=Math.min(from.c,to.c),b=Math.max(from.c,to.c),l=VI.L[from.r];VI.reg=[l.slice(a,b)];VI.regLine=false;
  if(op==="y"){VI.undo.pop();VI.changed=false;return}
  VI.L[from.r]=l.slice(0,a)+l.slice(b);VI.c=a;if(op==="c")VI.mode="insert"}
function viExCmd(c){const cmd=c.trim();
  const write=()=>{const body=VI.L.join("\n")+"\n";writeFile(VI.path,body,"vi");S.viKeys[VI.path]=(S.viKeys[VI.path]||0)+VI.keys;VI.dirty=false;VI.msg=`"${VI.shown}" ${VI.L.length}L written`;return true};
  if(cmd==="w")return write();
  if(cmd==="wq"||cmd==="x"){write();viClose();return}
  if(cmd==="q"){if(VI.dirty){VI.msg="No write since last change (use :q! to discard)";return}viClose();return}
  if(cmd==="q!"){viClose();return}
  if(/^\d+$/.test(cmd)){VI.r=+cmd-1;VI.c=0;return}
  const sm=/^(%|\d+,\d+)?s\/((?:\\\/|[^/])*)\/((?:\\\/|[^/])*)(?:\/([gi]*))?$/.exec(cmd);
  if(sm){let a=VI.r,b=VI.r;if(sm[1]==="%"){a=0;b=VI.L.length-1}else if(sm[1]){const q=sm[1].split(",");a=+q[0]-1;b=+q[1]-1}
    let re;try{re=new RegExp(sm[2].replace(/\\\//g,"/"),(sm[4]||"").includes("g")?"g":"")}catch{VI.msg="Bad pattern";return}
    viSnap();let n=0;const rep=sm[3].replace(/\\\//g,"/");for(let i=a;i<=b&&i<VI.L.length;i++){const nl=VI.L[i].replace(re,()=>{n++;return rep});VI.L[i]=nl}
    VI.changed=false;VI.msg=n?`${n} substitutions`:"Pattern not found";return}
  VI.msg=`Not an editor command here: ${cmd}`}
function viClose(){VI.on=false;host.viShow(false);host.afterVi()}
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
function viKey(k,ctrl){
  if(!VI.replay){if(!["Shift","Control","Alt","Meta","CapsLock","Tab"].includes(k))VI.keys++}
  VI.msg=VI.mode==="command"?VI.msg:"";
  const rec=()=>{if(!VI.replay)VI.rec.push(k)};
  if(VI.mode==="insert"){rec();
    if(k==="Escape"||(ctrl&&k==="[")){VI.mode="normal";VI.c=Math.max(0,VI.c-1);viClamp();viDone();return}
    if(k==="Backspace"){if(VI.c>0){const l=viLine();VI.L[VI.r]=l.slice(0,VI.c-1)+l.slice(VI.c);VI.c--}else if(VI.r>0){const l=viLine(),p=VI.L[VI.r-1];VI.L.splice(VI.r,1);VI.r--;VI.c=p.length;VI.L[VI.r]=p+l}return}
    if(k==="Enter"){const l=viLine();VI.L[VI.r]=l.slice(0,VI.c);VI.L.splice(VI.r+1,0,l.slice(VI.c));VI.r++;VI.c=0;return}
    if(k.length===1)viInsert(k);return}
  if(VI.mode==="command"){
    if(k==="Escape"){VI.mode="normal";VI.cmd="";return}
    if(k==="Backspace"){VI.cmd=VI.cmd.slice(0,-1);if(!VI.cmd){VI.mode="normal"}return}
    if(k==="Enter"){const c=VI.cmd;VI.mode="normal";VI.cmd="";if(c[0]===":")viExCmd(c.slice(1));else{VI.search=c.slice(1);viFind(c[0]==="/"?1:-1)}return}
    if(k.length===1)VI.cmd+=k;return}
  /* normal */
  if(VI.pending==="r"){rec();VI.pending="";if(k.length===1){viSnap();const l=viLine();VI.L[VI.r]=l.slice(0,VI.c)+k+l.slice(VI.c+1)}viDone();return}
  if(VI.pending==="f"||VI.pending==="F"){const d=VI.pending;VI.pending="";VI.fch={d,k};viF(d,k);return}
  if(VI.pending==="g"){VI.pending="";if(k==="g"){if(VI.op){viOperate(VI.op,{r:VI.r,c:0},{r:0,c:0},true);VI.op="";viDone()}else{VI.r=VI.count?+VI.count-1:0;VI.c=0}}VI.count="";return}
  if(VI.pending==="Z"){VI.pending="";if(k==="Z")viExCmd("wq");return}
  if(/^[1-9]$/.test(k)||(k==="0"&&VI.count)){VI.count+=k;if(!VI.op)VI.rec=[k];else rec();return}
  const n=+(VI.count||1);
  if(VI.op){rec();const op=VI.op;
    if(op===">"||op==="<"){VI.op="";VI.count="";if(k===op){viSnap();for(let i=VI.r;i<Math.min(VI.r+n,VI.L.length);i++)VI.L[i]=op===">"?"  "+VI.L[i]:VI.L[i].replace(/^ {1,2}/,"");viDone()}return}
    if(k===op){const end={r:Math.min(VI.r+n-1,VI.L.length-1),c:0};VI.op="";VI.count="";viOperate(op,{r:VI.r,c:VI.c},end,true);if(VI.mode==="normal")viDone();return}
    let to;
    if(k==="w"&&op==="c")to=(p=>({r:p.r,c:p.c+1}))(viMotion("e",n));
    else if(k==="w"){const p=viMotion("w",n);to=p.r!==VI.r||p.eol?{r:VI.r,c:viLine().length}:p}
    else if(k==="e"){const p=viMotion("e",n);to={r:p.r,c:p.c+1}}
    else if(k==="$")to={r:VI.r,c:viLine().length};
    else to=viMotion(k,n);
    VI.op="";VI.count="";
    if(to)viOperate(op,{r:VI.r,c:VI.c},to,false);
    if(VI.mode==="normal")viDone();return}
  const m=viMotion(k,n);
  if(m){VI.r=m.r;VI.c=m.c;viClamp();VI.count="";return}
  const startRec=()=>{VI.rec=(VI.count?[...VI.count]:[]).concat(k)};
  const enterInsert=()=>{VI.mode="insert";VI.count=""};
  switch(k){
    case"i":if(!VI.replay)startRec();viSnap();enterInsert();break;
    case"a":if(!VI.replay)startRec();viSnap();VI.c=Math.min(VI.c+1,viLine().length);enterInsert();break;
    case"I":if(!VI.replay)startRec();viSnap();VI.c=Math.max(0,viLine().search(/\S/));enterInsert();break;
    case"A":if(!VI.replay)startRec();viSnap();VI.mode="insert";VI.c=viLine().length;VI.count="";break;
    case"o":if(!VI.replay)startRec();viSnap();VI.L.splice(VI.r+1,0,"");VI.r++;VI.c=0;enterInsert();break;
    case"O":if(!VI.replay)startRec();viSnap();VI.L.splice(VI.r,0,"");VI.c=0;enterInsert();break;
    case"x":if(!VI.replay)startRec();if(viLine().length){viSnap();const l=viLine();VI.reg=[l.slice(VI.c,VI.c+n)];VI.regLine=false;VI.L[VI.r]=l.slice(0,VI.c)+l.slice(VI.c+n);viClamp()}VI.count="";viDone();break;
    case"D":if(!VI.replay)startRec();viSnap();VI.L[VI.r]=viLine().slice(0,VI.c);viClamp();viDone();break;
    case"C":if(!VI.replay)startRec();viSnap();VI.L[VI.r]=viLine().slice(0,VI.c);enterInsert();break;
    case"J":if(!VI.replay)startRec();if(VI.r<VI.L.length-1){viSnap();const j=viLine().length;VI.L[VI.r]=viLine().replace(/\s+$/,"")+" "+VI.L[VI.r+1].trim();VI.L.splice(VI.r+1,1);VI.c=j}viDone();break;
    case"d":case"c":case"y":if(!VI.replay)startRec();VI.op=k;break;
    case">":case"<":if(!VI.replay)startRec();VI.op=k;break;
    case"r":if(!VI.replay)startRec();VI.pending="r";break;
    case"g":case"Z":VI.pending=k;break;
    case"f":case"F":VI.pending=k;break;
    case";":if(VI.fch)viF(VI.fch.d,VI.fch.k);break;
    case"p":case"P":{if(!VI.replay)startRec();if(!VI.reg.length)break;viSnap();
      if(VI.regLine){const at=k==="p"?VI.r+1:VI.r;VI.L.splice(at,0,...VI.reg);VI.r=at;VI.c=0}
      else{const l=viLine(),at=k==="p"?Math.min(VI.c+1,l.length):VI.c;VI.L[VI.r]=l.slice(0,at)+VI.reg[0]+l.slice(at);VI.c=at+VI.reg[0].length-1}
      viDone();break}
    case"u":{const u=VI.undo.pop();if(u){VI.L=u.L;VI.r=u.r;VI.c=u.c;VI.dirty=VI.undo.length>0;VI.msg="undo"}else VI.msg="Already at oldest change";viClamp();break}
    case".":if(VI.last&&!VI.replay){VI.replay=true;for(const x of VI.last)viKey(x,false);VI.replay=false;VI.changed=false}break;
    case"n":viFind(1);break;
    case"N":viFind(-1);break;
    case":":VI.mode="command";VI.cmd=":";break;
    case"/":VI.mode="command";VI.cmd="/";break;
    case"?":VI.mode="command";VI.cmd="?";break;
    case"Escape":VI.count="";VI.op="";break;
    default:VI.msg=`${k} is not mapped in this vi`}
  if(k!=="."&&!"dcyrgZfF><".includes(k))VI.count="";}
function viF(d,k){const l=viLine();const i=d==="f"?l.indexOf(k,VI.c+1):l.lastIndexOf(k,VI.c-1);if(i>=0)VI.c=i}
function viDone(){if(VI.changed&&!VI.replay){VI.last=[...VI.rec]}VI.changed=false;VI.rec=[]}

export { VI, viOpen, viKey };
